import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload, type KeyLike } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { redirectAllowed, type OAuthConfig } from "../src/oauth";

const GOOGLE_CLIENT = "google-client.apps.googleusercontent.com";
const APPLE_SERVICES = "com.knightaiav.dandelist.web";
const APPLE_BUNDLE = "com.knightaiav.dandelist";
const WEB = "http://localhost:8081/auth/callback";
const WEB_ORIGINS = ["http://localhost:8081", "https://dandelist.knightaiav.com"];

type Keys = { privateKey: KeyLike; publicKey: KeyLike };
let googleKeys: Keys;
let appleKeys: Keys;
let strangerKeys: Keys;

beforeAll(async () => {
  [googleKeys, appleKeys, strangerKeys] = await Promise.all([generateKeyPair("RS256"), generateKeyPair("RS256"), generateKeyPair("RS256")]);
});

let db: Db;
let clock: Date;
let mail: { to: string; code: string }[];
let calls: { url: string; body: string }[];
/** What the fake Google puts in the next id_token, and what the fake GitHub reports. */
let nextGoogle: JWTPayload;
let githubEmails: { email: string; primary: boolean; verified: boolean }[];
let lastChallenge: string;

const nowS = () => Math.floor(clock.getTime() / 1000);
const b64sha = (s: string) => createHash("sha256").update(s).digest("base64url");

function signed(keys: Keys, kid: string, claims: JWTPayload, iss: string, aud: string) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(nowS())
    .setExpirationTime(nowS() + 600)
    .sign(keys.privateKey);
}
const appleToken = (claims: JWTPayload, aud = APPLE_BUNDLE, keys = appleKeys, iss = "https://appleid.apple.com") => signed(keys, "a1", claims, iss, aud);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stands in for Google, GitHub and Apple. */
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? init.body : "";
  calls.push({ url, body });
  if (url === "https://www.googleapis.com/oauth2/v3/certs") return json({ keys: [{ ...(await exportJWK(googleKeys.publicKey)), kid: "g1", alg: "RS256", use: "sig" }] });
  if (url === "https://appleid.apple.com/auth/keys") return json({ keys: [{ ...(await exportJWK(appleKeys.publicKey)), kid: "a1", alg: "RS256", use: "sig" }] });
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "good-code" || b64sha(form.get("code_verifier") ?? "") !== lastChallenge) return json({ error: "invalid_grant" }, 400);
    return json({ id_token: await signed(googleKeys, "g1", nextGoogle, "https://accounts.google.com", GOOGLE_CLIENT), access_token: "ya29" });
  }
  if (url === "https://github.com/login/oauth/access_token") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "good-code" || b64sha(form.get("code_verifier") ?? "") !== lastChallenge) return json({ error: "bad_verification_code" });
    return json({ access_token: "gho_test", token_type: "bearer" });
  }
  if (url === "https://api.github.com/user") return json({ id: 4242, login: "ada-l", name: "Ada Lovelace" });
  if (url === "https://api.github.com/user/emails") return json(githubEmails);
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const fullConfig = (): OAuthConfig => ({
  apiUrl: "https://api.test",
  production: false,
  google: { clientId: GOOGLE_CLIENT, clientSecret: "google-secret" },
  github: { clientId: "github-client", clientSecret: "github-secret" },
  apple: { servicesId: APPLE_SERVICES, bundleId: APPLE_BUNDLE },
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
  clock = new Date("2026-10-27T12:00:00Z");
  mail = [];
  calls = [];
  githubEmails = [];
  nextGoogle = {};
  lastChallenge = "";
  app = makeApp(fullConfig());
});

const postJson = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** The app's secret for its latest sign-in attempt; only its SHA-256 goes out at start. */
let appVerifier = "";
const newVerifier = () => randomBytes(32).toString("hex");
const startPath = (provider: string, redirect: string, verifier: string) =>
  `/auth/oauth/${provider}/start?redirect=${encodeURIComponent(redirect)}&challenge=${b64sha(verifier)}`;

