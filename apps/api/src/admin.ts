import { createHmac } from "node:crypto";
import { Hono, type Context } from "hono";
import { requireAuth, type AuthVars } from "./auth";
import type { Db } from "./db";
import { GUEST_DAILY_USD } from "./guest";
import { CLAUDE_MODEL_PREFIX, META_ONLY, dailyCapUsd } from "./spend";
import { guestShareUsd } from "./under";

/**
 * GET /admin/*: the owner's own read-only view of the service (owner, 2026-11-02: "I need a admin page for viewing usage
 * and issues and token per account and account data"). Model spend and tokens by day and kind, every account with its
 * use and what it holds, and the issues people sent or hit. Only the owner's accounts may read it: to anyone else, signed
 * in or not, every path answers the plain 404 of a path that doesn't exist. Nothing here writes.
 *
 * The owner's addresses are kept here only as HMAC-SHA256 digests keyed with the API's secret code pepper: a plain hash
 * of an address can be checked against a guess by anyone reading this public code (review of #207), a keyed one can't.
 * Rotating CODE_PEPPER means making these again (keep-offline/infra/aws/admin-digests.ts prints them).
 */
export const ADMIN_DIGESTS: ReadonlySet<string> = new Set([
  "1da05d6f5b7622cbfe36f54bbe73da08b0c6f4b1a25349384ef9d558b95a3ceb",
  "b961da807fb968f2f0ea158e50feef09800619b899fb695011f165d199bc7cdc",
]);

/**
 * An address's admin digest, as the email routes store it (trimmed, in lower case), behind an "admin:" prefix so it can
 * never equal another HMAC the same pepper keys, such as an agent key's (mcp.ts).
 */
export const adminDigest = (email: string, pepper: string) => createHmac("sha256", pepper).update(`admin:${email.trim().toLowerCase()}`).digest("hex");

/** How many days the usage view covers at most, and the issues it lists of each kind. */
export const ADMIN_MAX_DAYS = 60;
export const ADMIN_ISSUES = 50;

export interface AdminDeps {
  db: Db;
  jwtSecret: string;
  codePepper: string;
  now: () => Date;
  spendCaps?: { dailyUsd: number; totalUsd: number };
  /** Claude under Meta (under.ts), for its own line beside Meta's totals. */
  claude?: { dailyUsd: number };
  /** The digest (adminDigest) of each address that may read /admin; ADMIN_DIGESTS unless a test passes its own. */
  admins?: ReadonlySet<string>;
}

type ReportRow = { id: string; created_at: unknown; email: string; has_screen: boolean; app: unknown; transcript: unknown; replay: string | null };
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString());
const num = (v: unknown) => (v == null ? 0 : Number(v));

