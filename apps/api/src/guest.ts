import { MetaApiError, MetaClient, TRANSCRIBE_MODEL } from "@dandelist/meta";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { interpret, research, type Meta } from "./agent/agent";
import type { AgentDeps } from "./agent/routes";
import { MAX_CLIP_BYTES, WISH_KEYWORDS, cleanTranscript, clipProblem, readWav } from "./agent/transcribe";
import { pgArchive } from "./archive/archive";
import type { PoolItem } from "./pool";
import { ipOf } from "./preview";
import { SpendLimitError, assertBudget, recordSpend, recordToolSpend, withHold } from "./spend";

/**
 * Before sign-in (owner, 2026-10-28): the first thing someone wants is priced for real while they play this or
 * that, they can say it instead of typing, and the pairs come from the pool. Anonymous, so every route is capped per
 * network address and per day, and all guest Meta spend shares one small daily ceiling.
 */

export const GUEST_WISHES_PER_IP_PER_HOUR = 6;
export const GUEST_WISHES_PER_DAY = 150;
export const GUEST_VOICE_PER_IP_PER_HOUR = 20;
export const GUEST_VOICE_PER_DAY = 400;
/** Every guest wish and voice clip together, a day. Signed-in people have their own caps. */
export const GUEST_DAILY_USD = 3;
const HEARTBEAT_MS = 15_000;
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

const wishBody = z.object({ text: z.string().trim().min(2).max(300) });

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
    if (Number(spent?.s ?? 0) >= GUEST_DAILY_USD) throw new SpendLimitError("daily");
  };
  const guestMeta = (): Meta => {
    const client = new MetaClient({ ...deps.meta!, onUsage: (usage, cost) => recordSpend(db, null, "guest", usage, cost, deps.now()) });
    return { responses: (body) => withHold(guard, () => client.responses(body)) };
  };
  const busy = (why: "hour" | "day") => (why === "hour" ? "That's a lot for one hour. Try again soon, or sign in." : "The agent is resting until tomorrow. Sign in to keep going.");

  // The pool for this or that. Cached briefly at the edge; it changes when the archive gains a photo set.
  app.get("/pool", async (c) => c.json({ items: await deps.pool() }, 200, { "Cache-Control": "public, max-age=300" }));

  // The first wish, priced for real: what it is, the agent's live trail (thoughts included), then the best option.
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
    const text = parsed.data.text;
    return streamSSE(c, async (stream) => {
      const send = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) }).catch(() => {});
      // Research can take a minute; a comment line keeps proxies from closing a quiet stream.
      const beat = setInterval(() => void stream.write(": beat\n\n").catch(() => {}), HEARTBEAT_MS);
      try {
        const meta = guestMeta();
        const draft = await interpret(meta, text);
        await send({ type: "draft", title: draft.title, kind: draft.kind });
        const result = await research(meta, { draft, answers: [], onStep: (step) => send({ type: "step", step }), fetcher: deps.webFetch, now: deps.now, archive, homeCurrency: "USD" });
        const best = result.options[0];
        if (best) await send({ type: "priced", title: draft.title, kind: draft.kind, option: best, explanation: result.explanation });
        else await send({ type: "error", message: "Couldn't find a price for that just now. It stays on your list." });
      } catch (e) {
        if (!(e instanceof SpendLimitError)) console.error("guest wish failed", e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : (e as Error).message);
        await send({ type: "error", message: e instanceof SpendLimitError ? busy("day") : "Couldn't price that just now. It stays on your list." });
      } finally {
        clearInterval(beat);
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
      const heard = await withHold(guard, () => new MetaClient(deps.meta!).transcribe(new Blob([bytes], { type: "audio/wav" }), { keywords: WISH_KEYWORDS }));
      await recordToolSpend(db, null, "guest-transcribe", TRANSCRIBE_MODEL, heard.costUsd, deps.now());
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
