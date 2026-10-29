import { createHash } from "node:crypto";
import { MetaApiError, MetaClient, TRANSCRIBE_MODEL } from "@dandelist/meta";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireAuth, type AuthDeps, type AuthVars } from "../auth";
import type { MediaStore } from "../media-store";
import { SpendLimitError, TOOL_MODEL_PREFIX, assertBudget, assertUserBudget, callsToday, recordSpend, recordToolSpend, spentToday, userCapUsd, isJudge, withHold, type SpendCaps } from "../spend";
import { answerSchema, clarify, draftSchema, interpret, type Draft, type Meta, type Step } from "./agent";
import { HUNT_STOP_MS, huntWish, type HuntResult } from "./find";
import { SAM_MODEL } from "./cutout";
import type { MediaOptions } from "./hunt";
import { SHOPPING_ACTOR, SHOPPING_MAX_RESULTS, SHOPPING_PRICE_PER_RESULT_USD, shoppingSearch } from "./shopping";
import { findPhoto } from "./photos";
import { publicFetch, type Fetcher } from "./tools";
import { pgArchive, type Archive } from "../archive/archive";
import { MAX_CLIP_BYTES, TRANSCRIBES_PER_USER_PER_DAY, WISH_KEYWORDS, cleanTranscript, clipProblem, readWav } from "./transcribe";
import { personaSchema, voiceLine } from "./persona";
import { stoppable } from "../sse";

export const RUNS_PER_USER_PER_DAY = 20;
/** Every judge shares one account, so it gets more runs; its share of the daily spend cap still bounds it. */
export const RUNS_PER_JUDGE_PER_DAY = 120;
export const INTERPRETS_PER_USER_PER_DAY = 60;
/** New photos one person may ask for a day; each is a planned search, a web search and checked candidates. */
export const RETAKES_PER_USER_PER_DAY = 30;
/** A retake answers within this, well inside App Runner's 120 s. */
const RETAKE_MS = 35_000;
/** About 15 researched wishes; the per-day run cap usually bites first. */
export const USER_DAILY_USD = 2;
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface AgentDeps extends AuthDeps {
  /** Missing when no Meta key is configured; the agent routes then answer 503. */
  meta?: { apiKey: string; baseUrl?: string; fetch?: typeof fetch };
  spendCaps?: SpendCaps;
  /** Used for pages, images, exchange rates, Commons and Sketchfab; tests replace it. */
  webFetch?: Fetcher;
  /** Google Shopping through Apify. Missing turns the shopping tool off. `dailyUsd` is a hard cap on the free credit. */
  apify?: { token: string; dailyUsd: number; actor?: string; fetch?: Fetcher };
  /** Pictures Meta's models make. Each is off unless switched on, and each has a daily count cap. */
  media?: { store?: MediaStore; cutouts?: boolean; generate?: boolean; upscale?: boolean; cutoutsPerDay: number; imagesPerDay: number };
  /** The shared photo archive (defaults to the database's). Tests pass their own or none. */
  archive?: Archive | null;
}

const IMAGE_MODEL = "muse-image-1.0";

const interpretBody = z.object({ text: z.string().trim().min(2).max(1000) });
/**
 * A run hunts one wish. Send the person's words (`text`) to start at once, or a `draft` read before; to hunt again with
 * changed answers, send the run's draft and `answers` by question id (or the question's words), free text included.
 */
const runBody = z
  .object({
    draft: draftSchema.optional(),
    text: z.string().trim().min(2).max(1000).optional(),
    answers: z.array(answerSchema).max(6).default([]),
    persona: personaSchema,
  })
  .refine((b) => !!b.draft || !!b.text, { message: "Describe the wish." });

/** A retake: the wish the photo is for, and the photos already shown, which are never offered again. */
const photoBody = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["buy", "own", "do", "visit"]),
  summary: z.string().trim().max(400).optional(),
  place: z.string().trim().max(120).optional(),
  exclude: z.array(z.string().max(2000)).max(20).default([]),
  /** The page the wish was priced on: its own product photo is usually the very thing. */
  page: z.string().url().max(2000).optional(),
});
/** A retake's model calls at most: two looks at the photo turned down, the plan, a web search, and two looks at each of up to 12 candidates. */
const CALLS_PER_RETAKE = 28;

/** A run started from words alone holds this until the draft is read, a few seconds in. */
const pendingDraft = (text: string): Draft => ({ title: text.slice(0, 120), kind: "buy", summary: text.slice(0, 400), specifics: [], region: "US", currency: "USD", unknowns: [] });

/** What a run's result holds: the options, and while it runs the fast card marked provisional. */
const resultOf = (r: HuntResult) => ({ options: r.options, explanation: r.explanation, note: r.note, horizonYears: r.horizonYears, questions: r.questions, provisional: r.provisional });