export function adminRoutes(deps: AdminDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const admins = deps.admins ?? ADMIN_DIGESTS;
  const auth = requireAuth(deps);
  const nothing = (c: Context) => c.text("404 Not Found", 404);

  // Signed out, a bad token or any account but the owner's: the same 404 as an unknown path.
  app.use("*", async (c, next) => {
    let signedIn = false;
    await auth(c, async () => {
      signedIn = true;
    });
    if (!signedIn) return nothing(c);
    const email = (await deps.db.query<{ email: string }>("select email from users where id = $1", [c.get("userId")])).rows[0]?.email;
    if (!email || !admins.has(adminDigest(email, deps.codePepper))) return nothing(c);
    await next();
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("X-Robots-Tag", "noindex");
  });

  // Model use by day and kind (spend_ledger), with today's and all-time totals against the caps.
  app.get("/usage", async (c) => {
    const days = Math.min(ADMIN_MAX_DAYS, Math.max(1, Math.floor(Number(c.req.query("days") ?? 14)) || 14));
    const now = deps.now();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86_400_000);
    const rows = (
      await deps.db.query<Record<string, unknown>>(
        `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, kind, count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::float8 as input_tokens, coalesce(sum(output_tokens), 0)::float8 as output_tokens,
           coalesce(sum(searches), 0)::int as searches, coalesce(sum(cost_usd), 0)::float8 as usd
         from spend_ledger where created_at >= $1 group by 1, 2 order by 1 desc, 7 desc`,
        [from.toISOString()],
      )
    ).rows;
    // The totals stand beside the caps, so they count what each cap counts: Meta's rows for Meta's (spend.ts
    // META_ONLY), and Claude's on a line of their own.
    const totalsOf = async (rowsOf: string) =>
      (
        await deps.db.query<Record<string, unknown>>(
          `select coalesce(sum(cost_usd) filter (where created_at >= $1), 0)::float8 as today_usd,
             coalesce(sum(cost_usd) filter (where created_at >= $1 and user_id is null), 0)::float8 as guests_today_usd,
             coalesce(sum(cost_usd), 0)::float8 as total_usd, count(*)::int as total_calls
           from spend_ledger where ${rowsOf}`,
          [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()],
        )
      ).rows[0]!;
    const shown = (t: Record<string, unknown>) => ({ todayUsd: num(t.today_usd), guestsTodayUsd: num(t.guests_today_usd), totalUsd: num(t.total_usd), totalCalls: num(t.total_calls) });
    const metaDaily = deps.spendCaps?.dailyUsd ?? 10;
    return c.json({
      from: from.toISOString().slice(0, 10),
      days: rows.map((r) => ({ day: r.day, kind: r.kind, calls: num(r.calls), inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens), searches: num(r.searches), usd: num(r.usd) })),
      totals: shown(await totalsOf(META_ONLY)),
      caps: { dailyUsd: deps.spendCaps ? dailyCapUsd(deps.spendCaps, now) : null, totalUsd: deps.spendCaps?.totalUsd ?? null, guestDailyUsd: GUEST_DAILY_USD },
      claude: {
        ...shown(await totalsOf(`model like '${CLAUDE_MODEL_PREFIX}%'`)),
        dailyUsd: deps.claude?.dailyUsd ?? null,
        guestDailyUsd: deps.claude ? guestShareUsd(deps.claude.dailyUsd, GUEST_DAILY_USD, metaDaily) : null,
      },
    });
  });

  // Every account: who it is, how it signs in, what it holds, and its model use; signed-out visitors as one line.
  app.get("/accounts", async (c) => {
    const week = new Date(deps.now().getTime() - 7 * 86_400_000).toISOString();
    const accounts = (
      await deps.db.query<Record<string, unknown>>(
        `select u.id, u.email, u.created_at,
           coalesce((select string_agg(distinct provider, ',') from user_identities i where i.user_id = u.id), '') as providers,
           (select count(*)::int from wishes w where w.user_id = u.id) as wishes,
           (select count(*)::int from agent_runs r where r.user_id = u.id) as runs,
           (select count(*)::int from dream_memories m where m.user_id = u.id) as memories,
           (select count(*)::int from help_reports h where h.user_id = u.id) as reports,
           (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in,
           coalesce(l.calls, 0)::int as calls, coalesce(l.input_tokens, 0)::float8 as input_tokens,
           coalesce(l.output_tokens, 0)::float8 as output_tokens, coalesce(l.usd, 0)::float8 as usd,
           coalesce(l.usd_week, 0)::float8 as usd_week, l.last_used
         from users u left join (
           select user_id, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
             sum(cost_usd) as usd, sum(cost_usd) filter (where created_at >= $1) as usd_week, max(created_at) as last_used
           from spend_ledger where user_id is not null group by user_id
         ) l on l.user_id = u.id
         order by coalesce(l.last_used, u.created_at) desc`,
        [week],
      )
    ).rows;
    const guests = (
      await deps.db.query<Record<string, unknown>>(
        `select count(*)::int as calls, coalesce(sum(input_tokens), 0)::float8 as input_tokens, coalesce(sum(output_tokens), 0)::float8 as output_tokens,
           coalesce(sum(cost_usd), 0)::float8 as usd, coalesce(sum(cost_usd) filter (where created_at >= $1), 0)::float8 as usd_week, max(created_at) as last_used
         from spend_ledger where user_id is null`,
        [week],
      )
    ).rows[0]!;
    return c.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        createdAt: iso(a.created_at),
        providers: String(a.providers || "").split(",").filter(Boolean),
        wishes: num(a.wishes),
        runs: num(a.runs),
        memories: num(a.memories),
        reports: num(a.reports),
        lastSignIn: iso(a.last_sign_in),
        lastUsed: iso(a.last_used),
        calls: num(a.calls),
        inputTokens: num(a.input_tokens),
        outputTokens: num(a.output_tokens),
        usd: num(a.usd),
        usdWeek: num(a.usd_week),
      })),
      guests: { calls: num(guests.calls), inputTokens: num(guests.input_tokens), outputTokens: num(guests.output_tokens), usd: num(guests.usd), usdWeek: num(guests.usd_week), lastUsed: iso(guests.last_used) },
    });
  });

  // What people reported with the help button, and the hunts that ended in an error.
  app.get("/issues", async (c) => {
    const reports = (
      await deps.db.query<ReportRow>(
        `select h.id, h.created_at, u.email, h.has_screen, h.report->'app' as app, h.report->'chat'->'transcript' as transcript, h.report->>'replay' as replay
         from help_reports h join users u on u.id = h.user_id order by h.created_at desc limit $1`,
        [ADMIN_ISSUES],
      )
    ).rows;
    const failed = (
      await deps.db.query<Record<string, unknown>>(
        `select r.id, r.created_at, u.email, r.draft->>'title' as title, r.error from agent_runs r join users u on u.id = r.user_id
         where r.status = 'error' order by r.created_at desc limit $1`,
        [ADMIN_ISSUES],
      )
    ).rows;
    return c.json({
      reports: reports.map(issueOf),
      failedRuns: failed.map((f) => ({ id: f.id, at: iso(f.created_at), email: f.email, title: f.title ?? null, error: f.error ? String(f.error).slice(0, 300) : null })),
    });
  });

  return app;
}

const text = (v: unknown) => (typeof v === "string" ? v : null);
const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const parsed = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/**
 * One help report as the admin view lists it. Read defensively: a row in any other shape shows what it has rather than
 * failing the whole list. "Last said" is the person's own last words, never the app's notes ("[picked l_3]").
 */
export function issueOf(r: ReportRow) {
  const app = object(parsed(r.app));
  const transcript = parsed(r.transcript);
  const said = (Array.isArray(transcript) ? transcript : [])
    .map(object)
    .filter((e) => e.role === "user" && typeof e.text === "string" && e.text.trim() && !e.text.trimStart().startsWith("["))
    .at(-1)?.text;
  const logs = Array.isArray(app.logs) ? app.logs.filter((l) => l && typeof l === "object").slice(-5).map(object) : [];
  return {
    id: r.id,
    code: String(r.id).slice(0, 6).toUpperCase(),
    at: iso(r.created_at),
    email: r.email,
    route: text(app.route),
    platform: text(app.platform),
    os: text(app.os),
    version: text(app.version),
    build: text(app.build),
    lastSaid: typeof said === "string" ? said.slice(0, 300) : null,
    logs: logs.map((l) => ({ at: text(l.at), level: text(l.level), text: String(l.text ?? "").slice(0, 300) })),
    replay: text(r.replay),
    screen: !!r.has_screen,
  };
}
