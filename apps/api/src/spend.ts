import { aiGeneration } from "./analytics";
import type { Usage } from "@dandelist/meta";
import type { Db } from "./db";
import { SpendLimitError, heldInPool, heldFor, heldForScope, collectPolicy, currentReservation, settle } from "./spend-reservations";
export { SpendLimitError, HOLD_USD, CLAUDE_HOLD_USD, MAX_INFLIGHT_PER_USER, SLOT_WAIT_MS, HOLD_TTL_MS, hold, reserve, settle, withHold, withBudgetScope, heldInPool, heldFor, heldForScope, reservedFetch } from "./spend-reservations";
export type { Pool, BudgetPolicy } from "./spend-reservations";


export interface SpendCaps {
  dailyUsd: number;
  totalUsd: number;
}

/**
 * Outside services (Apify's free monthly credit) share the ledger under a "<provider>:" model name. They have their
 * own daily cap, so they stay out of the Meta caps below.
 */
export const TOOL_MODEL_PREFIX = "apify:";
/**
 * Claude, the agent under Meta (under.ts), writes its rows under its model name ("claude-opus-5-5"). Meta's caps count
 * Meta's spend only and Claude's cap counts Claude's only, so each has a day of its own.
 */
export const CLAUDE_MODEL_PREFIX = "claude-";
/** A ledger filter that leaves Claude's rows out. */
export const NOT_CLAUDE = `model not like '${CLAUDE_MODEL_PREFIX}%'`;
/** The ledger rows Meta's caps count: neither an outside service's nor Claude's. */
export const META_ONLY = `model not like '${TOOL_MODEL_PREFIX}%' and ${NOT_CLAUDE}`;

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Judging week (owner, 2026-11-02: "Yes, $30 for Nov 4-8"): on these UTC days Meta's daily cap is $30, so judges
 * (JUDGE_SHARE of it) and visitors aren't stopped mid-judging; either side it is SPEND_DAILY_USD as set, with nothing to
 * undo. It runs through Nov 9 UTC so the whole of Nov 8 in the US is covered. The all-time cap is untouched, so the most
 * that can ever be spent stays the same, and Claude's own cap (under.ts) never takes it.
 */
export const JUDGING = { from: "2026-11-04", to: "2026-11-09", dailyUsd: 30 } as const;

/** Meta's daily cap on the UTC day of `now`: the judging-week cap on those days (never lower than the set one). */
export function dailyCapUsd(caps: SpendCaps, now: Date): number {
  const day = now.toISOString().slice(0, 10);
  return day >= JUDGING.from && day <= JUDGING.to ? Math.max(caps.dailyUsd, JUDGING.dailyUsd) : caps.dailyUsd;
}

