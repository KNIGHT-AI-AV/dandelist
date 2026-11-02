import { ClaudeApiError, ClaudeClient, MetaApiError, TOKEN_PRICES, isClaudeResponseId, type ResponsesResult } from "@dandelist/meta";
import type { Db } from "./db";
import { stoppable } from "./sse";
import {
  CLAUDE_HOLD_USD,
  HOLD_USD,
  NOT_CLAUDE,
  SpendLimitError,
  assertClaudeBudget,
  assertUserBudget,
  assertUserClaudeBudget,
  heldForScope,
  recordSpend,
  userCapUsd,
  withBudgetScope,
  withHold,
  type SpendCaps,
} from "./spend";

/**
 * Claude as a working agent under Meta. The owner's note, in his words:
 * (i cant afford credits on Meta and claude gifted me credits but i want to use meta for all!)
 *
 * So every model call goes to Meta first, exactly as before. Only when Meta refuses because its spend is used up (the
 * service's daily or all-time cap, or the guests' share of the day) or its credit has run out (a 402) does the same
 * call go to Claude Opus 5.5 (packages/meta/src/claude.ts), under Claude's own daily cap, and with `onMetaErrors` also
 * when Meta's service fails after its one retry. One person's own Meta allowance, and their calls in flight, still
 * stop them as they always did: Claude checks that allowance too before it takes their call. Meta's caps count Meta's
 * rows in the ledger and Claude's cap counts Claude's (spend.ts); guests get the same share of Claude's day as of
 * Meta's. A conversation stays with whichever model began it. Speech, Muse Image and SAM are Meta's alone. With no
 * Claude key, nothing here runs.
 */
export interface ClaudeSetup {
  apiKey: string;
  /** Claude's own cap on a day's (UTC) spend, apart from Meta's. */
  dailyUsd: number;
  /** Fast mode, on unless false. */
  fast?: boolean;
  /** Also take a call when Meta's service fails (a 5xx after its retry), not only when Meta's spend is used up. */
  onMetaErrors?: boolean;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Retries of a failed Claude call; tests set 0. */
  maxRetries?: number;
}

type Responder = (body: Record<string, unknown>) => Promise<ResponsesResult>;

/** One caller's way onto Claude: its checks, and a call run under them with a hold in Claude's pool. */
export interface Under {
  setup: ClaudeSetup;
  /** Claude's caps for this caller: Claude's daily cap, and the caller's share of it. */
  guard: () => Promise<void>;
  run: Responder;
}

/** True when Meta's refusal or failure may go to Claude: its caps spent, its credit gone, or (if set) its service down. */
export function handsDown(e: unknown, setup: ClaudeSetup): boolean {
  if (e instanceof SpendLimitError) return e.scope !== "user";
  if (!(e instanceof MetaApiError) || e instanceof ClaudeApiError) return false;
  return e.status === 402 || (!!setup.onMetaErrors && e.status >= 500);
}

/** The guests' share of Claude's day: the same part of it their share of Meta's is of Meta's ($6 of $10 is $3 of $5). */
export const guestShareUsd = (claudeDailyUsd: number, guestDailyUsd: number, metaDailyUsd: number) => (claudeDailyUsd * guestDailyUsd) / metaDailyUsd;

/** A call Claude can answer: words on Muse Spark (never SAM or another of Meta's own models), and not a Meta conversation. */
const forClaude = (body: Record<string, unknown>) => !body.previous_response_id && (body.model === undefined || (typeof body.model === "string" && body.model in TOKEN_PRICES));

/**
 * Meta first, Claude under it: `meta` is the route's own call, guarded and held as it always was. When it refuses as
 * handsDown allows, `under` runs the same body on Claude. If Claude can't (its own cap is spent, or it fails), the caller
 * gets Meta's refusal, so the route answers as it does today. Without `under`, this is `meta` itself.
 */
export function metaFirst(meta: Responder, under: Under | undefined): Responder {
  if (!under) return meta;
  return async (body) => {
    if (isClaudeResponseId(body.previous_response_id)) return under.run(body);
    if (!forClaude(body)) return meta(body);
    try {
      return await meta(body);
    } catch (e) {
      if (!handsDown(e, under.setup)) throw e;
      try {
        return await under.run(body);
      } catch (claude) {
        if (!(claude instanceof SpendLimitError)) console.warn("claude under meta failed", claude instanceof MetaApiError ? `${claude.status} ${claude.body.slice(0, 200)}` : claude instanceof Error ? claude.message : claude);
        throw e;
      }
    }
  };
}

/**
 * A route's check before it starts work: passes when Meta can take calls, or when Meta's caps are spent and Claude's
 * check passes. Otherwise it throws Meta's refusal, as the route has always had.
 */
export async function eitherReady(meta: () => Promise<void>, claude: (() => Promise<void>) | undefined): Promise<void> {
  try {
    await meta();
  } catch (e) {
    if (!claude || !(e instanceof SpendLimitError) || e.scope === "user") throw e;
    try {
      await claude();
    } catch {
      throw e;
    }
  }
}

interface UnderDeps {
  db: Db;
  now: () => Date;
  judge?: { email: string };
  claude?: ClaudeSetup;
  /** Meta's caps, for the person's own Meta allowance; the routes' default when missing. */
  spendCaps?: SpendCaps;
}

/**
 * Claude's checks for one signed-in person. Their own Meta allowance first, with Meta's caps: the routes check Meta's
 * day before it, so a person past their own $2 reads as "daily" once the day is spent too, and must not get a fresh
 * allowance on Claude. Then Claude's day, and the same share of it their Meta allowance is of Meta's.
 */
