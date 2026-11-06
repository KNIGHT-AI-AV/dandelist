import { Hono } from "hono";
import { compress } from "hono/compress";
import type { AgentDeps } from "./agent/routes";
import type { PoolItem, TypicalEntity } from "./pool";

/**
 * Before sign-in: the pool for this or that, and nothing that reaches AI. Until 2026-11-06 the first wish was priced
 * here for real and could be said instead of typed; the owner then made accepting how Dandelist uses AI "the first
 * thing they do when they login to their account or make their account", so a guest's words go nowhere until then.
 * The welcome keeps the wish and prices it once the account has accepted (apps/mobile lib/adopt.ts).
 *
 * POST /guest/wish and POST /guest/transcribe stay as answers for apps from before: they read the body of neither and
 * send nothing anywhere, only SIGN_IN_FIRST.
 */

/** The guests' daily share of the AI budget when guest calls existed; the owner's admin view still shows it. */
export const GUEST_DAILY_USD = 6;

/** What a guest's wish or recording gets now: older apps show the words, newer ones never send them. */
export const SIGN_IN_FIRST = { error: "Sign in to price your first wish.", code: "sign_in_required" } as const;

export function guestRoutes(deps: AgentDeps & { pool: () => Promise<PoolItem[]>; typicals?: () => Promise<TypicalEntity[]> }) {
  const app = new Hono();

  // The pool for this or that. Cached briefly at the edge; it changes when the archive gains a photo set.
  app.get("/pool", compress({ contentTypeFilter: /^application\/json(?:;|$)/i }), async (c) =>
    c.json({ items: await deps.pool() }, 200, { "Cache-Control": "public, max-age=300" }),
  );

  app.post("/wish", (c) => c.json(SIGN_IN_FIRST, 401));
  app.post("/transcribe", (c) => c.json(SIGN_IN_FIRST, 401));

  return app;
}
