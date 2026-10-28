import type { DreamAction, DreamEvent, KeepLine, LifeContext, Widget } from "@dandelist/catalogue/dream";
import { currentPersona } from "./persona-state";
import type { NewWish } from "./wishes";

export type { DreamAction, DreamEvent, KeepLine, LifeContext, Widget };

/** One entry in the conversation: what they said, what the agent said, its work rows, and the tools it opened. */
export type FeedItem =
  | { id: string; kind: "you"; text: string }
  | { id: string; kind: "agent"; text: string }
  | { id: string; kind: "step"; text: string; state: "running" | "done" }
  | { id: string; kind: "widget"; widget: Widget };

type ApiStream = (path: string, init?: RequestInit) => Promise<Response>;

/** Sends one action and streams the agent's events back as they happen. Returns the session id. */
export async function dreamTurn(apiStream: ApiStream, sessionId: string | null, action: DreamAction, onEvent: (e: DreamEvent) => void, signal?: AbortSignal): Promise<string | null> {
  const res = await apiStream("/dream/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ sessionId, action, persona: currentPersona() }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The agent couldn't answer just now. Try again.");
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
