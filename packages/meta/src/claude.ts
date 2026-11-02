import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MetaApiError, type Citation, type FunctionCall, type ResponsesResult } from "./client";
import { claudeCostUsd, type Usage } from "./pricing";

/**
 * Claude as a working agent under Meta. The owner's note, in his words:
 * (i cant afford credits on Meta and claude gifted me credits but i want to use meta for all!)
 *
 * So Meta's Muse Spark answers first, always; this client answers only a call the API hands down to it when Meta
 * refuses (apps/api/src/under.ts). It has MetaClient.responses' shape: it takes the OpenAI-Responses-style body the
 * routes send, asks Claude Opus 5.5 at low effort in fast mode through the Messages API, and maps the reply back into
 * a ResponsesResult, so the routes read either the same way.
 *
 * - `instructions` become the system prompt; `input` (words, message items, pictures, function calls and their
 *   outputs) becomes messages with tool_use and tool_result blocks.
 * - Function tools become Claude tools; Meta's built-in `web_search` becomes `web_search_20260209`, capped by
 *   `max_tool_calls`. `text.format` json_schema becomes `output_config.format`; beside the web search, whose citations
 *   structured outputs refuse, the schema is asked for in words instead and the JSON read out of the answer.
 * - Pictures Claude can't read (not JPEG, PNG, GIF or WebP, or over about 3.7 MB) throw ClaudeImageError unsent.
 * - `previous_response_id` is a conversation this client kept in memory under the id it returned, while it can go on
 *   (the request offered tools, or the reply stopped for a tool or a pause) and within a byte budget. Claude reads the
 *   whole history every time, and Opus 5.5 checks that its earlier thinking was made with the same system prompt,
 *   tools and messages, so a conversation is only ever appended to: the first request's system prompt and tools stay,
 *   changed instructions arrive as a system message, and a follow-up that sends no tools keeps them with tool_choice
 *   none.
 * - Thinking can't be switched off on Opus 5.5 and a forced tool_choice is refused, so neither is sent. Meta's
 *   reasoning effort and `include` have no counterpart and are dropped; the effort is always low.
 * - A server-side search loop that pauses (`pause_turn`) is resumed by sending the paused turn back unchanged, at most
 *   four times, and only while `mayResume` agrees (the API checks Claude's caps there, with what the call has spent).
 */

export const CLAUDE_MODEL = "claude-opus-5-5";
export const CLAUDE_FAST_BETA = "fast-mode-2026-02-01";
/** Lets a request whose tool set grew drop the earlier thinking instead of failing (see responses). */
const BINDING_BETA = "thinking-binding-controls-2026-08-01";
/** Room for the adaptive thinking and the answer. The SDK refuses a non-streaming call much past 21k. */
export const CLAUDE_MAX_TOKENS = 16_000;
/** A paused search loop is resumed at most this many times; then the call answers with what it has. */
const MAX_RESUMES = 4;
const ID_PREFIX = "claude_";

/** True for an id this client returned: a conversation that can only go on with Claude. */
export const isClaudeResponseId = (id: unknown): id is string => typeof id === "string" && id.startsWith(ID_PREFIX);

/** A Meta-shaped error, so the routes' handling (429 means busy, the rest means try again) reads Claude's alike. */
export class ClaudeApiError extends MetaApiError {
  constructor(status: number, body: string) {
    super(status, body);
    this.message = `Claude API returned ${status}: ${body.slice(0, 300)}`;
  }
}

/** A picture Claude can't read: not JPEG, PNG, GIF or WebP, or too big. Thrown before anything is sent or spent. */
export class ClaudeImageError extends Error {}

/** The pictures Claude reads, and the most one may weigh: 5 MB once base64-encoded, so a little under 3.75 MB raw. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 3.7 * 1024 * 1024;
/** Addresses whose extension says Claude can't read the picture behind them. */
const UNREADABLE = /\.(avif|heic|heif|jxl|svg|bmp|tiff?|ico)$/i;

interface Conversation {
  system?: string;
  /** The instructions now in effect: the system prompt, or the last system message added after it. */
  rules?: string;
  tools: BetaToolUnion[];
  messages: BetaMessageParam[];
  /** Set once the tool set grew: from then on the earlier thinking is dropped on every request, not refused. */
  drops?: boolean;
  /** Roughly what the conversation weighs in memory (its JSON length), photos included. */
  bytes: number;
}

