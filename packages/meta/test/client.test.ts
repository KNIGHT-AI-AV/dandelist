import { describe, expect, it } from "vitest";
import { MetaApiError, MetaClient, parseResponses } from "../src/client";
import { estimateCostUsd } from "../src/pricing";

const sample = {
  id: "resp_1",
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "B&H lists it at $5,995.",
          annotations: [{ type: "url_citation", url: "https://example.com/q3", title: "Leica Q3" }],
        },
      ],
    },
    { type: "function_call", call_id: "call_1", name: "get_page", arguments: '{"url":"https://example.com/q3"}' },
  ],
  usage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 500 } },
};

describe("parseResponses", () => {
  it("reads text, citations, function calls, searches and usage", () => {
    const r = parseResponses(sample, "muse-spark-1.3");
    expect(r.text).toBe("B&H lists it at $5,995.");
    expect(r.citations).toEqual([{ url: "https://example.com/q3", title: "Leica Q3" }]);
    expect(r.functionCalls).toEqual([{ callId: "call_1", name: "get_page", arguments: '{"url":"https://example.com/q3"}' }]);
    expect(r.usage).toEqual({ model: "muse-spark-1.3", inputTokens: 2000, cachedInputTokens: 500, outputTokens: 300, searches: 1 });
  });

  it("prices tokens and searches from Meta's published rates", () => {
    const cost = estimateCostUsd({ model: "muse-spark-1.3", inputTokens: 2000, cachedInputTokens: 500, outputTokens: 300, searches: 1 });
    // 1500 x 1.25 + 500 x 0.15 + 300 x 4.25, per million, plus one search at $2.50 per thousand
    expect(cost).toBeCloseTo((1500 * 1.25 + 500 * 0.15 + 300 * 4.25) / 1e6 + 0.0025, 10);
  });
});

describe("MetaClient", () => {
  it("sends the key as a bearer token, defaults the model and reports usage", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    let reported = 0;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ apiKey: "test-key", fetch: fakeFetch, onUsage: (_u, c) => void (reported = c) });
    const r = await client.responses({ input: "hi" });
    expect(seen?.url).toBe("https://api.meta.ai/v1/responses");
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(seen?.init.body)).model).toBe("muse-spark-1.3");
    expect(reported).toBeCloseTo(r.costUsd, 12);
  });

  it("prices SAM 3.1 per image segmented", async () => {
    const sam = { id: "resp_sam", output: [{ type: "message", content: [{ type: "output_text", text: "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=4;h=4|>" }] }], usage: { input_tokens: 0, output_tokens: 0, images_processed: 1 } };
    const r = parseResponses(sam, "sam-3.1");
    expect(r.usage.images).toBe(1);
    expect(r.costUsd).toBeCloseTo(0.0025, 10);
  });

  it("generates images, decodes them and reports a flat price per image", async () => {
    let seen: { url: string; body: Record<string, unknown> } | undefined;
    let reported = 0;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ created: 1, output_format: "webp", data: [{ b64_json: Buffer.from("RIFFxxxxWEBP").toString("base64") }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MetaClient({ apiKey: "k", fetch: fakeFetch, onUsage: (_u, c) => void (reported = c) });
    const r = await client.images("generations", { prompt: "a camera" });
    expect(seen?.url).toBe("https://api.meta.ai/v1/images/generations");
    expect(seen?.body).toEqual({ model: "muse-image-1.0", n: 1, prompt: "a camera" });
    expect(r.images.map((b) => b.toString())).toEqual(["RIFFxxxxWEBP"]);
    expect(r.format).toBe("webp");
    expect(r.costUsd).toBeCloseTo(0.01, 10);
    expect(reported).toBeCloseTo(0.01, 10);
  });

  it("retries a 503 once, and only once", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response('{"error":{"message":"persistence service error"}}', { status: 503 }) : new Response(JSON.stringify(sample), { status: 200 }))) as unknown as typeof fetch;
    expect((await new MetaClient({ apiKey: "k", fetch: flaky, retryDelayMs: 0 }).responses({ input: "hi" })).text).toBe("B&H lists it at $5,995.");
    expect(calls).toBe(2);
    calls = 0;
    const down = (async () => (calls++, new Response("{}", { status: 503 }))) as unknown as typeof fetch;
    await expect(new MetaClient({ apiKey: "k", fetch: down, retryDelayMs: 0 }).responses({ input: "hi" })).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(2);
  });

  it("raises MetaApiError with the status on failure", async () => {
    const fakeFetch = (async () => new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch;
    const client = new MetaClient({ apiKey: "x", fetch: fakeFetch });
    await expect(client.responses({ input: "hi" })).rejects.toBeInstanceOf(MetaApiError);
  });
});
