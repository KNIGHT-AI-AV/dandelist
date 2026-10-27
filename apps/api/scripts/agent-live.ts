/**
 * Runs the wish agent once against the real Meta API and the real web, without a database, and prints its trail.
 * Usage: MODEL_API_KEY=... [APIFY_TOKEN=...] [MEDIA_DIR=./.media MEDIA_CUTOUTS=1 MEDIA_GENERATE=1 MEDIA_UPSCALE=1]
 *   tsx scripts/agent-live.ts "a peloton bike plus"
 * Spends a few cents of Meta credit, and with APIFY_TOKEN about 2 cents of Apify's free credit per shopping search.
 */
import { MetaClient } from "@dandelist/meta";
import { clarify, interpret, research } from "../src/agent/agent";
import { shoppingSearch } from "../src/agent/shopping";
import { fileMediaStore } from "../src/media-store";

const wish = process.argv[2] ?? "a Peloton Bike+";
const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test(v ?? "");
let spent = 0;
let shopSpent = 0;
const meta = new MetaClient({ apiKey: process.env.MODEL_API_KEY!, onUsage: (_u, c) => void (spent += c) });
const t0 = Date.now();
const draft = await interpret(meta, wish);
console.log("draft:", JSON.stringify(draft));
const questions = await clarify(meta, draft);
console.log("questions:", JSON.stringify(questions));
const answers = questions.map((q) => ({ question: q.question, answer: q.choices[0]! }));
const token = process.env.APIFY_TOKEN;
const shopping = token
  ? async (query: string) => {
      const r = await shoppingSearch(query, draft.region, draft.currency, { token });
      shopSpent += r.costUsd;
      return r.offers;
    }
  : undefined;
const media = process.env.MEDIA_DIR
  ? { store: fileMediaStore(process.env.MEDIA_DIR, "http://localhost:8080"), cutouts: on(process.env.MEDIA_CUTOUTS), generate: on(process.env.MEDIA_GENERATE), upscale: on(process.env.MEDIA_UPSCALE) }
  : undefined;
const result = await research(meta, { draft, answers, now: () => new Date(), shopping, media, onStep: (s) => console.log("  step", JSON.stringify(s)) });
for (const o of result.options) {
  console.log(`option: ${o.label} | ${o.seller} | ${o.status} (${o.statusLabel}) | ${o.source.currency} ${o.source.price} | upfront ${o.upfrontCents} | monthly ${Math.round(o.totals.monthlyCents)} | 5y ${Math.round(o.totals.horizonCents)} | ${o.url}`);
  for (const p of o.parts ?? []) console.log(`  part: ${p.kind} ${p.label} | ${p.seller} | ${p.status} (${p.statusLabel}) | ${p.source.currency} ${p.source.price} x ${p.quantity} ${p.unit} = ${p.totalCents} cents | ${p.url}`);
  const m = o.media;
  if (!m) continue;
  console.log(`  media: ${m.kind}, ${m.images.length} images${m.model3d ? `, 3D "${m.model3d.name}" by ${m.model3d.author} (${m.model3d.license}) ${m.model3d.embedUrl}` : ", no 3D"}${m.cutout ? `, cutout ${m.cutout.width}x${m.cutout.height} from ${m.cutout.from}` : ""}`);
  for (const i of m.images) console.log(`    ${i.width}x${i.height} ${i.source}${i.generated ? " GENERATED" : ""}${i.clean ? " clean" : ""} | ${i.credit ?? ""} | ${i.license ?? ""} | ${i.url}`);
}
console.log("explanation:", result.explanation);
console.log("note:", result.note);
console.log(`spent ~$${spent.toFixed(4)} Meta + ~$${shopSpent.toFixed(4)} Apify in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
