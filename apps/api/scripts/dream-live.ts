/**
 * Runs dream builder turns against the real Meta API, the real web and (when APIFY_TOKEN is set) Apify's free plan,
 * on an in-memory database, and prints what came back. Each check follows the flow to a priced wish.
 * Usage: MODEL_API_KEY=... [APIFY_TOKEN=...] tsx scripts/dream-live.ts [villa|car|security ...]. Spends cents.
 */
import type { DreamAction, DreamEvent, Widget } from "@dandelist/catalogue/dream";
import { MetaClient } from "@dandelist/meta";
import { publicFetch } from "../src/agent/tools";
import { migrate, openDb } from "../src/db";
import { runTurn } from "../src/dream/agent";
import { TurnBudget, type DreamCtx } from "../src/dream/context";
import { money } from "../src/dream/keep";
import { readLife } from "../src/dream/life";
import { emptyState, type DreamState, type TranscriptEntry } from "../src/dream/types";
import { recordSpend } from "../src/spend";

const db = await openDb("pglite:");
await migrate(db);
const userId = (await db.query<{ id: string }>("insert into users (email) values ('live@dandelist.test') returning id")).rows[0]!.id;
const client = new MetaClient({
  apiKey: process.env.MODEL_API_KEY!,
  onUsage: (u, c) => {
    console.log(`  usage: ${u.inputTokens} in, ${u.outputTokens} out, ${u.searches} searches, ~$${c.toFixed(4)}`);
    return recordSpend(db, userId, "dream", u, c, new Date());
  },
});
const apify = process.env.APIFY_TOKEN ? { token: process.env.APIFY_TOKEN, dailyUsd: 0.15 } : undefined;

const line = (s: string) => console.log(s);
function show(w: Widget) {
  if (w.kind === "deck") {
    line(`  DECK ${w.id} "${w.title}" round ${w.round}: ${w.cards.length} listings`);
    for (const c of w.cards) line(`    - ${c.title} | ${money(c.priceCents, c.currency)} | ${c.status} | ${c.source} | ${c.images.length} photos | ${c.facts.join(", ")} | ${c.url}`);
  } else if (w.kind === "wish_ready") {
    const x = w.wish;
    line(`  WISH ${x.name} | upfront ${money(x.upfrontCents, x.currency ?? "USD")} | ${x.status} | region ${x.region ?? "-"} | ${x.seller ?? ""} ${x.url ?? ""}`);
    for (const k of x.keep) line(`    keep: ${k.label} ${money(k.amountCents, x.currency ?? "USD")}/${k.period} ${k.estimate ? "(estimate)" : ""} | ${k.basis} | ${k.source?.url ?? "no source"}`);
  } else if (w.kind === "service_quote") {
    line(`  QUOTE ${w.service} in ${w.region}: ${w.summary} | ${w.images.length} photos`);
    for (const k of w.lines) line(`    line: ${k.label} ${money(k.amountCents, w.currency ?? "USD")}/${k.period} | ${k.basis} | ${k.source?.url ?? "no source"}`);
  } else if (w.kind === "car_builder") {
    line(`  CAR BUILDER ${w.id} (${w.currency})`);
    for (const s of w.steps) line(`    ${s.title}: ${s.choices.map((c) => `${c.label}${c.priceCents !== undefined ? ` ${money(c.priceCents, w.currency ?? "USD")}` : ""}${c.detail ? ` [${c.detail}]` : ""}`).join("; ")}${s.selected ? ` (selected ${s.selected})` : ""}`);
  } else if (w.kind === "home_builder") {
    line(`  HOME BUILDER ${w.id} for ${w.region}: styles ${w.styles.map((s) => `${s.label}${s.on ? "*" : ""}${s.imageUrl ? "(photo)" : ""}`).join(", ")} | features on: ${w.features.filter((f) => f.on).map((f) => f.label).join(", ")}`);
  } else line(`  WIDGET ${w.kind} ${JSON.stringify(w).slice(0, 200)}`);
}

