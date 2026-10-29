/**
 * Compares ways of writing a wish's questions (the details that move its price, shown in the app's Refine panel)
 * against the real Meta API: each setup's speed (p50 and p90 of the call), its tokens, simple nonsense checks, and
 * every answer side by side for a person to judge as the domain expert would.
 *
 * Usage, from apps/api:
 *   MODEL_API_KEY=... npx tsx scripts/questions-eval.ts --setups production,baseline,spark-low,wonder-low
 *     [--wishes rolex-sub,porsche-911] [--out dir] [--tag name] [--today 2026-10-29] [--max-calls 60] [--concurrency 4]
 * `production` is exactly what the hunt sends (QUESTION_SETUP); `baseline` is the call as it was before 2026-10-29.
 *   npx tsx scripts/questions-eval.ts --report [--out dir] [--scores scores.json]   (no API calls)
 * Instead of MODEL_API_KEY, VAULT_GET may name a vault reader script that prints one secret to stdout and VAULT_ENTRY
 * the entry it reads: the script runs it itself and keeps the key in memory only. The key is never printed or written.
 * Spends Meta credit: a fraction of a cent to a few cents per call (muse-wonder-1.0 costs more; a web search $0.0025).
 * Scores are a person's, 0 to 10 per answer: real and current choices (4), the right details covered (3), each
 * question moving the price, biggest first, nothing they already said (3).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetaClient } from "@dandelist/meta";
import { QUESTION_SETUP, interpret, questionsOf, questionsRequest, tidyQuestions, type Draft, type QuestionSetup, type WishQuestion } from "../src/agent/agent";

interface EvalWish {
  id: string;
  text: string;
  category: string;
  /** What a top expert asks, biggest price mover first. The bar each answer is judged against. */
  expert: string;
  /** A label or choice matching this is nonsense for this wish. */
  never?: RegExp;
  /** Each pattern should match some label or choice: details an expert can't skip. */
  must?: RegExp[];
}

