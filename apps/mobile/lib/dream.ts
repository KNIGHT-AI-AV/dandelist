import type { DreamAction, DreamEvent, KeepLine, LifeContext, Widget } from "@dandelist/catalogue/dream";
import { currentPersona, type PersonaId } from "./persona-state";
import type { NewWish } from "./wishes";

export type { DreamAction, DreamEvent, KeepLine, LifeContext, Widget };

/**
 * One entry in the conversation: what they said, what the Dandy said, its work rows, and the tools it opened.
 * `fresh` marks a line that arrived just now, which the chat writes out word by word; a resumed line shows whole.
 * `live` marks a tool that opened in this visit, whose questions the Dandy is waiting on; a resumed one waits for a tap.
 */
export type FeedItem =
  | { id: string; kind: "you"; text: string }
  | { id: string; kind: "agent"; text: string; fresh?: boolean }
  | { id: string; kind: "step"; text: string; state: "running" | "done" }
  | { id: string; kind: "widget"; widget: Widget; live?: boolean };

/** The tool the Dandy is waiting on: the newest one in the chat, while nothing has been said after it. */
export function askingWidget(feed: readonly FeedItem[]): string | null {
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i]!;
    if (f.kind === "you") return null;
    if (f.kind === "widget") return f.widget.id;
  }
  return null;
}

type ApiStream = (path: string, init?: RequestInit) => Promise<Response>;
type Api = ApiStream;

/** The Dandy's name as the API takes it: one line of printable characters, at most 24, or nothing. */
export function nameForApi(name: string | undefined): string | undefined {
  const n = (name ?? "").replace(/\p{C}/gu, "").replace(/\s+/g, " ").trim().slice(0, 24).trim();
  return n || undefined;
}

/**
 * Sends one action and streams the Dandy's events back as they happen. Returns the session id. The Dandy's
 * personality and name go with it, so it speaks in its own voice and introduces itself by name.
 */
export async function dreamTurn(apiStream: ApiStream, sessionId: string | null, action: DreamAction, onEvent: (e: DreamEvent) => void, opts: { signal?: AbortSignal; name?: string } = {}): Promise<string | null> {
  const res = await apiStream("/dream/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ sessionId, action, persona: currentPersona(), name: nameForApi(opts.name) }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "I couldn't answer just now. Try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let session = sessionId;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const data = buffer
        .slice(0, cut)
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      buffer = buffer.slice(cut + 2);
      if (!data) continue;
      const e = JSON.parse(data) as DreamEvent;
      if (e.type === "done") session = e.sessionId;
      onEvent(e);
    }
  }
  return session;
}

const MONTHS: Record<KeepLine["period"], number> = { week: 52 / 12, month: 1, year: 1 / 12 };
export const monthlyOf = (lines: KeepLine[]) => Math.round(lines.reduce((s, l) => s + l.amountCents * MONTHS[l.period], 0));

/** Formats cents in a currency the way the dream screens show it: "€3,720,000", "$198,750". */
export function moneyIn(currency = "USD") {
  let f: Intl.NumberFormat;
  try {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 });
  } catch {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });
  }
  return (cents: number) => f.format(Math.round(cents / 100));
}

/**
 * A finished find becomes a wish: the price, the itemised cost to keep it, its source and its photographs. The life
 * list keeps dollars, so a find in another currency is converted at the rate the server sent with it.
 */
export function wishFrom(w: Extract<Widget, { kind: "wish_ready" }>["wish"]): NewWish {
  const checkedAt = w.checkedAt ?? new Date().toISOString();
  const currency = (w.currency ?? "USD").toUpperCase();
  const fx = currency === "USD" ? { rate: 1, date: checkedAt.slice(0, 10) } : w.toUsd;
  if (!fx) throw new Error("Couldn't get today's exchange rate. Try again.");
  const usd = (cents: number) => Math.round(cents * fx.rate);
  return {
    name: w.name,
    kind: w.kind,
    tier: "must",
    upfrontCents: usd(w.upfrontCents),
    recurringCents: 0,
    period: "month",
    recurring: w.keep.map((l) => ({ amountCents: usd(l.amountCents), period: l.period, label: l.label })),
    details: {
      agent: {
        runId: "dream",
        seller: w.seller ?? "",
        url: webOnly(w.url),
        status: w.status,
        checkedAt,
        ...(webOnly(w.images[0]?.url) ? { imageUrl: webOnly(w.images[0]?.url) } : {}),
        explanation: "",
        source: { currency, price: w.upfrontCents / 100, rate: fx.rate, rateDate: fx.date },
      },
    },
  };
}

