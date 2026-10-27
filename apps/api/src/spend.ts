import type { Usage } from "@dandelist/meta";
import type { Db } from "./db";

export class SpendLimitError extends Error {
  constructor(readonly scope: "daily" | "total" | "user") {
    super(
      scope === "daily"
        ? "Today's AI budget is used up. Try again tomorrow."
        : scope === "user"
          ? "You've used today's research allowance. Try again tomorrow."
          : "The AI budget for this event is used up.",
    );
  }
}

export interface SpendCaps {
  dailyUsd: number;
  totalUsd: number;
}

/**
 * Outside services (Apify's free monthly credit) share the ledger under a "<provider>:" model name. They have their
 * own daily cap, so they stay out of the Meta caps below.
 */
export const TOOL_MODEL_PREFIX = "apify:";
const META_ONLY = `model not like '${TOOL_MODEL_PREFIX}%'`;

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Refuses a Meta call when today's or the all-time spend has reached its cap. Meta's own limit only notifies. */
export async function assertBudget(db: Db, caps: SpendCaps, now: Date): Promise<void> {
  const { rows } = await db.query<{ today: string | null; total: string | null }>(
    `select coalesce(sum(cost_usd) filter (where created_at >= $1), 0) as today, coalesce(sum(cost_usd), 0) as total from spend_ledger where ${META_ONLY}`,
    [dayStart(now).toISOString()],
  );
  const today = Number(rows[0]?.today ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  if (total >= caps.totalUsd) throw new SpendLimitError("total");
  if (today >= caps.dailyUsd) throw new SpendLimitError("daily");
}

export async function recordSpend(db: Db, userId: string | null, kind: string, usage: Usage, costUsd: number, now: Date): Promise<void> {
  await db.query(
    "insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [userId, usage.model, kind, usage.inputTokens, usage.outputTokens, usage.searches, costUsd.toFixed(6), now.toISOString()],
  );
}

/** One person can spend at most `capUsd` of AI calls in any 24 hours, so nobody can drain the shared budget. */
export async function assertUserBudget(db: Db, userId: string, capUsd: number, now: Date): Promise<void> {
  const { rows } = await db.query<{ spent: string | null }>(`select coalesce(sum(cost_usd), 0) as spent from spend_ledger where user_id = $1 and created_at > $2 and ${META_ONLY}`, [
    userId,
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  ]);
  if (Number(rows[0]?.spent ?? 0) >= capUsd) throw new SpendLimitError("user");
}

/** Records a call to an outside service, such as one Apify actor run, with its estimated cost. */
export async function recordToolSpend(db: Db, userId: string | null, kind: string, model: string, costUsd: number, now: Date): Promise<void> {
  await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, $2, $3, $4, $5)", [userId, model, kind, costUsd.toFixed(6), now.toISOString()]);
}

/** Today's (UTC) spend on models whose name starts with `prefix`. */
export async function spentToday(db: Db, prefix: string, now: Date): Promise<number> {
  const { rows } = await db.query<{ spent: string | null }>("select coalesce(sum(cost_usd), 0) as spent from spend_ledger where model like $1 and created_at >= $2", [
    `${prefix}%`,
    dayStart(now).toISOString(),
  ]);
  return Number(rows[0]?.spent ?? 0);
}

/** How many calls to one model were made today (UTC); each ledger row is one call. */
export async function callsToday(db: Db, model: string, now: Date): Promise<number> {
  const { rows } = await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where model = $1 and created_at >= $2", [model, dayStart(now).toISOString()]);
  return Number(rows[0]?.n ?? 0);
}