const WISHES: EvalWish[] = [
  { id: "rolex-sub", text: "a Rolex sub", category: "watch", expert: "Which Submariner (Date 126610LN, No-Date 124060, Starbucks 126610LV, two-tone Bluesy 126613LB, gold 126618LB, white gold 126619LB, older 116610LN/LV Hulk, 16610, vintage); new or pre-owned with box and papers; generation or year. Always on an Oyster bracelet, one 41 mm size.", never: /jubilee|president/i, must: [/126610|124060|no.?date/i, /pre.?owned|used/i] },
  { id: "patek-nautilus", text: "Patek Nautilus", category: "watch", expert: "Which reference (5811/1G white gold, 5711/1A steel discontinued 2021, 5712/1A, 5980, 5990/1A, 5726/1A, 7118/1A ladies); pre-owned with papers is the only real route for steel; year; dial.", never: /jubilee|oyster/i, must: [/5811|5711|5712|5980|5990|7118|5726/i] },
  { id: "ap-royal-oak", text: "AP Royal Oak", category: "watch", expert: "Which model and size (Selfwinding 41 15510ST, Jumbo 16202ST/15202ST, 37 mm, 34 mm, Chronograph 26240ST, Offshore); metal (steel, gold, titanium, ceramic); dial; new or pre-owned; year.", never: /jubilee|oyster/i, must: [/15510|16202|15202|15500|26240|15450|jumbo|chronograph/i] },
  { id: "rolex-datejust", text: "Rolex Datejust", category: "watch", expert: "Size (41, 36, 31, 28); metal (Oystersteel, white Rolesor fluted, yellow or Everose Rolesor, gold); bezel smooth or fluted; bracelet Oyster or Jubilee (President on gold); dial (diamonds cost more); new or pre-owned.", must: [/\b41\b|\b36\b/, /jubilee/i] },
  { id: "porsche-911", text: "a Porsche 911", category: "car", expert: "Trim (Carrera, Carrera T, Carrera S, 4S, GTS T-Hybrid, Turbo S, GT3, GT3 RS); new or used and model year (992.2 from 2025, 992.1, 991); body (coupe, cabriolet, Targa) and gearbox; big options.", never: /diesel/i, must: [/carrera/i, /gt3|turbo/i] },
  { id: "g-wagon", text: "G wagon", category: "car", expert: "Version (G 550, AMG G 63, electric G 580); new or used and model year (2025 update, 2019 W463A, older); Manufaktur and packages.", must: [/g ?63|amg/i, /g ?550|g ?580/i] },
  { id: "birkin", text: "Birkin", category: "bag", expert: "Boutique at retail or resale (resale is far higher); size 25, 30, 35 (40, Birkin 20); leather Togo, Epsom, Clemence, Swift or exotic (crocodile, alligator, ostrich, lizard); hardware gold or palladium; colour only for rare ones.", must: [/\b25\b|\b30\b/, /togo|epsom|clemence|croc/i] },
  { id: "leica-q", text: "Leica Q", category: "camera", expert: "Which model (Q3, Q3 43, Q3 Monochrom from November 2025, Q2 Monochrom, Q2, original Q); new or used; special editions.", must: [/q3/i, /monochrom/i] },
  { id: "cartier-love", text: "Cartier Love bracelet", category: "jewellery", expert: "Model (classic, small model, cuff); metal (yellow, rose, white gold); diamonds (none, 4, 10, paved); new or pre-owned. Size doesn't change the price.", must: [/yellow|rose|white/i, /diamond/i] },
  { id: "engagement-ring", text: "an engagement ring", category: "jewellery", expert: "Carat (1, 1.5, 2, 3); natural or lab-grown; shape (round, oval, emerald, cushion, pear); colour and clarity grade; setting and metal; maker (Tiffany, Cartier, Harry Winston or independent).", must: [/lab/i, /carat|\bct\b/i] },
  { id: "iphone", text: "iPhone", category: "tech", expert: "Which model in today's lineup (since September 2026: iPhone 18 Pro, 18 Pro Max and the foldable iPhone Duo, beside iPhone 17, Air and 17e); storage (256 GB to 2 TB); new or refurbished.", must: [/pro/i, /256|512|1 ?tb/i, /18|duo/i] },
  { id: "villa-malta", text: "villa in Malta", category: "home", expert: "Buy or rent; area (Madliena and Swieqi, Santa Maria Estate in Mellieha, Ta' Xbiex, Mdina and Attard, Gozo); bedrooms; pool and sea view; Special Designated Area for foreign buyers; new or converted farmhouse.", must: [/buy|rent/i] },
  { id: "paris-apartment", text: "apartment in Paris", category: "home", expert: "Buy or rent; arrondissement (6th, 7th, 8th, 16th, Marais or 11th, 18th); size or bedrooms; Haussmann building with lift, balcony, view; renovated.", must: [/buy|rent/i, /arrondissement|marais|\b(6|7|8|16)(th|e|ème)\b/i] },
  { id: "lisbon-week", text: "a week in Lisbon", category: "trip", expert: "Travellers; where to stay (named 5-star like Four Seasons Ritz, boutique, 4-star, apartment); flight class; month or season. Never the nights: a week was said.", never: /how many nights|how long|\bnights?\b\?|duration/i, must: [/economy|business/i] },
  { id: "japan-sakura", text: "Japan in cherry blossom season", category: "trip", expert: "Nights; travellers; where to stay (ryokan, 5-star like Aman or Park Hyatt, 4-star); flight class; cities. The season was said: only late March or early April.", never: /summer|autumn|fall|winter|july|august|october|november|december/i, must: [/night|week|days/i, /economy|business/i] },
  { id: "private-chef", text: "private chef", category: "service", expert: "Arrangement (one dinner, weekly meal prep, full-time or live-in); guests; menu level (3 courses, tasting menu, Michelin-trained); city.", must: [/dinner|event|weekly|full.?time|live.?in/i, /guest|people|\b\d+\s*(?:to|-)\s*\d+\b/i] },
  { id: "yacht-amalfi", text: "yacht charter Amalfi", category: "experience", expert: "Day or week; yacht size or type (traditional gozzo, 20 to 30 m motor yacht, 40 m+ superyacht, sailing catamaran); month (July and August peak); guests.", must: [/day/i, /week/i] },
  { id: "f1-monaco", text: "F1 Monaco paddock", category: "event", expert: "Which year's race (2027 is next, early June); days (Paddock Club sells 1, 2 or 3 days); people; the package (Paddock Club, its trackside yacht, a team's suite). Never grandstands: paddock was said. Never 2026: it has passed.", never: /grandstand|general admission|^2026$|2026 monaco/i, must: [/day|sunday|saturday/i] },
  { id: "banksy-print", text: "a Banksy print", category: "art", expert: "Which image (Girl with Balloon, Love is in the Air, Kids on Guns, Napalm, Choose Your Weapon...); signed or unsigned; with a Pest Control certificate; colourway or edition; condition.", must: [/signed/i] },
  { id: "riva", text: "a Riva speedboat", category: "boat", expert: "Which model (Iseo, El-Iseo, Aquariva, Rivamare, Dolceriva, or a classic Aquarama); new, pre-owned or restored classic; year; engines.", must: [/iseo|aquariva|rivamare|aquarama|dolceriva/i] },
  { id: "private-jet", text: "a private jet", category: "aircraft", expert: "How to fly (buy, fractional share, jet card, charter); size class (light like Phenom 300E, midsize, super-midsize like Challenger 3500, long range like G700 or Global 7500); new or pre-owned; hours a year.", must: [/charter|fractional|jet card|buy|own/i, /light|mid|long|phenom|challenger|gulfstream|global|citation/i] },
  { id: "harvard-mba", text: "Harvard MBA", category: "education", expert: "Programme (two-year full-time MBA, joint degrees, or executive education like AMP); entry year (Class of 2029 starts in 2027); living single or with family.", must: [/full.?time|two.?year|2.?year|executive|online/i] },
  { id: "tuscany-wedding", text: "a wedding in Tuscany", category: "wedding", expert: "Guests (50, 100, 150); venue (exclusive-use castle or villa, agriturismo, luxury resort); season and day; how many days of events; planner and service level.", must: [/\b\d{2,3}\b.*guest|guest/i, /villa|castle|castello|borgo|agriturismo|resort/i] },
  { id: "golden-puppy", text: "a golden retriever puppy", category: "pet", expert: "Health-tested breeder or rescue; pet home or breeding rights; American or English cream line; region.", must: [/breeder|rescue|adopt/i] },
  { id: "peloton-bikeplus", text: "a Peloton Bike+", category: "fitness", expert: "Which Bike+ (Cross Training Bike+ from October 2025, or the original); new or certified refurbished (or rental); accessories package. Never Bike or Bike+: they said Bike+.", never: /^(?:peloton )?bike$|^original bike$|bike \(standard\)/i, must: [/refurb|rent|new/i] },
  { id: "airpods-pro-3", text: "AirPods Pro 3", category: "tech", expert: "Almost nothing moves the price: at most new or refurbished. Never another model.", never: /pro 2|airpods 4|max/i },
];