/** Refuses a Meta call when today's or the all-time spend has reached its cap, counting calls still in flight. */
export async function assertBudget(db: Db, caps: SpendCaps, now: Date): Promise<void> {
  collectPolicy(db,{pool:"meta",type:"global",since:dayStart(now).toISOString(),cap:dailyCapUsd(caps,now),total:caps.totalUsd});
  const held = await heldInPool(db,"meta");
  const { rows } = await db.query<{ today: string | null; total: string | null }>(
    `select coalesce(sum(cost_usd) filter (where created_at >= $1), 0) as today, coalesce(sum(cost_usd), 0) as total from spend_ledger where ${META_ONLY}`,
    [dayStart(now).toISOString()],
  );
  const today = Number(rows[0]?.today ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  if (total >= caps.totalUsd || total + held > caps.totalUsd) throw new SpendLimitError("total");
  const daily = dailyCapUsd(caps, now);
  if (today >= daily || today + held > daily) throw new SpendLimitError("daily");
}

/**
 * Refuses a Claude call once today's (UTC) Claude spend, with Claude calls in flight, reaches Claude's own daily cap.
 * `extraUsd` is spend not in the ledger yet: what a call about to resume has already spent (under.ts).
 */
export async function assertClaudeBudget(db: Db, dailyUsd: number, now: Date, extraUsd = 0): Promise<void> {
  collectPolicy(db,{pool:"claude",type:"global",since:dayStart(now).toISOString(),cap:dailyUsd,extra:extraUsd});
  const spent = (await spentToday(db, CLAUDE_MODEL_PREFIX, now)) + extraUsd;
  if (spent >= dailyUsd || spent + await heldInPool(db,"claude") > dailyUsd) throw new SpendLimitError("daily");
}

/** One person's Claude spend in any 24 hours against their share of Claude's cap, as assertUserBudget is for Meta's. */
export async function assertUserClaudeBudget(db: Db, userId: string, capUsd: number, now: Date, extraUsd = 0): Promise<void> {
  collectPolicy(db,{pool:"claude",type:"user",userId,since:new Date(now.getTime()-24*60*60*1000).toISOString(),cap:capUsd,exclusive:true,extra:extraUsd});
  const { rows } = await db.query<{ spent: string | null }>("select coalesce(sum(cost_usd), 0) as spent from spend_ledger where user_id = $1 and created_at > $2 and model like $3", [
    userId,
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    `${CLAUDE_MODEL_PREFIX}%`,
  ]);
  const spent = Number(rows[0]?.spent ?? 0) + extraUsd;
  if (spent >= capUsd || spent + await heldFor(db,userId, "claude") > capUsd) throw new SpendLimitError("user");
}

export async function recordSpend(db: Db, userId: string | null, kind: string, usage: Usage, costUsd: number, now: Date): Promise<void> {
  const reservation = currentReservation(db);
  if (reservation) {
    if (await settle(db,reservation,userId,kind,usage,costUsd,now)) aiGeneration(userId,kind,usage,costUsd);
    return;
  }
  await db.query(
    "insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [userId, usage.model, kind, usage.inputTokens, usage.outputTokens, usage.searches, costUsd.toFixed(6), now.toISOString()],
  );
  aiGeneration(userId,kind,usage,costUsd);
}

/** One person can spend at most `capUsd` of AI calls in any 24 hours, so nobody can drain the shared budget. */
export async function assertUserBudget(db: Db, userId: string, capUsd: number, now: Date): Promise<void> {
  collectPolicy(db,{pool:"meta",type:"user",userId,since:new Date(now.getTime()-24*60*60*1000).toISOString(),cap:capUsd,exclusive:true});
  const { rows } = await db.query<{ spent: string | null }>(`select coalesce(sum(cost_usd), 0) as spent from spend_ledger where user_id = $1 and created_at > $2 and ${META_ONLY}`, [
    userId,
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  ]);
  const spent = Number(rows[0]?.spent ?? 0);
  if (spent >= capUsd || spent + await heldFor(db,userId) > capUsd) throw new SpendLimitError("user");
}

/** The judge account's share of the service's daily cap; the rest stays for everyone else. */
export const JUDGE_SHARE = 0.6;

/**
 * The cap for one account in any 24 hours. Every judge signs in to the same judge account, so it gets a bounded
 * share of the service's daily cap rather than one person's allowance, as does a team account; everyone else gets
 * `personUsd`.
 */
export async function userCapUsd(db: Db, userId: string, personUsd: number, judge: { email: string } | undefined, caps: SpendCaps, now?: Date): Promise<number> {
  // `now` is given for Meta's caps, so the judge's share follows the judging week; Claude's caps (under.ts) leave it out.
  const daily = now ? dailyCapUsd(caps, now) : caps.dailyUsd;
  return (await isJudge(db, userId, judge)) ? Math.max(personUsd, daily * JUDGE_SHARE) : personUsd;
}

/** True for the one account every judge signs in to, and for a team account (users.team, set by hand). */
export async function isJudge(db: Db, userId: string, judge: { email: string } | undefined): Promise<boolean> {
  const { rows } = await db.query<{ email: string | null; team: boolean | null }>("select email, team from users where id = $1", [userId]);
  const row = rows[0];
  return !!row?.team || (!!judge && row?.email?.toLowerCase() === judge.email.toLowerCase());
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

/** Shared anonymous feature cap, with the same policy included in atomic reservation admission. */
export async function assertScopeBudget(db:Db,scope:string,pool:"meta"|"claude",cap:number,now:Date,extra=0):Promise<void> {
  collectPolicy(db,{pool,type:"scope",scope,since:dayStart(now).toISOString(),cap,extra});
  const {rows}=await db.query<{spent:string}>(`select coalesce(sum(cost_usd),0) as spent from spend_ledger where user_id is null and kind like $1 and created_at >= $2 and ${pool==="meta"?META_ONLY:"model like 'claude-%'"}`,[scope+"%",dayStart(now).toISOString()]);
  const spent=Number(rows[0]?.spent??0)+extra;
  if(spent>=cap || spent+await heldForScope(db,scope,pool)>cap)throw new SpendLimitError("daily");
}
