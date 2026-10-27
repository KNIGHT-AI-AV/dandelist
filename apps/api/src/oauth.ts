import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { EncryptJWT, createLocalJWKSet, jwtDecrypt, jwtVerify, type JWTPayload, type JWTVerifyOptions } from "jose";
import { z } from "zod";
import type { Db } from "./db";
import { RateLimiter, clientIp } from "./ratelimit";
import { normalizeEmail } from "./tokens";

/**
 * Social sign-in, brokered by the API for every platform. The app opens /auth/oauth/<provider>/start; the provider
 * comes back to /auth/oauth/<provider>/callback; the API finds or creates the user and hands the app a one-time
 * ticket in the redirect, which the app swaps for the usual tokens at /auth/oauth/redeem. Native iOS uses Apple's own
 * sheet instead and posts the identity token to /auth/apple/native.
 */

export type Provider = "apple" | "google" | "github";
export const PROVIDERS: readonly Provider[] = ["apple", "google", "github"];

export interface OAuthConfig {
  /** Public origin of this API; providers return to `<apiUrl>/auth/oauth/<provider>/callback`. */
  apiUrl: string;
  production: boolean;
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
  /** `servicesId` turns on Apple for the web and Android; `bundleId` turns on the native iOS sheet. */
  apple?: { servicesId?: string; bundleId?: string };
  /** Outbound HTTP for token exchanges and signing keys; tests replace it. */
  fetch?: typeof fetch;
}

export interface OAuthRouteDeps {
  db: Db;
  jwtSecret: string;
  now: () => Date;
  webOrigins?: string[];
  oauth?: OAuthConfig;
}

type Session = { accessToken: string; refreshToken: string; expiresIn: number };

/** What a provider tells us about the person once it has vouched for them. */
export interface Profile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const STATE_TTL_S = 10 * 60;
const TICKET_TTL_MS = 60 * 1000;
const STATE_ISSUER = "dandelist-api";
const STATE_AUDIENCE = "dandelist-oauth-state";
const COOKIE = "dl_oauth";
const NATIVE_REDIRECT = "dandelist://auth";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";

/** Why a sign-in didn't finish, as the app shows it. Only these codes ever reach the redirect. */
export type FailureCode = "cancelled" | "expired" | "no_email" | "failed";

class OAuthFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

const stateSchema = z.object({
  p: z.enum(["apple", "google", "github"]),
  r: z.string(),
  n: z.string().min(16),
  v: z.string().min(43),
});
type State = z.infer<typeof stateSchema>;

