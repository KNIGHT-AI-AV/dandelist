import { createHash } from "node:crypto";
import { MetaApiError, MetaClient } from "@dandelist/meta";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthDeps, type AuthVars } from "../auth";
import { assertBudget, assertUserBudget, recordSpend, SpendLimitError, userCapUsd, type SpendCaps } from "../spend";
import { answerSchema, clarify, draftSchema, interpret, research, type Meta, type Step } from "./agent";
import type { Fetcher } from "./tools";

export const RUNS_PER_USER_PER_DAY = 20;
export const INTERPRETS_PER_USER_PER_DAY = 60;
/** About 15 researched wishes; the per-day run cap usually bites first. */
export const USER_DAILY_USD = 2;
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface AgentDeps extends AuthDeps {
  /** Missing when no Meta key is configured; the agent routes then answer 503. */
  meta?: { apiKey: string; baseUrl?: string; fetch?: typeof fetch };
  spendCaps?: SpendCaps;
  /** Used for pages and exchange rates; tests replace it. */
  webFetch?: Fetcher;
}

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
    return {
      responses: async (body) => {
        await assertBudget(db, caps, deps.now());
        await assertUserBudget(db, userId, await userCapUsd(db, userId, USER_DAILY_USD, deps.judge, caps), deps.now());
        return client.responses(body);
      },
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
    const { rows } = await db.query<RunRow>(
      `insert into agent_runs (user_id, cache_key, draft, answers, created_at, updated_at)
       select $1, $2, $3::jsonb, $4::jsonb, $5, $5
       where (select count(*) from agent_runs where user_id = $1 and created_at > $6) < $7
       returning ${RUN_COLUMNS}`,
      [userId, key, JSON.stringify(draft), JSON.stringify(answers), now.toISOString(), since, RUNS_PER_USER_PER_DAY],
    );
    if (!rows[0]) return c.json({ error: `You can research up to ${RUNS_PER_USER_PER_DAY} wishes a day.` }, 429);
    const run = rows[0]!;

    const touch = () => deps.now().toISOString();
    const addCost = async (usd: number) => void (await db.query("update agent_runs set cost_usd = cost_usd + $1 where id = $2", [usd.toFixed(6), run.id]));
    const onStep = async (step: Step) =>
      void (await db.query("update agent_runs set steps = steps || $1::jsonb, updated_at = $2 where id = $3", [JSON.stringify([step]), touch(), run.id]));
    // The agent keeps working after this response; the app polls GET /agent/runs/:id for its trail.
    void research(metaFor(userId, "research", addCost), { draft, answers, onStep, fetcher: deps.webFetch, now: deps.now })
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
