import type { DreamAction, DreamEvent, KeepLine, LifeContext, Widget } from "@dandelist/catalogue/dream";
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
    body: JSON.stringify({ sessionId, action }),
    signal,
  });
  if (__DEV__ && res.status === 404) return mockTurn(sessionId, action, onEvent);
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

/** A finished find becomes a wish: the price, the itemised cost to keep it, its source and its photographs. */
export function wishFrom(w: Extract<Widget, { kind: "wish_ready" }>["wish"]): NewWish {
  const checkedAt = w.checkedAt ?? new Date().toISOString();
  return {
    name: w.name,
    kind: w.kind,
    tier: "must",
    upfrontCents: w.upfrontCents,
    recurringCents: 0,
    period: "month",
    recurring: w.keep.map((l) => ({ amountCents: l.amountCents, period: l.period, label: l.label })),
    details: {
      agent: {
        runId: "dream",
        seller: w.seller ?? "",
        url: webOnly(w.url),
        status: w.status,
        checkedAt,
        ...(webOnly(w.images[0]?.url) ? { imageUrl: webOnly(w.images[0]?.url) } : {}),
        explanation: "",
        source: { currency: "USD", price: w.upfrontCents / 100, rate: 1, rateDate: checkedAt.slice(0, 10) },
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

/**
 * Development only, until the API ships /dream/turn: plays back a scripted turn so the screens can be built and
 * checked. Production builds compile this path out (__DEV__ is false), so nothing here can reach a real user.
 */
async function mockTurn(sessionId: string | null, action: DreamAction, onEvent: (e: DreamEvent) => void): Promise<string> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const villa = "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Ta%27_Kola_Windmill%2C_Xaghra%2C_Gozo.jpg/1280px-Ta%27_Kola_Windmill%2C_Xaghra%2C_Gozo.jpg";
  if (action.type === "message" && /villa|home|house/i.test(action.text)) {
    onEvent({ type: "life", life: { home: { country: "MT", label: "Malta" }, currency: "USD" } });
    onEvent({ type: "text", text: "A sea-view villa in Malta, then. Tell me how it should feel, or just let me search." });
    onEvent({ type: "widget", widget: { kind: "home_builder", id: "hb1", region: "Malta", styles: [{ id: "modern", label: "Modern" }, { id: "med", label: "Mediterranean" }, { id: "farmhouse", label: "Farmhouse" }], features: [{ id: "pool", label: "Pool", on: true }, { id: "sea", label: "Sea view", on: true }, { id: "cellar", label: "Wine cellar", on: false }, { id: "gym", label: "Home gym", on: false }], bedrooms: 4, budgetCents: null } });
  } else if (action.type === "builder" || action.type === "search_now") {
    onEvent({ type: "step", id: "s1", state: "running", text: "Searching listings in Malta" });
    await wait(700);
    onEvent({ type: "step", id: "s1", state: "done", text: "Read 14 listings, kept 3 that match" });
    onEvent({ type: "widget", widget: { kind: "deck", id: "d1", title: "Swipe the ones that feel right", round: 1, cards: [1, 2, 3].map((n) => ({ id: `l${n}`, title: `Sea-view villa ${n}`, priceCents: 250000000 * n, currency: "EUR", url: "https://example.com", source: "Mock listing", images: [{ url: villa, source: "commons.wikimedia.org" }], facts: ["Pool", "Sea view", `${3 + n} bedrooms`] })) } });
  } else if (action.type === "swipe" && action.verdict === "yes") {
    onEvent({ type: "widget", widget: { kind: "wish_ready", id: "w1", wish: { name: "Sea-view villa", kind: "own", upfrontCents: 250000000, status: "estimate", region: "Malta", images: [{ url: villa, source: "commons.wikimedia.org" }], keep: [{ label: "Maintenance", amountCents: 312500, period: "month", basis: "1.5% of value a year", estimate: true }] } } });
  } else if (action.type === "message" && /security/i.test(action.text)) {
    onEvent({ type: "widget", widget: { kind: "service_quote", id: "q1", service: "Private security", region: "Malta", summary: "Two officers around the clock and an armoured SUV.", images: [], lines: [{ label: "Close protection, 2 officers 24/7", amountCents: 4200000, period: "month", basis: "Mock rate", estimate: true }] } });
  } else {
    onEvent({ type: "text", text: "Mock agent: describe a home, a car, or a service." });
  }
  const id = sessionId ?? "mock";
  onEvent({ type: "done", sessionId: id });
  return id;
}
