import { createHash } from "node:crypto";
import { MetaApiError, MetaClient, TRANSCRIBE_MODEL } from "@dandelist/meta";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireAuth, type AuthDeps, type AuthVars } from "../auth";
import type { MediaStore } from "../media-store";
import { SpendLimitError, TOOL_MODEL_PREFIX, assertBudget, assertUserBudget, callsToday, recordSpend, recordToolSpend, spentToday, userCapUsd, isJudge, withHold, type SpendCaps } from "../spend";
import { answerSchema, clarify, draftSchema, interpret, research, type Meta, type Step } from "./agent";
import { SAM_MODEL } from "./cutout";
import type { MediaOptions } from "./hunt";
import { SHOPPING_ACTOR, SHOPPING_MAX_RESULTS, SHOPPING_PRICE_PER_RESULT_USD, shoppingSearch } from "./shopping";
import type { Fetcher } from "./tools";
import { pgArchive, type Archive } from "../archive/archive";
import { MAX_CLIP_BYTES, TRANSCRIBES_PER_USER_PER_DAY, WISH_KEYWORDS, cleanTranscript, clipProblem, readWav } from "./transcribe";

export const RUNS_PER_USER_PER_DAY = 20;
/** Every judge shares one account, so it gets more runs; its share of the daily spend cap still bounds it. */
export const RUNS_PER_JUDGE_PER_DAY = 120;
export const INTERPRETS_PER_USER_PER_DAY = 60;
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
const runBody = z.object({ draft: draftSchema, answers: z.array(answerSchema).max(3).default([]) });

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
  const metaFor = (userId: string, kind: string, onCost?: (usd: number) => Promise<void>): Meta => {
    const cfg = deps.meta!;
    const client = new MetaClient({
      ...cfg,
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

  app.post("/runs", async (c) => {
    const body = runBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Check the wish and try again." }, 400);
    const userId = c.get("userId");
    const now = deps.now();
    const { draft, answers } = body.data;
    const key = createHash("sha256")
      .update(JSON.stringify([draft.title.toLowerCase(), draft.kind, draft.region, draft.currency, [...draft.specifics].sort((a, b) => a.name.localeCompare(b.name)), answers]))
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
      [userId, key, JSON.stringify(draft), JSON.stringify(answers), now.toISOString(), since, runCap],
    );
    if (!rows[0]) return c.json({ error: `You can research up to ${runCap} wishes a day.` }, 429);
    const run = rows[0]!;

    const touch = () => deps.now().toISOString();
    const addCost = async (usd: number) => void (await db.query("update agent_runs set cost_usd = cost_usd + $1 where id = $2", [usd.toFixed(6), run.id]));
    const onStep = async (step: Step) =>
      void (await db.query("update agent_runs set steps = steps || $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify([step]), touch(), run.id]));
    // The agent keeps working after this response; the app polls GET /agent/runs/:id for its trail.
    const shopping = shoppingFor(userId, draft.region, draft.currency, addCost);
    void research(metaFor(userId, "research", addCost), { draft, answers, onStep, fetcher: deps.webFetch, now: deps.now, shopping, media: mediaOptions(), archive, contributor: userId })
      .then((result) => db.query("update agent_runs set status = 'done', result = $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify(result), touch(), run.id]))
      .catch((e) => {
        console.error("research failed", run.id, e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 200)}` : e);
        return db.query("update agent_runs set status = 'error', error = $1, updated_at = $2 where id = $3", [friendly(e), touch(), run.id]);
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