/** Begins a sign-in the way the app does and returns what the provider would receive. */
async function start(provider: string, redirect = WEB) {
  appVerifier = newVerifier();
  const res = await app.request(startPath(provider, redirect, appVerifier));
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("Location")!);
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  expect(cookie).toMatch(/^dl_oauth=./);
  lastChallenge = to.searchParams.get("code_challenge") ?? "";
  return { to, state: to.searchParams.get("state")!, nonce: to.searchParams.get("nonce"), cookie, verifier: appVerifier };
}

function callback(provider: string, query: Record<string, string>, cookie?: string) {
  return app.request(`/auth/oauth/${provider}/callback?${new URLSearchParams(query)}`, { headers: cookie ? { Cookie: cookie } : {} });
}

/** Where the API sent the browser back to, split into the address and its query. */
function landing(res: Response) {
  const loc = new URL(res.headers.get("Location")!);
  return { at: `${loc.protocol}//${loc.host}${loc.pathname}`, ticket: loc.searchParams.get("ticket"), error: loc.searchParams.get("error") };
}

async function googleSignIn(claims: JWTPayload, redirect = WEB) {
  const s = await start("google", redirect);
  nextGoogle = { nonce: s.nonce!, ...claims };
  return callback("google", { code: "good-code", state: s.state }, s.cookie);
}

async function githubSignIn() {
  const s = await start("github");
  return callback("github", { code: "good-code", state: s.state }, s.cookie);
}

async function redeem(ticket: string, verifier = appVerifier) {
  return postJson("/auth/oauth/redeem", { ticket, verifier });
}

/** A nonce from the API, as the iPhone app fetches it before opening Apple's sheet. */
async function appleNonce() {
  const res = await app.request("/auth/apple/nonce");
  expect(res.status).toBe(200);
  return ((await res.json()) as { nonce: string }).nonce;
}

async function emailSignIn(email: string) {
  await postJson("/auth/email/start", { email });
  const res = await postJson("/auth/email/verify", { email, code: mail.at(-1)!.code });
  return ((await res.json()) as { user: { id: string } }).user.id;
}

describe("provider list", () => {
  it("shows nothing until a provider is configured", async () => {
    app = makeApp(undefined);
    expect(await (await app.request("/auth/providers")).json()).toEqual({ providers: [] });
    expect((await app.request(`/auth/oauth/google/start?redirect=${encodeURIComponent(WEB)}`)).status).toBe(404);
    expect((await postJson("/auth/apple/native", { identityToken: "x".repeat(40) })).status).toBe(404);
    expect((await app.request("/auth/apple/nonce")).status).toBe(404);
  });

  it("shows each configured provider and where it works", async () => {
    expect(await (await app.request("/auth/providers")).json()).toEqual({
      providers: [
        { id: "apple", web: true, native: true },
        { id: "google", web: true, native: true },
        { id: "github", web: true, native: true },
      ],
    });
    app = makeApp({ apiUrl: "https://api.test", production: false, google: { clientId: GOOGLE_CLIENT, clientSecret: "" }, apple: { bundleId: APPLE_BUNDLE } });
    expect(await (await app.request("/auth/providers")).json()).toEqual({ providers: [{ id: "apple", web: false, native: true }] });
    expect((await app.request(`/auth/oauth/apple/start?redirect=${encodeURIComponent(WEB)}`)).status).toBe(404);
    expect((await app.request(`/auth/oauth/twitter/start?redirect=${encodeURIComponent(WEB)}`)).status).toBe(404);
  });
});

