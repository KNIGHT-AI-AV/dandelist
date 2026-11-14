import { describe, expect, it, vi } from "vitest";
import { createNoMetaDispatcher, type NoMetaDispatch, type NoMetaReservation } from "../src/inference-policy";

const now = 1_800_000_000_000;
const policy = () => ({
  provider: "anthropic-api", billingAccountId: "synthetic-org", modelId: "claude-haiku-5-5",
  funding: { verified: true, receiptId: "synthetic-approved-receipt", provider: "anthropic-api", billingAccountId: "synthetic-org",
    modelIds: ["claude-haiku-5-5"], capabilities: ["text", "vision", "app-tools"], checkedAtMs: now - 1000, expiresAtMs: now + 60_000, eligibleRemainingUsd: 20 },
  limits: { callUsd: 0.05, dailyUsd: 1, totalUsd: 10, inputBytes: 8192, outputTokens: 1024, toolCalls: 4 },
});
const request = () => ({ capability: "text", body: { input: "synthetic wish" } as Record<string, unknown>, maximumChargeUsd: 0.02 });
const reserve: NoMetaReservation = async (_dispatch, run) => run();

describe("no-Meta candidate admission boundary (no provider invocation)", () => {
  it("dispatches only the selected route after reservation, with explicit bounds", async () => {
    const order: string[] = [];
    const send = vi.fn(async (_dispatch: NoMetaDispatch) => { order.push("send"); return "synthetic answer"; });
    const run = createNoMetaDispatcher(policy(), send, async (d, call) => {
      order.push("reserve"); expect(d.maximumChargeUsd).toBe(0.02); return call();
    }, () => now);
    await expect(run(request())).resolves.toBe("synthetic answer");
    expect(order).toEqual(["reserve", "send"]);
    expect(send.mock.calls[0]![0]).toMatchObject({ provider: "anthropic-api", billingAccountId: "synthetic-org", endpoint: "https://api.anthropic.com", modelId: "claude-haiku-5-5",
      body: { model: "claude-haiku-5-5", max_output_tokens: 1024, max_tool_calls: 4 } });
  });

  it("refuses a competing Bedrock route even with a funding assertion", async () => {
    const p = policy();
    p.provider = p.funding.provider = "aws-bedrock";
    p.billingAccountId = p.funding.billingAccountId = "111111111111";
    p.modelId = "us.amazon.nova-2-lite-v1:0"; p.funding.modelIds = [p.modelId];
    const send = vi.fn(async d => d.endpoint);
    expect(() => createNoMetaDispatcher(p, send, reserve, () => now)).toThrow("allowlist");
    expect(send).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { ...policy(), provider: "meta" }, { ...policy(), fallback: "meta" }])("rejects absent/legacy/implicit funding configuration before dispatch", p => {
    const send = vi.fn();
    expect(() => createNoMetaDispatcher(p, send, reserve, () => now)).toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["muse-spark-1.3", "sam-3.1", "muse-image-1.0", "muse-voice-transcribe-1.0", "local:glimmer", "claude-opus-5-5", "global.amazon.nova-2-lite-v1:0"])("refuses an unapproved model %s", modelId => {
    const p = policy(); p.modelId = modelId; p.funding.modelIds = [modelId];
    expect(() => createNoMetaDispatcher(p, vi.fn(), reserve, () => now)).toThrow("allowlist");
  });

  it("rejects false, wrong-account, wrong-provider and wrong-model funding attestations", () => {
    for (const alter of [
      p => { p.funding.verified = false; }, p => { p.funding.billingAccountId = "other-org"; },
      p => { p.funding.provider = "aws-bedrock"; }, p => { p.funding.modelIds = ["claude-sonnet-5-5"]; },
    ] as ((p: ReturnType<typeof policy>) => void)[]) {
      const p = policy(); alter(p);
      expect(() => createNoMetaDispatcher(p, vi.fn(), reserve, () => now)).toThrow();
    }
  });

  it("rejects stale, future, expired and overlong receipts", () => {
    for (const dates of [[now - 1000, now], [now + 1, now + 1000], [now - 1000, now - 1], [now - 1, now + 86_400_000]]) {
      const p = policy(); [p.funding.checkedAtMs, p.funding.expiresAtMs] = dates as [number, number];
      expect(() => createNoMetaDispatcher(p, vi.fn(), reserve, () => now)).toThrow("current");
    }
  });

  it("rechecks expiration both before and after waiting for a reservation", async () => {
    let clock = now;
    const send = vi.fn();
    const p = policy();
    const call = createNoMetaDispatcher(p, send, async (_d, run) => { clock = p.funding.expiresAtMs; return run(); }, () => clock);
    await expect(call(request())).rejects.toThrow("current");
    await expect(call(request())).rejects.toThrow("current");
    expect(send).not.toHaveBeenCalled();
  });

  it("requires nested call/day/total limits within the attested credit allowance", () => {
    for (const limits of [{ callUsd: 2 }, { dailyUsd: 11 }, { totalUsd: 21 }, { callUsd: Number.NaN }]) {
      const p = policy(); Object.assign(p.limits, limits);
      expect(() => createNoMetaDispatcher(p, vi.fn(), reserve, () => now)).toThrow();
    }
  });

  it.each([0, -1, Number.NaN, Infinity, 0.06])("rejects missing/excess worst-case cost %s", async maximumChargeUsd => {
    const send = vi.fn(); const run = createNoMetaDispatcher(policy(), send, reserve, () => now);
    await expect(run({ ...request(), maximumChargeUsd })).rejects.toThrow("cost bound"); expect(send).not.toHaveBeenCalled();
  });

  it.each(["speech", "segmentation", "image-generation", "meta"]) ("rejects unsupported capability %s", async capability => {
    const send = vi.fn(); const run = createNoMetaDispatcher(policy(), send, reserve, () => now);
    await expect(run({ ...request(), capability })).rejects.toThrow("Capability"); expect(send).not.toHaveBeenCalled();
  });

  it("does not admit an otherwise supported but unfunded capability", async () => {
    const p = policy(); p.funding.capabilities = ["text"];
    await expect(createNoMetaDispatcher(p, vi.fn(), reserve, () => now)({ ...request(), capability: "vision" })).rejects.toThrow("funded");
  });

  it("does not smuggle an unfunded app tool through a text request", async () => {
    const p = policy(); p.funding.capabilities = ["text"];
    const send = vi.fn();
    await expect(createNoMetaDispatcher(p, send, reserve, () => now)({ ...request(), body: { tools: [{ type: "function", name: "lookup" }] } })).rejects.toThrow("tools are not funded");
    expect(send).not.toHaveBeenCalled();
  });

  it.each([ { model: "muse-spark-1.3" }, { endpoint: "https://api.meta.ai/v1" }, { fallbacks: ["meta"] }, { service_tier: "priority" }, { headers: {} },
    { tools: [{ type: "web_search_20260209" }] }, { tools: [{ type: "nova_grounding" }] }, { max_output_tokens: 2048 }, { input: "x".repeat(9000) },
  ])("refuses request-side model/routing/tool/token bypasses", async body => {
    const send = vi.fn();
    await expect(createNoMetaDispatcher(policy(), send, reserve, () => now)({ ...request(), body })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("never calls a provider when the ledger reservation is refused", async () => {
    const send = vi.fn();
    await expect(createNoMetaDispatcher(policy(), send, async () => { throw Error("allowance used"); }, () => now)(request())).rejects.toThrow("allowance used");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not retry or fall back after the admitted transport fails", async () => {
    const send = vi.fn(async () => { throw Error("provider unavailable"); });
    await expect(createNoMetaDispatcher(policy(), send, reserve, () => now)(request())).rejects.toThrow("provider unavailable");
    expect(send).toHaveBeenCalledOnce();
  });

  it("cancels before dispatch or while waiting for a reservation", async () => {
    for (const before of [true, false]) {
      const controller = new AbortController(), send = vi.fn();
      if (before) controller.abort(Error("cancelled"));
      const call = createNoMetaDispatcher(policy(), send, async (_d, run) => { controller.abort(Error("cancelled")); return run(); }, () => now);
      await expect(call({ ...request(), signal: controller.signal })).rejects.toThrow("cancelled"); expect(send).not.toHaveBeenCalled();
    }
  });

  it("isolates the admitted route/body from caller and reservation mutations", async () => {
    const p = policy(); const input = request(); const send = vi.fn(async d => d);
    const call = createNoMetaDispatcher(p, send, async (d, run) => {
      d.provider = "aws-bedrock"; d.modelId = "meta"; d.body.model = "meta"; d.endpoint = "https://api.meta.ai"; d.limits.outputTokens = 99999;
      return run();
    }, () => now);
    p.modelId = "meta";
    const result = await call(input);
    expect(result).toMatchObject({ provider: "anthropic-api", modelId: "claude-haiku-5-5", endpoint: "https://api.anthropic.com", body: { model: "claude-haiku-5-5" }, limits: { outputTokens: 1024 } });
    expect(input.body).toEqual({ input: "synthetic wish" });
  });

  it("prevents a reservation from dispatching twice", async () => {
    const send = vi.fn(async () => "answer");
    await expect(createNoMetaDispatcher(policy(), send, async (_d, run) => { await run(); return run(); }, () => now)(request())).rejects.toThrow("only one");
    expect(send).toHaveBeenCalledOnce();
  });
});
