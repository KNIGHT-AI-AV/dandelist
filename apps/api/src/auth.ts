import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Db } from "./db";
import type { Mailer } from "./mailer";
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
    const open = await deps.db.query("select 1 from sessions where id = $1 and user_id = $2 and revoked_at is null", [claims.sessionId, claims.userId]);
    if (!open.rows.length) return c.json({ error: "Sign in again to continue." }, 401);
    c.set("userId", claims.userId);
    c.set("sessionId", claims.sessionId);
    await next();
  };
}

export function authRoutes(deps: AuthDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;

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

  app.post("/email/start", async (c) => {
    const parsed = emailBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter a valid email address." }, 400);
    const email = normalizeEmail(parsed.data.email);
    const hourAgo = new Date(deps.now().getTime() - 60 * 60 * 1000).toISOString();
    const recent = await db.query<{ n: string }>("select count(*) as n from email_codes where email = $1 and created_at > $2", [email, hourAgo]);
    if (Number(recent.rows[0]?.n ?? 0) >= MAX_CODES_PER_HOUR) return c.json({ error: "Too many codes requested. Wait an hour and try again." }, 429);

    const isJudge = deps.judge && email === normalizeEmail(deps.judge.email);
    const code = isJudge ? deps.judge!.code : newCode();
    const expires = new Date(deps.now().getTime() + CODE_TTL_MS).toISOString();
    await db.query("insert into email_codes (email, code_hash, expires_at, created_at) values ($1, $2, $3, $4)", [
      email,
      hashCode(deps.codePepper, email, code),
      expires,
      deps.now().toISOString(),
    ]);
    if (!isJudge) await deps.mailer.sendCode(email, code);
    return c.body(null, 204);
  });

  app.post("/email/verify", async (c) => {
    const parsed = verifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Enter the 6-digit code from your email." }, 400);
    const email = normalizeEmail(parsed.data.email);
    const { rows } = await db.query<{ id: string; code_hash: string; attempts: number }>(
      "select id, code_hash, attempts from email_codes where email = $1 and consumed_at is null and expires_at > $2 order by created_at desc limit 1",
      [email, deps.now().toISOString()],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "That code has expired. Request a new one." }, 400);
    if (row.attempts >= MAX_CODE_ATTEMPTS) return c.json({ error: "Too many wrong tries. Request a new code." }, 400);
    if (!sameHash(row.code_hash, hashCode(deps.codePepper, email, parsed.data.code))) {
      await db.query("update email_codes set attempts = attempts + 1 where id = $1", [row.id]);
      return c.json({ error: "That code doesn't match. Check the email and try again." }, 400);
    }
    await db.query("update email_codes set consumed_at = $2 where id = $1", [row.id, deps.now().toISOString()]);
    await db.query("insert into users (email) values ($1) on conflict (email) do nothing", [email]);
    const user = (await db.query<{ id: string; email: string }>("select id, email from users where email = $1", [email])).rows[0]!;
    return c.json({ user, ...(await issueSession(user.id)) });
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

  app.use("/logout", requireAuth(deps));
  app.post("/logout", async (c) => {
    await db.query("update sessions set revoked_at = $2 where id = $1 and revoked_at is null", [c.get("sessionId"), deps.now().toISOString()]);
    return c.body(null, 204);
  });

  return app;
}