/** Seals and opens the state parameter. It is encrypted as well as authenticated, so the PKCE verifier and nonce never travel readable through the browser or the provider's logs. */
function stateCodec(jwtSecret: string) {
  const key = new Uint8Array(hkdfSync("sha256", jwtSecret, new Uint8Array(0), "dandelist oauth state v1", 32));
  return {
    seal: (s: State, nowS: number) =>
      new EncryptJWT({ ...s })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuer(STATE_ISSUER)
        .setAudience(STATE_AUDIENCE)
        .setIssuedAt(nowS)
        .setExpirationTime(nowS + STATE_TTL_S)
        .encrypt(key),
    async open(token: string, now: Date): Promise<State | null> {
      try {
        const { payload } = await jwtDecrypt(token, key, {
          issuer: STATE_ISSUER,
          audience: STATE_AUDIENCE,
          currentDate: now,
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        const parsed = stateSchema.safeParse(payload);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Where a ticket may be sent: each web origin's /auth/callback and the app's own scheme. Development also accepts
 * Expo Go (exp://) and any localhost port. Matching is exact, never by prefix.
 */
export function redirectAllowed(redirect: string, webOrigins: string[], production: boolean): boolean {
  if (!redirect || redirect.length > 300) return false;
  const exact = new Set([NATIVE_REDIRECT]);
  for (const o of webOrigins) {
    try {
      exact.add(`${new URL(o).origin}/auth/callback`);
    } catch {
      // A malformed origin in WEB_ORIGINS simply allows nothing.
    }
  }
  if (exact.has(redirect)) return true;
  if (production) return false;
  return /^exp:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.test(redirect) || /^http:\/\/localhost:\d{1,5}(\/[A-Za-z0-9._~/-]*)?$/.test(redirect);
}

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = (bytes: number) => randomBytes(bytes).toString("base64url");
const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** A provider's signing keys, fetched through the injectable fetch and refreshed when a token names a key we don't have. */
class SigningKeys {
  private keys?: ReturnType<typeof createLocalJWKSet>;
  private fetchedAt = 0;

  constructor(
    private readonly url: string,
    private readonly http: () => typeof fetch,
  ) {}

  private async load() {
    const res = await this.http()(this.url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`signing keys answered ${res.status}`);
    this.keys = createLocalJWKSet((await res.json()) as Parameters<typeof createLocalJWKSet>[0]);
    this.fetchedAt = Date.now();
    return this.keys;
  }

  async verify(token: string, options: JWTVerifyOptions): Promise<JWTPayload> {
    const stale = !this.keys || Date.now() - this.fetchedAt > 6 * 60 * 60 * 1000;
    const keys = stale ? await this.load() : this.keys!;
    try {
      return (await jwtVerify(token, keys, options)).payload;
    } catch (e) {
      // Providers rotate keys; refetch once for an unknown key id, but at most once a minute.
      if ((e as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY" || Date.now() - this.fetchedAt < 60_000) throw e;
      return (await jwtVerify(token, await this.load(), options)).payload;
    }
  }
}

const verified = (v: unknown) => v === true || v === "true";
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

const nativeBody = z.object({
  identityToken: z.string().min(20).max(8000),
  fullName: z
    .object({ givenName: z.string().max(100).nullish(), familyName: z.string().max(100).nullish() })
    .nullish(),
});
const redeemBody = z.object({ ticket: z.string().min(20).max(100) });

export function oauthRoutes(deps: OAuthRouteDeps, issueSession: (userId: string) => Promise<Session>) {
  const app = new Hono();
  const { db } = deps;
  const cfg = deps.oauth;
  const production = cfg?.production ?? false;
  const webOrigins = deps.webOrigins ?? [];
  const state = stateCodec(deps.jwtSecret);
  const http = () => cfg?.fetch ?? fetch;
  const googleKeys = new SigningKeys("https://www.googleapis.com/oauth2/v3/certs", http);
  const appleKeys = new SigningKeys("https://appleid.apple.com/auth/keys", http);
  const callbacksPerIp = new RateLimiter(60, 60 * 60 * 1000);
  const redeemsPerIp = new RateLimiter(60, 60 * 60 * 1000);
  const nativePerIp = new RateLimiter(30, 60 * 60 * 1000);
  const ip = (c: Context) => clientIp(c.req.header("X-Forwarded-For"));
  const nowS = () => Math.floor(deps.now().getTime() / 1000);

  const google = cfg?.google?.clientId && cfg.google.clientSecret ? cfg.google : undefined;
  const github = cfg?.github?.clientId && cfg.github.clientSecret ? cfg.github : undefined;
  const appleServicesId = cfg?.apple?.servicesId || undefined;
  const appleBundleId = cfg?.apple?.bundleId || undefined;
  const webEnabled: Record<Provider, boolean> = { apple: !!appleServicesId, google: !!google, github: !!github };
  const callbackUrl = (p: Provider) => `${(cfg?.apiUrl ?? "").replace(/\/+$/, "")}/auth/oauth/${p}/callback`;

  // The browser that starts a sign-in must be the one that finishes it, or a stranger could finish their own sign-in
  // in your browser and sign you into their account. A short-lived cookie carries the flow's nonce for that check.
  // Apple returns with a cross-site POST, so in production the cookie is SameSite=None (and therefore Secure).
  const cookieOpts = production
    ? ({ path: "/", httpOnly: true, secure: true, sameSite: "None", maxAge: STATE_TTL_S, prefix: "host" } as const)
    : ({ path: "/", httpOnly: true, sameSite: "Lax", maxAge: STATE_TTL_S } as const);
  const readCookie = (c: Context) => (production ? getCookie(c, COOKIE, "host") : getCookie(c, COOKIE));

  function authorizeUrl(p: Provider, sealed: string, s: State): string {
    const redirect_uri = callbackUrl(p);
    let base: string;
    let params: Record<string, string>;
    if (p === "google") {
      base = "https://accounts.google.com/o/oauth2/v2/auth";
      params = {
        client_id: google!.clientId,
        redirect_uri,
        response_type: "code",
        scope: "openid email profile",
        state: sealed,
        nonce: s.n,
        code_challenge: pkceChallenge(s.v),
        code_challenge_method: "S256",
        prompt: "select_account",
      };
    } else if (p === "github") {
      base = "https://github.com/login/oauth/authorize";
      params = {
        client_id: github!.clientId,
        redirect_uri,
        scope: "user:email",
        state: sealed,
        allow_signup: "true",
        code_challenge: pkceChallenge(s.v),
        code_challenge_method: "S256",
      };
    } else {
      base = "https://appleid.apple.com/auth/authorize";
      params = {
        client_id: appleServicesId!,
        redirect_uri,
        response_type: "code id_token",
        response_mode: "form_post",
        scope: "name email",
        state: sealed,
        nonce: s.n,
      };
    }
    return `${base}?${new URLSearchParams(params).toString()}`;
  }

  async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await http()(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.error === "string") throw new Error(`token exchange failed (${res.status} ${String(body.error ?? "")})`);
    return body;
  }

  async function githubGet(path: string, token: string): Promise<unknown> {
    const res = await http()(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "dandelist-api", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub ${path} answered ${res.status}`);
    return res.json();
  }

  async function appleProfile(idToken: string, audience: string, nonce: string | null, name: string | null): Promise<Profile> {
    const claims = await appleKeys.verify(idToken, { issuer: APPLE_ISSUER, audience, algorithms: ["RS256"], currentDate: deps.now() });
    if (nonce !== null && claims.nonce !== nonce) throw new Error("Apple token nonce doesn't match");
    if (!claims.sub) throw new Error("Apple token has no subject");
    return { subject: claims.sub, email: text(claims.email), emailVerified: verified(claims.email_verified), name };
  }

  /** Completes the provider's side of a sign-in and returns who the person is. */
  async function finish(p: Provider, params: Record<string, string>, s: State): Promise<Profile> {
    if (p === "google") {
      if (!params.code) throw new Error("Google returned no code");
      const tokens = await postForm("https://oauth2.googleapis.com/token", {
        code: params.code,
        client_id: google!.clientId,
        client_secret: google!.clientSecret,
        redirect_uri: callbackUrl("google"),
        grant_type: "authorization_code",
        code_verifier: s.v,
      });
      if (typeof tokens.id_token !== "string") throw new Error("Google returned no id_token");
      const claims = await googleKeys.verify(tokens.id_token, { issuer: GOOGLE_ISSUERS, audience: google!.clientId, algorithms: ["RS256"], currentDate: deps.now() });
      if (claims.nonce !== s.n) throw new Error("Google token nonce doesn't match");
      if (!claims.sub) throw new Error("Google token has no subject");
      return { subject: claims.sub, email: text(claims.email), emailVerified: verified(claims.email_verified), name: text(claims.name) };
    }
    if (p === "github") {
      if (!params.code) throw new Error("GitHub returned no code");
      const tokens = await postForm("https://github.com/login/oauth/access_token", {
        code: params.code,
        client_id: github!.clientId,
        client_secret: github!.clientSecret,
        redirect_uri: callbackUrl("github"),
        code_verifier: s.v,
      });
      if (typeof tokens.access_token !== "string") throw new Error("GitHub returned no access token");
      const user = (await githubGet("/user", tokens.access_token)) as { id?: unknown; name?: unknown; login?: unknown };
      if (typeof user.id !== "number" && typeof user.id !== "string") throw new Error("GitHub user has no id");
      const emails = (await githubGet("/user/emails", tokens.access_token)) as { email?: unknown; primary?: unknown; verified?: unknown }[];
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary === true && e.verified === true && typeof e.email === "string") : undefined;
      return { subject: String(user.id), email: primary ? String(primary.email) : null, emailVerified: !!primary, name: text(user.name) ?? text(user.login) };
    }
    // Apple on the web posts back an id_token alongside the code; we only need the token, so no client secret.
    if (!params.id_token) throw new Error("Apple returned no id_token");
    let name: string | null = null;
    try {
      const u = JSON.parse(params.user ?? "null") as { name?: { firstName?: unknown; lastName?: unknown } } | null;
      name = text([u?.name?.firstName, u?.name?.lastName].filter((x) => typeof x === "string").join(" "));
    } catch {
      // Apple sends the name only the first time; a malformed value is the same as none.
    }
    return appleProfile(params.id_token, appleServicesId!, s.n, name);
  }

  /**
   * The account for a provider identity. A known identity signs straight in. Otherwise the person joins the account
   * that already has their email, but only when the provider has verified that email; without one there is nothing
   * safe to link or create.
   */
  async function accountFor(p: Provider, profile: Profile): Promise<string> {
    const known = await db.query<{ user_id: string }>("select user_id from user_identities where provider = $1 and subject = $2", [p, profile.subject]);
    if (known.rows[0]) return known.rows[0].user_id;
    if (!profile.email || !profile.emailVerified) throw new OAuthFailure("no_email");
    const email = normalizeEmail(profile.email);
    await db.query("insert into users (email) values ($1) on conflict (email) do nothing", [email]);
    const user = (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]!;
    await db.query(
      "insert into user_identities (provider, subject, user_id, email, name) values ($1, $2, $3, $4, $5) on conflict (provider, subject) do nothing",
      [p, profile.subject, user.id, email, profile.name],
    );
    // Re-read so two first sign-ins racing each other land on the same account.
    return (await db.query<{ user_id: string }>("select user_id from user_identities where provider = $1 and subject = $2", [p, profile.subject])).rows[0]!.user_id;
  }

  async function issueTicket(userId: string): Promise<string> {
    const ticket = randomToken(32);
    const nowMs = deps.now().getTime();
    await db.query("delete from oauth_tickets where expires_at < $1", [new Date(nowMs - 60 * 60 * 1000).toISOString()]);
    await db.query("insert into oauth_tickets (ticket_hash, user_id, expires_at) values ($1, $2, $3)", [
      sha256hex(ticket),
      userId,
      new Date(nowMs + TICKET_TTL_MS).toISOString(),
    ]);
    return ticket;
  }

  async function signedIn(userId: string) {
    const user = (await db.query<{ id: string; email: string }>("select id, email from users where id = $1", [userId])).rows[0]!;
    return { user, ...(await issueSession(user.id)) };
  }

  const noStore = (c: Context) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  };

  app.get("/providers", (c) => {
    const providers = PROVIDERS.map((id) => ({ id, web: webEnabled[id], native: id === "apple" ? !!appleBundleId : webEnabled[id] })).filter((p) => p.web || p.native);
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ providers });
  });

  app.get("/oauth/:provider/start", async (c) => {
    noStore(c);
    const p = c.req.param("provider") as Provider;
    if (!PROVIDERS.includes(p) || !webEnabled[p]) return c.json({ error: "That sign-in option isn't available." }, 404);
    const redirect = c.req.query("redirect") ?? "";
    if (!redirectAllowed(redirect, webOrigins, production)) return c.json({ error: "That return address isn't allowed." }, 400);
    const s: State = { p, r: redirect, n: randomToken(24), v: randomToken(32) };
    const sealed = await state.seal(s, nowS());
    setCookie(c, COOKIE, s.n, cookieOpts);
    return c.redirect(authorizeUrl(p, sealed, s), 302);
  });

  async function callback(c: Context) {
    noStore(c);
    const p = c.req.param("provider") as Provider;
    const raw = c.req.method === "POST" ? await c.req.parseBody().catch(() => ({})) : c.req.query();
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") params[k] = v;

    const s = params.state ? await state.open(params.state, deps.now()) : null;
    if (!s || s.p !== p || !redirectAllowed(s.r, webOrigins, production)) {
      return c.text("This sign-in link has expired or isn't valid. Go back to Dandelist and try again.", 400);
    }
    // From here the state is ours, so its redirect is safe to send the person back to, with or without a ticket.
    const back = (query: string) => c.redirect(`${s.r}?${query}`, c.req.method === "POST" ? 303 : 302);
    const bounce = (code: FailureCode) => back(`error=${code}`);

    const bound = readCookie(c);
    deleteCookie(c, COOKIE, cookieOpts);
    if (bound !== s.n) return bounce("expired");
    if (!callbacksPerIp.take(ip(c), deps.now().getTime())) return bounce("failed");
    if (params.error) return bounce(params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "cancelled" : "failed");
    if (!webEnabled[p]) return bounce("failed");

    try {
      const userId = await accountFor(p, await finish(p, params, s));
      return back(`ticket=${await issueTicket(userId)}`);
    } catch (e) {
      if (e instanceof OAuthFailure) return bounce(e.code);
      console.warn(`${p} sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
      return bounce("failed");
    }
  }
  app.get("/oauth/:provider/callback", callback);
  app.post("/oauth/:provider/callback", callback);

  app.post("/oauth/redeem", async (c) => {
    noStore(c);
    const parsed = redeemBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "That sign-in has expired. Try again." }, 400);
    if (!redeemsPerIp.take(ip(c), deps.now().getTime())) return c.json({ error: "Too many sign-in attempts from this network. Try again in an hour." }, 429);
    const nowIso = deps.now().toISOString();
    const { rows } = await db.query<{ user_id: string }>(
      "update oauth_tickets set consumed_at = $2 where ticket_hash = $1 and consumed_at is null and expires_at > $2 returning user_id",
      [sha256hex(parsed.data.ticket), nowIso],
    );
    if (!rows[0]) return c.json({ error: "That sign-in has expired. Try again." }, 400);
    return c.json(await signedIn(rows[0].user_id));
  });

  app.post("/apple/native", async (c) => {
    noStore(c);
    if (!appleBundleId) return c.json({ error: "Sign in with Apple isn't available." }, 404);
    const parsed = nativeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Apple didn't send a sign-in. Try again." }, 400);
    if (!nativePerIp.take(ip(c), deps.now().getTime())) return c.json({ error: "Too many sign-in attempts from this network. Try again in an hour." }, 429);
    const { identityToken, fullName } = parsed.data;
    let profile: Profile;
    try {
      profile = await appleProfile(identityToken, appleBundleId, null, text([fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ")));
    } catch (e) {
      console.warn(`native Apple sign-in rejected: ${e instanceof Error ? e.message : String(e)}`);
      return c.json({ error: "Apple couldn't confirm that sign-in. Try again." }, 401);
    }
    try {
      return c.json(await signedIn(await accountFor("apple", profile)));
    } catch (e) {
      if (e instanceof OAuthFailure) return c.json({ error: "Apple didn't share a verified email. Sign in with an email code instead." }, 400);
      throw e;
    }
  });

  return app;
}
