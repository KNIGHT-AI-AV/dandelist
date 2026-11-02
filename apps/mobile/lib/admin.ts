/** The owner's admin view (app/admin.tsx): the shapes GET /admin/* answers with (api/src/admin.ts) and how they read. */
export type AdminUsage = {
  from: string;
  days: { day: string; kind: string; calls: number; inputTokens: number; outputTokens: number; searches: number; usd: number }[];
  totals: { todayUsd: number; guestsTodayUsd: number; totalUsd: number; totalCalls: number };
  caps: { dailyUsd: number | null; totalUsd: number | null; guestDailyUsd: number };
};
export type AdminAccount = {
  id: string;
  email: string;
  createdAt: string | null;
  providers: string[];
  wishes: number;
  runs: number;
  memories: number;
  reports: number;
  lastSignIn: string | null;
  lastUsed: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  usdWeek: number;
};
export type AdminAccounts = {
  accounts: AdminAccount[];
  guests: { calls: number; inputTokens: number; outputTokens: number; usd: number; usdWeek: number; lastUsed: string | null };
};
export type AdminIssues = {
  reports: { id: string; code: string; at: string | null; email: string; route: string | null; platform: string | null; os: string | null; version: string | null; build: string | null; lastSaid: string | null; logs: { at: string | null; level: string | null; text: string }[]; replay: string | null; screen: boolean }[];
  failedRuns: { id: string; at: string | null; email: string; title: string | null; error: string | null }[];
};

/** Dollars to the cent, or to a tenth of a cent under a dollar, where model calls live. */
export function adminMoney(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 1 ? 3 : 2)}`;
}

export function adminNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A UTC day as "Nov 2". */
export function adminDay(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A moment's date as "Nov 1" in the viewer's own time, or "never". */
export function adminDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A moment as "Nov 2, 1:10 AM" in the viewer's own time, or "never". */
export function adminWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The usage rows grouped by day, newest first, each day with its total and its kinds by spend. */
export function byDay(rows: AdminUsage["days"]) {
  const days = new Map<string, { day: string; usd: number; calls: number; kinds: AdminUsage["days"] }>();
  for (const r of rows) {
    const d = days.get(r.day) ?? { day: r.day, usd: 0, calls: 0, kinds: [] };
    d.usd += r.usd;
    d.calls += r.calls;
    d.kinds.push(r);
    days.set(r.day, d);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({ ...d, kinds: [...d.kinds].sort((a, b) => b.usd - a.usd) }));
}
