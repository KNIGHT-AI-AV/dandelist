import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Db } from "./db";
import type { Mailer } from "./mailer";
import { oauthRoutes, type OAuthConfig } from "./oauth";
import { RateLimiter, clientIp } from "./ratelimit";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_HOUR,
  REFRESH_TTL_MS,
  hashCode,
  hashRefresh,
  newCode,
  newRefreshToken,
  normalizeEmail,
  sameHash,
  signAccess,
  verifyAccess,
} from "./tokens";

export interface AuthDeps {
  db: Db;
  mailer: Mailer;
  jwtSecret: string;
  codePepper: string;
  judge?: { email: string; code: string };
  now: () => Date;
  /** Google, GitHub, Apple and Facebook sign-in; each provider stays off until its settings are present. */
  oauth?: OAuthConfig;
  /** Web app origins; each may receive social sign-in tickets at /auth/callback. */
  webOrigins?: string[];
}

export type AuthVars = { userId: string; sessionId: string };

const emailBody = z.object({ email: z.string().trim().email().max(254) });
const verifyBody = emailBody.extend({ code: z.string().regex(/^\d{6}$/) });
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

/** Accepts a valid access token whose session is still open, so signing out takes effect immediately. */
export function requireAuth(deps: Pick<AuthDeps, "db" | "jwtSecret" | "now">): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    let claims: { userId: string; sessionId: string };
    try {
      claims = await verifyAccess(deps.jwtSecret, token, Math.floor(deps.now().getTime() / 1000));
    } catch {
      return c.json({ error: "Sign in again to continue." }, 401);
    }
    // An expired session is closed too, so nothing minted for it (an agent key's calls) outlives it.
    const open = await deps.db.query("select 1 from sessions where id = $1 and user_id = $2 and revoked_at is null and expires_at > $3", [claims.sessionId, claims.userId, deps.now().toISOString()]);
    if (!open.rows.length) return c.json({ error: "Sign in again to continue." }, 401);
    c.set("userId", claims.userId);
    c.set("sessionId", claims.sessionId);
    await next();
  };
}

