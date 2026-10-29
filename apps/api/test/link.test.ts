import { createHash, createHmac, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload, type KeyLike } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { FACEBOOK_GRAPH_VERSION, type OAuthConfig } from "../src/oauth";

const GOOGLE_CLIENT = "google-client.apps.googleusercontent.com";
const APPLE_BUNDLE = "com.knightaiav.dandelist";
const FB_APP = "fb-app-123";
const FB_SECRET = "fb-secret-test";
const FB_TOKEN = "EAAB-test-token";
const WEB = "http://localhost:8081/auth/callback";
const WEB_ORIGINS = ["http://localhost:8081", "https://dandelist.knightaiav.com"];
const GRAPH = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

type Keys = { privateKey: KeyLike; publicKey: KeyLike };
let googleKeys: Keys;
let appleKeys: Keys;

beforeAll(async () => {
  [googleKeys, appleKeys] = await Promise.all([generateKeyPair("RS256"), generateKeyPair("RS256")]);
});

let db: Db;
let clock: Date;
let mail: { to: string; code: string }[];
let calls: string[];
let nextGoogle: JWTPayload;
/** What the fake Facebook says about the person: an id, a name, and an email only when they confirmed one. */
let nextFacebook: Record<string, unknown>;
let lastChallenge: string;

const nowS = () => Math.floor(clock.getTime() / 1000);
const b64sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function signed(keys: Keys, kid: string, claims: JWTPayload, iss: string, aud: string) {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer(iss).setAudience(aud).setIssuedAt(nowS()).setExpirationTime(nowS() + 600).sign(keys.privateKey);
}

/** Stands in for Google, Apple and Facebook's Graph API. */
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? init.body : "";
  calls.push(url);
  if (url === "https://www.googleapis.com/oauth2/v3/certs") return json({ keys: [{ ...(await exportJWK(googleKeys.publicKey)), kid: "g1", alg: "RS256", use: "sig" }] });
  if (url === "https://appleid.apple.com/auth/keys") return json({ keys: [{ ...(await exportJWK(appleKeys.publicKey)), kid: "a1", alg: "RS256", use: "sig" }] });
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "good-code" || b64sha(form.get("code_verifier") ?? "") !== lastChallenge) return json({ error: "invalid_grant" }, 400);
    return json({ id_token: await signed(googleKeys, "g1", nextGoogle, "https://accounts.google.com", GOOGLE_CLIENT) });
  }
  const u = new URL(url);
  if (`${u.origin}${u.pathname}` === `${GRAPH}/oauth/access_token`) {
    const q = u.searchParams;
    const ok = q.get("code") === "good-code" && q.get("client_id") === FB_APP && q.get("client_secret") === FB_SECRET && q.get("redirect_uri") === "https://api.test/auth/oauth/facebook/callback";
    return ok ? json({ access_token: FB_TOKEN, token_type: "bearer", expires_in: 5183944 }) : json({ error: { message: "Invalid verification code format.", type: "OAuthException", code: 100 } }, 400);
  }
  if (`${u.origin}${u.pathname}` === `${GRAPH}/me`) {
    const q = u.searchParams;
    const proof = createHmac("sha256", FB_SECRET).update(FB_TOKEN).digest("hex");
    if (q.get("access_token") !== FB_TOKEN || q.get("appsecret_proof") !== proof) return json({ error: { message: "Invalid appsecret_proof provided in the API argument", code: 100 } }, 400);
    expect(q.get("fields")).toBe("id,name,email");
    return json(nextFacebook);
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const fullConfig = (): OAuthConfig => ({
  apiUrl: "https://api.test",
  production: false,
  google: { clientId: GOOGLE_CLIENT, clientSecret: "google-secret" },
  apple: { bundleId: APPLE_BUNDLE },
  facebook: { appId: FB_APP, appSecret: FB_SECRET },
  fetch: fakeFetch,
});

function makeApp(oauth?: OAuthConfig) {
  return createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: WEB_ORIGINS,
    oauth,
  });
}
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  clock = new Date("2026-10-28T12:00:00Z");
  mail = [];
  calls = [];
  nextGoogle = {};
  nextFacebook = {};
  lastChallenge = "";
  app = makeApp(fullConfig());
});

