import { MetaApiError, MetaClient, TRANSCRIBE_MODEL } from "@dandelist/meta";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { answerSchema, draftSchema, type Meta, type PriceOption } from "./agent/agent";
import { HUNT_STOP_MS, huntWish, type HuntResult } from "./agent/find";
import type { AgentDeps } from "./agent/routes";
import { MAX_CLIP_BYTES, WISH_KEYWORDS, cleanTranscript, clipProblem, readWav } from "./agent/transcribe";
import { pgArchive } from "./archive/archive";
import type { PoolItem } from "./pool";
import { ipOf } from "./preview";
import { SpendLimitError, assertBudget, heldForScope, recordSpend, recordToolSpend, withBudgetScope } from "./spend";
import { heartbeat, stoppable } from "./sse";

/**
 * Before sign-in (owner, 2026-10-28): the first thing someone wants is priced for real while they play this or
 * that, they can say it instead of typing, and the pairs come from the pool. Anonymous, so every route is capped per
 * network address and per day, and all guest Meta spend shares one small daily ceiling.
 *
 * POST /guest/wish streams, as server-sent events (owner, 2026-10-29: the first card is the one they just asked for):
 *   {type:"draft", title, kind, draft, questions}     what it is, with the questions and the answers the hunt assumes
 *   {type:"step", step}                               the live trail; step.line is one short line for a status row
 *   {type:"priced", title, kind, option, explanation, questions, provisional?: true}
 *                                                     the card: first the fast one (provisional, about 10 to 15 s),
 *                                                     then the full research's when it is better, by 60 s
 *   {type:"error", message}                           only when no card was sent
 * Hunting again with changed answers: the same body plus `draft` (from the draft event) and `answers`.
 */

export const GUEST_WISHES_PER_IP_PER_HOUR = 6;
export const GUEST_WISHES_PER_DAY = 150;
export const GUEST_VOICE_PER_IP_PER_HOUR = 20;
export const GUEST_VOICE_PER_DAY = 400;
/** Every guest wish and voice clip together, a day. Signed-in people have their own caps. */
export const GUEST_DAILY_USD = 3;
const MAX_TRACKED_IPS = 5000;

/** Calls per address in the last hour, and per day for everyone, kept in memory like the preview's. */
function limiter(perHour: number, perDay: number) {
  const hits = new Map<string, number[]>();
  let day = "";
  let count = 0;
  return (ip: string, now: Date): "ok" | "hour" | "day" => {
    const t = now.getTime();
    if (hits.size > MAX_TRACKED_IPS) for (const [k, v] of hits) if (!v.some((x) => t - x < 3_600_000)) hits.delete(k);
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < 3_600_000);
    if (recent.length >= perHour) return "hour";
    const today = now.toISOString().slice(0, 10);
    if (today !== day) [day, count] = [today, 0];
    if (count >= perDay) return "day";
    hits.set(ip, [...recent, t]);
    count++;
    return "ok";
  };
}

const wishBody = z.object({
  text: z.string().trim().min(2).max(300),
  /** The draft from this wish's own draft event, sent back to hunt again with changed answers. */
  draft: draftSchema.optional(),
  /** Answers by question id (or the question's words); free text is fine. */
  answers: z.array(answerSchema).max(6).default([]),
});

/** The same card: nothing new to show (price, running costs, photo, source), so a second priced event would only repeat the first. */
const sameCard = (a: PriceOption, b: PriceOption | null) =>
  !!b && a.url === b.url && a.upfrontCents === b.upfrontCents && a.imageUrl === b.imageUrl && a.status === b.status && a.totals.monthlyCents === b.totals.monthlyCents;

