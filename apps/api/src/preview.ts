import { entries as catalogue } from "@dandelist/catalogue";
import { formatCents, recurringBreakdown, upfrontCashCents, type Item } from "@dandelist/cost";
import { MetaClient } from "@dandelist/meta";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { heartbeat } from "./sse";
import { z } from "zod";
import { unknownNumbers } from "./agent/agent";
import { getPage, pageShowsPrice, publicFetch, type Fetcher } from "./agent/tools";
import type { AgentDeps } from "./agent/routes";
import { fromCatalogue, resolvePicks, type PoolItem } from "./pool";
import { SpendLimitError, assertBudget, heldForScope, recordSpend, withBudgetScope } from "./spend";

/**
 * The pre-login "your agent at work" step. Nothing here is scripted: each row is sent when the server has done that
 * piece of work, the one live seller check really fetches the seller's page, and every number comes from the
 * catalogue and the cost engine. Muse Spark writes the closing note, and the note is dropped for a fixed template if
 * it uses any number that isn't in the facts.
 */

export const PREVIEWS_PER_IP_PER_HOUR = 6;
export const PREVIEWS_PER_DAY = 400;
const CHECK_TIMEOUT_MS = 6000;

const recurringSchema = z.object({ label: z.string().max(60), amountCents: z.number().int().min(0).max(1_000_000_000), period: z.enum(["month", "year"]) });
const body = z
  .object({
    // Pool items from this-or-that: a few rounds, each "Both" adds two.
    picks: z.array(z.string().max(80)).max(12).default([]),
    // The wish someone typed or said, as the guest agent priced it. Shown only to them, before they save anything.
    extra: z.object({ name: z.string().trim().min(1).max(120), upfrontCents: z.number().int().min(1).max(100_000_000_000), recurring: z.array(recurringSchema).max(6).default([]) }).optional(),
    monthlyCents: z.number().int().min(1000).max(10_000_000),
    horizonYears: z.number().int().min(1).max(30).nullable().default(null),
  })
  .refine((b) => b.picks.length > 0 || !!b.extra);

/** Something on the list, as the plan sums it: a pool item or the priced wish. */
interface ListItem {
  id: string;
  name: string;
  upfrontCents: number;
  recurring: PoolItem["recurring"];
  status?: PoolItem["status"];
  url?: string;
  checkedAt?: string;
}
const toItem = (p: ListItem): Item => ({ id: p.id, upfrontCents: p.upfrontCents, recurring: p.recurring.map(({ amountCents, period, label }) => ({ amountCents, period, label })) });

const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

export function reachBy(cents: number, monthlyCents: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + Math.ceil(cents / monthlyCents), 1));
}

export function planFacts(picks: ListItem[], monthlyCents: number, now: Date) {
  const items = picks.map(toItem);
  const upfront = upfrontCashCents(items);
  const running = recurringBreakdown(items).perMonth;
  const biggest = [...picks].sort((a, b) => b.upfrontCents - a.upfrontCents)[0]!;
  const share = Math.round((biggest.upfrontCents / upfront) * 100);
  const rest = upfront - biggest.upfrontCents;
  return {
    picks: picks.map((p) => ({ name: p.name, upfront: formatCents(p.upfrontCents), running_per_month: p.recurring.length ? formatCents(recurringBreakdown([toItem(p)]).perMonth) : "none" })),
    everything_upfront: formatCents(upfront),
    running_costs_per_month_once_owned: running ? formatCents(Math.round(running)) : "none",
    set_aside_per_month: formatCents(monthlyCents),
    everything_by: month.format(reachBy(upfront, monthlyCents, now)),
    largest: { name: biggest.name, share_percent: share, rest_by_if_bought_last: picks.length > 1 && rest > 0 ? month.format(reachBy(rest, monthlyCents, now)) : null },
  };
}

/** The note when the model can't write one: what the list comes to, never a date or a budget (owner, 2026-10-28). */
export function fallbackNote(f: ReturnType<typeof planFacts>): string {
  const keep = f.running_costs_per_month_once_owned !== "none" ? `, plus ${f.running_costs_per_month_once_owned} a month to keep` : "";
  if (f.picks.length > 1 && f.largest.share_percent >= 40) return `The ${f.largest.name} is ${f.largest.share_percent}% of this list, which comes to ${f.everything_upfront}${keep}.`;
  return `Everything on this list comes to ${f.everything_upfront}${keep}.`;
}

/**
 * App Runner's proxy appends the caller's address as the last X-Forwarded-For hop; earlier hops are whatever the
 * caller sent, so only the right-most one can be trusted.
 */