type Json = Record<string, any>;
const send = (method: string, path: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const newVerifier = () => randomBytes(32).toString("hex");

async function emailSignIn(email: string) {
  await send("POST", "/auth/email/start", { email });
  const res = await send("POST", "/auth/email/verify", { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}

/** Where the API sent the browser back to, split into the address and its query. */
function landing(res: Response) {
  const loc = new URL(res.headers.get("Location")!);
  const q = loc.searchParams;
  return { at: `${loc.protocol}//${loc.host}${loc.pathname}`, intent: q.get("intent"), ticket: q.get("ticket"), error: q.get("error") };
}

/** Opens a start address in "the browser": returns the provider's authorize URL, the state and the binding cookie. */
async function openStart(pathAndQuery: string) {
  const res = await app.request(pathAndQuery);
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("Location")!);
  lastChallenge = to.searchParams.get("code_challenge") ?? "";
  return { to, state: to.searchParams.get("state")!, nonce: to.searchParams.get("nonce"), cookie: (res.headers.get("Set-Cookie") ?? "").split(";")[0]! };
}

const callback = (provider: string, query: Record<string, string>, cookie: string) =>
  app.request(`/auth/oauth/${provider}/callback?${new URLSearchParams(query)}`, { headers: { Cookie: cookie } });

/** A plain sign-in with a provider, as the sign-in screen does it. */
async function signInWith(provider: "google" | "facebook", who: JWTPayload | Record<string, unknown>) {
  const verifier = newVerifier();
  const s = await openStart(`/auth/oauth/${provider}/start?redirect=${encodeURIComponent(WEB)}&challenge=${b64sha(verifier)}`);
  if (provider === "google") nextGoogle = { nonce: s.nonce!, ...who };
  else nextFacebook = who;
  const res = await callback(provider, { code: "good-code", state: s.state }, s.cookie);
  return { res, verifier, s };
}

/** Starts a link from settings: asks the API for the address, then opens it. */
async function startLink(token: string, provider: string, redirect = WEB) {
  const verifier = newVerifier();
  const res = await send("POST", `/auth/link/${provider}`, { redirect, challenge: b64sha(verifier) }, token);
  expect(res.status).toBe(200);
  const url = new URL(((await res.json()) as { url: string }).url);
  expect(url.origin).toBe("https://api.test");
  expect(url.pathname).toBe(`/auth/oauth/${provider}/start`);
  return { verifier, path: url.pathname + url.search, link: url.searchParams.get("link")! };
}

async function linkGoogle(token: string, who: JWTPayload) {
  const l = await startLink(token, "google");
  const s = await openStart(l.path);
  nextGoogle = { nonce: s.nonce!, ...who };
  return { ...l, res: await callback("google", { code: "good-code", state: s.state }, s.cookie) };
}

const redeemLink = (ticket: string, verifier: string, token?: string) => send("POST", "/auth/link/redeem", { ticket, verifier }, token);

describe("Facebook sign-in", () => {
  it("is offered only when both the app id and the secret are set", async () => {
    expect(((await (await app.request("/auth/providers")).json()) as Json).providers).toContainEqual({ id: "facebook", web: true, native: true });
    app = makeApp({ ...fullConfig(), facebook: { appId: FB_APP, appSecret: "" } });
    expect(((await (await app.request("/auth/providers")).json()) as Json).providers.map((p: Json) => p.id)).not.toContain("facebook");
    expect((await app.request(`/auth/oauth/facebook/start?redirect=${encodeURIComponent(WEB)}&challenge=${b64sha(newVerifier())}`)).status).toBe(404);
  });

  it(`runs Facebook's code flow on Graph ${FACEBOOK_GRAPH_VERSION}, with appsecret_proof, and signs in with a confirmed email`, async () => {
    const { res, verifier, s } = await signInWith("facebook", { id: "10229", name: "Ada Lovelace", email: "Ada@Example.com" });
    expect(s.to.origin + s.to.pathname).toBe(`https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
    expect(Object.fromEntries([...s.to.searchParams].filter(([k]) => k !== "state"))).toEqual({
      client_id: FB_APP,
      redirect_uri: "https://api.test/auth/oauth/facebook/callback",
      response_type: "code",
      scope: "email,public_profile",
    });
    // The secret never travels through the browser.
    expect(s.to.toString()).not.toContain(FB_SECRET);
    const { ticket, intent } = landing(res);
    expect(intent).toBeNull();
    const r = await send("POST", "/auth/oauth/redeem", { ticket, verifier });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Json).user.email).toBe("ada@example.com");
    expect((await db.query("select provider, subject, email, name from user_identities")).rows).toEqual([{ provider: "facebook", subject: "10229", email: "ada@example.com", name: "Ada Lovelace" }]);
    expect(calls.filter((c) => c.startsWith(GRAPH))).toHaveLength(2);
  });

  it("can't create an account without an email, but a linked Facebook signs straight in", async () => {
    expect(landing((await signInWith("facebook", { id: "777", name: "Phone Person" })).res).error).toBe("no_email");
    expect((await db.query("select count(*)::int as n from users")).rows[0]).toEqual({ n: 0 });

    const ada = await emailSignIn("ada@example.com");
    const l = await startLink(ada.token, "facebook");
    const s = await openStart(l.path);
    nextFacebook = { id: "777", name: "Phone Person" };
    const back = landing(await callback("facebook", { code: "good-code", state: s.state }, s.cookie));
    expect(back.intent).toBe("link");
    expect((await redeemLink(back.ticket!, l.verifier, ada.token)).status).toBe(200);

    const again = landing((await signInWith("facebook", { id: "777", name: "Phone Person" })).res);
    expect(again.error).toBeNull();
  });

  it("sends a cancelled dialog back as cancelled, and a bad code or proof as failed", async () => {
    const verifier = newVerifier();
    const s = await openStart(`/auth/oauth/facebook/start?redirect=${encodeURIComponent(WEB)}&challenge=${b64sha(verifier)}`);
    const cancelled = await callback("facebook", { error: "access_denied", error_reason: "user_denied", error_description: "Permissions error.", state: s.state }, s.cookie);
    expect(landing(cancelled).error).toBe("cancelled");
    const t = await openStart(`/auth/oauth/facebook/start?redirect=${encodeURIComponent(WEB)}&challenge=${b64sha(verifier)}`);
    expect(landing(await callback("facebook", { code: "forged-code", state: t.state }, t.cookie)).error).toBe("failed");
    app = makeApp({ ...fullConfig(), facebook: { appId: FB_APP, appSecret: "a-different-secret" } });
    const u = await openStart(`/auth/oauth/facebook/start?redirect=${encodeURIComponent(WEB)}&challenge=${b64sha(verifier)}`);
    nextFacebook = { id: "1", email: "x@example.com" };
    expect(landing(await callback("facebook", { code: "good-code", state: u.state }, u.cookie)).error).toBe("failed");
  });
});

describe("linking", () => {
  it("needs a session, a provider that is on, an allowed return address and a challenge", async () => {
    const ada = await emailSignIn("ada@example.com");
    const challenge = b64sha(newVerifier());
    expect((await send("POST", "/auth/link/google", { redirect: WEB, challenge })).status).toBe(401);
    expect((await send("POST", "/auth/link/twitter", { redirect: WEB, challenge }, ada.token)).status).toBe(404);
    expect((await send("POST", "/auth/link/github", { redirect: WEB, challenge }, ada.token)).status).toBe(404);
    expect((await send("POST", "/auth/link/google", { redirect: "https://evil.example/auth/callback", challenge }, ada.token)).status).toBe(400);
    expect((await send("POST", "/auth/link/google", { redirect: WEB, challenge: "short" }, ada.token)).status).toBe(400);
    expect((await send("POST", "/auth/link/redeem", { ticket: "x".repeat(43), verifier: newVerifier() })).status).toBe(401);
  });

  it("adds Google to an email account, and that Google then signs into it", async () => {
    const ada = await emailSignIn("ada@example.com");
    const bob = await emailSignIn("bob@example.com");
    const { res, verifier } = await linkGoogle(ada.token, { sub: "g-ada", email: "ada.work@gmail.com", email_verified: true, name: "Ada L" });
    const back = landing(res);
    expect(back).toMatchObject({ at: WEB, intent: "link", error: null });
    expect(back.ticket).toMatch(/^[\w-]{43}$/);
    // Nothing is linked until the app that asked redeems it.
    expect((await db.query("select count(*)::int as n from user_identities")).rows[0]).toEqual({ n: 0 });

    // A link ticket never signs anyone in, and only Ada's session with Ada's app's verifier redeems it.
    expect((await send("POST", "/auth/oauth/redeem", { ticket: back.ticket, verifier })).status).toBe(400);
    expect((await redeemLink(back.ticket!, newVerifier(), ada.token)).status).toBe(400);
    expect((await redeemLink(back.ticket!, verifier, bob.token)).status).toBe(400);
    const ok = await redeemLink(back.ticket!, verifier, ada.token);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Json).identities).toEqual([{ provider: "google", email: "ada.work@gmail.com", name: "Ada L", linkedAt: expect.any(String) }]);
    expect((await redeemLink(back.ticket!, verifier, ada.token)).status).toBe(400);

    // Signing in with that Google account now opens Ada's account, though its email is a different one.
    const g = await signInWith("google", { sub: "g-ada", email: "ada.work@gmail.com", email_verified: true });
    const signedIn = await send("POST", "/auth/oauth/redeem", { ticket: landing(g.res).ticket, verifier: g.verifier });
    expect(((await signedIn.json()) as Json).user.id).toBe(ada.id);
  });

  it("refuses an identity that belongs to another account, at the callback and at redeem", async () => {
    const bobGoogle = await signInWith("google", { sub: "g-bob", email: "bob@example.com", email_verified: true });
    const bob = (await (await send("POST", "/auth/oauth/redeem", { ticket: landing(bobGoogle.res).ticket, verifier: bobGoogle.verifier })).json()) as Json;
    const ada = await emailSignIn("ada@example.com");

    const taken = landing((await linkGoogle(ada.token, { sub: "g-bob", email: "bob@example.com", email_verified: true })).res);
    expect(taken).toMatchObject({ intent: "link", error: "taken", ticket: null });

    // Bob links the same Google account between Ada's callback and her redeem: the redeem says so plainly.
    const race = await linkGoogle(ada.token, { sub: "g-shared", email: "shared@example.com", email_verified: true });
    await db.query("insert into user_identities (provider, subject, user_id) values ('google', 'g-shared', $1)", [bob.user.id]);
    const res = await redeemLink(landing(race.res).ticket!, race.verifier, ada.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toMatch(/That Google account is already linked to another Dandelist account/);
    expect((await db.query("select user_id from user_identities where subject = 'g-shared'")).rows).toEqual([{ user_id: bob.user.id }]);
  });

  it("keeps the link request sealed: no tampering, no other provider, ten minutes at most", async () => {
    const ada = await emailSignIn("ada@example.com");
    const l = await startLink(ada.token, "google");
    // The user id inside can't be read from the address.
    expect(l.path).not.toContain(ada.id);
    const parts = l.link.split(".");
    parts[3] = (parts[3]![0] === "A" ? "B" : "A") + parts[3]!.slice(1);
    expect((await app.request(`/auth/oauth/google/start?link=${parts.join(".")}`)).status).toBe(400);
    expect((await app.request(`/auth/oauth/facebook/start?link=${l.link}`)).status).toBe(400);
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    expect((await app.request(l.path)).status).toBe(400);
  });

  it("links Apple from the iPhone sheet with a nonce the API issued", async () => {
    const ada = await emailSignIn("ada@example.com");
    const nonce = ((await (await app.request("/auth/apple/nonce")).json()) as Json).nonce as string;
    const token = await signed(appleKeys, "a1", { sub: "001.apple", email: "x@privaterelay.appleid.com", email_verified: true, nonce }, "https://appleid.apple.com", APPLE_BUNDLE);
    expect((await send("POST", "/auth/link/apple/native", { identityToken: token })).status).toBe(401);
    const res = await send("POST", "/auth/link/apple/native", { identityToken: token }, ada.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).identities.map((i: Json) => i.provider)).toEqual(["apple"]);
    // The same token can't be used again.
    expect((await send("POST", "/auth/link/apple/native", { identityToken: token }, ada.token)).status).toBe(401);

    const bob = await emailSignIn("bob@example.com");
    const n2 = ((await (await app.request("/auth/apple/nonce")).json()) as Json).nonce as string;
    const t2 = await signed(appleKeys, "a1", { sub: "001.apple", nonce: n2 }, "https://appleid.apple.com", APPLE_BUNDLE);
    expect((await send("POST", "/auth/link/apple/native", { identityToken: t2 }, bob.token)).status).toBe(409);
  });

  it("unlinks, after which that Google is a stranger again", async () => {
    const ada = await emailSignIn("ada@example.com");
    const { res, verifier } = await linkGoogle(ada.token, { sub: "g-ada", email: "ada.work@gmail.com", email_verified: true });
    await redeemLink(landing(res).ticket!, verifier, ada.token);
    const after = await send("DELETE", "/me/identities/google", undefined, ada.token);
    expect(((await after.json()) as Json).identities).toEqual([]);
    const g = await signInWith("google", { sub: "g-ada", email: "ada.work@gmail.com", email_verified: true });
    const r = (await (await send("POST", "/auth/oauth/redeem", { ticket: landing(g.res).ticket, verifier: g.verifier })).json()) as Json;
    expect(r.user.id).not.toBe(ada.id);
  });
});