/** What a part of a conversation weighs, as JSON. */
const weight = (v: unknown) => JSON.stringify(v ?? null).length;

/**
 * Conversations by the response id that ends them, for `previous_response_id`. A chain's calls run within minutes of
 * each other, so entries go after `ttlMs`, and the oldest go first past `max` of them or past `maxBytes` in all (the
 * API runs in 1 GB, and a conversation can carry photos). One bigger than `maxBytes` on its own is never kept.
 */
export class ClaudeHistory {
  private readonly entries = new Map<string, { conversation: Conversation; at: number }>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private bytes = 0;

  constructor(opts: { ttlMs?: number; max?: number; maxBytes?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? 15 * 60_000;
    this.max = opts.max ?? 300;
    this.maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    this.now = opts.now ?? Date.now;
  }

  get(id: string): Conversation | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.drop(id);
      return undefined;
    }
    return entry.conversation;
  }

  set(id: string, conversation: Conversation): void {
    const at = this.now();
    for (const [key, entry] of this.entries) if (at - entry.at > this.ttlMs) this.drop(key);
    if (conversation.bytes > this.maxBytes) return;
    this.entries.set(id, { conversation, at });
    this.bytes += conversation.bytes;
    while (this.entries.size > this.max || this.bytes > this.maxBytes) this.drop(this.entries.keys().next().value!);
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.bytes -= entry.conversation.bytes;
  }
}

/** One per process: the routes make a client for each request, and the calls of one chain must find each other. */
const sharedHistory = new ClaudeHistory();

export interface ClaudeClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called once per responses() call (also when it fails partway), so the API records spend first. */
  onUsage?: (usage: Usage, costUsd: number) => void | Promise<void>;
  /** Fast mode: on unless set false. Twice the price, for answers that keep up with Meta's. */
  fast?: boolean;
  /** Where conversations wait between calls; one per process unless a test passes its own. */
  history?: ClaudeHistory;
  /** Retries of a 408, 409, 429 or 5xx; one, as Meta's client does. Tests set 0. */
  maxRetries?: number;
  /**
   * Asked before each resume of a paused search, with what the call has spent so far (not yet in any ledger). Each
   * resume can run to another 16k tokens, so false stops resuming and the call answers with what it has, as from a
   * final reply. A failure here fails the call, with what it spent reported.
   */
  mayResume?: (spentUsd: number) => Promise<boolean>;
}

type Json = Record<string, unknown>;

/** Structured outputs and strict tools refuse these JSON Schema keywords (a 400); the routes check the answers anyway. */
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "minContains",
  "maxContains",
]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
/** Keywords whose values are data, never schemas. */
const VALUES = new Set(["enum", "const", "required", "default", "examples", "description", "title", "pattern", "type"]);
/** Keywords whose values map names to schemas. */
const NAMED = new Set(["properties", "$defs", "definitions", "patternProperties"]);

/**
 * A JSON Schema with what Claude's structured outputs don't support taken out: number and length bounds, array
 * bounds past minItems 0 or 1, and string formats outside its list. Everything else, enums included, stays.
 */
export function claudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(claudeSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema as Json)) {
    if (UNSUPPORTED.has(key)) continue;
    if (key === "minItems" && value !== 0 && value !== 1) continue;
    if (key === "format" && !(typeof value === "string" && FORMATS.has(value))) continue;
    if (NAMED.has(key) && value && typeof value === "object") out[key] = Object.fromEntries(Object.entries(value as Json).map(([name, s]) => [name, claudeSchema(s)]));
    else out[key] = VALUES.has(key) ? value : claudeSchema(value);
  }
  return out;
}

/**
 * A picture from a data: URL or a public address; anything else is left out. One Claude can't read (an AVIF, or over
 * about 3.7 MB) throws ClaudeImageError here, before the call: Claude would only refuse it with a 400.
 */
