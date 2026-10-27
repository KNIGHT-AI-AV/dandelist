/**
 * Checks the Responses API features the wish agent depends on: a function tool call, continuing a turn with
 * previous_response_id and a function_call_output, and web_search alongside function tools.
 * Run with MODEL_API_KEY set. Spends about a cent.
 */
import { MetaClient, MetaApiError } from "../src/index";

const client = new MetaClient({ apiKey: process.env.MODEL_API_KEY! });
const getPage = {
  type: "function",
  name: "get_page",
  description: "Open a web page and return its visible text.",
  parameters: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } },
  strict: true,
};

try {
  const first = await client.responses({
    input: "Open https://example.com with get_page and tell me its heading.",
    tools: [getPage],
  });
  console.log("function call:", JSON.stringify(first.functionCalls), "text:", first.text.slice(0, 80));
  const call = first.functionCalls[0];
  if (call) {
    const second = await client.responses({
      previous_response_id: first.id,
      input: [{ type: "function_call_output", call_id: call.callId, output: "Example Domain. This domain is for use in illustrative examples." }],
      tools: [getPage],
    });
    console.log("continued:", second.text.slice(0, 120));
  }
} catch (e) {
  console.log("FAIL function loop:", e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 400)}` : e);
}

try {
  const mixed = await client.responses({
    input: "Find the current US price of a Peloton Bike+ . Search the web, then call get_page on the best product page.",
    tools: [{ type: "web_search" }, getPage],
  });
  const raw = mixed.raw as { output?: { type: string }[] };
  console.log("mixed output types:", raw.output?.map((o) => o.type).join(","), "calls:", JSON.stringify(mixed.functionCalls).slice(0, 300));
  console.log("cost ~$" + mixed.costUsd.toFixed(4));
} catch (e) {
  console.log("FAIL mixed:", e instanceof MetaApiError ? `${e.status} ${e.body.slice(0, 400)}` : e);
}
