/**
 * Runs the wish agent once against the real Meta API and the real web, without a database, and prints its
 * trail. Usage: MODEL_API_KEY=... tsx scripts/agent-live.ts "a peloton bike plus". Spends a few cents.
 */
import { MetaClient } from "@dandelist/meta";
import { clarify, interpret, research } from "../src/agent/agent";

const wish = process.argv[2] ?? "a Peloton Bike+";
let spent = 0;
const meta = new MetaClient({ apiKey: process.env.MODEL_API_KEY!, onUsage: (_u, c) => void (spent += c) });
const t0 = Date.now();
const draft = await interpret(meta, wish);
console.log("draft:", JSON.stringify(draft));
const questions = await clarify(meta, draft);
console.log("questions:", JSON.stringify(questions));
const answers = questions.map((q) => ({ question: q.question, answer: q.choices[0]! }));
const result = await research(meta, { draft, answers, now: () => new Date(), onStep: (s) => console.log("  step", JSON.stringify(s)) });
for (const o of result.options) console.log(`option: ${o.label} | ${o.seller} | ${o.status} | upfront ${o.upfrontCents} | monthly ${Math.round(o.totals.monthlyCents)} | 5y ${Math.round(o.totals.horizonCents)} | ${o.url}`);
console.log("explanation:", result.explanation);
console.log("note:", result.note);
console.log(`spent ~$${spent.toFixed(4)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
