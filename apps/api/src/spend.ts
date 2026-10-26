import type { Usage } from "@dandelist/meta";
import type { Db } from "./db";

export class SpendLimitError extends Error {
  constructor(readonly scope: "daily" | "total") {
    super(scope === "daily" ? "Today's AI budget is used up. Try again tomorrow." : "The AI budget for this event is used up.");
  }
}

export interface SpendCaps {
  dailyUsd: number;
  totalUsd: number;
}

/** Refuses a Meta call when today's or the all-time spend has reached its cap. Meta's own limit only notifies. */
export async function assertBudget(db: Db, caps: SpendCaps, now: Date): Promise<void> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { rows } = await db.query<{ today: string | null; total: string | null }>(
    "select coalesce(sum(cost_usd) filter (where created_at >= $1), 0) as today, coalesce(sum(cost_usd), 0) as total from spend_ledger",
    [dayStart.toISOString()],
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