describe("Google sign-in", () => {
  it("runs code + PKCE, checks the id_token and hands back what email sign-in returns", async () => {
    const s = await start("google");
    expect(s.to.origin + s.to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(s.to.searchParams.get("redirect_uri")).toBe("https://api.test/auth/oauth/google/callback");
    expect(s.to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(s.to.searchParams.get("scope")).toBe("openid email profile");
    // The state is encrypted: neither the verifier nor the nonce can be read from it.
    expect(s.state.split(".")).toHaveLength(5);

    nextGoogle = { nonce: s.nonce!, sub: "g-123", email: "New@Example.com", email_verified: true, name: "New Person" };
    const res = await callback("google", { code: "good-code", state: s.state }, s.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { at, ticket } = landing(res);
    expect(at).toBe(WEB);
    expect(ticket).toMatch(/^[\w-]{43}$/);

    const r = await redeem(ticket!);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { user: { id: string; email: string }; accessToken: string; refreshToken: string; expiresIn: number };
    expect(Object.keys(body).sort()).toEqual(["accessToken", "expiresIn", "refreshToken", "user"]);
    expect(body.user.email).toBe("new@example.com");
    expect((await app.request("/me", { headers: { Authorization: `Bearer ${body.accessToken}` } })).status).toBe(200);
    expect((await db.query("select provider, subject, email, name from user_identities")).rows).toEqual([
      { provider: "google", subject: "g-123", email: "new@example.com", name: "New Person" },
    ]);
  });

  it("refuses an id_token minted for another flow or another app", async () => {
    let res = await googleSignIn({ sub: "g-1", email: "a@example.com", email_verified: true, nonce: "someone-elses-nonce" });
    expect(landing(res).error).toBe("failed");
    const s = await start("google");
    nextGoogle = { nonce: s.nonce!, sub: "g-1", email: "a@example.com", email_verified: true };
    res = await callback("google", { code: "stolen-code", state: s.state }, s.cookie);
    expect(landing(res).error).toBe("failed");
    expect((await db.query("select count(*)::int as n from users")).rows[0]).toEqual({ n: 0 });
  });

  it("signs a returning identity into the same account even if its email changed", async () => {
    const first = landing(await googleSignIn({ sub: "g-9", email: "old@example.com", email_verified: true }));
    const a = (await (await redeem(first.ticket!)).json()) as { user: { id: string } };
    const second = landing(await googleSignIn({ sub: "g-9", email: "new@example.com", email_verified: true }));
    const b = (await (await redeem(second.ticket!)).json()) as { user: { id: string; email: string } };
    expect(b.user).toEqual({ id: a.user.id, email: "old@example.com" });
  });

  it("sends a cancelled sign-in back with a reason and no ticket", async () => {
    const s = await start("google");
    const res = await callback("google", { error: "access_denied", state: s.state }, s.cookie);
    expect(landing(res)).toEqual({ at: WEB, ticket: null, error: "cancelled" });
  });
});

describe("state", () => {
  it("rejects a tampered, swapped or expired state", async () => {
    const s = await start("google");
    nextGoogle = { nonce: s.nonce!, sub: "g-1", email: "a@example.com", email_verified: true };
    const parts = s.state.split(".");
    const ct = parts[3]!;
    parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect((await callback("google", { code: "good-code", state: parts.join(".") }, s.cookie)).status).toBe(400);
    expect((await callback("google", { code: "good-code", state: "not-a-state" }, s.cookie)).status).toBe(400);
    expect((await callback("google", { code: "good-code" }, s.cookie)).status).toBe(400);

    // A state issued for GitHub can't finish a Google sign-in.
    const gh = await start("github");
    expect((await callback("google", { code: "good-code", state: gh.state }, gh.cookie)).status).toBe(400);

    // States last ten minutes.
    const late = await start("google");
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    expect((await callback("google", { code: "good-code", state: late.state }, late.cookie)).status).toBe(400);
    expect(calls.filter((c) => c.url.includes("oauth2.googleapis.com/token"))).toHaveLength(0);
  });

  it("only finishes in the browser that started it", async () => {
    const s = await start("google");
    nextGoogle = { nonce: s.nonce!, sub: "g-1", email: "a@example.com", email_verified: true };
    expect(landing(await callback("google", { code: "good-code", state: s.state })).error).toBe("expired");
    expect(landing(await callback("google", { code: "good-code", state: s.state }, "dl_oauth=somebody-else")).error).toBe("expired");
    expect((await db.query("select count(*)::int as n from oauth_tickets")).rows[0]).toEqual({ n: 0 });
  });
});

describe("redirect allowlist", () => {
  it("accepts each web origin's callback and the app scheme, exactly", () => {
    for (const ok of [WEB, "https://dandelist.knightaiav.com/auth/callback", "dandelist://auth"]) {
      expect(redirectAllowed(ok, WEB_ORIGINS, false)).toBe(true);
    }
    for (const ok of ["https://dandelist.knightaiav.com/auth/callback", "dandelist://auth"]) {
      expect(redirectAllowed(ok, WEB_ORIGINS, true)).toBe(true);
    }
    for (const bad of [
      "https://evil.example/auth/callback",
      "https://dandelist.knightaiav.com.evil.example/auth/callback",
      "https://dandelist.knightaiav.com/auth/callback?next=https://evil.example",
      "https://dandelist.knightaiav.com/auth/callback#x",
      "https://dandelist.knightaiav.com/auth/callbackx",
      "https://dandelist.knightaiav.com/",
      "http://dandelist.knightaiav.com/auth/callback",
      "dandelist://auth/../evil",
      "dandelist://evil",
      "javascript:alert(1)",
      "",
    ]) {
      expect(redirectAllowed(bad, WEB_ORIGINS, false)).toBe(false);
    }
  });

  it("allows Expo Go and any localhost port only outside production", () => {
    for (const dev of ["exp://192.168.1.20:8081/--/auth", "http://localhost:19006/auth/callback", "http://localhost:3000"]) {
      expect(redirectAllowed(dev, WEB_ORIGINS, false)).toBe(true);
      expect(redirectAllowed(dev, WEB_ORIGINS, true)).toBe(false);
    }
    for (const bad of ["http://localhost:8081@evil.example/", "http://localhost.evil.example:80/", "https://localhost:8081/auth/callback", "exp://host/path?ticket=x"]) {
      expect(redirectAllowed(bad, WEB_ORIGINS, false)).toBe(false);
    }
  });

  it("in production sends tickets only to https origins, even when an http origin is listed for CORS", async () => {
    // WEB_ORIGINS in production still lists http://localhost:8081 so local builds can call the API.
    expect(WEB_ORIGINS).toContain("http://localhost:8081");
    expect(redirectAllowed(WEB, WEB_ORIGINS, true)).toBe(false);
    expect(redirectAllowed(WEB, WEB_ORIGINS, false)).toBe(true);
    expect(redirectAllowed("http://staging.example/auth/callback", ["http://staging.example"], true)).toBe(false);
    expect(redirectAllowed("https://staging.example/auth/callback", ["https://staging.example"], true)).toBe(true);

    app = makeApp({ ...fullConfig(), production: true });
    const res = await app.request(startPath("google", WEB, newVerifier()));
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    expect((await app.request(startPath("google", "https://dandelist.knightaiav.com/auth/callback", newVerifier()))).status).toBe(302);
    // CORS for that origin is untouched.
    const cors = await app.request("/auth/providers", { headers: { Origin: "http://localhost:8081" } });
    expect(cors.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
  });

  it("refuses to start toward an address off the list", async () => {
    const res = await app.request(startPath("google", "https://evil.example/auth/callback", newVerifier()));
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    app = makeApp({ ...fullConfig(), production: true });
    expect((await app.request(startPath("google", "exp://192.168.1.20:8081/--/auth", newVerifier()))).status).toBe(400);
    const prod = await app.request(startPath("google", "dandelist://auth", newVerifier()));
    expect(prod.status).toBe(302);
    // In production the binding cookie is a host-only, Secure, SameSite=None cookie, so Apple's POST back carries it.
    expect(prod.headers.get("Set-Cookie")).toMatch(/^__Host-dl_oauth=[^;]+;.*Secure/);
    expect(prod.headers.get("Set-Cookie")).toMatch(/SameSite=None/);
  });

  it("delivers the ticket to the app scheme for native sign-in", async () => {
    const res = await googleSignIn({ sub: "g-5", email: "phone@example.com", email_verified: true }, "dandelist://auth");
    expect(res.headers.get("Location")).toMatch(/^dandelist:\/\/auth\?ticket=[\w-]{43}$/);
  });
});

describe("tickets", () => {
  it("work once, and only for 60 seconds", async () => {
    const { ticket } = landing(await googleSignIn({ sub: "g-1", email: "a@example.com", email_verified: true }));
    expect((await redeem(ticket!)).status).toBe(200);
    const again = await redeem(ticket!);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toMatch(/expired/);

    const late = landing(await googleSignIn({ sub: "g-1", email: "a@example.com", email_verified: true })).ticket!;
    clock = new Date(clock.getTime() + 61 * 1000);
    expect((await redeem(late)).status).toBe(400);
    expect((await redeem("made-up-ticket-made-up-ticket-made-up-tic")).status).toBe(400);
    // Only the hash is stored.
    const stored = (await db.query<{ ticket_hash: string }>("select ticket_hash from oauth_tickets")).rows.map((r) => r.ticket_hash);
    expect(stored).not.toContain(late);
    expect(stored).toContain(createHash("sha256").update(late).digest("hex"));
  });

  it("redeem only for the app that started the sign-in", async () => {
    // Starting needs a well-formed challenge.
    const bare = await app.request(`/auth/oauth/google/start?redirect=${encodeURIComponent(WEB)}`);
    expect(bare.status).toBe(400);
    expect(bare.headers.get("Location")).toBeNull();
    expect((await app.request(`/auth/oauth/google/start?redirect=${encodeURIComponent(WEB)}&challenge=too-short`)).status).toBe(400);

    const res = await googleSignIn({ sub: "g-7", email: "mine@example.com", email_verified: true }, "dandelist://auth");
    const { ticket } = landing(res);
    const mine = appVerifier;
    // Another app that caught the dandelist://auth redirect has the ticket but not the verifier.
    expect((await redeem(ticket!, newVerifier())).status).toBe(400);
    expect((await postJson("/auth/oauth/redeem", { ticket })).status).toBe(400);
    expect((await redeem(ticket!, mine.slice(0, -1) + (mine.endsWith("0") ? "1" : "0"))).status).toBe(400);
    // Those failed tries didn't spend it: the app that started the sign-in still gets in.
    const r = await redeem(ticket!, mine);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { user: { email: string } }).user.email).toBe("mine@example.com");

    // A verifier from a different attempt doesn't fit this attempt's ticket.
    const first = await start("google");
    nextGoogle = { nonce: first.nonce!, sub: "g-7", email: "mine@example.com", email_verified: true };
    const firstTicket = landing(await callback("google", { code: "good-code", state: first.state }, first.cookie)).ticket!;
    await start("github");
    expect((await redeem(firstTicket, appVerifier)).status).toBe(400);
    expect((await redeem(firstTicket, first.verifier)).status).toBe(200);
  });

  it("can't be redeemed twice in parallel", async () => {
    const { ticket } = landing(await googleSignIn({ sub: "g-1", email: "a@example.com", email_verified: true }));
    const results = await Promise.all(Array.from({ length: 5 }, () => redeem(ticket!)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
  });
});

describe("linking by email", () => {
  it("joins an existing account only when the provider verified the email", async () => {
    const ada = await emailSignIn("ada@example.com");

    // Google says the address is unverified: no link, no new account, nothing stored.
    expect(landing(await googleSignIn({ sub: "g-ada", email: "Ada@Example.com", email_verified: false })).error).toBe("no_email");
    expect((await db.query("select count(*)::int as n from user_identities")).rows[0]).toEqual({ n: 0 });

    // GitHub: a verified address that isn't primary, or a primary that isn't verified, doesn't count.
    githubEmails = [
      { email: "ada@example.com", primary: false, verified: true },
      { email: "ada-work@example.com", primary: true, verified: false },
    ];
    expect(landing(await githubSignIn()).error).toBe("no_email");
    expect((await db.query("select count(*)::int as n from users")).rows[0]).toEqual({ n: 1 });

    // The primary, verified address links to Ada's account.
    githubEmails = [{ email: "ADA@example.com", primary: true, verified: true }];
    const { ticket } = landing(await githubSignIn());
    const linked = (await (await redeem(ticket!)).json()) as { user: { id: string } };
    expect(linked.user.id).toBe(ada);

    // And Google, once it reports the address verified, joins the same account.
    const g = landing(await googleSignIn({ sub: "g-ada", email: "ada@example.com", email_verified: true }));
    expect(((await (await redeem(g.ticket!)).json()) as { user: { id: string } }).user.id).toBe(ada);
    expect((await db.query("select provider from user_identities where user_id = $1 order by provider", [ada])).rows).toEqual([{ provider: "github" }, { provider: "google" }]);
  });

  it("goes when the account is deleted", async () => {
    const { ticket } = landing(await googleSignIn({ sub: "g-del", email: "del@example.com", email_verified: true }));
    const { accessToken } = (await (await redeem(ticket!)).json()) as { accessToken: string };
    expect((await app.request("/me", { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } })).status).toBe(204);
    expect((await db.query("select count(*)::int as n from user_identities")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("select count(*)::int as n from oauth_tickets")).rows[0]).toEqual({ n: 0 });
  });
});

describe("Apple", () => {
  it("signs in on the web through form_post with the Services ID", async () => {
    const s = await start("apple");
    expect(s.to.origin + s.to.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(s.to.searchParams.get("response_type")).toBe("code id_token");
    expect(s.to.searchParams.get("response_mode")).toBe("form_post");
    expect(s.to.searchParams.get("scope")).toBe("name email");
    expect(s.to.searchParams.get("client_id")).toBe(APPLE_SERVICES);

    const idToken = await appleToken({ sub: "001234.apple", email: "x7@privaterelay.appleid.com", email_verified: "true", nonce: s.nonce! }, APPLE_SERVICES);
    const res = await app.request("/auth/oauth/apple/callback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: s.cookie },
      body: new URLSearchParams({ state: s.state, code: "c", id_token: idToken, user: JSON.stringify({ name: { firstName: "Ada", lastName: "L" } }) }).toString(),
    });
    expect(res.status).toBe(303);
    const r = await redeem(landing(res).ticket!);
    expect(((await r.json()) as { user: { email: string } }).user.email).toBe("x7@privaterelay.appleid.com");
    expect((await db.query("select name from user_identities")).rows).toEqual([{ name: "Ada L" }]);
  });

  it("refuses a web token meant for the iPhone app", async () => {
    const s = await start("apple");
    const idToken = await appleToken({ sub: "001234.apple", email: "a@example.com", email_verified: true, nonce: s.nonce! }, APPLE_BUNDLE);
    const res = await app.request("/auth/oauth/apple/callback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: s.cookie },
      body: new URLSearchParams({ state: s.state, id_token: idToken }).toString(),
    });
    expect(landing(res).error).toBe("failed");
  });

  it("signs in natively only with a token for the app's bundle id", async () => {
    const ada = { sub: "001234.apple", email: "ada@example.com", email_verified: true };
    const good = await appleToken({ ...ada, nonce: await appleNonce() });
    const res = await postJson("/auth/apple/native", { identityToken: good, fullName: { givenName: "Ada", familyName: null } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; accessToken: string; refreshToken: string; expiresIn: number };
    expect(Object.keys(body).sort()).toEqual(["accessToken", "expiresIn", "refreshToken", "user"]);
    expect(body.user.email).toBe("ada@example.com");

    // Each of these carries a valid, unused nonce, so the audience, signature, issuer or age is what fails.
    const wrongAud = await appleToken({ ...ada, nonce: await appleNonce() }, APPLE_SERVICES);
    expect((await postJson("/auth/apple/native", { identityToken: wrongAud })).status).toBe(401);
    const otherApp = await appleToken({ ...ada, nonce: await appleNonce() }, "com.example.other");
    expect((await postJson("/auth/apple/native", { identityToken: otherApp })).status).toBe(401);
    const forged = await appleToken({ ...ada, nonce: await appleNonce() }, APPLE_BUNDLE, strangerKeys);
    expect((await postJson("/auth/apple/native", { identityToken: forged })).status).toBe(401);
    const wrongIssuer = await appleToken({ sub: "001234.apple", nonce: await appleNonce() }, APPLE_BUNDLE, appleKeys, "https://evil.example");
    expect((await postJson("/auth/apple/native", { identityToken: wrongIssuer })).status).toBe(401);
    const stale = await appleToken({ ...ada, nonce: await appleNonce() });
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    expect((await postJson("/auth/apple/native", { identityToken: stale })).status).toBe(401);
  });

  it("needs a nonce the API issued, and takes each one once", async () => {
    const ada = { sub: "001234.apple", email: "ada@example.com", email_verified: true };
    // No nonce, or one the API never issued.
    expect((await postJson("/auth/apple/native", { identityToken: await appleToken(ada) })).status).toBe(401);
    expect((await postJson("/auth/apple/native", { identityToken: await appleToken({ ...ada, nonce: "made-up-nonce-made-up-nonce-made-up-n" }) })).status).toBe(401);

    // The raw nonce, exactly as Apple returns what the app passed, signs in once; replaying the same token fails.
    const nonce = await appleNonce();
    expect(nonce).toMatch(/^[\w-]{43}$/);
    const token = await appleToken({ ...ada, nonce });
    expect((await postJson("/auth/apple/native", { identityToken: token })).status).toBe(200);
    expect((await postJson("/auth/apple/native", { identityToken: token })).status).toBe(401);
    // A hashed form of an issued nonce is not the same thing.
    const other = await appleNonce();
    expect((await postJson("/auth/apple/native", { identityToken: await appleToken({ ...ada, nonce: b64sha(other) }) })).status).toBe(401);
    expect((await postJson("/auth/apple/native", { identityToken: await appleToken({ ...ada, nonce: other }) })).status).toBe(200);

    // Nonces last ten minutes and are stored only as hashes.
    const old = await appleNonce();
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    expect((await postJson("/auth/apple/native", { identityToken: await appleToken({ ...ada, nonce: old }) })).status).toBe(401);
    const stored = (await db.query<{ nonce_hash: string }>("select nonce_hash from apple_nonces")).rows.map((r) => r.nonce_hash);
    expect(stored).toContain(createHash("sha256").update(old).digest("hex"));
    expect(stored).not.toContain(old);
  });

  it("honours a configured bundle id and lets a returning Apple user in without an email", async () => {
    app = makeApp({ ...fullConfig(), apple: { bundleId: "com.example.custom" } });
    const native = async (claims: JWTPayload, aud = "com.example.custom") =>
      (await postJson("/auth/apple/native", { identityToken: await appleToken({ ...claims, nonce: await appleNonce() }, aud) })).status;
    expect(await native({ sub: "000777.apple", email: "z@example.com", email_verified: true })).toBe(200);
    // Apple can leave the email out on later sign-ins; the stable subject is enough.
    expect(await native({ sub: "000777.apple" })).toBe(200);
    // A brand-new Apple user with no email has nothing to sign in as.
    expect(await native({ sub: "000888.apple" })).toBe(400);
    expect(await native({ sub: "000777.apple" }, APPLE_BUNDLE)).toBe(401);
  });
});
