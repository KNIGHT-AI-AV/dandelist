import { describe, expect, it } from "vitest";
import { CLAUDE_FAST_BETA, CLAUDE_MAX_TOKENS, CLAUDE_MODEL, ClaudeApiError, ClaudeClient, ClaudeHistory, ClaudeImageError, claudeSchema, isClaudeResponseId } from "../src/claude";
import { MetaApiError } from "../src/client";
import { CLAUDE_PRICES, CLAUDE_SEARCH_PRICE, claudeCostUsd } from "../src/pricing";

// ---------------------------------------------------------------- a fake Claude, behind the real SDK

type Json = Record<string, any>;
type Sent = { url: string; headers: Headers; body: Json };

const usage = (over: Json = {}) => ({
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  ...over,
});
const message = (content: unknown[], over: Json = {}) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: CLAUDE_MODEL,
  content,
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: usage(),
  ...over,
});

/** A fetch that answers each Messages call with the next reply (a message, or a Response for an error). */
function fakeClaude(...replies: (Json | Response)[]) {
  const sent: Sent[] = [];
  const fetch = (async (url: string | URL, init: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (!next) return new Response('{"type":"error","error":{"type":"api_error","message":"no reply left"}}', { status: 500, headers: { "content-type": "application/json" } });
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const client = (fetch: typeof globalThis.fetch, more: Partial<ConstructorParameters<typeof ClaudeClient>[0]> = {}) =>
  new ClaudeClient({ apiKey: "test-key", fetch, maxRetries: 0, history: new ClaudeHistory(), ...more });

const GET_PAGE = {
  type: "function",
  name: "get_page",
  description: "Open a public web page.",
  parameters: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string", minLength: 8, maxLength: 2000 } } },
  strict: true,
};

describe("the request Claude gets", () => {
  it("is Opus 5.5 at low effort in fast mode, with the instructions as its system prompt and no thinking setting", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "Hello." }]));
    await client(claude.fetch).responses({ instructions: "Be brief.", input: "hi", reasoning: { effort: "high" }, include: ["web_search_call.results"] });
    const { url, headers, body } = claude.sent[0]!;
    expect(url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-beta")).toContain(CLAUDE_FAST_BETA);
    expect(body).toMatchObject({ model: "claude-opus-5-5", max_tokens: CLAUDE_MAX_TOKENS, speed: "fast", system: "Be brief.", output_config: { effort: "low" } });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    // Thinking can't be turned off on Opus 5.5, so the request leaves it to the model; nothing forces a tool either.
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("include");
  });

  it("runs at standard speed, without the fast beta, when fast mode is off", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "Hello." }]));
    await client(claude.fetch, { fast: false }).responses({ input: "hi" });
    expect(claude.sent[0]!.body).not.toHaveProperty("speed");
    expect(claude.sent[0]!.headers.get("anthropic-beta") ?? "").not.toContain(CLAUDE_FAST_BETA);
  });

  it("turns message items into messages, pictures included", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "B" }]));
    await client(claude.fetch).responses({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Which is it?" }, { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" }] },
        { role: "user", content: [{ type: "input_image", image_url: "https://example.com/watch.jpg" }] },
      ],
    });
    expect(claude.sent[0]!.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Which is it?" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
          { type: "image", source: { type: "url", url: "https://example.com/watch.jpg" } },
        ],
      },
    ]);
  });

  it("offers function tools and the web search, capped by max_tool_calls, with schemas Claude accepts", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "ok" }]));
    await client(claude.fetch).responses({ input: "find it", tools: [{ type: "web_search" }, GET_PAGE, { type: "file_search" }], max_tool_calls: 2 });
    expect(claude.sent[0]!.body.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 2 },
      {
        name: "get_page",
        description: "Open a public web page.",
        input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } },
        strict: true,
      },
    ]);
    // A request with tools may be followed by another, so it is cached.
    expect(claude.sent[0]!.body.cache_control).toEqual({ type: "ephemeral" });
  });

  it("asks for JSON through output_config.format", async () => {
    const claude = fakeClaude(message([{ type: "text", text: '{"facts":["a","b","c"]}' }]));
    const schema = { type: "object", additionalProperties: false, required: ["facts"], properties: { facts: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } } };
    const r = await client(claude.fetch).responses({ input: "facts", text: { format: { type: "json_schema", name: "facts", schema, strict: true } } });
    expect(claude.sent[0]!.body.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["facts"], properties: { facts: { type: "array", items: { type: "string" } } } } },
    });
    expect(JSON.parse(r.text)).toEqual({ facts: ["a", "b", "c"] });
  });
});

