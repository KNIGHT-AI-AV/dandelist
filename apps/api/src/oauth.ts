import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { EncryptJWT, createLocalJWKSet, jwtDecrypt, jwtVerify, type JWTPayload, type JWTVerifyOptions } from "jose";
import { z } from "zod";
import type { AuthVars } from "./auth";
import type { Db } from "./db";
import { RateLimiter, clientIp } from "./ratelimit";
import { normalizeEmail } from "./tokens";

/**
 * Social sign-in, brokered by the API for every platform. The app opens /auth/oauth/<provider>/start; the provider
 * comes back to /auth/oauth/<provider>/callback; the API finds or creates the user and hands the app a one-time
 * ticket in the redirect, which the app swaps for the usual tokens at /auth/oauth/redeem. Native iOS uses Apple's own
 * sheet instead and posts the identity token to /auth/apple/native.
 *
 * Each ticket is bound to the app that asked for it, PKCE-style: the app makes a random verifier per attempt, sends
 * its SHA-256 (base64url) as `challenge` when it starts, and must show the verifier to redeem. Another app that
 * catches the dandelist://auth redirect gets a ticket it cannot use. Native Apple sign-in carries a single-use nonce
 * from /auth/apple/nonce, so a captured identity token can't be replayed.
 *
 * Linking (settings; owner, 2026-10-28: "Apple plus Google on one account") runs the same flow for someone already
 * signed in. POST /auth/link/<provider> seals their user id into a start address; the provider round trip is the same;
 * the callback hands back a link ticket instead of a sign-in ticket, and the app redeems it at /auth/link/redeem with
 * its verifier and the same account's session, which is when the identity joins the account. An identity that already
 * belongs to another account is refused.
 */

export type Provider = "apple" | "google" | "github" | "facebook";
export const PROVIDERS: readonly Provider[] = ["apple", "google", "github", "facebook"];
export const PROVIDER_NAMES: Record<Provider, string> = { apple: "Apple", google: "Google", github: "GitHub", facebook: "Facebook" };

/**
 * The Graph API version for Facebook Login. v26.0 is the current one (Meta's changelog, read 2026-10-28: released
 * 2026-07-29). Keep it a constant and move it forward deliberately; Meta supports each version for about two years.
 */
export const FACEBOOK_GRAPH_VERSION = "v26.0";

