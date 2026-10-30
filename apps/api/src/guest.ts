import { MetaApiError, MetaClient, TRANSCRIBE_MODEL } from "@dandelist/meta";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { answerSchema, draftSchema, type Meta, type PriceOption } from "./agent/agent";
import { HUNT_STOP_MS, huntWish, type HuntResult } from "./agent/find";
import type { AgentDeps } from "./agent/routes";
import { publicFetch } from "./agent/tools";
import { MAX_CLIP_BYTES, WISH_KEYWORDS, cleanTranscript, clipProblem, readWav } from "./agent/transcribe";
import { moneyPhoto, photoMedia, pricelessPhoto } from "./agent/worth";
import { within } from "./agent/time";
import { pgArchive } from "./archive/archive";
import { PAIRS_MS, makePairs } from "./pairs";
import type { PoolItem, TypicalEntity } from "./pool";
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
 *   {type:"worth", worth:"money", title, kind, amountCents?}
 *   {type:"worth", worth:"priceless", title, kind, line}
 *                                                     money itself or something priceless (owner, 2026-10-30): no
 *                                                     hunt; the app asks how much, or shows infinity and the line.
 *                                                     An error event follows for apps that predate it; apps that
 *                                                     know this event ignore that error.
 *   {type:"photo", imageUrl, media}                   a money wish's checked photo, when one is found in time
 *   {type:"pairs", pairs:[{a, b, why, adjacent}]}     only when the body asks with `pairs: true` (owner, 2026-10-30:
 *                                                     this or that made from the wish itself, while it is hunted).
 *                                                     Each side is a pool-shaped card with a real photo; none is
 *                                                     sent when the pairs fail or are slow, and the app keeps its
 *                                                     pool. It may come before or after the card, by about 28 s.
 *   {type:"error", message}                           only when no card was sent. Only the reason: the app adds
 *                                                     that the wish stays on the list.
 * Hunting again with changed answers: the same body plus `draft` (from the draft event) and `answers`; that never makes
 * pairs. A money or priceless card's "Price it": the same body plus `price: true`, which hunts it as an ordinary priced
 * wish, and makes pairs only if asked again.
 */

// Raised 2026-10-30: one person re-running the intro (and judges sharing a network) hit 6 in minutes.
export const GUEST_WISHES_PER_IP_PER_HOUR = 15;
export const GUEST_WISHES_PER_DAY = 150;
export const GUEST_VOICE_PER_IP_PER_HOUR = 20;
export const GUEST_VOICE_PER_DAY = 400;
/** Every guest wish and voice clip together, a day. Signed-in people have their own caps. */
// Raised 2026-10-30 from 3: a guest run averages about $0.20, so 3 a day ran out after some 15 runs. The app's own
// daily and all-time caps (spend.ts) still bound everything.
export const GUEST_DAILY_USD = 6;
const MAX_TRACKED_IPS = 5000;

/**
 * Why a first wish has no card: the reason alone. Every app, old builds included, adds after it that the wish stays
 * on the list and is priced after saving (made.tsx), so saying that here too printed it twice (owner, 2026-10-30).
 */
export const NOT_FOUND = "Couldn't find a price for that just now.";
export const NOT_PRICED = "Couldn't price that just now.";
/** How long a money wish's stream stays open for its photo, at most. */
export const MONEY_PHOTO_MS = 20_000;
/** How long a priceless wish's stream stays open for its photo, at most: a whole hunt for it, not one held photo. */
export const PRICELESS_PHOTO_MS = 40_000;

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
  /** "Price it" on a money or priceless card: hunt it as an ordinary priced wish, whatever it reads as. */
  price: z.boolean().optional(),
  /** This or that made from this wish, sent as a "pairs" event: one more model call, so only apps that show them ask. */
  pairs: z.boolean().optional(),
});

/** The same card: nothing new to show (price, running costs, photo, source), so a second priced event would only repeat the first. */
const sameCard = (a: PriceOption, b: PriceOption | null) =>
  !!b && a.url === b.url && a.upfrontCents === b.upfrontCents && a.imageUrl === b.imageUrl && a.status === b.status && a.totals.monthlyCents === b.totals.monthlyCents;