/* ---------- the baseline: the questions call as it was before this comparison (2026-10-29) ---------- */

const strictObject = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const BASELINE_JSON = strictObject({
  questions: {
    type: "array",
    description: "Up to three details they didn't give that would change the price by more than about 10%. Empty when the wish is clear.",
    items: strictObject({
      id: { type: "string", description: "A short snake_case name, like 'bracelet' or 'condition'." },
      label: { type: "string", description: "The question in under eight words, like 'Which bracelet?'." },
      options: { type: "array", items: { type: "string" }, description: "2 to 5 short choices, the most common first." },
      picked: { type: "string", description: "The choice most people mean, copied exactly from options." },
    }),
  },
});
const baselineRequest = (draft: Draft) => ({
  model: "muse-spark-1.3",
  instructions:
    "You help price a wish. List up to three details the person didn't give that would change the price by more than about 10% (for a watch: the reference or metal, the bracelet, new or pre-owned; for a trip: the nights and the hotel class), each with 2 to 5 short choices, the most common first. Pick for each the choice most people mean. Never ask about something they said. Empty when the wish is clear.",
  input: `Wish: ${JSON.stringify({ title: draft.title, kind: draft.kind, summary: draft.summary, specifics: draft.specifics })}`,
  text: { format: { type: "json_schema", name: "wish_questions", schema: BASELINE_JSON, strict: true } },
});

/* ---------- the setups compared ---------- */

interface Setup {
  /** What the call reads: the person's words (the hunt asks at once), or the draft read before (the old way). */
  input: "words" | "draft";
  body(w: EvalWish, draft: Draft | null, today: Date): Record<string, unknown>;
}
const expert = (setup: QuestionSetup, input: Setup["input"] = "words"): Setup => ({
  input,
  body: (w, draft, today) => questionsRequest(input === "words" ? { text: w.text, homeCurrency: "USD" } : { draft: draft!, homeCurrency: "USD" }, today, setup),
});
const SETUPS: Record<string, Setup> = {
  /** Exactly what the hunt sends today. */
  production: expert(QUESTION_SETUP),
  baseline: { input: "draft", body: (_w, draft) => baselineRequest(draft!) },
  spark: expert({ model: "muse-spark-1.3" }),
  "spark-minimal": expert({ model: "muse-spark-1.3", effort: "minimal" }),
  "spark-low": expert({ model: "muse-spark-1.3", effort: "low" }),
  "spark-medium": expert({ model: "muse-spark-1.3", effort: "medium" }),
  "spark-high": expert({ model: "muse-spark-1.3", effort: "high" }),
  "spark-search": expert({ model: "muse-spark-1.3", search: true }),
  "spark-low-search": expert({ model: "muse-spark-1.3", effort: "low", search: true }),
  "spark-draft": expert({ model: "muse-spark-1.3" }, "draft"),
  wonder: expert({ model: "muse-wonder-1.0" }),
  "wonder-low": expert({ model: "muse-wonder-1.0", effort: "low" }),
  "wonder-search": expert({ model: "muse-wonder-1.0", search: true }),
};

