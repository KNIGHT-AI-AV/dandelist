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

/** Below this many units a price keeps its cents ("$49.99 a month"); above it, cents are noise. */
const CENTS_BELOW = 1000;
let withCents: Intl.NumberFormat | undefined;
const centsFormatter = (code: CurrencyCode) => (withCents?.resolvedOptions().currency === code ? withCents : (withCents = new Intl.NumberFormat("en-US", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 })));

/** "$198,750", "€183,000", "¥30,210,000", "CN¥1,431,000"; small amounts keep their cents ("$49.99"), never yen. */
export function formatIn(code: CurrencyCode, rate: number, usdCents: number): string {
  const local = toLocal(usdCents, rate);
  if (code !== "JPY" && local % 100 !== 0 && Math.abs(local) < CENTS_BELOW * 100) return centsFormatter(code).format(local / 100);
  return formatter(code, false).format(Math.round(local / 100));
}

/** "$7.2M", "€940K": for incomes and tight places. */
export function formatCompact(code: CurrencyCode, rate: number, usdCents: number): string {
  return formatter(code, true).format(toLocal(usdCents, rate) / 100);
}

/** The symbol alone ("$", "€", "£", "¥", "CN¥"), for chips. */
export function symbolOf(code: CurrencyCode): string {
  return formatter(code, false).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
}

let shown: { code: CurrencyCode; rate: number } = { code: "USD", rate: 1 };

/** Set by the currency provider whenever the choice or the rate changes. */
export function setShownCurrency(code: CurrencyCode, rate: number): void {
  shown = { code, rate };
}

/**
 * The chosen currency for strings built outside React (lib helpers, accessibility lines). Screens should prefer
 * useMoney(), which also re-renders when the choice changes.
 */
export const formatShown = (usdCents: number) => formatIn(shown.code, shown.rate, usdCents);

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
