/**
 * Day-one check against the real Meta Model API: a plain reply, structured JSON output, and built-in web search.
 * Run with MODEL_API_KEY set: pnpm meta:smoke. Spends well under one cent.
 */
import { MetaClient, MetaApiError, type ResponsesResult } from "../src/index";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) {
  console.error("Set MODEL_API_KEY first (vault entry accounting/meta-model-api).");
  process.exit(1);
}

let spent = 0;
const client = new MetaClient({ apiKey, onUsage: (_u, cost) => void (spent += cost) });

const priceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["item", "price_usd"],
  properties: { item: { type: "string" }, price_usd: { type: "number" } },
};

async function check(name: string, run: () => Promise<ResponsesResult>, ok: (r: ResponsesResult) => boolean) {
  try {
    const r = await run();
    console.log(`${ok(r) ? "PASS" : "WARN"} ${name}: ${r.text.slice(0, 160).replace(/\s+/g, " ")}`);
    console.log(`     tokens in ${r.usage.inputTokens} out ${r.usage.outputTokens}, searches ${r.usage.searches}, citations ${r.citations.length}, ~$${r.costUsd.toFixed(5)}`);
    return true;
  } catch (e) {
    console.log(`FAIL ${name}: ${e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 300)}` : String(e)}`);
    return false;
  }
}

await check("plain reply", () => client.responses({ input: "Reply with exactly one word: ready" }), (r) => /ready/i.test(r.text));

const structuredOk = await check(
  "structured output (text.format)",
  () => client.responses({
    input: "A Leica Q3 camera costs about 5995 US dollars. Return the item and price.",
    text: { format: { type: "json_schema", name: "price", schema: priceSchema, strict: true } },
  }),
  (r) => typeof JSON.parse(r.text).price_usd === "number",
);
if (!structuredOk) {
  await check(
    "structured output (response_format fallback)",
    () => client.responses({
      input: "A Leica Q3 camera costs about 5995 US dollars. Return the item and price.",
      response_format: { type: "json_schema", json_schema: { name: "price", schema: priceSchema, strict: true } },
    }),
    (r) => typeof JSON.parse(r.text).price_usd === "number",
  );
}

await check(
  "built-in web_search",
  () => client.responses({
    input: "Find the current US price of a new Leica Q3 camera at two retailers. Give each price with its source link.",
    tools: [{ type: "web_search" }],
  }),
  (r) => r.citations.length > 0 || /https?:\/\//.test(r.text),
);

console.log(`Estimated spend for this run: $${spent.toFixed(4)}`);