describe("JSON beside the web search", () => {
  const schema = { type: "object", additionalProperties: false, required: ["pick"], properties: { pick: { type: "string" } } };
  const format = { format: { type: "json_schema", name: "pick", schema, strict: true } };

  it("asks for JSON in the system prompt instead of output_config.format, and reads the JSON out of the answer", async () => {
    const claude = fakeClaude(message([{ type: "text", text: 'Here it is:\n```json\n{ "pick": "Leica Q3" }\n```' }]));
    const r = await client(claude.fetch).responses({ instructions: "Pick one.", input: "pick", tools: [{ type: "web_search" }], text: format });
    const body = claude.sent[0]!.body;
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.system).toMatch(/^Pick one\.\n/);
    expect(body.system).toContain(JSON.stringify(schema));
    expect(body.system).toMatch(/only/i);
    expect(r.text).toBe('{"pick":"Leica Q3"}');
  });

  it("on a follow-up that keeps the web search, asks in a system message after the turn and leaves the first prompt alone", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "found it" }]), message([{ type: "text", text: '{"pick":"Leica Q3"}' }]));
    const c = client(claude.fetch);
    const first = await c.responses({ instructions: "Find it.", input: "camera", tools: [{ type: "web_search" }] });
    const r = await c.responses({ previous_response_id: first.id, input: [{ role: "user", content: "Return JSON." }], text: format });
    const body = claude.sent[1]!.body;
    expect(body.system).toBe("Find it.");
    expect(body.output_config).toEqual({ effort: "low" });
    const last = body.messages.at(-1);
    expect(last.role).toBe("system");
    expect(last.content).toContain(JSON.stringify(schema));
    expect(r.text).toBe('{"pick":"Leica Q3"}');
  });

  it("keeps output_config.format when only function tools are offered", async () => {
    const claude = fakeClaude(message([{ type: "text", text: '{"pick":"x"}' }]));
    await client(claude.fetch).responses({ input: "pick", tools: [GET_PAGE], text: format });
    expect(claude.sent[0]!.body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
  });

  it("hands back the answer as written when it holds no JSON, for the route to judge", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "Nothing turned up." }]));
    const r = await client(claude.fetch).responses({ input: "pick", tools: [{ type: "web_search" }], text: format });
    expect(r.text).toBe("Nothing turned up.");
  });
});

describe("pictures", () => {
  it("refuses one Claude can't read before sending it: only JPEG, PNG, GIF and WebP, up to about 3.7 MB", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "ok" }]), message([{ type: "text", text: "ok" }]));
    const c = client(claude.fetch);
    const ask = (image_url: string) => c.responses({ input: [{ role: "user", content: [{ type: "input_text", text: "Which is it?" }, { type: "input_image", image_url }] }] });
    for (const url of ["data:image/avif;base64,AAAA", `data:image/jpeg;base64,${"A".repeat(5_200_000)}`, "https://example.com/watch.avif?w=800"]) {
      const err = await ask(url).catch((e) => e);
      expect(err).toBeInstanceOf(ClaudeImageError);
      // Not an API error: the photo check reads it as a photo it couldn't verify, and nothing was sent or spent.
      expect(err).not.toBeInstanceOf(MetaApiError);
    }
    expect(claude.sent).toHaveLength(0);
    await ask("data:image/png;base64,AAAA");
    await ask("https://example.com/watch.jpg");
    expect(claude.sent).toHaveLength(2);
  });
});

