import { Hono } from "hono";

/** The currencies the app shows prices in; wishes are kept in US cents and shown at today's rate. */
export const SHOWN_CURRENCIES = ["EUR", "GBP", "JPY", "CNY"] as const;
const FRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

type Fetcher = typeof fetch;
type Rates = { base: "USD"; date: string; rates: Record<string, number> };

/**
 * GET /fx: the European Central Bank's reference rates (through Frankfurter) for the five currencies, per US dollar.
 * Public like the prices themselves; cached for six hours, and the last good answer is kept when the source is down.
 */
export function fxRoutes(deps: { webFetch?: Fetcher; now(): Date }) {
  const app = new Hono();
  let cached: { at: number; body: Rates } | null = null;
  app.get("/", async (c) => {
    const now = deps.now().getTime();
    if (cached && now - cached.at < FRESH_MS) return c.json(cached.body, 200, { "Cache-Control": "public, max-age=3600" });
    try {
      const res = await (deps.webFetch ?? fetch)(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${SHOWN_CURRENCIES.join(",")}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`frankfurter ${res.status}`);
      const body = (await res.json()) as { date?: string; rates?: Record<string, unknown> };
      const rates: Record<string, number> = { USD: 1 };
      for (const code of SHOWN_CURRENCIES) {
        const v = body.rates?.[code];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) rates[code] = v;
      }
      if (Object.keys(rates).length === 1) throw new Error("no rates");
      cached = { at: now, body: { base: "USD", date: String(body.date ?? ""), rates } };
      return c.json(cached.body, 200, { "Cache-Control": "public, max-age=3600" });
    } catch (e) {
      if (cached) return c.json(cached.body, 200, { "Cache-Control": "no-cache" });
      console.error("fx rates unavailable", (e as Error).message);
      return c.json({ error: "Exchange rates are unavailable right now." }, 503);
    }
  });
  return app;
}