const transcript: TranscriptEntry[] = [];
const state: DreamState = emptyState();
async function turn(action: DreamAction): Promise<Widget[]> {
  const out: Widget[] = [];
  const t0 = Date.now();
  const ctx: DreamCtx = {
    db,
    meta: { responses: (b) => (ctx.budget.meta(), client.responses(b)) },
    web: publicFetch,
    api: fetch,
    apify,
    userId,
    sessionId: "live",
    life: await readLife(db, userId),
    now: () => new Date(),
    budget: new TurnBudget(),
    emit: async (e: DreamEvent) => {
      if (e.type === "widget") {
        out.push(e.widget);
        show(e.widget);
      } else if (e.type === "step") line(`  step ${e.id} ${e.state}: ${e.text}`);
      else if (e.type === "text") line(`  TEXT: ${e.text}`);
      else if (e.type === "life") line(`  LIFE: ${JSON.stringify(e.life)}`);
      else if (e.type === "error") line(`  ERROR: ${e.message}`);
    },
    step: (id, s, text) => ctx.emit({ type: "step", id, state: s, text }),
  };
  line(`> ${JSON.stringify(action)}`);
  try {
    await runTurn(ctx, transcript, state, action);
  } catch (e) {
    line(`  THREW: ${(e as Error).message}`);
  }
  line(`  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${ctx.budget.metaCalls} Meta calls, ${ctx.budget.pageReads} page reads)`);
  return out;
}

const best = (d: Extract<Widget, { kind: "deck" }>) => d.cards.find((c) => c.status === "verified" && c.images.length) ?? d.cards[0];

async function villa() {
  let ws = await turn({ type: "message", text: "a modern sea-view villa in Malta with a pool and a wine cellar" });
  const hb = ws.find((w) => w.kind === "home_builder");
  if (hb) ws = await turn({ type: "builder", widgetId: hb.id, values: {} });
  const deck = ws.find((w): w is Extract<Widget, { kind: "deck" }> => w.kind === "deck");
  if (deck?.cards.length) await turn({ type: "pick", widgetId: deck.id, listingId: best(deck)!.id });
}

async function car() {
  let ws = await turn({ type: "message", text: "a black Mercedes G 63" });
  const cb = ws.find((w): w is Extract<Widget, { kind: "car_builder" }> => w.kind === "car_builder");
  if (cb) {
    const trim = cb.steps.find((s) => s.id === "trim")?.choices[0]?.id;
    ws = await turn({ type: "builder", widgetId: cb.id, values: { ...(trim ? { trim } : {}), done: true } });
    await turn({ type: "builder", widgetId: cb.id, values: { search: true } }).then((x) => (ws = x));
  }
  const deck = ws.find((w): w is Extract<Widget, { kind: "deck" }> => w.kind === "deck");
  if (deck?.cards.length) await turn({ type: "pick", widgetId: deck.id, listingId: best(deck)!.id });
}

async function security() {
  const ws = await turn({ type: "message", text: "private security for my family in Malta" });
  const q = ws.find((w) => w.kind === "service_quote");
  if (q) await turn({ type: "pick", widgetId: q.id });
}

const which = process.argv.slice(2);
const runs: Record<string, () => Promise<void>> = { villa, car, security };
for (const name of which.length ? which : Object.keys(runs)) {
  line(`\n===== ${name} =====`);
  await runs[name]!();
}
const spent = await db.query<{ model: string; s: string }>("select split_part(model, ':', 1) as model, sum(cost_usd) as s from spend_ledger group by 1");
for (const r of spent.rows) line(`spent on ${r.model}: ~$${Number(r.s).toFixed(4)}`);
const rates = await db.query<{ region: string; key: string; value: { amount?: number; unit?: string; currency?: string; verified?: boolean; found?: boolean }; source_url: string | null }>(
  "select region, key, value, source_url from region_rates order by region, key",
);
for (const r of rates.rows) line(`rate ${r.region}/${r.key}: ${r.value.found === false ? "not found" : `${r.value.amount} ${r.value.unit} ${r.value.currency ?? ""} verified=${r.value.verified}`} ${r.source_url ?? ""}`);
await db.end();