/* ---------- running ---------- */

interface Row {
  tag: string;
  setup: string;
  wish: string;
  at: string;
  ms: number;
  ok: boolean;
  error?: string;
  questions: WishQuestion[];
  /** How many questions the model wrote before tidying. */
  written: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  searches: number;
  costUsd: number;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const OUT = arg("out") ?? join(tmpdir(), "dandelist-questions-eval");
const RESULTS = join(OUT, "results.jsonl");
const DRAFTS = join(OUT, "drafts.json");
mkdirSync(OUT, { recursive: true });

/** The key, from the environment or the vault reader, held in memory only. */
function apiKey(): string {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY;
  const reader = process.env.VAULT_GET;
  const entry = process.env.VAULT_ENTRY;
  if (!reader || !entry) throw new Error("Set MODEL_API_KEY, or VAULT_GET to a vault reader script and VAULT_ENTRY to the entry it reads.");
  const key = execFileSync(process.execPath, [reader, entry], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!key) throw new Error("The vault reader returned nothing.");
  return key;
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};

const textOf = (qs: WishQuestion[]) => qs.flatMap((q) => [q.label, ...q.options]);
function checks(w: EvalWish, qs: WishQuestion[]) {
  const all = textOf(qs);
  const nonsense = w.never ? all.filter((t) => w.never!.test(t)) : [];
  const missing = (w.must ?? []).filter((re) => !all.some((t) => re.test(t))).map(String);
  return { nonsense, missing };
}

function readRows(): Row[] {
  if (!existsSync(RESULTS)) return [];
  return readFileSync(RESULTS, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
}

function report(rows: Row[], scores: Record<string, Record<string, number>> = {}) {
  const bySetup = new Map<string, Row[]>();
  for (const r of rows) bySetup.set(`${r.tag}/${r.setup}`, [...(bySetup.get(`${r.tag}/${r.setup}`) ?? []), r]);
  const lines = ["setup | calls | errors | p50 ms | p90 ms | mean out tok | mean reasoning tok | mean questions | nonsense | missing | expert score"];
  for (const [key, rs] of bySetup) {
    const ok = rs.filter((r) => r.ok);
    const ms = rs.map((r) => r.ms);
    const wishMap = new Map(WISHES.map((w) => [w.id, w]));
    const c = ok.map((r) => checks(wishMap.get(r.wish)!, r.questions));
    const s = scores[key] ?? scores[key.split("/")[1]!] ?? {};
    const scored = ok.map((r) => s[r.wish]).filter((x): x is number => typeof x === "number");
    lines.push(
      [
        key,
        rs.length,
        rs.length - ok.length,
        Math.round(percentile(ms, 50)),
        Math.round(percentile(ms, 90)),
        Math.round(ok.reduce((a, r) => a + r.outputTokens, 0) / Math.max(1, ok.length)),
        Math.round(ok.reduce((a, r) => a + r.reasoningTokens, 0) / Math.max(1, ok.length)),
        (ok.reduce((a, r) => a + r.questions.length, 0) / Math.max(1, ok.length)).toFixed(1),
        c.filter((x) => x.nonsense.length).length,
        c.filter((x) => x.missing.length).length,
        scored.length ? `${(scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2)} (${scored.length})` : "-",
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

function sideBySide(rows: Row[]) {
  const out: string[] = [];
  for (const w of WISHES) {
    const rs = rows.filter((r) => r.wish === w.id);
    if (!rs.length) continue;
    out.push(`\n==== ${w.text} (${w.id}, ${w.category})\nEXPERT: ${w.expert}`);
    for (const r of rs) {
      const c = checks(w, r.questions);
      out.push(`-- ${r.tag}/${r.setup}: ${Math.round(r.ms)} ms${r.ok ? "" : ` ERROR ${r.error}`}${c.nonsense.length ? ` NONSENSE[${c.nonsense.join("; ")}]` : ""}${c.missing.length ? ` MISSING[${c.missing.join(" ")}]` : ""}`);
      for (const q of r.questions) out.push(`   ${q.label}  =>  ${q.options.map((o) => (o === q.picked ? `*${o}*` : o)).join(" | ")}`);
    }
  }
  return out.join("\n");
}

async function main() {
  if (flag("report")) {
    const scoresFile = arg("scores");
    const scores = scoresFile ? (JSON.parse(readFileSync(scoresFile, "utf8")) as Record<string, Record<string, number>>) : {};
    const rows = readRows();
    const tags = arg("tags")?.split(",");
    const shown = tags ? rows.filter((r) => tags.includes(r.tag)) : rows;
    console.log(report(shown, scores));
    writeFileSync(join(OUT, "side-by-side.txt"), sideBySide(shown));
    console.log(`side by side: ${join(OUT, "side-by-side.txt")}`);
    return;
  }

  const setups = (arg("setups") ?? "baseline,spark").split(",").map((s) => s.trim());
  for (const s of setups) if (!SETUPS[s]) throw new Error(`Unknown setup ${s}. Known: ${Object.keys(SETUPS).join(", ")}`);
  const wanted = arg("wishes")?.split(",").map((s) => s.trim());
  const wishes = wanted ? WISHES.filter((w) => wanted.includes(w.id)) : WISHES;
  const tag = arg("tag") ?? new Date().toISOString().slice(0, 16);
  const maxCalls = Number(arg("max-calls") ?? 60);
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 4));
  const today = arg("today") ? new Date(`${arg("today")}T12:00:00Z`) : new Date();

  let calls = 0;
  let spent = 0;
  const meta = new MetaClient({ apiKey: apiKey(), onUsage: (_u, c) => void (spent += c) });
  const budget = () => {
    if (calls >= maxCalls) throw new Error(`Stopped at --max-calls ${maxCalls}.`);
    calls++;
  };

  // Drafts are read once per wish and kept, so every setup that reads a draft sees the same one.
  const drafts: Record<string, Draft> = existsSync(DRAFTS) ? JSON.parse(readFileSync(DRAFTS, "utf8")) : {};
  const needDrafts = setups.some((s) => SETUPS[s]!.input === "draft");
  if (needDrafts) {
    const missing = wishes.filter((w) => !drafts[w.id]);
    const interpretMs: number[] = [];
    await pool(missing, concurrency, async (w) => {
      budget();
      const t = performance.now();
      try {
        drafts[w.id] = await interpret(meta, w.text);
        interpretMs.push(performance.now() - t);
      } catch (e) {
        console.log(`could not read ${w.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      }
    });
    writeFileSync(DRAFTS, JSON.stringify(drafts, null, 1));
    if (interpretMs.length) console.log(`read ${interpretMs.length} drafts: p50 ${Math.round(percentile(interpretMs, 50))} ms, p90 ${Math.round(percentile(interpretMs, 90))} ms`);
  }

  const jobs = setups.flatMap((setup) => wishes.filter((w) => SETUPS[setup]!.input === "words" || drafts[w.id]).map((w) => ({ setup, w })));
  const rows: Row[] = [];
  await pool(jobs, concurrency, async ({ setup, w }) => {
    budget();
    const body = SETUPS[setup]!.body(w, drafts[w.id] ?? null, today);
    const t = performance.now();
    const row: Row = { tag, setup, wish: w.id, at: new Date().toISOString(), ms: 0, ok: false, questions: [], written: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, searches: 0, costUsd: 0 };
    try {
      const res = await meta.responses(body);
      row.ms = performance.now() - t;
      let written: unknown;
      try {
        written = questionsOf(res.text);
      } catch (e) {
        throw new Error(`${(e as Error).message}; the answer began: ${res.text.slice(0, 160)}`);
      }
      row.written = Array.isArray(written) ? written.length : 0;
      row.questions = tidyQuestions(written);
      row.ok = true;
      const usage = ((res.raw ?? {}) as { usage?: { output_tokens_details?: { reasoning_tokens?: number } } }).usage;
      Object.assign(row, { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0, searches: res.usage.searches, costUsd: res.costUsd });
    } catch (e) {
      row.ms = performance.now() - t;
      // Only the API's own message; nothing here carries the key.
      row.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    rows.push(row);
    appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);
    console.log(`${setup.padEnd(16)} ${w.id.padEnd(18)} ${String(Math.round(row.ms)).padStart(6)} ms  ${row.ok ? `${row.questions.length} questions` : `ERROR ${row.error}`}`);
  });

  console.log(`\n${report(rows)}`);
  writeFileSync(join(OUT, `side-by-side-${tag.replace(/[^a-z0-9-]/gi, "_")}.txt`), sideBySide(rows));
  console.log(`\n${calls} Meta calls, about $${spent.toFixed(4)}. Results: ${RESULTS}`);
}

/** Runs `work` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

await main();
