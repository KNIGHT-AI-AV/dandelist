import { afterEach, expect, it, vi } from "vitest";
import { localModelEndpoint, localTextAdapter, type LocalModelOptions } from "../src/local-model";

const model = "fixture-local";
const output = (patch: Record<string, unknown> = {}) => ({ model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"worth":"priceless"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...patch });
const tool = { type: "function", name: "read_plan", description: "Read a synthetic saved plan", parameters: { type: "object", properties: {}, additionalProperties: false } };
function fixture(patch: Partial<LocalModelOptions> = {}, response: unknown = output()) {
  const request = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json(response));
  const adapter = localTextAdapter({ evaluationOnly: true, endpoint: "http://127.0.0.1:8191/v1", model, fetch: request, ...patch });
  return { request, adapter };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each(["https://api.meta.ai/v1", "https://api.openai.com/v1", "http://localhost:8191/v1", "http://192.168.0.2:8191/v1", "http://0.0.0.0:8191/v1", "http://127.0.0.1:8191/other", "http://user:password@127.0.0.1:8191/v1", "http://127.0.0.1:8191/v1?key=value"])("refuses non-loopback or ambiguous endpoints before a request: %s", endpoint => {
  expect(() => localModelEndpoint(endpoint)).toThrow();
});
it("accepts a fixed IPv6 loopback without any redirect or DNS lookup", () => { expect(localModelEndpoint("http://[::1]:8191/v1/").href).toBe("http://[::1]:8191/v1/chat/completions"); });
it("maps the frozen legacy text-model selection to the explicit local alias without changing the request", async () => {
  const f = fixture(), original = { input: "Synthetic question", model: "muse-spark-1.3" };
  await f.adapter.respond(original); expect(original.model).toBe("muse-spark-1.3"); expect(JSON.parse(f.request.mock.calls[0]![1]!.body as string).model).toBe(model);
});
it("refuses production even with explicit opt-in, and rechecks before dispatch", async () => {
  const f = fixture(); vi.stubEnv("NODE_ENV", "production");
  expect(() => fixture()).toThrow("evaluation-only"); await expect(f.adapter.respond({ input: "synthetic" })).rejects.toThrow("evaluation-only"); expect(f.request).not.toHaveBeenCalled();
});
it("keeps field descriptions in the prompt, enforces the schema and reports local usage without credentials", async () => {
  const f = fixture(); const schema = { type: "object", properties: { worth: { type: "string", description: "Whether money can buy it" } } };
  const answer = await f.adapter.respond({ instructions: "Synthetic evaluation", input: "A feeling of belonging", text: { format: { type: "json_schema", name: "worth", schema } }, max_output_tokens: 9000, reasoning: { effort: "minimal" } });
  const init = f.request.mock.calls[0]![1]!; const sent = JSON.parse(init.body as string);
  expect(sent.model).toBe(model); expect(sent.messages[0].content).toContain("Whether money can buy it"); expect(sent.response_format.json_schema.schema).toEqual(schema);
  expect(sent.max_tokens).toBe(4096); expect(sent.thinking_budget_tokens).toBe(0); expect(sent.stream).toBe(false); expect(sent.seed).toBe(17); expect(sent.temperature).toBe(0);
  expect(init).toMatchObject({ redirect: "error", headers: { "Content-Type": "application/json" } }); expect(init.headers).not.toHaveProperty("Authorization");
  expect(answer).toMatchObject({ costUsd: 0, citations: [], searchQueries: [], usage: { model, inputTokens: 10, outputTokens: 5 }, raw: { localEvaluation: true, tokenUsageMeasured: true } });
});
it.each([{ previous_response_id: "meta-private-id" }, { model: "muse-image-1.0" }, { stream: true }, { tools: [{ type: "web_search" }] }, { input: [{ role: "user", content: [{ type: "input_image", image_url: "https://private.invalid/image" }] }] }, { tool_choice: "required" }])("unsupported capabilities stop before the local call: %j", async patch => {
  const f = fixture(); await expect(f.adapter.respond({ input: "synthetic", ...patch })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it("maps function history and returned calls without executing any tool", async () => {
  const f = fixture({}, output({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "next", type: "function", function: { name: tool.name, arguments: "{}" } }] } }] }));
  const answer = await f.adapter.respond({ tools: [tool], input: [{ role: "user", content: [{ type: "input_text", text: "Synthetic plan" }] }, { type: "function_call", call_id: "first", name: tool.name, arguments: "{}" }, { type: "function_call_output", call_id: "first", output: "fixture plan" }] });
  expect(answer.functionCalls).toEqual([{ callId: "next", name: tool.name, arguments: "{}" }]);
  expect(JSON.parse(f.request.mock.calls[0]![1]!.body as string).messages.at(-1)).toEqual({ role: "tool", tool_call_id: "first", content: "fixture plan" }); expect(f.request).toHaveBeenCalledTimes(1);
});
it("groups parallel historical calls into one assistant turn before their results", async () => {
  const f = fixture(); await f.adapter.respond({ tools: [tool], input: [{ role: "user", content: "Synthetic" }, ...["a", "b"].map(call_id => ({ type: "function_call", call_id, name: tool.name, arguments: "{}" })), ...["a", "b"].map(call_id => ({ type: "function_call_output", call_id, output: "fixture" }))] });
  const messages = JSON.parse(f.request.mock.calls[0]![1]!.body as string).messages; expect(messages).toHaveLength(4); expect(messages[1].tool_calls.map((c: { id: string }) => c.id)).toEqual(["a", "b"]);
});
it("refuses tool IDs repeated from history and inconsistent completion reasons", async () => {
  const call = { id: "first", type: "function", function: { name: tool.name, arguments: "{}" } };
  const f = fixture({}, output({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [call] } }] }));
  await expect(f.adapter.respond({ tools: [tool], input: [{ type: "function_call", call_id: "first", name: tool.name, arguments: "{}" }, { type: "function_call_output", call_id: "first", output: "fixture" }] })).rejects.toThrow();
  const inconsistent = fixture({}, output({ choices: [{ finish_reason: "stop", message: { content: null, tool_calls: [call] } }] }));
  await expect(inconsistent.adapter.respond({ tools: [tool], input: "Synthetic" })).rejects.toThrow();
});
it.each([
  [{ type: "function_call_output", call_id: "unknown", output: "fixture" }],
  [{ type: "function_call", call_id: "a", name: tool.name, arguments: "{}" }],
  [{ type: "function_call", call_id: "a", name: tool.name, arguments: "{}" }, { type: "function_call_output", call_id: "a", output: "fixture" }, { type: "function_call_output", call_id: "a", output: "replay" }],
].map(input => ({ input })))("rejects orphaned, incomplete and duplicate tool histories before dispatch", async ({ input }) => {
  const f = fixture(); await expect(f.adapter.respond({ tools: [tool], input })).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
});
it.each([
  output({ model: "unexpected" }), output({ choices: [] }), output({ choices: [{ finish_reason: "length", message: { content: "partial" } }] }),
  output({ choices: [{ finish_reason: "stop", message: { content: "", refusal: "refused" } }] }),
  output({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "a", type: "function", function: { name: "unoffered_tool", arguments: "{}" } }] } }] }),
])("refusals, truncation, unexpected models and unoffered tools fail without retry", async response => {
  const f = fixture({}, response); await expect(f.adapter.respond({ input: "synthetic", tools: [tool] })).rejects.toThrow("Local evaluation failed"); expect(f.request).toHaveBeenCalledTimes(1);
});
it("an already cancelled evaluation never sends a request", async () => { const controller = new AbortController(); controller.abort(); const f = fixture({ signal: controller.signal }); await expect(f.adapter.respond({ input: "synthetic" })).rejects.toThrow("cancelled"); expect(f.request).not.toHaveBeenCalled(); });
it("times out a stalled request once, with no cloud fallback or token leak", async () => {
  vi.useFakeTimers(); const request = vi.fn((_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("private-provider-detail")))));
  const f = fixture({ timeoutMs: 100, fetch: request }); const result = f.adapter.respond({ input: "synthetic" }); const check = expect(result).rejects.toThrow(/^Local evaluation cancelled or timed out$/);
  await vi.advanceTimersByTimeAsync(100); await check; expect(request).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("does not expose backend error bodies or malformed tool JSON", async () => {
  const f = fixture({ fetch: async () => new Response("private-provider-detail", { status: 500 }) });
  await expect(f.adapter.respond({ input: "synthetic" })).rejects.toThrow(/^Local evaluation failed$/);
  await expect(f.adapter.respond({ tools: [tool], input: [{ type: "function_call", call_id: "a", name: tool.name, arguments: "private-sensitive-fragment" }] })).rejects.toThrow(/^Invalid local tool JSON$/);
});
it("bounds the response body instead of buffering arbitrary local output", async () => {
  const f = fixture({ fetch: async () => new Response("x".repeat(512001)) }); await expect(f.adapter.respond({ input: "synthetic" })).rejects.toThrow();
});
