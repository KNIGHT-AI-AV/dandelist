/**
 * Admission boundary for the owner's no-Meta migration. Not yet wired to production routes.
 * Funding is a private operator attestation, not a live balance lookup or an account-wide cash guarantee.
 * The composition root must supply the verified provider transport and atomic ledger reservation runner.
 */
import { z } from "zod";

const models = {
  "anthropic-api": ["claude-haiku-5-5", "claude-sonnet-5-5"],
  "aws-bedrock": ["us.amazon.nova-2-lite-v1:0", "us.anthropic.claude-haiku-5-5", "us.anthropic.claude-sonnet-5-5"],
} as const;
const provider = z.enum(["anthropic-api", "aws-bedrock"]);
const capability = z.enum(["text", "vision", "app-tools"]);
const money = z.number().finite().positive();
const policySchema = z.object({
  provider,
  billingAccountId: z.string().min(1),
  modelId: z.string().min(1),
  funding: z.object({
    verified: z.literal(true),
    receiptId: z.string().min(1),
    provider,
    billingAccountId: z.string().min(1),
    modelIds: z.array(z.string()).min(1),
    capabilities: z.array(capability).min(1),
    checkedAtMs: z.number().finite(),
    expiresAtMs: z.number().finite(),
    eligibleRemainingUsd: money,
  }).strict(),
  limits: z.object({
    callUsd: money,
    dailyUsd: money,
    totalUsd: money,
    inputBytes: z.number().int().min(1).max(32_768),
    outputTokens: z.number().int().min(1).max(2048),
    toolCalls: z.number().int().min(0).max(8),
  }).strict(),
}).strict();
type Policy = z.infer<typeof policySchema>;
export interface NoMetaDispatch {
  provider: Policy["provider"];
  billingAccountId: string;
  modelId: string;
  endpoint: string;
  receiptId: string;
  maximumChargeUsd: number;
  limits: Policy["limits"];
  capability: z.infer<typeof capability>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}
export type NoMetaReservation = <T>(dispatch: NoMetaDispatch, run: () => Promise<T>) => Promise<T>;
export class InferencePolicyError extends Error {}
const fail = (message: string): never => { throw new InferencePolicyError(message); };
const DAY_MS = 24 * 60 * 60_000;

function admit(p: Policy, now: number) {
  if (!(models[p.provider] as readonly string[]).includes(p.modelId)) fail("Model is not on the non-Meta allowlist");
  const f = p.funding;
  if (f.provider !== p.provider || f.billingAccountId !== p.billingAccountId || !f.modelIds.includes(p.modelId)) fail("Funding receipt does not match the billing route and model");
  if (!Number.isFinite(now) || f.checkedAtMs > now || f.expiresAtMs <= now || f.expiresAtMs <= f.checkedAtMs || f.expiresAtMs - f.checkedAtMs > DAY_MS || now - f.checkedAtMs > DAY_MS) fail("Funding receipt is not current");
  if (p.limits.callUsd > p.limits.dailyUsd || p.limits.dailyUsd > p.limits.totalUsd || p.limits.totalUsd > f.eligibleRemainingUsd) fail("Approved limits exceed the attested allowance");
}

/** No implicit provider, endpoint, fallback or retry. Recheck funding before every reserved dispatch. */
export function createNoMetaDispatcher<T>(configuration: unknown, send: (dispatch: NoMetaDispatch) => Promise<T>, reserveAndRun: NoMetaReservation, now = Date.now) {
  const parsed = policySchema.safeParse(configuration);
  if (!parsed.success) fail("An explicit verified funding policy is required");
  const policy = structuredClone(parsed.data!);
  admit(policy, now());
  if (typeof send !== "function" || typeof reserveAndRun !== "function") fail("Transport and reservation runner are required");
  return async (request: { capability: string; body: Record<string, unknown>; maximumChargeUsd: number; signal?: AbortSignal }): Promise<T> => {
    admit(policy, now());
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("Inference cancelled");
    const kind = capability.safeParse(request.capability);
    if (!kind.success || !policy.funding.capabilities.includes(kind.data!)) fail("Capability is not funded");
    if (!Number.isFinite(request.maximumChargeUsd) || request.maximumChargeUsd <= 0 || request.maximumChargeUsd > policy.limits.callUsd) fail("Call has no admissible worst-case cost bound");
    const body = structuredClone(request.body);
    if (Object.keys(body).some(k => ["base_url", "baseURL", "endpoint", "headers", "api_key", "fallbacks", "service_tier"].includes(k))) fail("Request cannot override its billing route");
    if (body.model !== undefined && body.model !== policy.modelId) fail("Request cannot change its approved model");
    // Initial candidate permits bounded app-owned tools only. Hosted search/resumes need a separate cost contract.
    if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(t => !t || typeof t !== "object" || t.type !== "function"))) fail("Hosted or unknown tools are not admitted");
    if (Array.isArray(body.tools) && body.tools.length && !policy.funding.capabilities.includes("app-tools")) fail("App-owned tools are not funded");
    if (Array.isArray(body.tools) && body.tools.length > policy.limits.toolCalls) fail("Tool count exceeds its bound");
    const output = body.max_output_tokens ?? policy.limits.outputTokens;
    if (typeof output !== "number" || !Number.isInteger(output) || output <= 0 || output > policy.limits.outputTokens) fail("Output exceeds its bound");
    body.model = policy.modelId;
    body.max_output_tokens = output;
    body.max_tool_calls = policy.limits.toolCalls;
    if (Buffer.byteLength(JSON.stringify(body)) > policy.limits.inputBytes) fail("Request exceeds its input bound");
    const dispatch: NoMetaDispatch = {
      provider: policy.provider, billingAccountId: policy.billingAccountId, modelId: policy.modelId,
      endpoint: policy.provider === "anthropic-api" ? "https://api.anthropic.com" : "https://bedrock-runtime.us-east-1.amazonaws.com",
      receiptId: policy.funding.receiptId, maximumChargeUsd: request.maximumChargeUsd,
      limits: { ...policy.limits }, capability: kind.data!, body, signal: request.signal,
    };
    let sent = false;
    return reserveAndRun({ ...dispatch, limits: { ...policy.limits }, body: structuredClone(body) }, async () => {
      // A reservation must not become permission for a delayed/repeated call or a mutated route.
      admit(policy, now());
      if (sent) fail("A reservation permits only one dispatch");
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("Inference cancelled");
      sent = true;
      return send({ ...dispatch, limits: { ...policy.limits }, body: structuredClone(body),
        provider: policy.provider, billingAccountId: policy.billingAccountId, modelId: policy.modelId,
        endpoint: policy.provider === "anthropic-api" ? "https://api.anthropic.com" : "https://bedrock-runtime.us-east-1.amazonaws.com" });
    });
  };
}
