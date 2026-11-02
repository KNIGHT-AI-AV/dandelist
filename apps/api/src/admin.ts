import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { requireAuth, type AuthVars } from "./auth";
import type { Db } from "./db";
import { GUEST_DAILY_USD } from "./guest";

/**
 * GET /admin/*: the owner's own read-only view of the service (owner, 2026-11-02: "I need a admin page for viewing usage
 * and issues and token per account and account data"). Model spend and tokens by day and kind, every account with its
 * use and what it holds, and the issues people sent or hit. Only the owner's accounts may read it: to anyone else, signed
 * in or not, every path answers 404, as if nothing were there. The owner's addresses are not in this public code, only
 * their sha256; nothing here writes.
 */
export const ADMIN_EMAIL_SHA256: ReadonlySet<string> = new Set([
  "cdb834b723cf4e7bc7ba17f9bc16be6c693c104924cc037855032fd654ea9ffa",
  "8d8930891641057fdc75b203af7acedea038f8b5b3e6dadfc77bafead0436fe8",
]);

export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** How many days the usage view covers at most, and the issues it lists of each kind. */
export const ADMIN_MAX_DAYS = 60;
export const ADMIN_ISSUES = 50;

export interface AdminDeps {
  db: Db;
  jwtSecret: string;
  now: () => Date;
  spendCaps?: { dailyUsd: number; totalUsd: number };
  /** The sha256 of each address that may read /admin; ADMIN_EMAIL_SHA256 unless a test passes its own. */
  admins?: ReadonlySet<string>;
}

type ReportRow = { id: string; created_at: unknown; email: string; has_screen: boolean; report: Record<string, any> | string | null };
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString());
const num = (v: unknown) => (v == null ? 0 : Number(v));

export function adminRoutes(deps: AdminDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const admins = deps.admins ?? ADMIN_EMAIL_SHA256;
  const auth = requireAuth(deps);
  const nothing = (c: Context) => c.json({ error: "Not found." }, 404);

  // Signed out, a bad token or any account but the owner's: the same 404 as an unknown path.
  app.use("*", async (c, next) => {
    let signedIn = false;
    await auth(c, async () => {
      signedIn = true;
    });
    if (!signedIn) return nothing(c);
    const email = (await deps.db.query<{ email: string }>("select email from users where id = $1", [c.get("userId")])).rows[0]?.email;
    if (!email || !admins.has(emailHash(email))) return nothing(c);
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
    const totals = (
      await deps.db.query<Record<string, unknown>>(
        `select coalesce(sum(cost_usd) filter (where created_at >= $1), 0)::float8 as today_usd,
           coalesce(sum(cost_usd) filter (where created_at >= $1 and user_id is null), 0)::float8 as guests_today_usd,
           coalesce(sum(cost_usd), 0)::float8 as total_usd, count(*)::int as total_calls
         from spend_ledger`,
        [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()],
      )
    ).rows[0]!;
    return c.json({
      from: from.toISOString().slice(0, 10),
      days: rows.map((r) => ({ day: r.day, kind: r.kind, calls: num(r.calls), inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens), searches: num(r.searches), usd: num(r.usd) })),
      totals: { todayUsd: num(totals.today_usd), guestsTodayUsd: num(totals.guests_today_usd), totalUsd: num(totals.total_usd), totalCalls: num(totals.total_calls) },
      caps: { dailyUsd: deps.spendCaps?.dailyUsd ?? null, totalUsd: deps.spendCaps?.totalUsd ?? null, guestDailyUsd: GUEST_DAILY_USD },
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
        `select h.id, h.created_at, u.email, h.has_screen, h.report from help_reports h join users u on u.id = h.user_id order by h.created_at desc limit $1`,
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
      reports: reports.map((r) => {
        const report = (typeof r.report === "string" ? JSON.parse(r.report) : r.report) ?? {};
        const said = (report.chat?.transcript ?? []).filter((e: { role?: string }) => e?.role === "user").at(-1)?.text;
        const logs = Array.isArray(report.app?.logs) ? report.app.logs.slice(-5) : [];
        return {
          id: r.id,
          code: String(r.id).slice(0, 6).toUpperCase(),
          at: iso(r.created_at),
          email: r.email,
          route: report.app?.route ?? null,
          platform: report.app?.platform ?? null,
          os: report.app?.os ?? null,
          version: report.app?.version ?? null,
          build: report.app?.build ?? null,
          lastSaid: typeof said === "string" ? said.slice(0, 300) : null,
          logs: logs.map((l: { at?: string; level?: string; text?: string }) => ({ at: l.at ?? null, level: l.level ?? null, text: String(l.text ?? "").slice(0, 300) })),
          replay: report.replay ?? null,
          screen: !!r.has_screen,
        };
      }),
      failedRuns: failed.map((f) => ({ id: f.id, at: iso(f.created_at), email: f.email, title: f.title ?? null, error: f.error ? String(f.error).slice(0, 300) : null })),
    });
  });

  return app;
}