export function guestRoutes(deps: AgentDeps & { pool: () => Promise<PoolItem[]>; typicals?: () => Promise<TypicalEntity[]> }) {
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
  /**
   * Guest model calls under the guest allowance; once `stop` fires, any call still running is dropped. `kind` names the
   * ledger rows ("guest-pairs" for this or that); every guest kind shares the one daily allowance.
   */
  const guestMeta = (stop?: AbortSignal, kind = "guest"): Meta => {
    const base = deps.meta!.fetch ?? fetch;
    const client = new MetaClient({ ...deps.meta!, fetch: stop ? stoppable(base, stop) : base, onUsage: (usage, cost) => recordSpend(db, null, kind, usage, cost, deps.now()) });
    return { responses: (body) => withBudgetScope("guest", guard, () => client.responses(body)) };
  };
  const busy = (why: "hour" | "day") => (why === "hour" ? "That's a lot for one hour. Try again soon, or sign in." : "The agent is resting until tomorrow. Sign in to keep going.");

  // The pool for this or that. Cached briefly at the edge; it changes when the archive gains a photo set.
  app.get("/pool", compress({ contentTypeFilter: /^application\/json(?:;|$)/i }), async (c) =>
    c.json({ items: await deps.pool() }, 200, { "Cache-Control": "public, max-age=300" }),
  );

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
    const { text, draft, answers, price, pairs: wantPairs } = parsed.data;
    const startedAt = Date.now();
    return streamSSE(c, async (stream) => {
      let open = true;
      // The hunt's own live events stop once its answer is in; the stream itself may wait a little longer for the pairs.
      let hunting = true;
      const send = async (data: unknown) => {
        if (open) await stream.writeSSE({ data: JSON.stringify(data) }).catch(() => undefined);
      };
      const live = (data: unknown) => (hunting ? send(data) : Promise.resolve());
      // Research can take a minute; a comment line keeps proxies from closing a quiet stream.
      const stopBeat = heartbeat(stream);
      const stop = new AbortController();
      // A money wish's photo hunt runs after the hunt's own calls are stopped, so it has its own stop.
      const shot = new AbortController();
      // This or that from the wish itself, made beside the hunt (owner, 2026-10-30): one model call of its own, then
      // photo and price lookups that call no model (pairs.ts). Never for a hunt again with changed answers.
      const pairing = new AbortController();
      const paired: Promise<unknown> =
        wantPairs && !draft
          ? makePairs(guestMeta(pairing.signal, "guest-pairs"), { wish: text }, { pool: deps.pool, typicals: deps.typicals ?? (async () => []), archive, api: deps.webFetch ?? publicFetch, now: deps.now, by: startedAt + PAIRS_MS })
              .then((pairs) => (pairs.length ? send({ type: "pairs", pairs }) : undefined))
              .catch(() => undefined)
          : Promise.resolve();
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
        price,
        startedAt,
        onStep: (step) => live({ type: "step", step }),
        fetcher: deps.webFetch,
        now: deps.now,
        archive,
        homeCurrency: "USD",
        onDraft: (d) => live({ type: "draft", title: d.title, kind: d.kind, draft: d, questions: d.questions ?? [] }),
        onProvisional: async (r) => {
          // A copy of the card as shown: the hunt keeps working on its own object (a photo found later lands on it), so
          // holding that object made the final card always look the same as the fast one, and the photo never went out
          // (live, 2026-10-30: three wishes in a row ended on the fast card with no photo).
          shown.card = r.options[0] ? structuredClone(r.options[0]) : null;
          await live(card(r, true));
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), Math.max(0, startedAt + HUNT_STOP_MS - Date.now()))));
      try {
        const outcome = await Promise.race([hunt.then((r) => ({ r }), (e: unknown) => ({ e })), late]);
        if (outcome === "late") {
          if (!shown.card) await send({ type: "error", message: NOT_FOUND });
        } else if ("e" in outcome) {
          const e = outcome.e;
          if (!(e instanceof SpendLimitError)) console.error("guest wish failed", e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : (e as Error).message);
          if (!shown.card) await send({ type: "error", message: e instanceof SpendLimitError ? busy("day") : NOT_PRICED });
        } else if (outcome.r.worth) {
          // Money or priceless: nothing to hunt, so the fast find and the questions that started beside the reading
          // stop now. The card is the worth itself.
          const worth = outcome.r.worth;
          stop.abort();
          await send({ type: "worth", ...worth });
          // An app from before 2026-10-30 has no worth card and would wait on a price forever; it ends on this line,
          // as it did for these wishes before. Apps that know the worth event ignore it.
          await send({ type: "error", message: NOT_PRICED });
          if (worth.worth === "money") {
            const by = Math.min(Date.now() + MONEY_PHOTO_MS, startedAt + HUNT_STOP_MS);
            const photo = await moneyPhoto(guestMeta(shot.signal), { fetcher: deps.webFetch ?? publicFetch, archive, by }).catch(() => null);
            if (photo) await send({ type: "photo", ...photoMedia(photo) });
          } else {
            const by = Math.min(Date.now() + PRICELESS_PHOTO_MS, startedAt + HUNT_STOP_MS);
            const photo = await pricelessPhoto(guestMeta(shot.signal), outcome.r.draft, { fetcher: deps.webFetch ?? publicFetch, by }).catch(() => null);
            if (photo) await send({ type: "photo", ...photoMedia(photo) });
          }
        } else {
          const best = outcome.r.options[0];
          if (best && !sameCard(best, shown.card)) await send(card(outcome.r, false));
          else if (!best && !shown.card) await send({ type: "error", message: NOT_FOUND });
        }
      } finally {
        clearTimeout(timer);
        // Whatever the hunt still has running stops here and spends nothing more; its late steps are not sent.
        hunting = false;
        stop.abort();
        shot.abort();
        // The pairs go out before the stream closes: a hunt can end long before them (money, a wish that can't be read).
        await within(paired, Math.max(0, startedAt + PAIRS_MS - Date.now()));
        open = false;
        pairing.abort();
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