export function authRoutes(deps: AuthDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  const judge = deps.judge
    ? { email: normalizeEmail(deps.judge.email), hash: hashCode(deps.codePepper, normalizeEmail(deps.judge.email), deps.judge.code) }
    : undefined;
  const startsPerIp = new RateLimiter(10, 60 * 60 * 1000);
  const verifiesPerIp = new RateLimiter(30, 60 * 60 * 1000);
  const sendsNew = new RateLimiter(300, 60 * 60 * 1000);
  const sendsKnown = new RateLimiter(1000, 60 * 60 * 1000);
  const ip = (c: { req: { header(n: string): string | undefined } }) => clientIp(c.req.header("X-Forwarded-For"));

  async function issueSession(userId: string) {
    const { token, hash } = newRefreshToken();
    const expires = new Date(deps.now().getTime() + REFRESH_TTL_MS);
    const { rows } = await db.query<{ id: string }>(
      "insert into sessions (user_id, refresh_hash, expires_at) values ($1, $2, $3) returning id",
      [userId, hash, expires.toISOString()],
    );
    const sessionId = rows[0]!.id;
    const accessToken = await signAccess(deps.jwtSecret, userId, sessionId, Math.floor(deps.now().getTime() / 1000));
    return { accessToken, refreshToken: token, expiresIn: 15 * 60 };
  }

  async function issueEmailSession(email: string) {
    await db.query("insert into users (email) values ($1) on conflict (email) do nothing", [email]);
    const user = (await db.query<{ id: string; email: string }>("select id, email from users where email = $1", [email])).rows[0]!;
    return { user, ...(await issueSession(user.id)) };
  }

  app.post("/email/start", async (c) => {
    const parsed = emailBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter a valid email address." }, 400);
    const nowMs = deps.now().getTime();
    if (!startsPerIp.take(ip(c), nowMs)) return c.json({ error: "Too many sign-in attempts from this network. Try again in an hour." }, 429);
    const email = normalizeEmail(parsed.data.email);

    // The configured judge code is reusable. Shared one-time rows would let one caller exhaust it for every judge.
    // Keep the network limit above, but do not create or count email-code rows for this account.
    if (email === judge?.email) return c.body(null, 204);

    // Past the per-email cap we stop sending but still answer 204, so a stranger can't lock someone out:
    // the codes already in their inbox keep working.
    const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const recent = await db.query<{ n: string }>("select count(*) as n from email_codes where email = $1 and created_at > $2", [email, hourAgo]);
    if (Number(recent.rows[0]?.n ?? 0) >= MAX_CODES_PER_HOUR) return c.body(null, 204);

    // Separate hourly send budgets for new and existing addresses, so a flood of fake signups can't starve
    // existing users. Hitting either one answers exactly like a normal send, so the reply never reveals
    // whether an account exists.
    const known = (await db.query("select 1 from users where email = $1", [email])).rows.length > 0;
    if (!(known ? sendsKnown : sendsNew).take("all", nowMs)) {
      console.warn(`sign-in email budget reached (${known ? "existing" : "new"} addresses); skipping send`);
      return c.body(null, 204);
    }
    const code = newCode();
    const expires = new Date(nowMs + CODE_TTL_MS).toISOString();
    await db.query("insert into email_codes (email, code_hash, expires_at, created_at) values ($1, $2, $3, $4)", [
      email,
      hashCode(deps.codePepper, email, code),
      expires,
      deps.now().toISOString(),
    ]);
    await deps.mailer.sendCode(email, code);
    return c.body(null, 204);
  });

  app.post("/email/verify", async (c) => {
    const parsed = verifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter the 6-digit code from your email." }, 400);
    if (!verifiesPerIp.take(ip(c), deps.now().getTime())) return c.json({ error: "Too many tries from this network. Try again in an hour." }, 429);
    const email = normalizeEmail(parsed.data.email);
    if (email === judge?.email) {
      // Both hashes have the same fixed size; sameHash uses timingSafeEqual for the secret comparison.
      if (!sameHash(judge.hash, hashCode(deps.codePepper, email, parsed.data.code))) {
        return c.json({ error: "That code doesn't match. Check the email and try again." }, 400);
      }
      return c.json(await issueEmailSession(email));
    }
    const now = deps.now().toISOString();
    const active = await db.query("select 1 from email_codes where email = $1 and consumed_at is null and expires_at > $2 limit 1", [email, now]);
    if (!active.rows.length) return c.json({ error: "That code has expired. Request a new one." }, 400);

    // Every try counts against every active code, atomically, before any comparison: parallel guesses can't
    // exceed the limit, and any code still in the inbox works.
    const counted = await db.query<{ id: string; code_hash: string }>(
      "update email_codes set attempts = attempts + 1 where email = $1 and consumed_at is null and expires_at > $2 and attempts < $3 returning id, code_hash",
      [email, now, MAX_CODE_ATTEMPTS],
    );
    if (!counted.rows.length) return c.json({ error: "Too many wrong tries. Request a new code." }, 400);
    const submitted = hashCode(deps.codePepper, email, parsed.data.code);
    const row = counted.rows.find((r) => sameHash(r.code_hash, submitted));
    if (!row) return c.json({ error: "That code doesn't match. Check the email and try again." }, 400);
    const consumed = await db.query("update email_codes set consumed_at = $2 where id = $1 and consumed_at is null returning id", [row.id, now]);
    if (!consumed.rows.length) return c.json({ error: "That code was already used. Request a new one." }, 400);
    return c.json(await issueEmailSession(email));
  });

  app.post("/refresh", async (c) => {
    const parsed = refreshBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Sign in again to continue." }, 401);
    const { rows } = await db.query<{ id: string; user_id: string }>(
      "update sessions set revoked_at = $2 where refresh_hash = $1 and revoked_at is null and expires_at > $2 returning id, user_id",
      [hashRefresh(parsed.data.refreshToken), deps.now().toISOString()],
    );
    const old = rows[0];
    if (!old) return c.json({ error: "Sign in again to continue." }, 401);
    return c.json(await issueSession(old.user_id));
  });

  // Sign-in with a provider, and linking one more provider to the account that is signed in.
  app.route("/", oauthRoutes(deps, issueSession, requireAuth(deps)));

  app.use("/logout", requireAuth(deps));
  app.post("/logout", async (c) => {
    await db.query("update sessions set revoked_at = $2 where id = $1 and revoked_at is null", [c.get("sessionId"), deps.now().toISOString()]);
    return c.body(null, 204);
  });

  return app;
}
