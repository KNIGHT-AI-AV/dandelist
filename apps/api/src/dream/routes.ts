import type { DreamEvent } from "@dandelist/catalogue/dream";
import { MetaApiError, MetaClient } from "@dandelist/meta";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Meta } from "../agent/agent";
import { USER_DAILY_USD, type AgentDeps } from "../agent/routes";
import { publicFetch } from "../agent/tools";
import { requireAuth, type AuthVars } from "../auth";
import { SpendLimitError, assertBudget, assertUserBudget, recordSpend } from "../spend";
import { deckWidget, runTurn } from "./agent";
import { TurnBudget, TurnLimitError, type ApifyConfig, type DreamCtx } from "./context";
import { homeSchema, lifeBody, readLife, writeLife } from "./life";
import { emptyState, type DreamState, type TranscriptEntry } from "./types";

/**
 * GET/PUT /me/life: where the person lives, which prices everything regional.
 * POST /dream/turn: one chat turn with the concierge, streamed as DreamEvents over server-sent events.
 * GET /dream/sessions/:id: a session's transcript and open widgets, to resume after the app reopens.
 */

/** Meta calls one person's dream turns may make in a day, on top of the shared and per-person spend caps. */
export const DREAM_CALLS_PER_USER_PER_DAY = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DreamDeps extends AgentDeps {
  /** Listing portals through Apify. Missing turns them off; the web search still runs. */
  apify?: ApifyConfig;
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("builder"), widgetId: z.string().max(40), values: z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= 8000, "Too much.") }),
  z.object({ type: z.literal("swipe"), widgetId: z.string().max(40), listingId: z.string().max(40), verdict: z.enum(["yes", "no"]) }),
  z.object({ type: z.literal("search_now"), widgetId: z.string().max(40) }),
  z.object({ type: z.literal("region"), home: homeSchema }),
  z.object({ type: z.literal("pick"), widgetId: z.string().max(40), listingId: z.string().max(40).optional() }),
]);
const turnBody = z.object({ sessionId: z.string().uuid().optional(), action: actionSchema });

type SessionRow = { id: string; transcript: unknown; state: unknown };
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

function friendly(e: unknown): string {
  if (e instanceof SpendLimitError) return e.message;
  if (e instanceof TurnLimitError) return e.message;
  if (e instanceof MetaApiError) return e.status === 429 ? "The AI is busy right now. Try again in a minute." : "The AI couldn't answer just now. Try again.";
  return "Something went wrong. Try again.";
}

export function dreamRoutes(deps: DreamDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  const caps = deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 };
  const auth = requireAuth(deps);
  app.use("/me/life", auth);
  app.use("/dream/*", auth);

  app.get("/me/life", async (c) => c.json({ life: await readLife(db, c.get("userId")) }));

  const putLife = async (c: Context<{ Variables: AuthVars }>) => {
    const body = lifeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Choose a country and a name for it." }, 400);
    const life = await writeLife(db, c.get("userId"), body.data, "settings", deps.now());
    return c.json({ life });
  };
  app.put("/me/life", putLife);
  app.patch("/me/life", putLife);

  app.get("/dream/sessions/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That conversation wasn't found." }, 404);
    const { rows } = await db.query<SessionRow>("select id, transcript, state from dream_sessions where id = $1 and user_id = $2", [id.data, c.get("userId")]);
    if (!rows[0]) return c.json({ error: "That conversation wasn't found." }, 404);
    const state = parse(rows[0].state) as DreamState;
    const decks = Object.values(state.decks ?? {}).map(deckWidget);
    return c.json({ id: rows[0].id, transcript: parse(rows[0].transcript), widgets: [...Object.values(state.widgets ?? {}), ...decks] });
  });

  app.post("/dream/turn", async (c) => {
    if (!deps.meta) return c.json({ error: "The AI helper isn't set up on this server." }, 503);
    const body = turnBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "That message couldn't be read. Try again." }, 400);
    const userId = c.get("userId");
    const now = deps.now();
    try {
      await assertBudget(db, caps, now);
      await assertUserBudget(db, userId, USER_DAILY_USD, now);
    } catch (e) {
      return c.json({ error: friendly(e) }, 429);
    }
    const used = await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where user_id = $1 and kind = 'dream' and created_at > $2", [
      userId,
      new Date(now.getTime() - DAY_MS).toISOString(),
    ]);
    if (Number(used.rows[0]?.n ?? 0) >= DREAM_CALLS_PER_USER_PER_DAY) return c.json({ error: "That's a lot of dreaming for one day. Pick it up tomorrow." }, 429);

    let session: SessionRow | undefined;
    if (body.data.sessionId) {
      session = (await db.query<SessionRow>("select id, transcript, state from dream_sessions where id = $1 and user_id = $2", [body.data.sessionId, userId])).rows[0];
      if (!session) return c.json({ error: "That conversation wasn't found." }, 404);
    } else {
      session = (
        await db.query<SessionRow>("insert into dream_sessions (user_id, created_at, updated_at) values ($1, $2, $2) returning id, transcript, state", [userId, now.toISOString()])
      ).rows[0]!;
    }
    const transcript = (parse(session.transcript) ?? []) as TranscriptEntry[];
    const saved = parse(session.state) as Partial<DreamState> | null;
    const state: DreamState = { ...emptyState(), ...(saved ?? {}) };
    const sessionId = session.id;
    const budget = new TurnBudget();
    const client = new MetaClient({ ...deps.meta, onUsage: (usage, cost) => recordSpend(db, userId, "dream", usage, cost, deps.now()) });
    const meta: Meta = {
      responses: async (b) => {
        budget.meta();
        await assertBudget(db, caps, deps.now());
        await assertUserBudget(db, userId, USER_DAILY_USD, deps.now());
        return client.responses(b);
      },
    };
    const life = await readLife(db, userId);

    return streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => void (open = false));
      const emit = async (e: DreamEvent) => {
        if (!open) return;
        try {
          await stream.writeSSE({ data: JSON.stringify(e) });
        } catch {
          open = false; // the app went away; the work still finishes and is saved
        }
      };
      const ctx: DreamCtx = {
        db,
        meta,
        web: deps.webFetch ?? publicFetch,
        api: deps.webFetch ?? fetch,
        apify: deps.apify,
        userId,
        sessionId,
        life,
        now: deps.now,
        budget,
        emit,
        step: (id, state, text) => emit({ type: "step", id, state, text }),
      };
      try {
        await runTurn(ctx, transcript, state, body.data.action);
      } catch (e) {
        if (!(e instanceof SpendLimitError || e instanceof TurnLimitError)) console.error("dream turn failed", sessionId, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
        await emit({ type: "error", message: friendly(e) });
      }
      try {
        await db.query("update dream_sessions set transcript = $1::jsonb, state = $2::jsonb, updated_at = $3 where id = $4", [JSON.stringify(transcript), JSON.stringify(state), deps.now().toISOString(), sessionId]);
      } catch (e) {
        console.error("could not save dream session", sessionId, e);
      }
      await emit({ type: "done", sessionId });
    });
  });

  return app;
}