export const ipOf = (h: (name: string) => string | undefined) => (h("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop() || "unknown";

/** Preview notes are cheap, but they get their own daily ceiling so anonymous traffic can't eat the agent's budget. */
export const PREVIEW_DAILY_USD = 1;
const MAX_TRACKED_IPS = 5000;

export function previewRoutes(deps: AgentDeps & { webFetch?: Fetcher; pool?: () => Promise<PoolItem[]> }) {
  const app = new Hono();
  const { db } = deps;
  const hits = new Map<string, number[]>();
  let dayKey = "";
  let dayCount = 0;

  app.post("/", async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Check your picks and try again." }, 400);
    const pool = deps.pool ? await deps.pool() : catalogue.map(fromCatalogue);
    const { extra } = parsed.data;
    const picks: ListItem[] = [...(extra ? [{ id: "wish", ...extra }] : []), ...resolvePicks(parsed.data.picks, pool)];
    if (!picks.length) return c.json({ error: "Pick something first." }, 400);

    const now = deps.now();
    const ip = ipOf((n) => c.req.header(n));
    const recent = (hits.get(ip) ?? []).filter((t) => now.getTime() - t < 3_600_000);
    if (hits.size > MAX_TRACKED_IPS) {
      for (const [k, v] of hits) if (!v.some((t) => now.getTime() - t < 3_600_000)) hits.delete(k);
      if (hits.size > MAX_TRACKED_IPS) hits.clear();
    }
    if (recent.length >= PREVIEWS_PER_IP_PER_HOUR) return c.json({ error: "That's a lot of lists for one hour. Try again soon." }, 429);
    const today = now.toISOString().slice(0, 10);
    if (today !== dayKey) [dayKey, dayCount] = [today, 0];
    if (dayCount >= PREVIEWS_PER_DAY) return c.json({ error: "The agent is resting until tomorrow." }, 429);
    hits.set(ip, [...recent, now.getTime()]);
    dayCount++;

    const { monthlyCents } = parsed.data;
    return streamSSE(c, async (stream) => {
      const send = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) });
      const stopBeat = heartbeat(stream);
      try {
        await send({ type: "row", id: "read", state: "done", text: `Read your ${picks.length} ${picks.length === 1 ? "pick" : "picks"}.` });

        // One live check per visit: the most expensive pick that was checked on its seller's page.
        const target = [...picks].filter((p) => p.status === "verified" && p.url && p.checkedAt).sort((a, b) => b.upfrontCents - a.upfrontCents)[0];
        if (target?.url && target.checkedAt) {
          const host = new URL(target.url).hostname.replace(/^www\./, "");
          await send({ type: "row", id: "check", state: "running", text: `Checking ${target.name} on ${host}` });
          const fetcher: Fetcher = (u, init) => (deps.webFetch ?? publicFetch)(u, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
          const page = await getPage(target.url, fetcher).catch(() => null);
          const shown = !!page?.ok && pageShowsPrice(page, target.upfrontCents / 100);
          const earlier = day.format(new Date(target.checkedAt));
          await send({
            type: "row",
            id: "check",
            state: "done",
            text: shown
              ? `Checked ${target.name} on ${host}: ${formatCents(target.upfrontCents)} (just now)`
              : page?.ok
                ? `Couldn't confirm ${host} just now. Using the ${earlier} check.`
                : `Couldn't reach ${host}. Using the ${earlier} check.`,
          });
        }

        const facts = planFacts(picks, monthlyCents, now);
        const labels = [...new Set(picks.flatMap((p) => p.recurring.map((r) => r.label?.toLowerCase()).filter(Boolean)))];
        await send({ type: "row", id: "running", state: "done", text: labels.length ? `Added running costs: ${labels.slice(0, 3).join(", ")}.` : "No running costs recorded for these picks." });
        await send({ type: "row", id: "total", state: "done", text: `Added it all up: ${facts.everything_upfront}.` });

        let note = fallbackNote(facts);
        if (deps.meta) {
          try {
            // Give the note writer the unit to copy; the streamed result still uses the numeric share.
            const noteFacts = { ...facts, largest: { ...facts.largest, share_percent: `${facts.largest.share_percent}%` } };
            const client = new MetaClient({ ...deps.meta, onUsage: (usage, cost) => recordSpend(db, null, "preview", usage, cost, deps.now()) });
            const res = await withBudgetScope("preview", async () => {
              await assertBudget(db, deps.spendCaps ?? { dailyUsd: 10, totalUsd: 120 }, now);
              const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
              const spent = (await db.query<{ s: string | null }>("select coalesce(sum(cost_usd), 0) as s from spend_ledger where kind = 'preview' and created_at >= $1", [dayStart])).rows[0];
              const usd = Number(spent?.s ?? 0);
              if (usd >= PREVIEW_DAILY_USD || usd + heldForScope("preview") > PREVIEW_DAILY_USD) throw new SpendLimitError("daily");
            }, () => client.responses({
              instructions:
                "You are Dandelist's agent. In two short sentences, under 40 words, say something useful about this wish list: what stands out, the largest share, and what it costs to keep each month if anything. Use only numbers that appear in FACTS, written exactly as given, including the % sign on percentages. No dates, no saving or budgeting advice, no financial advice, no hype, no questions.",
              input: `FACTS: ${JSON.stringify(noteFacts)}`,
            }));
            const text = res.text.trim();
            if (text && !unknownNumbers(text, noteFacts).length) note = text;
          } catch (e) {
            if (!(e instanceof SpendLimitError)) console.error("preview note failed", (e as Error).message);
          }
        }
        await send({ type: "note", text: note });

        const items = picks.map(toItem);
        await send({
          type: "result",
          upfrontCents: upfrontCashCents(items),
          monthlyRunningCents: Math.round(recurringBreakdown(items).perMonth),
          everythingBy: reachBy(upfrontCashCents(items), monthlyCents, now).toISOString().slice(0, 7),
          largest: facts.largest.rest_by_if_bought_last && facts.largest.share_percent >= 40 ? { name: facts.largest.name, share: facts.largest.share_percent, restBy: facts.largest.rest_by_if_bought_last } : null,
        });
      } finally {
        stopBeat();
      }
    });
  });

  return app;
}