describe("claudeSchema", () => {
  it("drops only what structured outputs refuse, and keeps enums, constants and small minItems", () => {
    expect(
      claudeSchema({
        type: "object",
        properties: {
          n: { type: "integer", minimum: 0, maximum: 3, multipleOf: 1 },
          s: { type: "string", enum: ["a", "b"], minLength: 1, format: "uri" },
          odd: { type: "string", format: "currency" },
          list: { type: "array", minItems: 1, maxItems: 5, items: { anyOf: [{ type: "string", maxLength: 3 }, { type: "null" }] } },
          k: { const: "x" },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        n: { type: "integer" },
        s: { type: "string", enum: ["a", "b"], format: "uri" },
        odd: { type: "string" },
        list: { type: "array", minItems: 1, items: { anyOf: [{ type: "string" }, { type: "null" }] } },
        k: { const: "x" },
      },
    });
  });
});

describe("the reply the routes get", () => {
  const searched = [
    { type: "text", text: "Let me look." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Leica Q3 price" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_1",
      content: [
        { type: "web_search_result", url: "https://shop.example/q3", title: "Leica Q3 | Shop", encrypted_content: "enc1", page_age: null },
        { type: "web_search_result", url: "https://other.example/q3", title: "Q3 review", encrypted_content: "enc2", page_age: "May 2026" },
      ],
    },
    { type: "text", text: "B&H lists it at " },
    {
      type: "text",
      text: "$5,995.",
      citations: [{ type: "web_search_result_location", url: "https://shop.example/q3", title: "Leica Q3 | Shop", cited_text: "$5,995", encrypted_index: "i1" }],
    },
    { type: "tool_use", id: "toolu_1", name: "get_page", input: { url: "https://shop.example/q3" } },
  ];

  it("reads text, citations, tool calls and searches, and keeps a Responses-shaped raw for the search readers", async () => {
    const claude = fakeClaude(message(searched, { stop_reason: "tool_use", usage: usage({ server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }) }));
    const r = await client(claude.fetch).responses({ input: "price it", tools: [{ type: "web_search" }, GET_PAGE] });
    expect(isClaudeResponseId(r.id)).toBe(true);
    expect(r.text).toBe("Let me look. B&H lists it at $5,995.");
    expect(r.citations).toEqual([{ url: "https://shop.example/q3", title: "Leica Q3 | Shop" }]);
    expect(r.functionCalls).toEqual([{ callId: "toolu_1", name: "get_page", arguments: '{"url":"https://shop.example/q3"}' }]);
    expect(r.searchQueries).toEqual(["Leica Q3 price"]);
    expect(r.usage).toMatchObject({ model: "claude-opus-5-5", searches: 1 });
    // The routes read the pages a search returned from raw.output, as they do Meta's (dream/context.ts searchResults).
    const calls = (r.raw as Json).output.filter((o: Json) => o.type === "web_search_call");
    expect(calls).toEqual([
      {
        type: "web_search_call",
        id: "srvtoolu_1",
        status: "completed",
        action: { type: "search", query: "Leica Q3 price", sources: [{ type: "url", url: "https://shop.example/q3" }, { type: "url", url: "https://other.example/q3" }] },
        results: [
          { url: "https://shop.example/q3", title: "Leica Q3 | Shop" },
          { url: "https://other.example/q3", title: "Q3 review" },
        ],
      },
    ]);
  });

  it("answers JSON from the final words only, after any searching", async () => {
    const claude = fakeClaude(message([...searched.slice(0, 3), { type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: '{"pick":"Leica Q3"}' }]));
    const r = await client(claude.fetch).responses({ input: "pick", tools: [{ type: "web_search" }], text: { format: { type: "json_schema", name: "pick", schema: { type: "object", properties: {} } } } });
    expect(r.text).toBe('{"pick":"Leica Q3"}');
  });

  it("never hands back a tool call from a reply that was cut off or refused", async () => {
    for (const stop_reason of ["max_tokens", "refusal"]) {
      const claude = fakeClaude(message([{ type: "tool_use", id: "toolu_9", name: "get_page", input: { url: "https://x" } }], { stop_reason }));
      expect((await client(claude.fetch).responses({ input: "go", tools: [GET_PAGE] })).functionCalls).toEqual([]);
    }
  });

  it("raises a ClaudeApiError the routes read like Meta's, with the status", async () => {
    const claude = fakeClaude(new Response('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}', { status: 429, headers: { "content-type": "application/json" } }));
    const err = await client(claude.fetch).responses({ input: "hi" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeApiError);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/^Claude API returned 429/);
  });
});

describe("previous_response_id", () => {
  it("carries the conversation, verbatim and append-only, with the tool results as tool_result blocks", async () => {
    const firstReply = [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "toolu_1", name: "get_page", input: { url: "https://shop.example/q3" } },
    ];
    const claude = fakeClaude(message(firstReply, { stop_reason: "tool_use" }), message([{ type: "text", text: "It is $5,995." }]));
    const c = client(claude.fetch);
    const first = await c.responses({ instructions: "Research prices.", input: "Leica Q3", tools: [{ type: "web_search" }, GET_PAGE], max_tool_calls: 3 });
    const second = await c.responses({
      previous_response_id: first.id,
      input: [
        { type: "function_call_output", call_id: "toolu_1", output: '{"price":"$5,995"}' },
        { role: "user", content: "Answer now." },
      ],
      tools: [{ type: "web_search" }, GET_PAGE],
    });
    expect(second.text).toBe("It is $5,995.");
    expect(second.id).not.toBe(first.id);
    const [a, b] = claude.sent.map((s) => s.body);
    // The same system prompt and tools as the first request, so the earlier thinking stays valid.
    expect(b!.system).toBe(a!.system);
    expect(b!.tools).toEqual(a!.tools);
    expect(b!.messages).toEqual([
      { role: "user", content: "Leica Q3" },
      { role: "assistant", content: firstReply },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: '{"price":"$5,995"}' },
          { type: "text", text: "Answer now." },
        ],
      },
    ]);
  });

  it("puts a turn's tool results ahead of its words, whatever order they came in", async () => {
    const claude = fakeClaude(message([{ type: "tool_use", id: "toolu_1", name: "get_page", input: {} }], { stop_reason: "tool_use" }), message([{ type: "text", text: "ok" }]));
    const c = client(claude.fetch);
    const first = await c.responses({ input: "go", tools: [GET_PAGE] });
    await c.responses({ previous_response_id: first.id, input: [{ role: "user", content: "Answer now." }, { type: "function_call_output", call_id: "toolu_1", output: "page" }], tools: [GET_PAGE] });
    expect(claude.sent[1]!.body.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "page" },
        { type: "text", text: "Answer now." },
      ],
    });
  });

  it("keeps the conversation's tools on a follow-up that sends none, and asks for no tool use", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "found" }]), message([{ type: "text", text: '{"ok":true}' }]));
    const c = client(claude.fetch);
    const first = await c.responses({ instructions: "Find it.", input: "car", tools: [{ type: "web_search" }], max_tool_calls: 4 });
    await c.responses({ previous_response_id: first.id, input: [{ role: "user", content: "Return JSON." }], text: { format: { type: "json_schema", name: "car", schema: { type: "object", properties: {} } } } });
    const b = claude.sent[1]!.body;
    expect(b.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 4 }]);
    expect(b.tool_choice).toEqual({ type: "none" });
    expect(b.system).toBe("Find it.");
  });

  it("adds changed instructions as a system message at the end, never rewriting the first", async () => {
    const claude = fakeClaude(message([{ type: "text", text: "one" }]), message([{ type: "text", text: "two" }]));
    const c = client(claude.fetch);
    const first = await c.responses({ instructions: "First rules.", input: "a", tools: [GET_PAGE] });
    await c.responses({ previous_response_id: first.id, instructions: "New rules.", input: "b", tools: [GET_PAGE] });
    const b = claude.sent[1]!.body;
    expect(b.system).toBe("First rules.");
    expect(b.messages.slice(-2)).toEqual([
      { role: "user", content: "b" },
      { role: "system", content: "New rules." },
    ]);
  });

  it("adds a tool the conversation lacked at the end, and lets the API drop the thinking that no longer matches", async () => {
    const claude = fakeClaude(...["one", "two", "three", "four"].map((t) => message([{ type: "text", text: t }])));
    const c = client(claude.fetch);
    const first = await c.responses({ input: "a", tools: [{ type: "web_search" }] });
    const second = await c.responses({ previous_response_id: first.id, input: "b", tools: [{ type: "web_search" }] });
    expect(claude.sent[1]!.body).not.toHaveProperty("thinking");
    const third = await c.responses({ previous_response_id: second.id, input: "c", tools: [{ type: "web_search" }, GET_PAGE] });
    const sent = claude.sent[2]!;
    expect(sent.body.tools.map((t: Json) => t.name)).toEqual(["web_search", "get_page"]);
    expect(sent.body.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(sent.headers.get("anthropic-beta")).toContain("thinking-binding-controls-2026-08-01");
    // The drop applies to one request only, so every later request in the conversation asks for it again.
    await c.responses({ previous_response_id: third.id, input: "d", tools: [{ type: "web_search" }, GET_PAGE] });
    expect(claude.sent[3]!.body.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  });

  it("refuses an id it never issued, as Meta does an expired one", async () => {
    const claude = fakeClaude();
    const err = await client(claude.fetch).responses({ previous_response_id: "claude_unknown", input: "more" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeApiError);
    expect(err.status).toBe(400);
    expect(claude.sent).toHaveLength(0);
  });

  it("forgets conversations past their time", async () => {
    let now = 1_000;
    const history = new ClaudeHistory({ ttlMs: 60_000, now: () => now });
    const claude = fakeClaude(message([{ type: "text", text: "one" }]));
    const first = await client(claude.fetch, { history }).responses({ input: "a", tools: [GET_PAGE] });
    expect(history.get(first.id)).toBeDefined();
    now += 60_001;
    expect(history.get(first.id)).toBeUndefined();
  });

  it("keeps a conversation only when it can go on: the request offered tools, or the reply stopped for a tool or a pause", async () => {
    const history = new ClaudeHistory();
    const claude = fakeClaude(message([{ type: "text", text: "plain" }]), message([{ type: "text", text: "found" }]), message([{ type: "text", text: '{"ok":true}' }]));
    const c = client(claude.fetch, { history });
    const plain = await c.responses({ input: "hi" });
    expect(history.get(plain.id)).toBeUndefined();
    const tooled = await c.responses({ input: "find it", tools: [{ type: "web_search" }] });
    expect(history.get(tooled.id)).toBeDefined();
    // The answer that closes a conversation sends no tools and ends its turn: nothing follows it.
    const answer = await c.responses({ previous_response_id: tooled.id, input: "Return JSON." });
    expect(history.get(answer.id)).toBeUndefined();
  });

  it("holds at most maxBytes of conversations, the oldest going first, and never one bigger than that", async () => {
    const history = new ClaudeHistory({ maxBytes: 6_000 });
    const claude = fakeClaude(...[1, 2, 3].map(() => message([{ type: "text", text: "x".repeat(2_500) }])), message([{ type: "text", text: "y".repeat(7_000) }]));
    const c = client(claude.fetch, { history });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await c.responses({ input: "go", tools: [GET_PAGE] })).id);
    expect(history.get(ids[0]!)).toBeUndefined();
    expect(history.get(ids[1]!)).toBeDefined();
    expect(history.get(ids[2]!)).toBeDefined();
    const huge = await c.responses({ input: "go", tools: [GET_PAGE] });
    expect(history.get(huge.id)).toBeUndefined();
    expect(history.get(ids[2]!)).toBeDefined();
  });

  it("never keeps a tool call it dropped, so a follow-up still reads", async () => {
    const thought = { type: "thinking", thinking: "", signature: "s" };
    const claude = fakeClaude(
      message([thought, { type: "text", text: "Opening it." }, { type: "tool_use", id: "toolu_9", name: "get_page", input: { url: "https://x" } }], { stop_reason: "max_tokens" }),
      message([{ type: "text", text: "ok" }]),
      message([thought, { type: "tool_use", id: "toolu_8", name: "get_page", input: {} }], { stop_reason: "max_tokens" }),
      message([{ type: "text", text: "ok" }]),
    );
    const c = client(claude.fetch);
    const cut = await c.responses({ input: "go", tools: [GET_PAGE] });
    await c.responses({ previous_response_id: cut.id, input: "Answer with what you have.", tools: [GET_PAGE] });
    expect(claude.sent[1]!.body.messages).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: [thought, { type: "text", text: "Opening it." }] },
      { role: "user", content: "Answer with what you have." },
    ]);
    // A turn that was nothing but the dropped call leaves no assistant turn behind.
    const bare = await c.responses({ input: "again", tools: [GET_PAGE] });
    await c.responses({ previous_response_id: bare.id, input: "Answer now.", tools: [GET_PAGE] });
    expect(claude.sent[3]!.body.messages).toEqual([
      { role: "user", content: "again" },
      { role: "user", content: "Answer now." },
    ]);
  });
});

