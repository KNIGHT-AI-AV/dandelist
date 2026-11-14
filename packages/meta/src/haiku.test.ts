import { expect, it, vi } from "vitest";
import { ClaudeClient, HAIKU_MODEL } from "./claude";
import { claudeCostUsd, type Usage } from "./pricing";

const usage = (extra: Partial<Usage> = {}): Usage => ({ model: HAIKU_MODEL, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, searches: 0, ...extra });
it("prices Haiku's short and long prompts, cache reads/writes and search at current standard rates", () => {
  expect(claudeCostUsd(usage(), false)).toBeCloseTo(0.00015, 10);
  expect(claudeCostUsd(usage({ inputTokens: 100000 }), true)).toBeCloseTo(0.01005, 10);
  expect(claudeCostUsd(usage({ inputTokens: 100001 }), false)).toBeCloseTo(0.0502505, 10);
  expect(claudeCostUsd(usage({ inputTokens: 200000, cachedInputTokens: 100000, cacheWriteTokens: 50000, searches: 1 }), false)).toBeCloseTo(0.0715, 10);
  expect(() => claudeCostUsd(usage({ model: "unknown" }), false)).toThrow("Unknown");
});
it.each([{ model: "muse-spark-1.3" }, { maxTokens: 0 }, { maxResumes: -1 }, { maxSearchUses: 0 }])("refuses unknown model or invalid bound before transport", extra => {
  const fetcher = vi.fn(); expect(() => new ClaudeClient({ apiKey: "synthetic", model: HAIKU_MODEL, fetch: fetcher, ...extra } as any)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it("does not resume a paused Haiku call, use fast mode, or exceed its search/output bounds", async () => {
  const fetcher = vi.fn(async () => Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: HAIKU_MODEL,
    content: [{ type: "text", text: "Synthetic" }], stop_reason: "pause_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
  const brain = new ClaudeClient({ apiKey: "synthetic", model: HAIKU_MODEL, fast: true, maxResumes: 0, maxRetries: 0, maxSearchUses: 1, maxTokens: 512, fetch: fetcher });
  await brain.responses({ input: "Synthetic", tools: [{ type: "web_search" }], max_tool_calls: 8 });
  expect(fetcher).toHaveBeenCalledOnce();
  const sent = JSON.parse(String((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body));
  expect(sent).toMatchObject({ model: HAIKU_MODEL, max_tokens: 512, thinking: { type: "disabled" }, tools: [{ max_uses: 1, type: "web_search_20250305" }] });
  expect(sent.speed).toBeUndefined();
});
