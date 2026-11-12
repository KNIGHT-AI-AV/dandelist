import { randomUUID } from "node:crypto";
import { DEFAULT_MODEL } from "@dandelist/meta";
import type { ResponsesResult } from "@dandelist/meta";
import type { ModelAdapter, ModelRequest } from "./model-adapter";

type Json = Record<string, unknown>;
const toolJson = (value: string) => { try { return JSON.parse(value) as unknown; } catch { throw new Error("Invalid local tool JSON"); } };
const object = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported local model payload");
  return value as Json;
};
const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new Error("Local text input required");
  return value.map(part => {
    const item = object(part);
    if (!["input_text", "output_text", "text"].includes(String(item.type)) || typeof item.text !== "string") throw new Error("Local text input required");
    return item.text;
  }).join("\n");
};
export function localModelEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port ||
    url.username || url.password || url.search || url.hash || !["/v1", "/v1/"].includes(url.pathname)) throw new Error("Local evaluation requires a fixed loopback /v1 endpoint");
  url.pathname = "/v1/chat/completions";
  return url;
}
export interface LocalModelOptions {
  evaluationOnly: true;
  endpoint: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** Evaluation adapter only. No server entry point imports this; there is no cloud fallback, auth header or tool executor. */
export function localTextAdapter(options: LocalModelOptions): ModelAdapter {
  if (options.evaluationOnly !== true || process.env.NODE_ENV === "production") throw new Error("Local model adapter is evaluation-only");
  const endpoint = localModelEndpoint(options.endpoint);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(options.model)) throw new Error("Explicit local model alias required");
  const timeoutMs = options.timeoutMs ?? 30_000, maxTokens = options.maxOutputTokens ?? 4096;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw new Error("Invalid local evaluation limits");
  const request = options.fetch ?? fetch;
  return { id: "local:" + options.model, needsSchemaPrompt: true, async respond(body: ModelRequest): Promise<ResponsesResult> {
    if (process.env.NODE_ENV === "production") throw new Error("Local model adapter is evaluation-only");
    if (options.signal?.aborted) throw new Error("Local evaluation cancelled");
    if (body.previous_response_id !== undefined || body.stream !== undefined && body.stream !== false || body.model !== undefined && body.model !== DEFAULT_MODEL && body.model !== options.model) throw new Error("Unsupported local model capability");
    if (body.instructions !== undefined && typeof body.instructions !== "string") throw new Error("Local instructions must be text");
    const tools = body.tools === undefined ? [] : Array.isArray(body.tools) ? body.tools.map(object) : (() => { throw new Error("Invalid local tools"); })();
    const names = new Set<string>();
    const convertedTools = tools.map(tool => {
      if (tool.type !== "function" || typeof tool.name !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tool.name) || names.has(tool.name)) throw new Error("Local function tools only");
      names.add(tool.name);
      return { type: "function", function: { name: tool.name, ...(typeof tool.description === "string" ? { description: tool.description } : {}), parameters: object(tool.parameters), strict: tool.strict !== false } };
    });
    const toolChoice = body.tool_choice ?? "auto";
    if (!["auto", "none", "required"].includes(String(toolChoice))) throw new Error("Unsupported local tool choice");
    if (toolChoice === "required" && !names.size) throw new Error("Local function tools required");
    const toolLimit = body.max_tool_calls ?? 8;
    if (!Number.isInteger(toolLimit) || Number(toolLimit) < 0 || Number(toolLimit) > 16) throw new Error("Invalid local tool limit");
    const format = body.text === undefined ? undefined : object(object(body.text).format);
    if (format && format.type !== "json_schema") throw new Error("Unsupported local output format");
    const schema = format ? object(format.schema) : undefined;
    const instructions = [typeof body.instructions === "string" ? body.instructions : "", schema ? "Return JSON matching this schema, including its field descriptions:\n" + JSON.stringify(schema) : ""].filter(Boolean).join("\n\n");
    const messages: Json[] = instructions ? [{ role: "system", content: instructions }] : [];
    const pending = new Set<string>(), seenCalls = new Set<string>();
    for (const raw of typeof body.input === "string" ? [{ role: "user", content: body.input }] : Array.isArray(body.input) ? body.input : (() => { throw new Error("Local input required"); })()) {
      const item = object(raw);
      if (item.type === "function_call") {
        if (typeof item.call_id !== "string" || !item.call_id || seenCalls.has(item.call_id) || typeof item.name !== "string" || !names.has(item.name) || typeof item.arguments !== "string") throw new Error("Invalid local tool history");
        toolJson(item.arguments);
        const call = { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } };
        const previous = messages.at(-1);
        if (pending.size && previous?.role === "assistant" && Array.isArray(previous.tool_calls)) previous.tool_calls.push(call);
        else if (pending.size) throw new Error("Incomplete local tool history");
        else messages.push({ role: "assistant", content: null, tool_calls: [call] });
        pending.add(item.call_id); seenCalls.add(item.call_id);
      } else if (item.type === "function_call_output") {
        if (typeof item.call_id !== "string" || !pending.delete(item.call_id) || typeof item.output !== "string") throw new Error("Invalid local tool output");
        messages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });
      } else {
        if (pending.size) throw new Error("Incomplete local tool history");
        if (item.type !== undefined && item.type !== "message" || !["user", "assistant"].includes(String(item.role))) throw new Error("Invalid local message role");
        messages.push({ role: item.role, content: text(item.content) });
      }
    }
    if (pending.size || !messages.some(m => m.role !== "system")) throw new Error("Incomplete local conversation");
    const requestedTokens = body.max_output_tokens ?? maxTokens;
    if (!Number.isInteger(requestedTokens) || Number(requestedTokens) < 1) throw new Error("Invalid local output limit");
    const effort = body.reasoning === undefined ? "low" : String(object(body.reasoning).effort);
    if (!["minimal", "low", "medium", "high"].includes(effort)) throw new Error("Unsupported local reasoning effort");
    const thinkingBudget = Math.min(({ minimal: 0, low: 256, medium: 512, high: 1024 } as Record<string, number>)[effort]!, Number(requestedTokens));
    const payload = { model: options.model, messages, stream: false, seed: 17, temperature: 0, max_tokens: Math.min(maxTokens, Number(requestedTokens)),
      reasoning_effort: effort, thinking_budget_tokens: thinkingBudget,
      chat_template_kwargs: { reasoning_effort: effort, ...(thinkingBudget === 0 ? { enable_thinking: false } : {}) },
      ...(convertedTools.length ? { tools: convertedTools, tool_choice: toolChoice } : {}),
      ...(schema ? { response_format: { type: "json_schema", json_schema: { name: typeof format!.name === "string" ? format!.name : "answer", schema, strict: true } } } : {}) };
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded) > 2_000_000) throw new Error("Local input limit exceeded");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      const response = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: encoded, redirect: "error", signal });
      if (!response.ok || !response.body) throw new Error("Local model request failed");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 512_000) { controller.abort(); throw new Error("Local response limit exceeded"); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!Array.isArray(raw.choices) || raw.choices.length !== 1 || raw.model !== options.model) throw new Error("Unexpected local model response");
      const choice = object(raw.choices[0]), message = object(choice.message);
      if (!["stop", "tool_calls"].includes(String(choice.finish_reason)) || message.refusal) throw new Error("Incomplete or refused local response");
      const calls = message.tool_calls === undefined ? [] : Array.isArray(message.tool_calls) ? message.tool_calls.map(object) : (() => { throw new Error("Invalid local tool calls"); })();
      if ((choice.finish_reason === "tool_calls") !== (calls.length > 0)) throw new Error("Inconsistent local completion");
      if (calls.length > Number(toolLimit) || toolChoice === "none" && calls.length || toolChoice === "required" && !calls.length) throw new Error("Local tool limit or choice violated");
      const ids = new Set<string>();
      const functionCalls = calls.map(call => {
        const fn = object(call.function);
        if (call.type !== "function" || typeof call.id !== "string" || !call.id || ids.has(call.id) || seenCalls.has(call.id) || typeof fn.name !== "string" || !names.has(fn.name) || typeof fn.arguments !== "string" || fn.arguments.length > 64_000) throw new Error("Invalid local tool call");
        JSON.parse(fn.arguments); ids.add(call.id); return { callId: call.id, name: fn.name, arguments: fn.arguments };
      });
      const answer = message.content == null ? "" : typeof message.content === "string" ? message.content : (() => { throw new Error("Invalid local text response"); })();
      if (!answer && !functionCalls.length) throw new Error("Empty local response");
      const usage = raw.usage === undefined ? {} : object(raw.usage);
      for (const field of ["prompt_tokens", "completion_tokens"]) if (usage[field] !== undefined && (!Number.isSafeInteger(usage[field]) || Number(usage[field]) < 0)) throw new Error("Invalid local token usage");
      return { id: "local_" + randomUUID(), text: answer, citations: [], functionCalls, searchQueries: [],
        usage: { model: options.model, inputTokens: Number(usage.prompt_tokens ?? 0), cachedInputTokens: 0, outputTokens: Number(usage.completion_tokens ?? 0), searches: 0 }, costUsd: 0,
        raw: { localEvaluation: true, tokenUsageMeasured: usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined, finishReason: choice.finish_reason } };
    } catch { throw new Error(signal.aborted ? "Local evaluation cancelled or timed out" : "Local evaluation failed"); }
    finally { clearTimeout(timer); }
  } };
}
