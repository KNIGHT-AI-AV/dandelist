import type { DreamEvent } from "@dandelist/catalogue/dream";
import { MetaApiError, MetaClient } from "@dandelist/meta";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { personaSchema, voiceLine } from "../agent/persona";
import type { Meta } from "../agent/agent";
import { USER_DAILY_USD, type AgentDeps } from "../agent/routes";
import { publicFetch } from "../agent/tools";
import { requireAuth, type AuthVars } from "../auth";
import { heartbeat, stoppable } from "../sse";
import { assertBudget, assertUserBudget, recordSpend, SpendLimitError, userCapUsd, withHold } from "../spend";
import { deckWidget, runTurn } from "./agent";
import { TurnBudget, TurnLimitError, type ApifyConfig, type DreamCtx } from "./context";
import { HISTORY_LIMIT, previewOf, summary, titleOf } from "./history";
import { homeSchema, lifeBody, readLife, writeLife } from "./life";
import { notesFor } from "../notes";
import { Suggestions } from "./suggest";
import { emptyState, type DreamState, type TranscriptEntry } from "./types";

/**
 * GET/PUT /me/life: where the person lives, which prices everything regional.
 * POST /dream/turn: one chat turn with the concierge, streamed as DreamEvents over server-sent events.
 * GET /dream/sessions: the person's conversations, newest first, for the chat history.
 * GET /dream/sessions/:id: a session's transcript and open widgets, to resume after the app reopens.
 * DELETE /dream/sessions/:id: removes one conversation for good.
 * GET /dream/suggestions: three things to say to start a new chat, from what the app knows about the person.
 */

/** Meta calls one person's dream turns may make in a day, on top of the shared and per-person spend caps. */
export const DREAM_CALLS_PER_USER_PER_DAY = 400;
/**
 * A turn's stream closes by then, whatever is still running (2026-10-29: App Runner cuts a request at 120 s, which the
 * phone reported as "The network connection was lost"). Turns wrap up on their own well before (TURN_WRAP_MS).
 */
export const TURN_STOP_MS = 95_000;
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
/** The Dandy's name as its owner typed it: one line of printable characters, so it can introduce itself. */
export const dandyNameSchema = z.string().trim().min(1).max(24).regex(/^[^\p{C}]+$/u).optional();
const turnBody = z.object({ sessionId: z.string().uuid().nullish(), action: actionSchema, persona: personaSchema, name: dandyNameSchema });
const suggestQuery = z.object({ persona: personaSchema });

type SessionRow = { id: string; transcript: unknown; state: unknown };
type SummaryRow = { id: string; title: string | null; preview: string | null; created_at: unknown; updated_at: unknown };
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

/** What the person reads in the chat when a turn can't run, in the Dandy's own voice: no model, no "AI". */
function friendly(e: unknown): string {
  if (e instanceof SpendLimitError) {
    if (e.scope === "user") return "That's all I can look into for you today. Your allowance comes back tomorrow.";
    if (e.scope === "daily") return "I've done all I can for today. Let's pick this up tomorrow.";
    return "I'm not taking new requests just now. Try again later.";
  }
  if (e instanceof TurnLimitError) return e.message;
  if (e instanceof MetaApiError) return e.status === 429 ? "I'm a little busy right now. Try again in a minute." : "I couldn't answer just now. Try again.";
  return "Something went wrong. Try again.";
}

export function dreamRoutes(deps: DreamDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  const caps = deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 };
  const auth = requireAuth(deps);
  const suggestions = new Suggestions({ db, meta: deps.meta, caps, personUsd: USER_DAILY_USD, judge: deps.judge, now: deps.now });
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

  app.get("/dream/sessions", async (c) => {
    const { rows } = await db.query<SummaryRow>(
      "select id, title, preview, created_at, updated_at from dream_sessions where user_id = $1 and jsonb_array_length(transcript) > 0 order by updated_at desc limit $2",
      [c.get("userId"), HISTORY_LIMIT],
    );
    return c.json({ sessions: rows.map(summary) });
  });

  app.delete("/dream/sessions/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That conversation wasn't found." }, 404);
    const { rows } = await db.query("delete from dream_sessions where id = $1 and user_id = $2 returning id", [id.data, c.get("userId")]);
    if (!rows[0]) return c.json({ error: "That conversation wasn't found." }, 404);
    return c.body(null, 204);
  });

  app.get("/dream/suggestions", async (c) => {
    const q = suggestQuery.safeParse({ persona: c.req.query("persona") || undefined });
    return c.json(await suggestions.next(c.get("userId"), q.success ? q.data.persona : undefined));
  });

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
    if (!deps.meta) return c.json({ error: "Chat isn't available on this server yet." }, 503);
    const body = turnBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "That message couldn't be read. Try again." }, 400);
    const userId = c.get("userId");
    const now = deps.now();
    try {
      await assertBudget(db, caps, now);
      await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), now);
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
    const stop = new AbortController();
    const client = new MetaClient({ ...deps.meta, fetch: stoppable(deps.meta.fetch ?? fetch, stop.signal), onUsage: (usage, cost) => recordSpend(db, userId, "dream", usage, cost, deps.now()) });
    const meta: Meta = {
      responses: async (b) => {
        budget.meta();
        return withHold(
          async () => {
            await assertBudget(db, caps, deps.now());
            await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), deps.now());
          },
          () => client.responses(b),
          userId,
        );
      },
    };
    const life = await readLife(db, userId);
    // What they've told us about their wishes, for the concierge to keep in mind (notes.ts). Theirs alone.
    const notes = await notesFor(db, userId);

    return streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => void (open = false));
      // A comment line every 15 s keeps the phone and App Runner from closing a quiet stream mid-search.
      const stopBeat = heartbeat(stream);
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
        voice: voiceLine(body.data.persona),
        notes,
        name: body.data.name,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), TURN_STOP_MS)));
      const outcome = await Promise.race([runTurn(ctx, transcript, state, body.data.action).then(() => null, (e: unknown) => ({ e })), late]);
      clearTimeout(timer);
      if (outcome === "late") {
        // Whatever is still running stops spending; what the turn already showed stays in the conversation.
        stop.abort();
        await emit({ type: "error", message: friendly(new TurnLimitError("time")) });
      } else if (outcome) {
        const e = outcome.e;
        if (!(e instanceof SpendLimitError || e instanceof TurnLimitError)) console.error("dream turn failed", sessionId, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
        await emit({ type: "error", message: friendly(e) });
      }
      try {
        await db.query("update dream_sessions set transcript = $1::jsonb, state = $2::jsonb, updated_at = $3, title = coalesce(title, $5), preview = coalesce($6, preview) where id = $4", [
          JSON.stringify(transcript),
          JSON.stringify(state),
          deps.now().toISOString(),
          sessionId,
          titleOf(transcript),
          previewOf(transcript),
        ]);
      } catch (e) {
        console.error("could not save dream session", sessionId, e);
      }
      await emit({ type: "done", sessionId });
      stopBeat();
      stop.abort();
      open = false;
    });
  });

  return app;
}
