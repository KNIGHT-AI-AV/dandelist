import type { DreamEvent } from "@dandelist/catalogue/dream";
import { MetaApiError, MetaClient } from "@dandelist/meta";
import { Hono, type Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { personaSchema, voiceLine } from "../agent/persona";
import type { Meta } from "../agent/agent";
import { USER_DAILY_USD, type AgentDeps } from "../agent/routes";
import { publicFetch } from "../agent/tools";
import { requireAuth, type AuthVars } from "../auth";
import { heartbeat, stoppable } from "../sse";
import { assertBudget, assertUserBudget, recordSpend, SpendLimitError, userCapUsd, withHold } from "../spend";
import { MAX_TRANSCRIPT, deckWidget, runTurn } from "./agent";
import { Jobs, mergeChat, type ChatCopy } from "./jobs";
import { TurnBudget, TurnLimitError, type ApifyConfig, type DreamCtx } from "./context";
import { HISTORY_LIMIT, previewOf, summary, titleOf } from "./history";
import { homeSchema, lifeBody, readLife, writeLife } from "./life";
import { notesFor } from "../notes";
import { listWishes } from "../wishes";
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
/** The longest message the chat takes, in characters. */
export const MESSAGE_MAX = 16_000;
/** A background job wraps up by then (no new model call starts) and is stopped by JOB_STOP_MS: no request holds it. */
export const JOB_WRAP_MS = 110_000;
export const JOB_STOP_MS = 150_000;
/** How long GET /dream/sessions/:id/events waits for something new while work runs. */
export const EVENTS_WAIT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DreamDeps extends AgentDeps {
  /** The conversations' running jobs and event logs; one per server (tests pass their own). */
  jobs?: Jobs;
  /** Listing portals through Apify. Missing turns them off; the web search still runs. */
  apify?: ApifyConfig;
}

const actionSchema = z.discriminatedUnion("type", [
  // Long enough to write a book to it (owner, 2026-10-31: "write a book to us and just rant to us").
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(MESSAGE_MAX) }),
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
  const jobs = deps.jobs ?? new Jobs();
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
    return c.json({ id: rows[0].id, transcript: parse(rows[0].transcript), widgets: [...Object.values(state.widgets ?? {}), ...decks], running: jobs.list(id.data), seq: jobs.seq(id.data) });
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
    // What the turn began with, so its save folds in beside what jobs saved meanwhile (jobs.ts mergeChat).
    const base = structuredClone(state);
    const before = new Set(transcript);
    const life = await readLife(db, userId);
    // What they've told us about their wishes, for the concierge to keep in mind (notes.ts). Theirs alone.
    const notes = await notesFor(db, userId);
    // Their list in its order, so the concierge can suggest a new order, a tier or a removal (edit_list).
    const list = await listWishes(db, userId);
    const stop = new AbortController();
    const turnId = randomUUID().slice(0, 8);

    const ctxFor = (emit: DreamCtx["emit"], budget: TurnBudget, signal: AbortSignal): DreamCtx => {
      const client = new MetaClient({ ...deps.meta!, fetch: stoppable(deps.meta!.fetch ?? fetch, signal), onUsage: (usage, cost) => recordSpend(db, userId, "dream", usage, cost, deps.now()) });
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
        list,
        running: () => jobs.list(sessionId).filter((j) => j.lane !== "turn"),
        spawn: (t, st, lane, label, work) => spawn(ctx, t, st, lane, label, work),
      };
      return ctx;
    };

    /**
     * Slow work as a job beside the conversation (jobs.ts): it runs on a copy of the chat as it is now, with its own
     * budget and stop, shows its steps and cards through the session's event log, and folds what it made back in when
     * it ends. A newer job in the same lane stops it, and then what it made is dropped.
     */
    const spawn = (from: DreamCtx, t0: TranscriptEntry[], st0: DreamState, lane: string, label: string, work: (c: DreamCtx, t: TranscriptEntry[], st: DreamState) => Promise<unknown>): string => {
      const id = randomUUID().slice(0, 8);
      const jt = structuredClone(t0);
      const js = structuredClone(st0);
      js.tag = `${id.slice(0, 3)}`;
      const jobBase = structuredClone(js);
      const jobBefore = new Set(jt);
      const { signal, replaced } = jobs.add(sessionId, { id, lane, label, startedAt: deps.now().toISOString() });
      const emit = async (e: DreamEvent) => {
        if (replaced()) return;
        // A line the job says stays in the conversation, like the concierge's own.
        if (e.type === "text") jt.push({ role: "agent", text: e.text, at: deps.now().toISOString() });
        jobs.publish(sessionId, e);
      };
      const jctx = { ...ctxFor(emit, new TurnBudget(Date.now() + JOB_WRAP_MS), signal), life: from.life };
      jobs.publish(sessionId, { type: "step", id: `job_${id}`, state: "running", text: label });
      const run = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), JOB_STOP_MS)));
        const outcome = await Promise.race([work(jctx, jt, js).then(() => null, (e: unknown) => ({ e })), late]);
        clearTimeout(timer);
        if (replaced()) return;
        if (outcome === "late") jobs.publish(sessionId, { type: "error", message: friendly(new TurnLimitError("time")) });
        else if (outcome) {
          const e = outcome.e;
          if (!(e instanceof SpendLimitError || e instanceof TurnLimitError)) console.error("dream job failed", sessionId, lane, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
          jobs.publish(sessionId, { type: "error", message: friendly(e) });
        }
        // Whatever it made before it stopped stays.
        await save(jobBase, { transcript: jt, state: js }, jobBefore);
      })()
        .catch((e) => console.error("could not finish dream job", sessionId, lane, e))
        .finally(() => {
          jobs.publish(sessionId, { type: "step", id: `job_${id}`, state: "done", text: label });
          jobs.remove(sessionId, id);
          if (!jobs.list(sessionId).length) jobs.publish(sessionId, { type: "done", sessionId, seq: jobs.seq(sessionId) + 1 });
        });
      void deps.alive?.keep(run);
      return id;
    };

    /** Saves one piece of work's changes into the conversation as it stands now (jobs.ts mergeChat). */
    const save = (from: DreamState, next: ChatCopy, seen: ReadonlySet<TranscriptEntry>) =>
      jobs.lock(sessionId, async () => {
        const row = (await db.query<SessionRow>("select id, transcript, state from dream_sessions where id = $1 and user_id = $2", [sessionId, userId])).rows[0];
        if (!row) return; // deleted meanwhile
        const latest = { transcript: (parse(row.transcript) ?? []) as TranscriptEntry[], state: { ...emptyState(), ...((parse(row.state) as Partial<DreamState> | null) ?? {}) } };
        const merged = mergeChat(latest, from, next, seen, MAX_TRANSCRIPT);
        await db.query("update dream_sessions set transcript = $1::jsonb, state = $2::jsonb, updated_at = $3, title = coalesce(title, $5), preview = coalesce($6, preview) where id = $4", [
          JSON.stringify(merged.transcript),
          JSON.stringify(merged.state),
          deps.now().toISOString(),
          sessionId,
          titleOf(merged.transcript),
          previewOf(merged.transcript),
        ]);
      });

    const turn = (stream: SSEStreamingApi) =>
      (async () => {
        let open = true;
        stream.onAbort(() => void (open = false));
        // A comment line every 15 s keeps the phone and App Runner from closing a quiet stream mid-search.
        const stopBeat = heartbeat(stream);
        // The turn shows as running work too, so an app that comes back mid-turn keeps following the conversation.
        jobs.add(sessionId, { id: turnId, lane: "turn", label: "", startedAt: deps.now().toISOString() });
        const send = async (e: DreamEvent) => {
          if (!open) return;
          try {
            await stream.writeSSE({ data: JSON.stringify(e) });
          } catch {
            open = false; // the app went away; the work still finishes and is saved
          }
        };
        const emit = async (e: DreamEvent) => {
          jobs.publish(sessionId, e, turnId);
          await send(e);
        };
        // What the jobs it starts show while the turn is still open goes down the same stream; after it closes, the app
        // follows the event log from the turn's done.
        const unlisten = jobs.listen(sessionId, (e, origin) => void (origin !== turnId && send(e)));
        await send({ type: "start", sessionId });
        const ctx = ctxFor(emit, new TurnBudget(), stop.signal);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), TURN_STOP_MS)));
        const outcome = await Promise.race([runTurn(ctx, transcript, state, body.data.action).then(() => null, (e: unknown) => ({ e })), late]);
        clearTimeout(timer);
        if (outcome === "late") {
          // Whatever is still running in the turn stops spending; what it already showed stays in the conversation.
          // Jobs it started keep going.
          await emit({ type: "error", message: friendly(new TurnLimitError("time")) });
        } else if (outcome) {
          const e = outcome.e;
          if (!(e instanceof SpendLimitError || e instanceof TurnLimitError)) console.error("dream turn failed", sessionId, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
          await emit({ type: "error", message: friendly(e) });
        }
        try {
          await save(base, { transcript, state }, before);
        } catch (e) {
          console.error("could not save dream session", sessionId, e);
        }
        jobs.remove(sessionId, turnId);
        unlisten();
        // The seq the app follows the event log from, for the jobs this turn left running.
        const running = jobs.list(sessionId).length;
        const done: DreamEvent = { type: "done", sessionId, seq: jobs.seq(sessionId) + 1, running };
        await emit(done);
        stopBeat();
        // Anything still running in the turn itself stops spending; its jobs have their own stop.
        stop.abort();
        open = false;
      })();

    // The turn finishes with the phone gone: the instance stays awake until it's saved (alive.ts).
    return streamSSE(c, (stream) => deps.alive?.keep(turn(stream)) ?? turn(stream));
  });

  /**
   * GET /dream/sessions/:id/events?after=<seq>: what the conversation's turns and jobs showed after `after`, waiting up
   * to EVENTS_WAIT_MS for something new while work runs. `gap` means some were missed (or the server restarted): load
   * the session again.
   */
  app.get("/dream/sessions/:id/events", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That conversation wasn't found." }, 404);
    const { rows } = await db.query("select 1 from dream_sessions where id = $1 and user_id = $2", [id.data, c.get("userId")]);
    if (!rows[0]) return c.json({ error: "That conversation wasn't found." }, 404);
    const after = Math.max(0, Math.floor(Number(c.req.query("after") ?? 0)) || 0);
    return c.json(await jobs.since(id.data, after, EVENTS_WAIT_MS));
  });

  return app;
}
