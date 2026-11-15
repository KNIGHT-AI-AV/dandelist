import { Hono } from "hono";
import { z } from "zod";
import type { AuthVars } from "./auth";
import type { Db } from "./db";

/**
 * An account's acceptance of how Dandelist uses AI, with the 18-or-older confirmation (App Store guideline 5.1.2(i);
 * Meta's Model API terms §10.1). The owner, 2026-11-06: "It should be the first thing they do when they login to their
 * account or make their account is accept", and anyone using it without it "should just be prompted". Kept on the
 * account (sql/029), so it holds across devices; until it is saved, requireAuth refuses everything but the paths below.
 * Bump the version when what is sent, or to whom, changes: every account is then asked again.
 */
/** Version 2 is the direct-Claude notice; a former Meta notice never admits Claude inference. */
export const AI_CONSENT_VERSION = 2;

/** What a refused request gets: a new app shows the consent screen on the code, an older one shows the words. */
export const CONSENT_REQUIRED = {
  error: "Open the latest Dandelist and accept how it uses AI to continue.",
  code: "consent_required",
  consentVersion: AI_CONSENT_VERSION,
} as const;

/**
 * What a signed-in account may do before it accepts: learn who it is, read and give the consent, sign out, and delete
 * the account (the App Store requires deletion in the app, and it sends nothing to AI). Everything else is refused.
 */
const OPEN_BEFORE_CONSENT = new Set(["GET /me", "DELETE /me", "GET /me/consent", "POST /me/consent", "POST /auth/logout"]);

export function openBeforeConsent(method: string, path: string, previousVersion?: number | null): boolean {
  const verb = method.toUpperCase(), route = path.replace(/\/+$/, "") || "/";
  if (OPEN_BEFORE_CONSENT.has(`${verb} ${route}`)) return true;
  // Renewing an AI notice must not take away a returning account's manual list. No model-producing route qualifies.
  if (previousVersion !== 1) return false;
  return ((verb === "GET" || verb === "POST") && route === "/wishes") ||
    (verb === "PUT" && route === "/wishes/order") ||
    ((verb === "PATCH" || verb === "DELETE") && /^\/wishes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(route));
}

/** Whether a stored version is the current acceptance. */
export const accepted = (version: number | null | undefined) => version === AI_CONSENT_VERSION;

/** Rechecked at model admission too: an already-running job cannot rely on an earlier HTTP consent read. */
export async function assertAiConsent(db: Db, userId: string): Promise<void> {
  const row = (await db.query<{ ai_consent_version: number | null }>("select ai_consent_version from users where id = $1", [userId])).rows[0];
  if (!accepted(row?.ai_consent_version)) throw new Error(CONSENT_REQUIRED.error);
}

type Row = { ai_consent_version: number | null; ai_consent_at: string | Date | null };
const view = (r: Row) => ({
  version: r.ai_consent_version,
  acceptedAt: r.ai_consent_at ? new Date(r.ai_consent_at).toISOString() : null,
  current: AI_CONSENT_VERSION,
  accepted: accepted(r.ai_consent_version),
});

const acceptBody = z.object({ version: z.number().int() });

/** GET and POST /me/consent; mounted behind requireAuth, which lets exactly these through before acceptance. */
export function consentRoutes(deps: { db: Db; now: () => Date }) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;

  app.get("/", async (c) => {
    const row = (await db.query<Row>("select ai_consent_version, ai_consent_at from users where id = $1", [c.get("userId")])).rows[0];
    if (!row) return c.json({ error: "Sign in again to continue." }, 401);
    return c.json({ consent: view(row) });
  });

  // Accepting is idempotent: a second tap, or a retry after a lost answer, keeps the first time it was given.
  app.post("/", async (c) => {
    const body = acceptBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Send the version you agreed to." }, 400);
    // An app showing older words can't accept newer ones: it is asked to update instead.
    if (body.data.version !== AI_CONSENT_VERSION) return c.json({ error: "Update Dandelist to see what you're agreeing to.", code: "consent_outdated", consentVersion: AI_CONSENT_VERSION }, 409);
    const row = (
      await db.query<Row>(
        `update users set ai_consent_at = case when ai_consent_version = $2 then ai_consent_at else $3 end, ai_consent_version = $2
          where id = $1 returning ai_consent_version, ai_consent_at`,
        [c.get("userId"), AI_CONSENT_VERSION, deps.now().toISOString()],
      )
    ).rows[0];
    if (!row) return c.json({ error: "Sign in again to continue." }, 401);
    return c.json({ consent: view(row) });
  });

  return app;
}