function image(url: unknown): BetaImageBlockParam | null {
  const address = typeof url === "string" ? url : typeof (url as Json | null)?.url === "string" ? String((url as Json).url) : "";
  const data = /^data:(image\/[\w.+-]+);base64,/i.exec(address);
  if (data) {
    const type = data[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
    if (!IMAGE_TYPES.has(type)) throw new ClaudeImageError(`Claude can't read a ${type} picture`);
    const encoded = address.length - data[0].length;
    if (encoded * 0.75 > MAX_IMAGE_BYTES) throw new ClaudeImageError(`The picture is ${Math.round((encoded * 0.75) / 1024)} KB, over Claude's limit`);
    return { type: "image", source: { type: "base64", media_type: type as "image/jpeg", data: address.slice(data[0].length) } };
  }
  if (/^https?:\/\//i.test(address)) {
    let path = "";
    try {
      path = new URL(address).pathname;
    } catch {
      return null;
    }
    if (UNREADABLE.test(path)) throw new ClaudeImageError(`Claude can't read the picture at ${path.slice(-40)}`);
    return { type: "image", source: { type: "url", url: address } };
  }
  return null;
}

/** What a JSON answer is asked for in words, when the web search is on and output_config.format can't be used. */
const jsonAsk = (schema: unknown) =>
  `Answer with one JSON value only, with no words, notes or code fence before or after it, matching this JSON Schema: ${JSON.stringify(schema)}`;

/** The JSON value in an answer asked for in words (bare, fenced, or after a lead-in line), checked to parse; else null. */
function jsonIn(text: string, schema: unknown): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const tries = [text.trim(), fenced?.trim() ?? ""];
  const open = text.search(/[{[]/);
  const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (open >= 0 && close > open) tries.push(text.slice(open, close + 1));
  const want = (schema as { type?: unknown } | null)?.type;
  for (const t of tries) {
    if (!t) continue;
    try {
      const value: unknown = JSON.parse(t);
      if (!value || typeof value !== "object") continue;
      if ((want === "object" && Array.isArray(value)) || (want === "array" && !Array.isArray(value))) continue;
      return JSON.stringify(value);
    } catch {
      // The next way of reading it.
    }
  }
  return null;
}

/** The parts of one Responses message as Claude content: words stay a plain string, parts become blocks. */
function parts(content: unknown): string | BetaContentBlockParam[] {
  if (typeof content === "string") return content;
  const blocks: BetaContentBlockParam[] = [];
  for (const part of Array.isArray(content) ? (content as Json[]) : []) {
    if ((part.type === "input_text" || part.type === "output_text" || part.type === "text") && typeof part.text === "string") blocks.push({ type: "text", text: part.text });
    else if (part.type === "input_image") {
      const picture = image(part.image_url);
      if (picture) blocks.push(picture);
    }
  }
  return blocks;
}

const blocks = (content: string | BetaContentBlockParam[]): BetaContentBlockParam[] => (typeof content === "string" ? [{ type: "text", text: content }] : content);

/** Arguments as the model wrote them, for replaying a function call; unreadable ones replay as empty. */
function args(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * A Responses `input` as Claude messages, neighbours of one role merged (tool results first, as Claude needs them),
 * and any system or developer items as extra instructions.
 */
function inputMessages(input: unknown): { messages: BetaMessageParam[]; extra: string[] } {
  const messages: BetaMessageParam[] = [];
  const extra: string[] = [];
  const push = (role: "user" | "assistant", content: string | BetaContentBlockParam[]) => {
    if (typeof content !== "string" && !content.length) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content = [...blocks(last.content as string | BetaContentBlockParam[]), ...blocks(content)];
    else messages.push({ role, content });
  };
  if (typeof input === "string") push("user", input);
  for (const item of Array.isArray(input) ? (input as Json[]) : []) {
    if (item.type === "function_call_output") {
      push("user", [{ type: "tool_result", tool_use_id: String(item.call_id), content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "") }]);
    } else if (item.type === "function_call") {
      push("assistant", [{ type: "tool_use", id: String(item.call_id ?? item.id), name: String(item.name), input: args(item.arguments) }]);
    } else if (item.role === "user" || item.role === "assistant") {
      push(item.role, parts(item.content));
    } else if (item.role === "system" || item.role === "developer") {
      const said = parts(item.content);
      const text = typeof said === "string" ? said : said.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      if (text.trim()) extra.push(text);
    }
  }
  // Claude reads a turn's tool results only ahead of anything else the turn says.
  for (const m of messages) {
    if (m.role === "user" && Array.isArray(m.content)) m.content = [...m.content.filter((b) => b.type === "tool_result"), ...m.content.filter((b) => b.type !== "tool_result")];
  }
  return { messages, extra };
}

/** Meta's tools as Claude's: function tools as they are, the built-in web search as Claude's. Others aren't offered. */
function claudeTools(tools: unknown, maxUses: number | undefined): BetaToolUnion[] {
  const out: BetaToolUnion[] = [];
  for (const t of Array.isArray(tools) ? (tools as Json[]) : []) {
    if (t.type === "web_search" || t.type === "web_search_preview") {
      out.push({ type: "web_search_20260209", name: "web_search", ...(maxUses ? { max_uses: maxUses } : {}) });
    } else if (t.type === "function" && typeof t.name === "string") {
      const parameters = (t.parameters ?? { type: "object", properties: {} }) as Json;
      out.push({
        name: t.name,
        ...(typeof t.description === "string" ? { description: t.description } : {}),
        input_schema: (t.strict ? claudeSchema(parameters) : parameters) as { type: "object" },
        ...(t.strict ? { strict: true } : {}),
      });
    }
  }
  return out;
}

const toolName = (t: BetaToolUnion) => (t as { name: string }).name;

/** The SDK's failures with a status as ClaudeApiError; anything else (a stop, a lost connection) as it was. */
function asClaudeError(e: unknown): unknown {
  if (e instanceof Anthropic.APIError && typeof e.status === "number") return new ClaudeApiError(e.status, JSON.stringify(e.error ?? e.message));
  return e;
}

export class ClaudeClient {
  private readonly sdk: Anthropic;
  private readonly history: ClaudeHistory;
  private readonly fast: boolean;

  constructor(private readonly opts: ClaudeClientOptions) {
    if (!opts.apiKey) throw new Error("ClaudeClient needs an API key");
    // The address and the key are always the ones given, never ones read from the environment.
    this.sdk = new Anthropic({ apiKey: opts.apiKey, authToken: null, baseURL: opts.baseUrl ?? "https://api.anthropic.com", maxRetries: opts.maxRetries ?? 1, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    this.history = opts.history ?? sharedHistory;
    this.fast = opts.fast ?? true;
  }

  /** The Responses API's shape on Claude's Messages API. `body.model` is ignored: it is always Opus 5.5. */
  async responses(body: Json): Promise<ResponsesResult> {
    const previous = body.previous_response_id;
    const prior = previous === undefined || previous === null ? undefined : this.history.get(String(previous));
    if (previous != null && !prior) throw new ClaudeApiError(400, '{"error":{"message":"referenced response not found or expired"}}');

    const instructions = typeof body.instructions === "string" && body.instructions.trim() ? body.instructions : undefined;
    const { messages: added, extra } = inputMessages(body.input);
    const maxUses = Number.isInteger(body.max_tool_calls) && Number(body.max_tool_calls) > 0 ? Number(body.max_tool_calls) : undefined;
    const asked = claudeTools(body.tools, maxUses);
    // Append only: the first system prompt and tools stay, and a tool the conversation lacks goes at the end.
    const fresh = prior ? asked.filter((t) => !prior.tools.some((p) => toolName(p) === toolName(t))) : asked;
    const tools = [...(prior?.tools ?? []), ...fresh];

    // JSON comes through output_config.format, except beside the web search: its results carry citations, which
    // structured outputs refuse. There the schema is asked for in words and the JSON read out of the answer.
    const format = (body.text as { format?: Json } | undefined)?.format;
    const wantsJson = format?.type === "json_schema" && !!format.schema;
    const inWords = wantsJson && tools.some((t) => toolName(t) === "web_search");
    const json: "format" | "words" | false = !wantsJson ? false : inWords ? "words" : "format";
    const ask = inWords ? jsonAsk(format!.schema) : "";

    let conversation: Conversation;
    if (!prior) {
      const system = [instructions, ...extra, ask].filter(Boolean).join("\n") || undefined;
      conversation = { system, rules: instructions, tools, messages: added, bytes: 0 };
    } else {
      // Instructions that changed, and a JSON ask, come as one system message after the new turn.
      const note = [instructions && instructions !== prior.rules ? instructions : "", ...extra, ask].filter(Boolean).join("\n");
      conversation = {
        system: prior.system,
        rules: instructions ?? prior.rules,
        tools,
        messages: [...prior.messages, ...added, ...(note ? [{ role: "system" as const, content: note }] : [])],
        drops: prior.drops || fresh.length > 0,
        bytes: prior.bytes,
      };
    }
    if (!added.length) throw new ClaudeApiError(400, '{"error":{"message":"there is nothing to answer"}}');

    const drops = !!conversation.drops;
    const betas = [...(this.fast ? [CLAUDE_FAST_BETA] : []), ...(drops ? [BINDING_BETA] : [])];
    const params: MessageCreateParamsNonStreaming = {
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      ...(conversation.system ? { system: conversation.system } : {}),
      messages: conversation.messages,
      ...(tools.length ? { tools } : {}),
      // A follow-up that sends no tools wants an answer, not another call; the tools stay so the history still reads.
      ...(tools.length && !asked.length ? { tool_choice: { type: "none" as const } } : {}),
      output_config: { effort: "low", ...(json === "format" ? { format: { type: "json_schema" as const, schema: claudeSchema(format!.schema) as Record<string, unknown> } } : {}) },
      // A request with tools, or part of a conversation, is likely to be followed by another that rereads it.
      ...(tools.length || prior ? { cache_control: { type: "ephemeral" as const } } : {}),
      ...(this.fast ? { speed: "fast" as const } : {}),
      // Only once the tool set grew: the earlier thinking no longer matches it, so it is dropped rather than refused.
      ...(drops ? { thinking: { type: "adaptive" as const, block_binding: { prefix_mismatch_behavior: "drop_block" as const } } } : {}),
      ...(betas.length ? { betas } : {}),
    };

    const replies: BetaMessage[] = [];
    let sent = conversation.messages;
    try {
      for (let resumes = 0; ; resumes++) {
        const reply = await this.sdk.beta.messages.create({ ...params, messages: sent });
        replies.push(reply);
        sent = [...sent, { role: "assistant", content: reply.content as unknown as BetaContentBlockParam[] }];
        if (reply.stop_reason !== "pause_turn" || resumes >= MAX_RESUMES) break;
        if (this.opts.mayResume && !(await this.opts.mayResume(this.tally(replies).costUsd))) break;
      }
    } catch (e) {
      // What the finished replies cost is spent all the same.
      if (replies.length) await this.report(replies);
      throw asClaudeError(e);
    }

    const id = `${ID_PREFIX}${randomUUID()}`;
    const stop = replies.at(-1)?.stop_reason;
    // Kept only when it can go on: the request offered tools, or the reply stopped for a tool or a pause. Every other
    // call (a photo check, a reading, the answer that closes a chain) is over, and its photos needn't wait in memory.
    if (asked.length || stop === "tool_use" || stop === "pause_turn") {
      // A turn that was nothing but what is taken out (and its thinking) goes altogether.
      const trimLast = (out: (b: BetaContentBlockParam) => boolean) => {
        const kept = (sent.at(-1)!.content as BetaContentBlockParam[]).filter((b) => !out(b));
        sent = kept.some((b) => b.type !== "thinking" && b.type !== "redacted_thinking") ? [...sent.slice(0, -1), { role: "assistant", content: kept }] : sent.slice(0, -1);
      };
      // read() drops a call cut off or refused, so the history does too: a tool_use with no tool_result after it would
      // fail the next request.
      if (stop === "max_tokens" || stop === "refusal") trimLast((b) => b.type === "tool_use");
      // A search left paused (the caps stopped its resumes, or it paused too often) ran no further than its last result:
      // a server_tool_use with no result after it would leave the next request a search to finish, not a turn to answer.
      if (stop === "pause_turn") {
        const answered = new Set((sent.at(-1)!.content as BetaContentBlockParam[]).map((b) => (b as { tool_use_id?: unknown }).tool_use_id).filter((v): v is string => typeof v === "string"));
        trimLast((b) => b.type === "server_tool_use" && !answered.has(b.id));
      }
      const bytes = prior ? prior.bytes + weight(fresh) + weight(sent.slice(prior.messages.length)) : weight(conversation.system) + weight(tools) + weight(sent);
      this.history.set(id, { ...conversation, messages: sent, bytes });
    }
    const { usage, costUsd } = await this.report(replies);
    return { id, ...read(replies, json, id, format?.schema), usage, costUsd };
  }

  /** Adds up what the replies used, prices them, and reports it once. */
  private async report(replies: BetaMessage[]): Promise<{ usage: Usage; costUsd: number }> {
    const { usage, costUsd } = this.tally(replies);
    await this.opts.onUsage?.(usage, costUsd);
    return { usage, costUsd };
  }

  /** What the replies used, each priced at the speed it ran. */
  private tally(replies: BetaMessage[]): { usage: Usage; costUsd: number } {
    const usage: Usage = { model: CLAUDE_MODEL, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, searches: 0 };
    let costUsd = 0;
    for (const reply of replies) {
      const u = reply.usage;
      const one: Usage = {
        model: CLAUDE_MODEL,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        cachedInputTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        searches: u.server_tool_use?.web_search_requests ?? 0,
      };
      usage.inputTokens += one.inputTokens;
      usage.cachedInputTokens += one.cachedInputTokens;
      usage.cacheWriteTokens! += one.cacheWriteTokens!;
      usage.outputTokens += one.outputTokens;
      usage.searches += one.searches;
      costUsd += claudeCostUsd(one, u.speed ? u.speed === "fast" : this.fast);
    }
    return { usage, costUsd };
  }
}

/**
 * The replies in a ResponsesResult's terms. Text runs between tool calls are separate thoughts, joined with a space;
 * a JSON answer is the last run only, after any searching, and one asked for in words is the JSON read out of it (the
 * run as written when none parses, for the route to judge). `raw.output` carries the searches as Responses
 * `web_search_call` items with their results, so the readers of Meta's payloads (dream/context.ts) read Claude's too.
 */
function read(replies: BetaMessage[], json: "format" | "words" | false, id: string, schema?: unknown): Omit<ResponsesResult, "id" | "usage" | "costUsd"> {
  const runs: string[] = [];
  const citations: Citation[] = [];
  const cited = new Set<string>();
  let functionCalls: FunctionCall[] = [];
  const searchQueries: string[] = [];
  const output: Json[] = [];
  const searches = new Map<string, { status: string; action: { sources: Json[] }; results: Json[] }>();
  let message: { content: Json[] } | null = null;
  for (const reply of replies) {
    for (const block of reply.content) {
      if (block.type === "text") {
        if (!message) {
          runs.push("");
          message = { content: [] };
          output.push({ type: "message", role: "assistant", ...message });
        }
        runs[runs.length - 1] += block.text;
        const annotations: Json[] = [];
        for (const c of block.citations ?? []) {
          if (c.type !== "web_search_result_location") continue;
          annotations.push({ type: "url_citation", url: c.url, ...(c.title ? { title: c.title } : {}) });
          if (!cited.has(c.url)) {
            cited.add(c.url);
            citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}) });
          }
        }
        message.content.push({ type: "output_text", text: block.text, annotations });
        continue;
      }
      message = null;
      if (block.type === "tool_use") {
        const call = { callId: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) };
        functionCalls.push(call);
        output.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments });
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = typeof block.input?.query === "string" ? block.input.query : "";
        if (query) searchQueries.push(query);
        const item = { type: "web_search_call", id: block.id, status: "completed", action: { type: "search", query, sources: [] as Json[] }, results: [] as Json[] };
        searches.set(block.id, item);
        output.push(item);
      } else if (block.type === "web_search_tool_result") {
        const item = searches.get(block.tool_use_id);
        if (!item) continue;
        if (!Array.isArray(block.content)) item.status = "failed";
        else
          for (const r of block.content) {
            item.results.push({ url: r.url, title: r.title });
            item.action.sources.push({ type: "url", url: r.url });
          }
      }
    }
  }
  // A call cut off at max_tokens may carry half its arguments, and a refused turn's calls are never run.
  const stop = replies.at(-1)?.stop_reason;
  if (stop === "max_tokens" || stop === "refusal") functionCalls = [];
  let text = "";
  for (const run of runs) text += (text && !/\s$/.test(text) ? " " : "") + run;
  if (json) {
    const last = runs.at(-1) ?? "";
    text = json === "words" ? (jsonIn(last, schema) ?? jsonIn(text, schema) ?? last) : last;
  }
  const raw = { id, model: CLAUDE_MODEL, output: functionCalls.length ? output : output.filter((o) => o.type !== "function_call"), claude: replies };
  return { text, citations, functionCalls, searchQueries, raw };
}