describe("pause_turn", () => {
  it("sends the paused turn back unchanged until the turn ends, and reports one result and one usage", async () => {
    const paused = [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q3" } }];
    const claude = fakeClaude(
      message(paused, { stop_reason: "pause_turn", usage: usage({ input_tokens: 500, output_tokens: 50, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }) }),
      message([{ type: "text", text: "Done." }], { usage: usage({ input_tokens: 700, output_tokens: 60 }) }),
    );
    const reported: number[] = [];
    const c = client(claude.fetch, { onUsage: (_u, cost) => void reported.push(cost) });
    const r = await c.responses({ input: "price", tools: [{ type: "web_search" }] });
    expect(claude.sent).toHaveLength(2);
    expect(claude.sent[1]!.body.messages).toEqual([
      { role: "user", content: "price" },
      { role: "assistant", content: paused },
    ]);
    expect(r.text).toBe("Done.");
    expect(r.searchQueries).toEqual(["q3"]);
    expect(r.usage).toMatchObject({ inputTokens: 1200, outputTokens: 110, searches: 1 });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeCloseTo(r.costUsd, 12);

    // The next call carries both halves of the paused turn, as they were sent and received.
    const again = fakeClaude(message(paused, { stop_reason: "pause_turn" }), message([{ type: "text", text: "Done." }]), message([{ type: "text", text: "Again." }]));
    const c2 = client(again.fetch);
    const first = await c2.responses({ input: "price", tools: [{ type: "web_search" }] });
    await c2.responses({ previous_response_id: first.id, input: "and now?" });
    expect(again.sent[2]!.body.messages).toEqual([
      { role: "user", content: "price" },
      { role: "assistant", content: paused },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
      { role: "user", content: "and now?" },
    ]);
  });

  it("stops resuming after a few pauses and answers with what it has", async () => {
    const paused = [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q3" } }];
    const claude = fakeClaude(...Array.from({ length: 10 }, () => message(paused, { stop_reason: "pause_turn" })));
    const r = await client(claude.fetch).responses({ input: "price", tools: [{ type: "web_search" }] });
    expect(claude.sent.length).toBeLessThanOrEqual(6);
    expect(r.text).toBe("");
  });

  // Half a dollar of fast-mode output: 12,500 tokens at $40 a million.
  const costly = usage({ input_tokens: 0, output_tokens: 12_500 });
  const pausedWithWords = [
    { type: "text", text: "Looking it up." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q3 price" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://shop.example/q3", title: "Q3", encrypted_content: "e", page_age: null }] },
    { type: "server_tool_use", id: "srvtoolu_2", name: "web_search", input: { query: "q3 used" } },
  ];

  it("asks mayResume before each resume, with what the call has spent so far, and resumes when it agrees", async () => {
    const asked: number[] = [];
    const claude = fakeClaude(message(pausedWithWords, { stop_reason: "pause_turn", usage: costly }), message([{ type: "text", text: "Done." }]));
    const r = await client(claude.fetch, { mayResume: async (spent) => (asked.push(spent), true) }).responses({ input: "price", tools: [{ type: "web_search" }] });
    expect(claude.sent).toHaveLength(2);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeCloseTo(0.5, 12);
    expect(r.text).toBe("Looking it up. Done.");
  });

  it("stops resuming when mayResume says no, and answers with what it has, as from a final reply", async () => {
    const reported: number[] = [];
    const claude = fakeClaude(message(pausedWithWords, { stop_reason: "pause_turn", usage: costly }), message([{ type: "text", text: "more" }]), message([{ type: "text", text: "next" }]));
    const c = client(claude.fetch, { mayResume: async () => false, onUsage: (_u, cost) => void reported.push(cost) });
    const r = await c.responses({ input: "price", tools: [{ type: "web_search" }] });
    expect(claude.sent).toHaveLength(1);
    expect(r.text).toBe("Looking it up.");
    expect(r.searchQueries).toEqual(["q3 price", "q3 used"]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeCloseTo(r.costUsd, 12);
    // A follow-up reads: the search that never ran (no result after it) is not left dangling in the history.
    await c.responses({ previous_response_id: r.id, input: "Answer with what you have." });
    expect(claude.sent[1]!.body.messages).toEqual([
      { role: "user", content: "price" },
      { role: "assistant", content: pausedWithWords.slice(0, 3) },
      { role: "user", content: "Answer with what you have." },
    ]);
  });

  it("fails the call, with what it spent reported, when mayResume itself fails", async () => {
    const reported: number[] = [];
    const claude = fakeClaude(message(pausedWithWords, { stop_reason: "pause_turn", usage: costly }));
    const broken = new Error("ledger unreachable");
    const c = client(claude.fetch, { mayResume: async () => Promise.reject(broken), onUsage: (_u, cost) => void reported.push(cost) });
    await expect(c.responses({ input: "price", tools: [{ type: "web_search" }] })).rejects.toBe(broken);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeCloseTo(0.5, 12);
  });
});

describe("cost", () => {
  it("prices Opus 5.5 at $4/$20 a million tokens, $8/$40 in fast mode, with cache reads, cache writes and $10 a thousand searches", () => {
    expect(CLAUDE_PRICES.standard).toEqual({ input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 });
    expect(CLAUDE_PRICES.fast).toEqual({ input: 8, cachedInput: 0.4, cacheWrite: 10, output: 40 });
    expect(CLAUDE_SEARCH_PRICE).toBeCloseTo(0.01, 12);
    const u = { model: CLAUDE_MODEL, inputTokens: 10_000, cachedInputTokens: 6_000, cacheWriteTokens: 1_000, outputTokens: 500, searches: 2 };
    expect(claudeCostUsd(u, false)).toBeCloseTo((3_000 * 4 + 6_000 * 0.2 + 1_000 * 5 + 500 * 20) / 1e6 + 0.02, 12);
    expect(claudeCostUsd(u, true)).toBeCloseTo((3_000 * 8 + 6_000 * 0.4 + 1_000 * 10 + 500 * 40) / 1e6 + 0.02, 12);
  });

  it("reads Claude's usage into the ledger's terms and prices it at the speed it ran", async () => {
    const reply = message([{ type: "text", text: "ok" }], { usage: usage({ input_tokens: 2_000, cache_read_input_tokens: 6_000, cache_creation_input_tokens: 1_000, output_tokens: 500 }) });
    const r = await client(fakeClaude(reply).fetch).responses({ input: "hi" });
    expect(r.usage).toEqual({ model: CLAUDE_MODEL, inputTokens: 9_000, cachedInputTokens: 6_000, cacheWriteTokens: 1_000, outputTokens: 500, searches: 0 });
    expect(r.costUsd).toBeCloseTo(claudeCostUsd(r.usage, true), 12);
  });
});
