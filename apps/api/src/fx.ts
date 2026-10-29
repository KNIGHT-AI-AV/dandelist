import { Hono } from "hono";

/** Wishes stay in US cents; these currencies are display conversions. */
export const SHOWN_CURRENCIES = ["EUR", "GBP", "JPY", "CNY"] as const;
const FRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

type Observation = { rate: number; source: "ecb"; referenceDate: string; fetchedAt: string; retained: boolean };
type Observations = Partial<Record<(typeof SHOWN_CURRENCIES)[number], Observation>>;

function referenceDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Daily ECB reference observations via Frankfurter v1; no transaction quote is implied. */
export function fxRoutes(deps: { webFetch?: typeof fetch; now(): Date }) {
  const app = new Hono();
  let cached: { at: number; observations: Observations } | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    try {
      const res = await (deps.webFetch ?? fetch)("https://api.frankfurter.dev/v1/latest?base=USD&symbols=" + SHOWN_CURRENCIES.join(","), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error("frankfurter " + res.status);
      const body = (await res.json()) as { base?: unknown; date?: unknown; rates?: Record<string, unknown> };
      if (body?.base !== "USD" || !referenceDate(body.date)) throw new Error("invalid rate basis");
      const fetchedAt = deps.now().toISOString();
      const observations: Observations = {};
      let valid = 0;
      for (const code of SHOWN_CURRENCIES) {
        const prior = cached?.observations[code];
        const rate = body.rates?.[code];
        const acceptable = typeof rate === "number" && Number.isFinite(rate) && rate > 0;
        if (acceptable) valid++;
        // A partial or older response cannot erase a better observation.
        if (acceptable && (!prior || body.date >= prior.referenceDate)) {
          observations[code] = { rate, source: "ecb", referenceDate: body.date, fetchedAt, retained: false };
        } else if (prior) {
          observations[code] = { ...prior, retained: true };
        }
      }
      if (!valid) throw new Error("no rates");
      cached = { at: deps.now().getTime(), observations };
      return true;
    } catch {
      // Keep source dates and successful fetch times intact on failure.
      if (cached) cached = { ...cached, observations: Object.fromEntries(Object.entries(cached.observations).map(([code, observation]) => [code, { ...observation, retained: true }])) };
      return false;
    }
  }

  app.get("/", async (c) => {
    let available = true;
    if (!cached || deps.now().getTime() - cached.at >= FRESH_MS) {
      // Concurrent requests share a refresh; an older response cannot finish last and replace it.
      if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
      available = await refreshing;
    }
    if (!cached) return c.json({ error: "Exchange rates are unavailable right now." }, 503);
    const observations = cached.observations;
    const rates: Record<string, number> = { USD: 1 };
    for (const code of SHOWN_CURRENCIES) if (observations[code]) rates[code] = observations[code]!.rate;
    // Keep the old fields for older clients. The oldest date conservatively describes a mixed set.
    const date = Object.values(observations).map((o) => o.referenceDate).sort()[0] ?? "";
    return c.json({ base: "USD", date, rates, observations }, 200, { "Cache-Control": available ? "public, max-age=3600" : "no-cache" });
  });
  return app;
}