export function claudeGuard(deps: UnderDeps, userId: string, personUsd: number): (() => Promise<void>) | undefined {
  const setup = deps.claude;
  if (!setup) return undefined;
  const metaCaps = deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 };
  return async () => {
    await assertUserBudget(deps.db, userId, await userCapUsd(deps.db, userId, personUsd, deps.judge, metaCaps), deps.now());
    await assertClaudeBudget(deps.db, setup.dailyUsd, deps.now());
    await assertUserClaudeBudget(deps.db, userId, await userCapUsd(deps.db, userId, personUsd, deps.judge, { dailyUsd: setup.dailyUsd, totalUsd: Number.POSITIVE_INFINITY }), deps.now());
  };
}

/** What a Claude call holds: CLAUDE_HOLD_USD, scaled as the route scales Meta's (a photo check a fifth of a full call). */
const claudeHold = (metaUsd: number) => CLAUDE_HOLD_USD * (metaUsd / HOLD_USD);

/**
 * The check before a paused search resumes. One call can resume four times at up to 16k fast-mode tokens each, far
 * past its hold, so each resume first re-reads Claude's day and the caller's share, with every hold in flight (this
 * call's included) and what this call has already spent, which isn't in the ledger until it ends. A refusal stops the
 * resuming, and the call answers with what it has; any other failure fails the call.
 */
const resumeWhen =
  (check: (spentUsd: number) => Promise<void>) =>
  async (spentUsd: number): Promise<boolean> => {
    try {
      await check(spentUsd);
      return true;
    } catch (e) {
      if (e instanceof SpendLimitError) return false;
      throw e;
    }
  };

const clientFor = (setup: ClaudeSetup, onUsage: ConstructorParameters<typeof ClaudeClient>[0]["onUsage"], signal: AbortSignal | undefined, mayResume: (spentUsd: number) => Promise<void>) =>
  new ClaudeClient({
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl,
    fast: setup.fast,
    maxRetries: setup.maxRetries,
    fetch: signal ? stoppable(setup.fetch ?? fetch, signal) : setup.fetch,
    onUsage,
    mayResume: resumeWhen(mayResume),
  });

/**
 * Claude for one signed-in person's calls of `kind`, recorded in the ledger as theirs. `usd` is what the route holds
 * for the call on Meta, scaled up to Claude's hold, and `signal` stops what is still running once the route has its
 * answer.
 */
export function claudeFor(
  deps: UnderDeps,
  userId: string,
  kind: string,
  opts: { personUsd: number; onCost?: (usd: number) => Promise<void>; signal?: AbortSignal; usd?: (body: Record<string, unknown>) => number },
): Under | undefined {
  const setup = deps.claude;
  const guard = claudeGuard(deps, userId, opts.personUsd);
  if (!setup || !guard) return undefined;
  const client = clientFor(
    setup,
    async (usage, cost) => {
      await recordSpend(deps.db, userId, kind, usage, cost, deps.now());
      await opts.onCost?.(cost);
    },
    opts.signal,
    // The person's share counts $0.10 a call at the start; a resume counts what the call has really spent.
    async (spentUsd) => {
      await assertClaudeBudget(deps.db, setup.dailyUsd, deps.now(), spentUsd);
      const cap = await userCapUsd(deps.db, userId, opts.personUsd, deps.judge, { dailyUsd: setup.dailyUsd, totalUsd: Number.POSITIVE_INFINITY });
      await assertUserClaudeBudget(deps.db, userId, cap, deps.now(), spentUsd);
    },
  );
  return {
    setup,
    guard,
    run: (body) => {
      // Claude's day holds the full Opus 5.5 call, but the person's own share holds what the call holds on Meta (a tenth
      // of a dollar, a fiftieth for a photo check): at $0.60 a person's fourth call in flight would pass their $2 and be
      // refused while Claude still had room, and they would lose the last $0.60 of their share.
      const metaUsd = opts.usd?.(body) ?? HOLD_USD;
      return withHold(guard, () => client.responses(body), userId, claudeHold(metaUsd), opts.signal, "claude", metaUsd);
    },
  };
}

/** Claude for guests: Claude's day, and the guests' share of it (`shareUsd`, see guestShareUsd), on Claude's guest rows. */
export function claudeForGuests(deps: UnderDeps, kind: string, opts: { shareUsd: number; signal?: AbortSignal }): Under | undefined {
  const setup = deps.claude;
  if (!setup) return undefined;
  /** Claude's day and the guests' share, with `extraUsd` a resuming call has spent that the ledger doesn't hold yet. */
  const check = async (extraUsd = 0) => {
    const now = deps.now();
    await assertClaudeBudget(deps.db, setup.dailyUsd, now, extraUsd);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const spent = (await deps.db.query<{ s: string | null }>(`select coalesce(sum(cost_usd), 0) as s from spend_ledger where user_id is null and kind like 'guest%' and not (${NOT_CLAUDE}) and created_at >= $1`, [dayStart])).rows[0];
    const usd = Number(spent?.s ?? 0) + extraUsd;
    if (usd >= opts.shareUsd || usd + heldForScope("guest", "claude") > opts.shareUsd) throw new SpendLimitError("daily");
  };
  const guard = () => check();
  const client = clientFor(setup, (usage, cost) => recordSpend(deps.db, null, kind, usage, cost, deps.now()), opts.signal, check);
  return { setup, guard, run: (body) => withBudgetScope("guest", guard, () => client.responses(body), "claude", CLAUDE_HOLD_USD) };
}
