/**
 * The five currencies Dandelist shows prices in (owner, recording 03: "5 top currencies starting with USD"). Wishes
 * are kept in US cents on the server; every figure on screen is converted at the day's reference rate. Pure, so it
 * has tests.
 */
export const CURRENCIES = [
  { code: "USD", name: "US dollar", unit: 1 },
  { code: "EUR", name: "Euro", unit: 1 },
  { code: "GBP", name: "British pound", unit: 1 },
  // A yen or a yuan is worth much less than a dollar; ladders like the income fader count in larger units there so
  // the notches stay round numbers (¥1,000,000, not ¥1,523,000).
  { code: "JPY", name: "Japanese yen", unit: 100 },
  { code: "CNY", name: "Chinese yuan", unit: 10 },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === "string" && CURRENCIES.some((x) => x.code === c);
export const unitOf = (code: CurrencyCode) => CURRENCIES.find((c) => c.code === code)!.unit;

/** Units of each currency per US dollar. */
export type Rates = Record<CurrencyCode, number>;

/**
 * Used only until the day's rates arrive (and when the network never answers): late-2026 ECB levels, close enough
 * for the first frame, never shown as a quote.
 */
export const FALLBACK_RATES: Rates = { USD: 1, EUR: 0.92, GBP: 0.78, JPY: 152, CNY: 7.2 };

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(code: CurrencyCode, compact: boolean): Intl.NumberFormat {
  const key = `${code}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", compact ? { style: "currency", currency: code, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 } : { style: "currency", currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    formatters.set(key, f);
  }
  return f;
}

/** US cents to the chosen currency's minor units (cents, pence; yen have none, so a yen counts as 100 here too). */
export const toLocal = (usdCents: number, rate: number) => Math.round(usdCents * rate);
export const toUsd = (localCents: number, rate: number) => Math.round(localCents / rate);

/** "$198,750", "€183,000", "£155,000", "¥30,210,000", "CN¥1,431,000": whole units, no cents. */
export function formatIn(code: CurrencyCode, rate: number, usdCents: number): string {
  return formatter(code, false).format(Math.round(toLocal(usdCents, rate) / 100));
}

/** "$7.2M", "€940K": for incomes and tight places. */
export function formatCompact(code: CurrencyCode, rate: number, usdCents: number): string {
  return formatter(code, true).format(toLocal(usdCents, rate) / 100);
}

/** The symbol alone ("$", "€", "£", "¥", "CN¥"), for chips. */
export function symbolOf(code: CurrencyCode): string {
  return formatter(code, false).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
}

/** Reads a rates answer from the API, keeping only sane numbers and filling gaps from the fallback. */
export function readRates(body: unknown): Rates | null {
  const r = (body as { rates?: Record<string, unknown> } | null)?.rates;
  if (!r || typeof r !== "object") return null;
  const out = { ...FALLBACK_RATES };
  let any = false;
  for (const c of CURRENCIES) {
    const v = r[c.code];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[c.code] = v;
      any = true;
    }
  }
  out.USD = 1;
  return any ? out : null;
}