export function guestRoutes(deps: AgentDeps & { pool: () => Promise<PoolItem[]> }) {
  const app = new Hono();
  const { db } = deps;
  const caps = deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 };
  const archive = deps.archive === undefined ? pgArchive(db) : deps.archive ?? undefined;
  const wishes = limiter(GUEST_WISHES_PER_IP_PER_HOUR, GUEST_WISHES_PER_DAY);
  const voice = limiter(GUEST_VOICE_PER_IP_PER_HOUR, GUEST_VOICE_PER_DAY);

  /** Refuses when the whole service or today's guest share is spent. */
  const guard = async () => {
    const now = deps.now();
    await assertBudget(db, caps, now);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const spent = (await db.query<{ s: string | null }>("select coalesce(sum(cost_usd), 0) as s from spend_ledger where user_id is null and kind like 'guest%' and created_at >= $1", [dayStart])).rows[0];
    const usd = Number(spent?.s ?? 0);
    if (usd >= GUEST_DAILY_USD || usd + heldForScope("guest") > GUEST_DAILY_USD) throw new SpendLimitError("daily");
  };
  /** Guest model calls under the guest allowance; once `stop` fires, any call still running is dropped. */
  const guestMeta = (stop?: AbortSignal): Meta => {
    const base = deps.meta!.fetch ?? fetch;
    const client = new MetaClient({ ...deps.meta!, fetch: stop ? stoppable(base, stop) : base, onUsage: (usage, cost) => recordSpend(db, null, "guest", usage, cost, deps.now()) });
    return { responses: (body) => withBudgetScope("guest", guard, () => client.responses(body)) };
  };
  const busy = (why: "hour" | "day") => (why === "hour" ? "That's a lot for one hour. Try again soon, or sign in." : "The agent is resting until tomorrow. Sign in to keep going.");

  // The pool for this or that. Cached briefly at the edge; it changes when the archive gains a photo set.
  app.get("/pool", async (c) => c.json({ items: await deps.pool() }, 200, { "Cache-Control": "public, max-age=300" }));

  // The first wish, priced for real: what it is, the agent's live trail, the fast card, then the best one by 60 s.
  app.post("/wish", async (c) => {
    if (!deps.meta) return c.json({ error: "The agent isn't set up on this server." }, 503);
    const parsed = wishBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Tell us what you want in a few words." }, 400);
    const allowed = wishes(ipOf((n) => c.req.header(n)), deps.now());
    if (allowed !== "ok") return c.json({ error: busy(allowed) }, 429);
    try {
      await guard();
    } catch {
      return c.json({ error: busy("day") }, 429);
    }
    const { text, draft, answers } = parsed.data;
    const startedAt = Date.now();
    return streamSSE(c, async (stream) => {
      let open = true;
      const send = async (data: unknown) => {
        if (open) await stream.writeSSE({ data: JSON.stringify(data) }).catch(() => undefined);
      };
      // Research can take a minute; a comment line keeps proxies from closing a quiet stream.
      const stopBeat = heartbeat(stream);
      const stop = new AbortController();
      const shown: { card: PriceOption | null } = { card: null };
      const card = (r: HuntResult, provisional: boolean) => ({
        type: "priced",
        title: r.draft.title,
        kind: r.draft.kind,
        option: r.options[0],
        explanation: r.explanation,
        questions: r.questions,
        ...(provisional ? { provisional: true } : {}),
      });
      const hunt = huntWish(guestMeta(stop.signal), {
        text,
        draft,
        answers,
        startedAt,
        onStep: (step) => send({ type: "step", step }),
        fetcher: deps.webFetch,
        now: deps.now,
        archive,
        homeCurrency: "USD",
        onDraft: (d) => send({ type: "draft", title: d.title, kind: d.kind, draft: d, questions: d.questions ?? [] }),
        onProvisional: async (r) => {
          shown.card = r.options[0] ?? null;
          await send(card(r, true));
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), Math.max(0, startedAt + HUNT_STOP_MS - Date.now()))));
      try {
        const outcome = await Promise.race([hunt.then((r) => ({ r }), (e: unknown) => ({ e })), late]);
        if (outcome === "late") {
          if (!shown.card) await send({ type: "error", message: "Couldn't find a price for that just now. It stays on your list." });
        } else if ("e" in outcome) {
          const e = outcome.e;
          if (!(e instanceof SpendLimitError)) console.error("guest wish failed", e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : (e as Error).message);
          if (!shown.card) await send({ type: "error", message: e instanceof SpendLimitError ? busy("day") : "Couldn't price that just now. It stays on your list." });
        } else {
          const best = outcome.r.options[0];
          if (best && !sameCard(best, shown.card)) await send(card(outcome.r, false));
          else if (!best && !shown.card) await send({ type: "error", message: "Couldn't find a price for that just now. It stays on your list." });
        }
      } finally {
        clearTimeout(timer);
        // Whatever is still running stops here and spends nothing more; its late steps are not sent.
        open = false;
        stop.abort();
        stopBeat();
      }
    });
  });

  // Say it instead of typing, before an account exists. The same clip checks as the signed-in route.
  app.post("/transcribe", bodyLimit({ maxSize: MAX_CLIP_BYTES, onError: (c) => c.json({ error: "Keep it under a minute." }, 413) }), async (c) => {
    if (!deps.meta) return c.json({ error: "Voice isn't available right now." }, 503);
    if (!(c.req.header("content-type") ?? "").startsWith("audio/wav")) return c.json({ error: "Send the recording as a WAV file." }, 415);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const problem = clipProblem(readWav(bytes));
    if (problem) return c.json({ error: problem }, 400);
    const allowed = voice(ipOf((n) => c.req.header(n)), deps.now());
    if (allowed !== "ok") return c.json({ error: busy(allowed) }, 429);
    try {
      const heard = await withBudgetScope("guest", guard, async () => {
        const heard = await new MetaClient(deps.meta!).transcribe(new Blob([bytes], { type: "audio/wav" }), { keywords: WISH_KEYWORDS });
        await recordToolSpend(db, null, "guest-transcribe", TRANSCRIBE_MODEL, heard.costUsd, deps.now());
        return heard;
      });
      const text = cleanTranscript(heard.text);
      if (!text) return c.json({ error: "Didn't catch that. Try again a little closer." }, 422);
      return c.json({ text });
    } catch (e) {
      if (e instanceof SpendLimitError) return c.json({ error: busy("day") }, 429);
      if (e instanceof MetaApiError && e.status === 429) return c.json({ error: "The AI is busy right now. Try again in a minute." }, 429);
      return c.json({ error: "Couldn't hear that just now. Try again, or type it." }, 502);
    }
  });

  return app;
}
