import { estimateCostUsd, type Usage } from "./pricing";

export const META_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";
export const IMAGE_MODEL = "muse-image-1.0";

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Meta Model API returned ${status}: ${body.slice(0, 300)}`);
  }
}

export interface Citation {
  url: string;
  title?: string;
}

export interface FunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ResponsesResult {
  id: string;
  text: string;
  citations: Citation[];
  functionCalls: FunctionCall[];
  /** Queries the built-in web_search tool ran, when Meta reports them. */
  searchQueries: string[];
  usage: Usage;
  costUsd: number;
  raw: unknown;
}

export interface ImagesResult {
  /** Decoded image bytes, one per returned picture. */
  images: Buffer[];
  /** The encoding Meta reports, such as webp or jpeg. */
  format: string;
  usage: Usage;
  costUsd: number;
}

export interface MetaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called once per successful request, so the API can record spend before anything else happens. */
  onUsage?: (usage: Usage, costUsd: number) => void | Promise<void>;
  /** Wait before the one retry of a 502, 503 or 504. Tests set 0. */
  retryDelayMs?: number;
}

type Json = Record<string, unknown>;

export class MetaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MetaClientOptions) {
    if (!opts.apiKey) throw new Error("MetaClient needs an API key");
    this.baseUrl = opts.baseUrl ?? META_BASE_URL;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Calls the Responses API. `body.model` defaults to Muse Spark 1.3. */
  async responses(body: Json): Promise<ResponsesResult> {
    const payload = { model: DEFAULT_MODEL, ...body };
    const raw = (await this.post("/responses", payload)) as Json;
    const result = parseResponses(raw, String(payload.model));
    await this.opts.onUsage?.(result.usage, result.costUsd);
    return result;
  }

  /**
   * Muse Image: `generations` makes a picture from a prompt, `edits` changes the pictures in `body.images`.
   * `body.model` defaults to muse-image-1.0; each returned image is billed at a flat price.
   */
  async images(op: "generations" | "edits", body: Json): Promise<ImagesResult> {
    const payload = { model: IMAGE_MODEL, n: 1, ...body };
    const raw = (await this.post(`/images/${op}`, payload)) as Json;
    const images: Buffer[] = [];
    for (const d of Array.isArray(raw.data) ? (raw.data as Json[]) : []) {
      const bytes = typeof d.b64_json === "string" ? Buffer.from(d.b64_json, "base64") : undefined;
      if (bytes?.length) images.push(bytes);
    }
    const u = (raw.usage ?? {}) as Json;
    const usage: Usage = {
      model: String(payload.model),
      inputTokens: Number(u.input_tokens ?? 0),
      cachedInputTokens: 0,
      outputTokens: Number(u.output_tokens ?? 0),
      searches: 0,
      images: images.length,
    };
    const costUsd = estimateCostUsd(usage);
    await this.opts.onUsage?.(usage, costUsd);
    return { images, format: typeof raw.output_format === "string" ? raw.output_format : "", usage, costUsd };
  }

  async transcribe(audio: Blob, filename: string): Promise<{ text: string; raw: unknown }> {
    const form = new FormData();
    form.append("model", "muse-voice-transcribe-1.0");
    form.append("file", audio, filename);
    const res = await this.fetchImpl(`${this.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new MetaApiError(res.status, text);
    const raw = JSON.parse(text) as Json;
    return { text: String(raw.text ?? raw.transcript ?? ""), raw };
  }

  /** One retry, a second later, when Meta answers 502, 503 or 504: those failed before any work was billed. */
  private async post(path: string, payload: unknown): Promise<unknown> {
    const body = JSON.stringify(payload);
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      if (attempt === 0 && [502, 503, 504].includes(res.status)) {
        await new Promise((r) => setTimeout(r, this.opts.retryDelayMs ?? 1000));
        continue;
      }
      throw new MetaApiError(res.status, text);
    }
  }
}

/** Reads an OpenAI-style Responses payload: output text, URL citations, function calls, web searches and usage. */
export function parseResponses(raw: Json, model: string): ResponsesResult {
  const output = Array.isArray(raw.output) ? (raw.output as Json[]) : [];
  let text = "";
  const citations: Citation[] = [];
  const functionCalls: FunctionCall[] = [];
  const searchQueries: string[] = [];
  let searches = 0;
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Json[]) {
        if (part.type === "output_text" && typeof part.text === "string") {
          text += part.text;
          for (const a of (Array.isArray(part.annotations) ? part.annotations : []) as Json[]) {
            if (a.type === "url_citation" && typeof a.url === "string") {
              citations.push({ url: a.url, title: typeof a.title === "string" ? a.title : undefined });
            }
          }
        }
      }
    } else if (item.type === "function_call") {
      functionCalls.push({ callId: String(item.call_id ?? item.id), name: String(item.name), arguments: String(item.arguments ?? "{}") });
    } else if (item.type === "web_search_call") {
      searches++;
      const action = (item.action ?? {}) as Json;
      const query = action.query ?? item.query;
      if (typeof query === "string" && query) searchQueries.push(query);
    }
  }
  if (!text && typeof raw.output_text === "string") text = raw.output_text;
  const u = (raw.usage ?? {}) as Json;
  const inDetails = (u.input_tokens_details ?? {}) as Json;
  const images = Number(u.images_processed ?? 0);
  const usage: Usage = {
    model,
    inputTokens: Number(u.input_tokens ?? 0),
    cachedInputTokens: Number(inDetails.cached_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    searches,
    ...(images > 0 ? { images } : {}),
  };
  return { id: String(raw.id ?? ""), text, citations, functionCalls, searchQueries, usage, costUsd: estimateCostUsd(usage), raw };
}