type RunRow = {
  id: string;
  status: string;
  draft: unknown;
  answers: unknown;
  steps: unknown;
  result: unknown;
  error: string | null;
  cost_usd: string | number;
  created_at: string | Date;
};
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const toRun = (r: RunRow) => ({
  id: r.id,
  status: r.status,
  draft: parse(r.draft),
  answers: parse(r.answers),
  steps: parse(r.steps),
  result: parse(r.result),
  error: r.error,
  costUsd: Number(r.cost_usd),
  createdAt: new Date(r.created_at).toISOString(),
});
const RUN_COLUMNS = "id, status, draft, answers, steps, result, error, cost_usd, created_at";

function friendly(e: unknown): string {
  if (e instanceof SpendLimitError) return e.message;
  if (e instanceof MetaApiError) return e.status === 429 ? "The AI is busy right now. Try again in a minute." : "The AI couldn't answer just now. Try again.";
  return "Something went wrong while researching. Try again.";
}

export function agentRoutes(deps: AgentDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const { db } = deps;
  const caps = deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 };
  const archive = deps.archive === undefined ? pgArchive(db) : deps.archive ?? undefined;
  app.use("*", requireAuth(deps));

  /** A Meta client that checks the spend caps before each call and records what each call cost. */
  const metaFor = (userId: string, kind: string, onCost?: (usd: number) => Promise<void>, stop?: AbortSignal): Meta => {
    const cfg = deps.meta!;
    const client = new MetaClient({
      ...cfg,
      ...(stop ? { fetch: stoppable(cfg.fetch ?? fetch, stop) } : {}),
      onUsage: async (usage, cost) => {
        await recordSpend(db, userId, kind, usage, cost, deps.now());
        await onCost?.(cost);
      },
    });
    const guard = async () => {
      await assertBudget(db, caps, deps.now());
      await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), deps.now());
    };
    return {
      responses: (body) => withHold(guard, () => client.responses(body), userId),
      images: (op, body) => withHold(guard, () => client.images(op, body), userId),
    };
  };

  /** One shopping search, refused before it starts when it could push today's Apify spend past the cap. */
  const shoppingFor = (userId: string, region: string, currency: string, onCost: (usd: number) => Promise<void>) => {
    const apify = deps.apify;
    if (!apify) return undefined;
    const actor = apify.actor ?? SHOPPING_ACTOR;
    return async (query: string) => {
      const worst = SHOPPING_MAX_RESULTS * SHOPPING_PRICE_PER_RESULT_USD;
      if ((await spentToday(db, TOOL_MODEL_PREFIX, deps.now())) + worst > apify.dailyUsd) throw new Error("Today's shopping searches are used up; search the web instead.");
      const r = await shoppingSearch(query, region, currency, { token: apify.token, actor, fetcher: apify.fetch });
      await recordToolSpend(db, userId, "shopping", `${TOOL_MODEL_PREFIX}${actor}`, r.costUsd, deps.now());
      await onCost(r.costUsd);
      return r.offers;
    };
  };

  const mediaOptions = (): MediaOptions | undefined => {
    const m = deps.media;
    if (!m) return undefined;
    return {
      store: m.store,
      cutouts: m.cutouts,
      generate: m.generate,
      upscale: m.upscale,
      allow: async (what) => (await callsToday(db, what === "cutout" ? SAM_MODEL : IMAGE_MODEL, deps.now())) < (what === "cutout" ? m.cutoutsPerDay : m.imagesPerDay),
    };
  };

  app.use("*", async (c, next) => {
    if (!deps.meta) return c.json({ error: "The AI helper isn't set up on this server." }, 503);
    await next();
  });

  app.post("/interpret", async (c) => {
    const body = interpretBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Describe the wish in a few words." }, 400);
    const read = await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where user_id = $1 and kind = 'interpret' and created_at > $2", [
      c.get("userId"),
      new Date(deps.now().getTime() - CACHE_MS).toISOString(),
    ]);
    // Each wish read is two model calls: interpret, then clarify.
    if (Number(read.rows[0]?.n ?? 0) >= INTERPRETS_PER_USER_PER_DAY * 2) return c.json({ error: `You can add up to ${INTERPRETS_PER_USER_PER_DAY} wishes this way a day.` }, 429);
    try {
      const meta = metaFor(c.get("userId"), "interpret");
      const draft = await interpret(meta, body.data.text);
      const questions = await clarify(meta, draft);
      return c.json({ draft, questions });
    } catch (e) {
      return c.json({ error: friendly(e) }, e instanceof SpendLimitError ? 429 : 502);
    }
  });

  // A retake (owner, 2026-10-29: "a retake for image gen that has ai find a better picture"): the photo search, deep,
  // for one wish, never offering a photo already shown. Same caps as every Meta call, plus a per-person daily count.
  app.post("/photo", async (c) => {
    const body = photoBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Say which wish needs a photo." }, 400);
    const userId = c.get("userId");
    const used = await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where user_id = $1 and kind = 'photo' and created_at > $2", [userId, new Date(deps.now().getTime() - CACHE_MS).toISOString()]);
    if (Number(used.rows[0]?.n ?? 0) >= RETAKES_PER_USER_PER_DAY * CALLS_PER_RETAKE) return c.json({ error: `That's today's ${RETAKES_PER_USER_PER_DAY} new photos.` }, 429);
    try {
      // A retake means the person turned the last photo down (owner, 2026-10-29: "human clicked retake so that means I
      // stupidly picked this photo for 1 of 1000 reasons like not the right watch"): every new photo is held up against
      // the one turned down, and the hunt looks wider.
      const { exclude, page, ...subject } = body.data;
      const found = await findPhoto(metaFor(userId, "photo"), subject, { fetcher: deps.webFetch ?? publicFetch, exclude, deep: true, pages: page ? [page] : [], by: Date.now() + RETAKE_MS });
      if (!found) return c.json({ error: "No better photo turned up this time. Try again in a moment." }, 404);
      return c.json({ photo: { imageUrl: found.image.url, media: { kind: found.kind, images: [found.image] }, how: found.how } });
    } catch (e) {
      return c.json({ error: friendly(e) }, e instanceof SpendLimitError ? 429 : 502);
    }
  });

  // Say your wish: a short WAV in, the words out. Same caps as every Meta call, plus a per-person daily count.
  // The size cap is enforced while the body streams in, so an oversized upload never sits in memory.
  app.post("/transcribe", bodyLimit({ maxSize: MAX_CLIP_BYTES, onError: (c) => c.json({ error: "Keep it under a minute." }, 413) }), async (c) => {
    if (!(c.req.header("content-type") ?? "").startsWith("audio/wav")) return c.json({ error: "Send the recording as a WAV file." }, 415);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const problem = clipProblem(readWav(bytes));
    if (problem) return c.json({ error: problem }, 400);
    const userId = c.get("userId");
    const said = await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where user_id = $1 and kind = 'transcribe' and created_at > $2", [
      userId,
      new Date(deps.now().getTime() - CACHE_MS).toISOString(),
    ]);
    if (Number(said.rows[0]?.n ?? 0) >= TRANSCRIBES_PER_USER_PER_DAY) return c.json({ error: "That's today's voice wishes. Type it instead." }, 429);
    try {
      const guard = async () => {
        await assertBudget(db, caps, deps.now());
        await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), deps.now());
      };
      const client = new MetaClient(deps.meta!);
      const heard = await withHold(guard, () => client.transcribe(new Blob([bytes], { type: "audio/wav" }), { keywords: WISH_KEYWORDS }), userId);
      await recordToolSpend(db, userId, "transcribe", TRANSCRIBE_MODEL, heard.costUsd, deps.now());
      const text = cleanTranscript(heard.text);
      if (!text) return c.json({ error: "Didn't catch that. Try again a little closer." }, 422);
      return c.json({ text });
    } catch (e) {
      if (e instanceof SpendLimitError) return c.json({ error: e.message }, 429);
      if (e instanceof MetaApiError && e.status === 429) return c.json({ error: "The AI is busy right now. Try again in a minute." }, 429);
      return c.json({ error: "Couldn't hear that just now. Try again, or type it." }, 502);
    }
  });

  /**
   * POST /agent/runs {text} or {draft, answers?}, then poll GET /agent/runs/:id (the chat and the add-a-wish screen).
   * While `status` is "running": `steps[]` grows, each with a short `line` for one working row; `draft` is the read
   * wish (with `questions`, each with the answer it `picked`) a few seconds in; `result` appears with the fast card as
   * `options[0]` and `provisional: true`, usually in 10 to 15 s. At "done" (by 60 s) `result` is final: the best option
   * first, `questions` with what each hunt used. To change an answer, post the run's `draft` with
   * `answers: [{question: <question id>, answer: <a choice or their own words>}]`.
   */
  app.post("/runs", async (c) => {
    const body = runBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Check the wish and try again." }, 400);
    const userId = c.get("userId");
    const now = deps.now();
    const { draft, text, answers } = body.data;
    const key = createHash("sha256")
      .update(
        JSON.stringify(
          draft
            ? [draft.title.toLowerCase(), draft.kind, draft.region, draft.currency, [...draft.specifics].sort((a, b) => a.name.localeCompare(b.name)), answers]
            : ["text", text!.toLowerCase().replace(/\s+/g, " ").trim(), answers],
        ),
      )
      .digest("hex");

    const cached = await db.query<RunRow>(
      `select ${RUN_COLUMNS} from agent_runs where user_id = $1 and cache_key = $2 and status = 'done' and created_at > $3 order by created_at desc limit 1`,
      [userId, key, new Date(now.getTime() - CACHE_MS).toISOString()],
    );
    if (cached.rows[0]) return c.json({ run: { ...toRun(cached.rows[0]), cached: true } });

    try {
      await assertBudget(db, caps, now);
      await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), now);
    } catch (e) {
      return c.json({ error: friendly(e) }, 429);
    }

    // Count and insert in one statement. Parallel requests can still overshoot by a few; the per-person spend cap
    // above bounds what that costs.
    const since = new Date(now.getTime() - CACHE_MS).toISOString();
    const runCap = (await isJudge(db, userId, deps.judge)) ? RUNS_PER_JUDGE_PER_DAY : RUNS_PER_USER_PER_DAY;
    const { rows } = await db.query<RunRow>(
      `insert into agent_runs (user_id, cache_key, draft, answers, created_at, updated_at)
       select $1, $2, $3::jsonb, $4::jsonb, $5, $5
       where (select count(*) from agent_runs where user_id = $1 and created_at > $6) < $7
       returning ${RUN_COLUMNS}`,
      [userId, key, JSON.stringify(draft ?? pendingDraft(text!)), JSON.stringify(answers), now.toISOString(), since, runCap],
    );
    if (!rows[0]) return c.json({ error: `You can research up to ${runCap} wishes a day.` }, 429);
    const run = rows[0]!;

    const touch = () => deps.now().toISOString();
    const addCost = async (usd: number) => void (await db.query("update agent_runs set cost_usd = cost_usd + $1 where id = $2", [usd.toFixed(6), run.id]));
    const onStep = async (step: Step) =>
      void (await db.query("update agent_runs set steps = steps || $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify([step]), touch(), run.id]));
    // The agent keeps working after this response; the app polls GET /agent/runs/:id for its trail. The fast card
    // lands in the run's result while it still runs (provisional: true), and the run ends with its best by 60 s.
    const startedAt = Date.now();
    const stop = new AbortController();
    const shopping = shoppingFor(userId, draft?.region ?? "US", draft?.currency ?? "USD", addCost);
    const fast: { result: ReturnType<typeof resultOf> | null } = { result: null };
    const hunt = huntWish(metaFor(userId, "research", addCost, stop.signal), {
      text,
      draft,
      answers,
      startedAt,
      onStep,
      fetcher: deps.webFetch,
      now: deps.now,
      shopping,
      media: mediaOptions(),
      archive,
      contributor: userId,
      voice: voiceLine(body.data.persona),
      onDraft: async (d) => void (await db.query("update agent_runs set draft = $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify(d), touch(), run.id])),
      onProvisional: async (r) => {
        fast.result = resultOf(r);
        await db.query("update agent_runs set result = $1::jsonb, updated_at = $2 where id = $3 and status = 'running'", [JSON.stringify(fast.result), touch(), run.id]);
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), HUNT_STOP_MS)));
    void Promise.race([hunt.then((r) => ({ r }), (e: unknown) => ({ e })), late])
      .then(async (outcome) => {
        clearTimeout(timer);
        stop.abort(); // anything still running stops spending
        const done = (result: unknown) => db.query("update agent_runs set status = 'done', result = $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify(result), touch(), run.id]);
        if (outcome !== "late" && "r" in outcome) return done(resultOf(outcome.r));
        // Out of time, or the research failed: the fast card, if there was one, is the answer.
        if (fast.result) return done({ ...fast.result, provisional: false });
        const e: unknown = outcome === "late" ? null : "e" in outcome ? outcome.e : null;
        if (e) console.error("research failed", run.id, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
        return db.query("update agent_runs set status = 'error', error = $1, updated_at = $2 where id = $3", [e ? friendly(e) : "That took too long. Try again.", touch(), run.id]);
      })
      .catch((e) => console.error("could not record research outcome", run.id, e));

    return c.json({ run: toRun(run) }, 202);
  });

  app.get("/runs/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "That research wasn't found." }, 404);
    const { rows } = await db.query<RunRow>(`select ${RUN_COLUMNS} from agent_runs where id = $1 and user_id = $2`, [id.data, c.get("userId")]);
    if (!rows[0]) return c.json({ error: "That research wasn't found." }, 404);
    return c.json({ run: toRun(rows[0]) });
  });

  return app;
}