export interface OAuthConfig {
  /** Public origin of this API; providers return to `<apiUrl>/auth/oauth/<provider>/callback`. */
  apiUrl: string;
  production: boolean;
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
  /** `servicesId` turns on Apple for the web and Android; `bundleId` turns on the native iOS sheet. */
  apple?: { servicesId?: string; bundleId?: string };
  /** Facebook Login; on only when both are set. */
  facebook?: { appId: string; appSecret: string };
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
const APPLE_NONCE_TTL_MS = 10 * 60 * 1000;
/** A base64url SHA-256, as the app sends its challenge. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE_ISSUER = "dandelist-api";
const STATE_AUDIENCE = "dandelist-oauth-state";
const LINK_AUDIENCE = "dandelist-oauth-link";
const COOKIE = "dl_oauth";
const NATIVE_REDIRECT = "dandelist://auth";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";

/**
 * Why a sign-in or a link didn't finish, as the app shows it. Only these codes ever reach the redirect. `taken` is for
 * linking only: that provider account already belongs to another Dandelist account.
 */
export type FailureCode = "cancelled" | "expired" | "no_email" | "taken" | "failed";

class OAuthFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

const providerEnum = z.enum(["apple", "google", "github", "facebook"]);

const stateSchema = z.object({
  p: providerEnum,
  r: z.string(),
  n: z.string().min(16),
  v: z.string().min(43),
  // The app's challenge: SHA-256 of the verifier it must show to redeem the ticket.
  c: z.string().regex(CHALLENGE),
  // Set when the flow links this identity to a signed-in account: that account's id.
  u: z.string().uuid().optional(),
});
type State = z.infer<typeof stateSchema>;

/** A link request from POST /auth/link/<provider>: which provider, whose account, where to return, the app's challenge. */
const linkSchema = z.object({ p: providerEnum, u: z.string().uuid(), r: z.string(), c: z.string().regex(CHALLENGE) });
type LinkRequest = z.infer<typeof linkSchema>;

/**
 * Seals and opens a value that travels through the browser: the state parameter, and a link request. It is encrypted
 * as well as authenticated, so the PKCE verifier, the nonce and the user id never travel readable through the browser
 * or the provider's logs. Each kind has its own key and audience, so one can't be passed off as the other.
 */
function codec<T extends Record<string, unknown>>(jwtSecret: string, info: string, audience: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  const key = new Uint8Array(hkdfSync("sha256", jwtSecret, new Uint8Array(0), info, 32));
  return {
    seal: (s: T, nowS: number) =>
      new EncryptJWT({ ...s } as JWTPayload)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuer(STATE_ISSUER)
        .setAudience(audience)
        .setIssuedAt(nowS)
        .setExpirationTime(nowS + STATE_TTL_S)
        .encrypt(key),
    async open(token: string, now: Date): Promise<T | null> {
      try {
        const { payload } = await jwtDecrypt(token, key, {
          issuer: STATE_ISSUER,
          audience,
          currentDate: now,
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        const parsed = schema.safeParse(payload);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

/** One sign-in account on a Dandelist account, as settings lists it. */
export interface LinkedIdentity {
  provider: Provider;
  email: string | null;
  name: string | null;
  linkedAt: string;
}

/** Every sign-in account linked to `userId`, oldest first. */
export async function listIdentities(db: Db, userId: string): Promise<LinkedIdentity[]> {
  const { rows } = await db.query<{ provider: Provider; email: string | null; name: string | null; created_at: string | Date }>(
    "select provider, email, name, created_at from user_identities where user_id = $1 order by created_at, provider",
    [userId],
  );
  return rows.map((r) => ({ provider: r.provider, email: r.email, name: r.name, linkedAt: new Date(r.created_at).toISOString() }));
}

/**
 * Where a ticket may be sent: each web origin's /auth/callback and the app's own scheme. In production only https
 * origins qualify, so an http origin kept in WEB_ORIGINS for CORS (localhost) never receives a ticket. Development
 * also accepts Expo Go (exp://) and any localhost port. Matching is exact, never by prefix.
 */
export function redirectAllowed(redirect: string, webOrigins: string[], production: boolean): boolean {
  if (!redirect || redirect.length > 300) return false;
  const exact = new Set([NATIVE_REDIRECT]);
  for (const o of webOrigins) {
    try {
      const url = new URL(o);
      if (production && url.protocol !== "https:") continue;
      exact.add(`${url.origin}/auth/callback`);
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
const linkStartBody = z.object({ redirect: z.string().max(300), challenge: z.string().regex(CHALLENGE) });
const redeemBody = z.object({
  ticket: z.string().min(20).max(100),
  // The secret behind the challenge sent at start: 43 to 128 URL-safe characters, as in PKCE.
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

/** Whether `verifier` hashes to `challenge`, compared in constant time. */
function verifierMatches(verifier: string, challenge: string): boolean {
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The identity a link ticket carries until the account that asked for it redeems it. */
type LinkIdentityRow = { provider: Provider; subject: string; email: string | null; name: string | null };

export function oauthRoutes(deps: OAuthRouteDeps, issueSession: (userId: string) => Promise<Session>, auth: MiddlewareHandler<{ Variables: AuthVars }>) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  const cfg = deps.oauth;
  const production = cfg?.production ?? false;
  const webOrigins = deps.webOrigins ?? [];
  const state = codec<State>(deps.jwtSecret, "dandelist oauth state v1", STATE_AUDIENCE, stateSchema);
  const linkCodec = codec<LinkRequest>(deps.jwtSecret, "dandelist oauth link v1", LINK_AUDIENCE, linkSchema);
  const http = () => cfg?.fetch ?? fetch;
  const googleKeys = new SigningKeys("https://www.googleapis.com/oauth2/v3/certs", http);
  const appleKeys = new SigningKeys("https://appleid.apple.com/auth/keys", http);
  const callbacksPerIp = new RateLimiter(60, 60 * 60 * 1000);
  const redeemsPerIp = new RateLimiter(60, 60 * 60 * 1000);
  const nativePerIp = new RateLimiter(30, 60 * 60 * 1000);
  const noncesPerIp = new RateLimiter(60, 60 * 60 * 1000);
  const linksPerUser = new RateLimiter(30, 60 * 60 * 1000);
  const ip = (c: Context) => clientIp(c.req.header("X-Forwarded-For"));
  const nowS = () => Math.floor(deps.now().getTime() / 1000);

  const google = cfg?.google?.clientId && cfg.google.clientSecret ? cfg.google : undefined;
  const github = cfg?.github?.clientId && cfg.github.clientSecret ? cfg.github : undefined;
  const facebook = cfg?.facebook?.appId && cfg.facebook.appSecret ? cfg.facebook : undefined;
  const appleServicesId = cfg?.apple?.servicesId || undefined;
  const appleBundleId = cfg?.apple?.bundleId || undefined;
  const webEnabled: Record<Provider, boolean> = { apple: !!appleServicesId, google: !!google, github: !!github, facebook: !!facebook };
  const apiBase = (cfg?.apiUrl ?? "").replace(/\/+$/, "");
  const callbackUrl = (p: Provider) => `${apiBase}/auth/oauth/${p}/callback`;

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
    } else if (p === "facebook") {
      // Facebook's login dialog, code flow. The code is exchanged server to server with the app secret.
      base = `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`;
      params = {
        client_id: facebook!.appId,
        redirect_uri,
        response_type: "code",
        scope: "email,public_profile",
        state: sealed,
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

  /** A server-to-server GET to Facebook's Graph API, which reports failures as an `error` object. */
  async function graphGet(path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await http()(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}${path}?${new URLSearchParams(query).toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.error) throw new Error(`Facebook ${path} answered ${res.status}`);
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

  /** Verifies an Apple identity token, then lets `nonceOk` decide whether its nonce belongs to a sign-in we started. */
  async function appleProfile(idToken: string, audience: string, nonceOk: (nonce: unknown) => Promise<boolean>, name: string | null): Promise<Profile> {
    const claims = await appleKeys.verify(idToken, { issuer: APPLE_ISSUER, audience, algorithms: ["RS256"], currentDate: deps.now() });
    if (!claims.sub) throw new Error("Apple token has no subject");
    if (!(await nonceOk(claims.nonce))) throw new Error("Apple token nonce doesn't match a sign-in we started");
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
    if (p === "facebook") {
      if (!params.code) throw new Error("Facebook returned no code");
      const tokens = await graphGet("/oauth/access_token", {
        client_id: facebook!.appId,
        client_secret: facebook!.appSecret,
        redirect_uri: callbackUrl("facebook"),
        code: params.code,
      });
      if (typeof tokens.access_token !== "string") throw new Error("Facebook returned no access token");
      // Calls made with the person's token are signed with the app secret (appsecret_proof), so a token lifted from
      // somewhere else is no use against this app.
      const proof = createHmac("sha256", facebook!.appSecret).update(tokens.access_token).digest("hex");
      const me = await graphGet("/me", { fields: "id,name,email", access_token: tokens.access_token, appsecret_proof: proof });
      if (typeof me.id !== "string" && typeof me.id !== "number") throw new Error("Facebook user has no id");
      // Facebook returns an email only when the person has confirmed it with Facebook and allowed the email
      // permission, so an email that is present counts as verified. Many accounts (phone sign-ups) have none, and
      // those can still link to an account from settings.
      const email = text(me.email);
      return { subject: String(me.id), email, emailVerified: !!email, name: text(me.name) };
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
    return appleProfile(params.id_token, appleServicesId!, async (nonce) => nonce === s.n, name);
  }

  const ownerOf = async (p: Provider, subject: string) =>
    (await db.query<{ user_id: string }>("select user_id from user_identities where provider = $1 and subject = $2", [p, subject])).rows[0]?.user_id ?? null;

  /**
   * The account for a provider identity. A known identity signs straight in. Otherwise the person joins the account
   * that already has their email, but only when the provider has verified that email; without one there is nothing
   * safe to link or create.
   */
  async function accountFor(p: Provider, profile: Profile): Promise<string> {
    const known = await ownerOf(p, profile.subject);
    if (known) return known;
    if (!profile.email || !profile.emailVerified) throw new OAuthFailure("no_email");
    const email = normalizeEmail(profile.email);
    await db.query("insert into users (email) values ($1) on conflict (email) do nothing", [email]);
    const user = (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]!;
    await db.query(
      "insert into user_identities (provider, subject, user_id, email, name) values ($1, $2, $3, $4, $5) on conflict (provider, subject) do nothing",
      [p, profile.subject, user.id, email, profile.name],
    );
    // Re-read so two first sign-ins racing each other land on the same account.
    return (await ownerOf(p, profile.subject))!;
  }

  /** Adds an identity to `userId`. "taken" when it already belongs to another account; linking it again is fine. */
  async function attach(userId: string, link: LinkIdentityRow): Promise<"linked" | "taken"> {
    await db.query("insert into user_identities (provider, subject, user_id, email, name) values ($1, $2, $3, $4, $5) on conflict (provider, subject) do nothing", [
      link.provider,
      link.subject,
      userId,
      link.email,
      link.name,
    ]);
    return (await ownerOf(link.provider, link.subject)) === userId ? "linked" : "taken";
  }

  const takenMessage = (p: Provider) => `That ${PROVIDER_NAMES[p]} account is already linked to another Dandelist account. Sign in with it there and unlink it first.`;

  async function issueTicket(userId: string, challenge: string, link?: LinkIdentityRow): Promise<string> {
    const ticket = randomToken(32);
    const nowMs = deps.now().getTime();
    await db.query("delete from oauth_tickets where expires_at < $1", [new Date(nowMs - 60 * 60 * 1000).toISOString()]);
    await db.query("insert into oauth_tickets (ticket_hash, user_id, expires_at, client_challenge, link) values ($1, $2, $3, $4, $5::jsonb)", [
      sha256hex(ticket),
      userId,
      new Date(nowMs + TICKET_TTL_MS).toISOString(),
      challenge,
      link ? JSON.stringify(link) : null,
    ]);
    return ticket;
  }

  /** Uses up a nonce from /auth/apple/nonce. True only the first time, and only within its ten minutes. */
  async function consumeAppleNonce(nonce: unknown): Promise<boolean> {
    if (typeof nonce !== "string" || !nonce) return false;
    const nowIso = deps.now().toISOString();
    const { rows } = await db.query(
      "update apple_nonces set consumed_at = $2 where nonce_hash = $1 and consumed_at is null and expires_at > $2 returning id",
      [sha256hex(nonce), nowIso],
    );
    return rows.length > 0;
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
    // A link carries everything (whose account, where to return, the app's challenge), sealed by
    // POST /auth/link/<provider>; a sign-in takes the address and the challenge from the query.
    const rawLink = c.req.query("link");
    const link = rawLink ? await linkCodec.open(rawLink, deps.now()) : null;
    if (rawLink && (!link || link.p !== p)) return c.text("This link has expired or isn't valid. Go back to Dandelist and try again.", 400);
    const redirect = link?.r ?? c.req.query("redirect") ?? "";
    if (!redirectAllowed(redirect, webOrigins, production)) return c.json({ error: "That return address isn't allowed." }, 400);
    const challenge = link?.c ?? c.req.query("challenge") ?? "";
    if (!CHALLENGE.test(challenge)) return c.json({ error: "That sign-in request is incomplete. Update Dandelist and try again." }, 400);
    const s: State = { p, r: redirect, n: randomToken(24), v: randomToken(32), c: challenge, ...(link ? { u: link.u } : {}) };
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
    // A link says so, so the app finishes it in settings instead of signing in.
    const intent = s.u ? "intent=link&" : "";
    const back = (query: string) => c.redirect(`${s.r}?${intent}${query}`, c.req.method === "POST" ? 303 : 302);
    const bounce = (code: FailureCode) => back(`error=${code}`);

    const bound = readCookie(c);
    deleteCookie(c, COOKIE, cookieOpts);
    if (bound !== s.n) return bounce("expired");
    if (!callbacksPerIp.take(ip(c), deps.now().getTime())) return bounce("failed");
    if (params.error) return bounce(params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "cancelled" : "failed");
    if (!webEnabled[p]) return bounce("failed");

    try {
      const profile = await finish(p, params, s);
      if (s.u) {
        // A link needs no email: the account is already known. It must never take an identity from someone else.
        const owner = await ownerOf(p, profile.subject);
        if (owner && owner !== s.u) return bounce("taken");
        if (!(await db.query("select 1 from users where id = $1", [s.u])).rows.length) return bounce("failed");
        const link: LinkIdentityRow = { provider: p, subject: profile.subject, email: profile.email ? normalizeEmail(profile.email) : null, name: profile.name };
        return back(`ticket=${await issueTicket(s.u, s.c, link)}`);
      }
      const userId = await accountFor(p, profile);
      return back(`ticket=${await issueTicket(userId, s.c)}`);
    } catch (e) {
      if (e instanceof OAuthFailure) return bounce(e.code);
      console.warn(`${p} ${s.u ? "link" : "sign-in"} failed: ${e instanceof Error ? e.message : String(e)}`);
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
    const expired = () => c.json({ error: "That sign-in has expired. Try again." }, 400);
    // Link tickets never sign anyone in; only /auth/link/redeem takes them.
    const found = await db.query<{ id: string; client_challenge: string }>(
      "select id, client_challenge from oauth_tickets where ticket_hash = $1 and consumed_at is null and expires_at > $2 and link is null",
      [sha256hex(parsed.data.ticket), nowIso],
    );
    const ticket = found.rows[0];
    // A ticket redeems only with the verifier of the app that started the sign-in. A wrong one leaves the ticket
    // unspent, so an app that caught the redirect can't use it up before the real app does.
    if (!ticket || !verifierMatches(parsed.data.verifier, ticket.client_challenge)) return expired();
    const { rows } = await db.query<{ user_id: string }>(
      "update oauth_tickets set consumed_at = $2 where id = $1 and consumed_at is null returning user_id",
      [ticket.id, nowIso],
    );
    if (!rows[0]) return expired();
    return c.json(await signedIn(rows[0].user_id));
  });

  app.get("/apple/nonce", async (c) => {
    noStore(c);
    if (!appleBundleId) return c.json({ error: "Sign in with Apple isn't available." }, 404);
    const nowMs = deps.now().getTime();
    if (!noncesPerIp.take(ip(c), nowMs)) return c.json({ error: "Too many sign-in attempts from this network. Try again in an hour." }, 429);
    const nonce = randomToken(32);
    await db.query("delete from apple_nonces where expires_at < $1", [new Date(nowMs - 60 * 60 * 1000).toISOString()]);
    await db.query("insert into apple_nonces (nonce_hash, expires_at) values ($1, $2)", [sha256hex(nonce), new Date(nowMs + APPLE_NONCE_TTL_MS).toISOString()]);
    return c.json({ nonce });
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
      // expo-apple-authentication hands the nonce to Apple unchanged and Apple returns it unchanged in the token, so
      // the claim is the raw nonce from /auth/apple/nonce. It must be one we issued and is used up here.
      profile = await appleProfile(identityToken, appleBundleId, consumeAppleNonce, text([fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ")));
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

  // ------------------------------------------------------------------ linking, for someone already signed in

  // Finishes a link: the ticket from the callback, the verifier of the app that started it, and the same account's
  // session. Registered before /link/:provider, so "redeem" is never read as a provider.
  app.post("/link/redeem", auth, async (c) => {
    noStore(c);
    const parsed = redeemBody.safeParse(await c.req.json().catch(() => null));
    const expired = () => c.json({ error: "That link has expired. Try again." }, 400);
    if (!parsed.success) return expired();
    if (!redeemsPerIp.take(ip(c), deps.now().getTime())) return c.json({ error: "Too many tries from this network. Try again in an hour." }, 429);
    const userId = c.get("userId");
    const nowIso = deps.now().toISOString();
    const found = await db.query<{ id: string; client_challenge: string; user_id: string }>(
      "select id, client_challenge, user_id from oauth_tickets where ticket_hash = $1 and consumed_at is null and expires_at > $2 and link is not null",
      [sha256hex(parsed.data.ticket), nowIso],
    );
    const ticket = found.rows[0];
    if (!ticket || ticket.user_id !== userId || !verifierMatches(parsed.data.verifier, ticket.client_challenge)) return expired();
    const { rows } = await db.query<{ link: unknown }>("update oauth_tickets set consumed_at = $2 where id = $1 and consumed_at is null returning link", [ticket.id, nowIso]);
    if (!rows[0]) return expired();
    const link = (typeof rows[0].link === "string" ? JSON.parse(rows[0].link) : rows[0].link) as LinkIdentityRow;
    if ((await attach(userId, link)) === "taken") return c.json({ error: takenMessage(link.provider) }, 409);
    return c.json({ identities: await listIdentities(db, userId) });
  });

  // Apple on an iPhone links through the system sheet, with a nonce from /auth/apple/nonce, like native sign-in.
  app.post("/link/apple/native", auth, async (c) => {
    noStore(c);
    if (!appleBundleId) return c.json({ error: "Sign in with Apple isn't available." }, 404);
    const parsed = nativeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Apple didn't send an account. Try again." }, 400);
    if (!nativePerIp.take(ip(c), deps.now().getTime())) return c.json({ error: "Too many tries from this network. Try again in an hour." }, 429);
    const { identityToken, fullName } = parsed.data;
    let profile: Profile;
    try {
      profile = await appleProfile(identityToken, appleBundleId, consumeAppleNonce, text([fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ")));
    } catch (e) {
      console.warn(`native Apple link rejected: ${e instanceof Error ? e.message : String(e)}`);
      return c.json({ error: "Apple couldn't confirm that account. Try again." }, 401);
    }
    const userId = c.get("userId");
    const link: LinkIdentityRow = { provider: "apple", subject: profile.subject, email: profile.email ? normalizeEmail(profile.email) : null, name: profile.name };
    if ((await attach(userId, link)) === "taken") return c.json({ error: takenMessage("apple") }, 409);
    return c.json({ identities: await listIdentities(db, userId) });
  });

  // Starts a link and answers the address the app opens in a browser. The request inside it is sealed and lasts ten
  // minutes, and it finishes only with this account's session and the app's verifier at /auth/link/redeem.
  app.post("/link/:provider", auth, async (c) => {
    noStore(c);
    const p = c.req.param("provider") as Provider;
    if (!PROVIDERS.includes(p) || !webEnabled[p]) return c.json({ error: "That sign-in option isn't available." }, 404);
    const parsed = linkStartBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "That request is incomplete. Update Dandelist and try again." }, 400);
    if (!redirectAllowed(parsed.data.redirect, webOrigins, production)) return c.json({ error: "That return address isn't allowed." }, 400);
    const userId = c.get("userId");
    if (!linksPerUser.take(userId, deps.now().getTime())) return c.json({ error: "Too many tries. Try again in an hour." }, 429);
    const sealedLink = await linkCodec.seal({ p, u: userId, r: parsed.data.redirect, c: parsed.data.challenge }, nowS());
    return c.json({ url: `${apiBase}/auth/oauth/${p}/start?link=${encodeURIComponent(sealedLink)}` });
  });

  return app;
}
