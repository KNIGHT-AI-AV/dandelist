import type { DreamEvent, LifeContext } from "@dandelist/catalogue/dream";
import type { Meta } from "../agent/agent";
import type { Fetcher } from "../agent/tools";
import type { Db } from "../db";

/** Per-turn ceilings, so one message can't run up an unbounded bill or keep a phone waiting for minutes. */
export const MAX_TOOL_CALLS_PER_TURN = 10;
export const MAX_META_CALLS_PER_TURN = 24;
export const MAX_PAGE_READS_PER_TURN = 40;

export class TurnLimitError extends Error {
  constructor(readonly what: "tools" | "meta" | "pages") {
    super(what === "pages" ? "Read enough pages for one message." : "That's as much as one message can do. Say more to keep going.");
  }
}

export class TurnBudget {
  toolCalls = 0;
  metaCalls = 0;
  pageReads = 0;
  tool() {
    if (this.toolCalls >= MAX_TOOL_CALLS_PER_TURN) throw new TurnLimitError("tools");
    this.toolCalls++;
  }
  meta() {
    if (this.metaCalls >= MAX_META_CALLS_PER_TURN) throw new TurnLimitError("meta");
    this.metaCalls++;
  }
  /** Reserves up to `n` page reads and returns how many may go ahead. */
  pages(n: number): number {
    const ok = Math.max(0, Math.min(n, MAX_PAGE_READS_PER_TURN - this.pageReads));
    this.pageReads += ok;
    return ok;
  }
}

export interface ApifyConfig {
  token: string;
  /** Hard cap on Apify spend a day (UTC), shared with the price agent's shopping search; the free credit is $5 a month. */
  dailyUsd: number;
  actor?: string;
  fetch?: Fetcher;
}

export interface DreamCtx {
  db: Db;
  /** Muse Spark, with the spend caps and the per-turn ceiling checked before every call. */
  meta: Meta;
  web: Fetcher;
  /** Fetch for fixed, trusted APIs (ECB rates, Wikimedia Commons). */
  api: Fetcher;
  apify?: ApifyConfig;
  userId: string;
  sessionId: string;
  life: LifeContext;
  now: () => Date;
  budget: TurnBudget;
  emit: (e: DreamEvent) => Promise<void>;
  /** Steps show the person the agent's real work as it happens. */
  step: (id: string, state: "running" | "done", text: string) => Promise<void>;
  /** The Dandy's voice line (agent/persona.ts), or empty. */
  voice?: string;
}

/** Strict JSON schema helpers in the shape Meta's Responses API takes. */
export const strictObject = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
/** Asks Meta's web_search to return what each search found, so we read real result pages, not remembered URLs. */
export const SEARCH_INCLUDE = ["web_search_call.action.sources", "web_search_call.results"];

/** The pages Meta's web searches actually returned, from a Responses payload made with SEARCH_INCLUDE. */
export function searchResults(raw: unknown): { url: string; title: string }[] {
  const out = new Map<string, string>();
  const output = (raw as { output?: unknown[] } | null)?.output;
  for (const item of Array.isArray(output) ? output : []) {
    const it = item as { type?: string; results?: unknown; action?: { sources?: unknown } };
    if (it.type !== "web_search_call") continue;
    for (const r of Array.isArray(it.results) ? it.results : []) {
      const x = r as { url?: unknown; title?: unknown };
      if (typeof x.url === "string" && /^https?:\/\//i.test(x.url)) out.set(x.url, typeof x.title === "string" ? x.title.slice(0, 200) : out.get(x.url) ?? "");
    }
    for (const s of Array.isArray(it.action?.sources) ? it.action!.sources as unknown[] : []) {
      const x = s as { url?: unknown };
      if (typeof x.url === "string" && /^https?:\/\//i.test(x.url) && !out.has(x.url)) out.set(x.url, "");
    }
  }
  return [...out.entries()].map(([url, title]) => ({ url, title }));
}

/** Parses the model's JSON answer, tolerating a fence or a lead-in sentence before the object. */
export function json(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw e;
  }
}
