import { randomUUID } from "node:crypto";
import { ClaudeClient, HAIKU_MODEL, MetaApiError, type Usage } from "@dandelist/meta";
import type { Db } from "./db";
import { assertAiConsent } from "./consent";
import { createNoMetaDispatcher, readNoMetaPolicy, type NoMetaPolicy } from "./inference-policy";
import { modelRouter, postgresHistory, ModelHistoryError, type Envelope, type HistoryStore, type Responder } from "./model-adapter";
import { SpendLimitError, assertUserClaudeBudget, collectInferencePolicy, recordSpend, withHold, reservedFetch } from "./spend";
import { stoppable } from "./sse";

export const INFERENCE_UNAVAILABLE = "The helper is unavailable right now. Your saved wishes are still here.";
export const VOICE_UNAVAILABLE = "Voice input is unavailable. Type your wish instead.";
export const ALLOWANCE_LIMIT_MESSAGE = "I can't look into that within the current allowance. You can still add and edit wishes manually.";
/** MG0132: every selected inference flow shares this account's UTC-day allowance. Never supplied by a client. */
export const PILOT_USER_UTC_DAY_USD = 0.25;
export class InferenceUnavailableError extends Error { constructor() { super(INFERENCE_UNAVAILABLE); } }
export interface InferenceSetup {
  apiKey?: string; policy?: unknown;
  /** Main verifies the server key's organization against policy.billingAccountId before enabling it. */
  keyOrganizationVerified?: boolean;
  fetch?: typeof fetch;
  /** In-process dependency injection for offline fixtures. Never accepted from configuration or HTTP. */
  transport?: { respond: Responder; quote: (body: Record<string, unknown>, policy: NoMetaPolicy) => number };
}
export interface InferenceDeps { db: Db; now: () => Date; modelHistory?: boolean; inference?: InferenceSetup }
function personLimit(personUsd: number, dailyUsd: number): number {
  if (!Number.isFinite(personUsd) || personUsd < 0) throw new InferenceUnavailableError();
  return Math.min(personUsd, dailyUsd, PILOT_USER_UTC_DAY_USD);
}
function policyFor(deps: InferenceDeps) {
  const setup = deps.inference;
  if (!setup?.apiKey || !setup.keyOrganizationVerified) throw new InferenceUnavailableError();
  try {
    const p = readNoMetaPolicy(setup.policy, deps.now().getTime());
    if (p.provider !== "anthropic-api" || p.modelId !== HAIKU_MODEL) throw new Error();
    if (!setup.transport && (p.limits.callUsd > 0.05 || p.limits.dailyUsd > 1 || p.limits.totalUsd > 10)) throw new Error();
    return p;
  } catch { throw new InferenceUnavailableError(); }
}
export function inferenceAvailable(deps: InferenceDeps): boolean { try { policyFor(deps); return true; } catch { return false; } }
export async function inferenceReady(deps: InferenceDeps, userId: string, personUsd = 2): Promise<void> {
  const p = policyFor(deps);
  await assertAiConsent(deps.db, userId);
  await collectInferencePolicy(deps.db, p.limits.dailyUsd, p.limits.totalUsd, deps.now());
  await assertUserClaudeBudget(deps.db, userId, personLimit(personUsd, p.limits.dailyUsd), deps.now(), 0, true);
}
/** Bytes bound text tokens; native images have a documented 4,784-token ceiling. Include schema/tool overhead.
 * Hosted search's returned context is unknown, so its full-context bound cannot fit the approved pilot cap.
 * Pricing/vision contract: platform.claude.com/docs/en/about-claude/pricing and /en/build-with-claude/vision (2026-11-14).
 */
