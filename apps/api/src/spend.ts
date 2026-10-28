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

/**
 * Spend held for Meta calls that have started but not yet reported their cost. A call holds before it checks the
 * caps and releases after its cost is in the ledger, so calls running at once can't all pass the same check and
 * overshoot (Dandy List Master's review, 2026-10-27: $10.03 against a $10 cap). Per process; deliberately
 * conservative, since a held call is briefly counted twice once its cost is recorded.
 */
let held = 0;
const heldBy = new Map<string, { usd: number; calls: number }>();
export const HOLD_USD = 0.1;
/** Calls one person may have in flight at once, so nobody can inflate the shared hold and lock others out. */
export const MAX_INFLIGHT_PER_USER = 4;

/** Holds `usd` against the caps (and against `userId`'s own) until the returned release is called (safe twice). */
export function hold(usd = HOLD_USD, userId?: string): () => void {
  if (userId) {
    const mine = heldBy.get(userId) ?? { usd: 0, calls: 0 };
    if (mine.calls >= MAX_INFLIGHT_PER_USER) throw new SpendLimitError("user");
    heldBy.set(userId, { usd: mine.usd + usd, calls: mine.calls + 1 });
  }
  held += usd;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held = Math.max(0, held - usd);
    if (userId) {
      const mine = heldBy.get(userId);
      if (!mine) return;
      if (mine.calls <= 1) heldBy.delete(userId);
      else heldBy.set(userId, { usd: Math.max(0, mine.usd - usd), calls: mine.calls - 1 });
    }
  };
}

/** What `userId` has in flight right now. */
export const heldFor = (userId: string) => heldBy.get(userId)?.usd ?? 0;

/** Runs one Meta call under a hold: hold, check the caps with the hold counted, call, then release. */
export async function withHold<T>(check: () => Promise<void>, run: () => Promise<T>, userId?: string): Promise<T> {
  const release = hold(HOLD_USD, userId);
  try {
    await check();
    return await run();
  } finally {
    release();
  }
}

/** Refuses a Meta call when today's or the all-time spend has reached its cap, counting calls still in flight. */
export async function assertBudget(db: Db, caps: SpendCaps, now: Date): Promise<void> {
  const { rows } = await db.query<{ today: string | null; total: string | null }>(
    `select coalesce(sum(cost_usd) filter (where created_at >= $1), 0) as today, coalesce(sum(cost_usd), 0) as total from spend_ledger where ${META_ONLY}`,
    [dayStart(now).toISOString()],
  );
  const today = Number(rows[0]?.today ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  if (total >= caps.totalUsd || total + held > caps.totalUsd) throw new SpendLimitError("total");
  if (today >= caps.dailyUsd || today + held > caps.dailyUsd) throw new SpendLimitError("daily");
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
  const spent = Number(rows[0]?.spent ?? 0);
  if (spent >= capUsd || spent + heldFor(userId) > capUsd) throw new SpendLimitError("user");
}

/** The judge account's share of the service's daily cap; the rest stays for everyone else. */
export const JUDGE_SHARE = 0.6;

/**
 * The cap for one account in any 24 hours. Every judge signs in to the same judge account, so it gets a bounded
 * share of the service's daily cap rather than one person's allowance; everyone else gets `personUsd`.
 */
export async function userCapUsd(db: Db, userId: string, personUsd: number, judge: { email: string } | undefined, caps: SpendCaps): Promise<number> {
  return (await isJudge(db, userId, judge)) ? Math.max(personUsd, caps.dailyUsd * JUDGE_SHARE) : personUsd;
}

/** True for the one account every judge signs in to. */
export async function isJudge(db: Db, userId: string, judge: { email: string } | undefined): Promise<boolean> {
  if (!judge) return false;
  const { rows } = await db.query<{ email: string | null }>("select email from users where id = $1", [userId]);
  return rows[0]?.email?.toLowerCase() === judge.email.toLowerCase();
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