/** Links come from the agent, so anything that isn't an http(s) address is dropped. */
export function webOnly(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- chat history

/** A past conversation as the history lists it (GET /dream/sessions). */
export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/** One line of a saved transcript (the API's TranscriptEntry). */
export interface SessionEntry {
  role: "user" | "agent";
  text: string;
  at: string;
  widget?: { kind: Widget["kind"]; id: string };
}

/** A saved conversation (GET /dream/sessions/:id): its transcript and the widgets it still holds. */
export interface SessionDetail {
  id: string;
  transcript: SessionEntry[];
  widgets: Widget[];
}

/** A conversation touched within this long is picked up again when the chat opens; an older one stays in history. */
export const RESUME_MS = 60 * 60 * 1000;
/** Back in the app after this long without a word in the chat: a new conversation starts. */
export const IDLE_MS = 60 * 60 * 1000;

export function shouldResume(updatedAt: string | undefined, now: number): boolean {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(t) && now - t < RESUME_MS;
}

export const idleTooLong = (lastActive: number, now: number) => now - lastActive >= IDLE_MS;

async function failure(res: Response | null, fallback: string): Promise<Error> {
  const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
  return new Error(body?.error ?? fallback);
}

export async function listSessions(api: Api): Promise<SessionSummary[]> {
  const res = await api("/dream/sessions").catch(() => null);
  if (!res?.ok) throw await failure(res, "Couldn't load your conversations.");
  const body = (await res.json()) as { sessions?: SessionSummary[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function loadSession(api: Api, id: string): Promise<SessionDetail> {
  const res = await api(`/dream/sessions/${encodeURIComponent(id)}`).catch(() => null);
  if (!res?.ok) throw await failure(res, "Couldn't open that conversation.");
  return (await res.json()) as SessionDetail;
}

/** Deletes a conversation for good. One that is already gone counts as deleted. */
export async function deleteSession(api: Api, id: string): Promise<void> {
  const res = await api(`/dream/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  if (res && (res.ok || res.status === 404)) return;
  throw await failure(res, "Couldn't delete that conversation. Try again.");
}

/**
 * The chat as it was, from a saved transcript: what they said, what the Dandy said, and each tool where it opened.
 * The app's own notes ("[picked l_3]") and the Dandy's notes about its widgets stay out, and a widget that has since
 * closed (a session keeps its latest twelve) is left out rather than shown half-made.
 */
export function feedFromSession(s: Pick<SessionDetail, "transcript" | "widgets">, nextId: () => string): FeedItem[] {
  const widgets = new Map((Array.isArray(s.widgets) ? s.widgets : []).map((w) => [w.id, w]));
  const shown = new Set<string>();
  const out: FeedItem[] = [];
  for (const e of Array.isArray(s.transcript) ? s.transcript : []) {
    if (e.widget) {
      const w = widgets.get(e.widget.id);
      if (w && !shown.has(w.id)) {
        shown.add(w.id);
        out.push({ id: nextId(), kind: "widget", widget: w });
      }
      continue;
    }
    const text = (e.text ?? "").trim();
    if (!text) continue;
    if (e.role === "agent") out.push({ id: nextId(), kind: "agent", text });
    else if (!text.startsWith("[")) out.push({ id: nextId(), kind: "you", text });
  }
  return out;
}

/** When a conversation was, for the history: "Just now", "12 min ago", "Today", "Yesterday", "Monday", "Oct 12". */
export function whenLabel(iso: string, now: Date): string {
  const t = new Date(iso);
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "Just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} min ago`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(t)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return t.toLocaleDateString("en-US", { weekday: "long" });
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

// ---------------------------------------------------------------- an empty chat

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** How each personality says hello at each time of day: a short hello, then the question. */
const GREETINGS: Record<PersonaId, Record<DayPart, [string, string]>> = {
  heir: {
    morning: ["Good morning.", "What shall we look into today?"],
    afternoon: ["Good afternoon.", "Has anything caught your eye?"],
    evening: ["Good evening.", "What's on your mind tonight?"],
    night: ["Still up?", "Tell me what you're dreaming of."],
  },
  "it-girl": {
    morning: ["Morning, darling!", "What are we wishing for today?"],
    afternoon: ["Hi, gorgeous!", "What's the next obsession?"],
    evening: ["Evening, darling!", "What are we dreaming up tonight?"],
    night: ["Can't sleep?", "Me neither. Tell me everything."],
  },
  "old-money": {
    morning: ["Good morning.", "What would you like to find?"],
    afternoon: ["Good afternoon.", "What deserves a closer look?"],
    evening: ["Good evening.", "What have you been thinking of?"],
    night: ["A quiet hour.", "What's on your mind?"],
  },
  mogul: {
    morning: ["Morning.", "What's the next move?"],
    afternoon: ["Afternoon.", "What are we going after?"],
    evening: ["Evening.", "Name it and I'll price it."],
    night: ["Up late?", "Good. Let's make a plan."],
  },
};

/** The empty chat's greeting for this hour, in the Dandy's personality, and a line introducing it by name. */
export function greeting(persona: PersonaId | undefined, hour: number, name: string): { hello: string; ask: string; intro: string } {
  const [hello, ask] = GREETINGS[persona ?? "old-money"][dayPart(hour)];
  const n = name.trim();
  const who = !n || n.toLowerCase() === "dandy" ? "your Dandy" : n;
  return { hello, ask, intro: `I'm ${who}. Tell me anything you want, and I'll find the real thing and what it costs.` };
}

/** Suggestions as the chips show them: strings, trimmed, short enough to read at a glance, no repeats. */
export function cleanSuggestions(raw: unknown, max = 3): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (typeof r !== "string") continue;
    const t = r.replace(/\s+/g, " ").trim();
    if (t && t.length <= 48 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length === max) break;
  }
  return out;
}

/** What the list's Dandy area says while a chat turn runs, until its first step names the work. */
export function taskFor(action: DreamAction): string {
  switch (action.type) {
    case "message":
      return "Reading your message";
    case "builder":
      return "Updating your search";
    case "swipe":
      return "Noting your taste";
    case "search_now":
      return "Searching listings";
    case "pick":
      return "Pricing your choice";
    case "region":
      return "Setting where you live";
  }
}