export function haikuMaximumCharge(body: Record<string, unknown>, p: NoMetaPolicy): number {
  if (p.modelId !== HAIKU_MODEL) throw new InferenceUnavailableError();
  const searches = Array.isArray(body.tools) && body.tools.some(t => t?.type === "web_search") ? 1 : 0;
  const counted = structuredClone(body); let images = 0;
  if (Array.isArray(counted.input)) for (const item of counted.input) if (Array.isArray(item?.content)) {
    for (const part of item.content) if (part?.type === "input_image") { images++; part.image_url = "[bounded native image]"; }
  }
  const tokens = Buffer.byteLength(JSON.stringify(counted)) + 8192 + images * 4784;
  if (images > 20 || tokens > 60_000) throw new InferenceUnavailableError();
  return Math.ceil((searches ? 2_000_000 : tokens) * 0.625 + p.limits.outputTokens * 2.5 + searches * 10_000) / 1_000_000;
}
const memory = new Map<string, { owner: string; until: number; envelope: Envelope }>();
function memoryHistory(owner: string): HistoryStore {
  return {
    async load(id) { const row = memory.get(id); if (!row || row.owner !== owner || row.until <= Date.now()) throw new ModelHistoryError("Conversation expired"); return structuredClone(row.envelope); },
    async save(id, envelope) {
      for (const [key, row] of memory) if (row.until <= Date.now()) memory.delete(key);
      if (memory.size >= 256) memory.delete(memory.keys().next().value!);
      memory.set(id, { owner, until: Date.now() + 30 * 60_000, envelope: structuredClone(envelope) });
    },
  };
}
/** All application inference uses this one Haiku path; Meta keys and provider-sticky cursors are never used. */
export function inferenceFor(deps: InferenceDeps, userId: string, kind: string, opts: { personUsd?: number; signal?: AbortSignal; onCost?: (usd: number) => Promise<void>; sessionId?: string } = {}): { responses: Responder } {
  const p = policyFor(deps), setup = deps.inference!, scope = `run:${randomUUID()}`;
  const quote = setup.transport?.quote ?? haikuMaximumCharge;
  const dispatch = createNoMetaDispatcher(p, async d => {
    // A queued hold or background job may outlive its initial consent read. Check again immediately before I/O.
    await assertAiConsent(deps.db, userId);
    // Local adapter/preparation failures are not provider charges. Keep this per dispatch,
    // not per client: sibling vision calls may be running concurrently. Opaque test transports
    // cannot prove a pre-HTTP boundary, so their errors remain conservatively unconfirmed.
    let attempted = !!setup.transport;
    const directFetch: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://api.anthropic.com" || url.pathname !== "/v1/messages") throw new InferenceUnavailableError();
      init?.signal?.throwIfAborted();
      attempted = true;
      return (setup.fetch ?? fetch)(input, { ...init, redirect: "error" });
    };
    const send: Responder = setup.transport?.respond ?? (body => new ClaudeClient({ apiKey: setup.apiKey!, model: HAIKU_MODEL, fast: false,
      maxTokens: p.limits.outputTokens, maxRetries: 0, maxResumes: 0, maxSearchUses: 1,
      fetch: reservedFetch(stoppable(directFetch, opts.signal ?? new AbortController().signal)),
    }).responses(body));
    let result;
    try { result = await send(d.body); }
    catch (error) {
      if (attempted) {
        // Once fetch is attempted, even a disconnect/abort remains uncertain and consumes the full reservation.
        const usage: Usage = { model: HAIKU_MODEL, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 };
        await recordSpend(deps.db, userId, `${kind}:unconfirmed`, usage, d.maximumChargeUsd, deps.now());
        await opts.onCost?.(d.maximumChargeUsd);
      }
      throw error;
    }
    const valid = result.usage.model === HAIKU_MODEL && Number.isFinite(result.costUsd) && result.costUsd >= 0;
    const cost = valid ? result.costUsd : d.maximumChargeUsd;
    await recordSpend(deps.db, userId, valid ? kind : `${kind}:unconfirmed`, valid ? result.usage : { model: HAIKU_MODEL, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 }, cost, deps.now());
    await opts.onCost?.(cost);
    if (!valid || cost > d.maximumChargeUsd) throw new InferenceUnavailableError();
    if (result.functionCalls.length > Number(d.body.max_tool_calls)) throw new InferenceUnavailableError();
    return result;
  }, async (d, run) => withHold(deps.db, async () => {
    const current = policyFor(deps);
    await assertAiConsent(deps.db, userId);
    await collectInferencePolicy(deps.db, current.limits.dailyUsd, current.limits.totalUsd, deps.now(), scope, current.limits.callUsd, 32);
    await assertUserClaudeBudget(deps.db, userId, personLimit(opts.personUsd ?? 2, current.limits.dailyUsd), deps.now(), 0, true);
  }, run, userId, d.maximumChargeUsd, opts.signal, "claude", d.maximumChargeUsd, { scope }), () => deps.now().getTime());
  const respond: Responder = async body => {
    policyFor(deps);
    // Pilot: page-reading app tools remain; hosted search cannot fit the approved $0.05/request bound.
    if (!setup.transport && Array.isArray(body.tools) && body.tools.some(t => t?.type === "web_search")) {
      body = { ...body, tools: body.tools.filter(t => t?.type !== "web_search"), instructions: [body.instructions,
        "Live web search is unavailable. Use provided URLs with the page-reading tools when available. Never invent current prices, sellers, availability or source evidence. Say when information cannot be verified."].filter(Boolean).join("\n") };
    }
    const vision = JSON.stringify(body.input ?? "").includes('"input_image"');
    const hasWeb = Array.isArray(body.tools) && body.tools.some(t => t?.type === "web_search");
    try { return await dispatch({ capability: vision ? "vision" : hasWeb ? "web-search" : "text", body, maximumChargeUsd: quote(body, p), signal: opts.signal }); }
    catch (error) { if (error instanceof SpendLimitError || error instanceof ModelHistoryError) throw error;
      if (error instanceof MetaApiError) throw new MetaApiError(error.status, INFERENCE_UNAVAILABLE);
      throw new InferenceUnavailableError(); }
  };
  const history = deps.modelHistory ? postgresHistory(deps.db, userId, opts.sessionId) : memoryHistory(`${userId}:${opts.sessionId ?? ""}`);
  // Offline protocol fixtures may supply their own history. Server configuration never injects a transport.
  return { responses: setup.transport && !deps.modelHistory ? respond : modelRouter({ id: "anthropic-api:claude-haiku-5-5", respond }, undefined, history, () => false) };
}
