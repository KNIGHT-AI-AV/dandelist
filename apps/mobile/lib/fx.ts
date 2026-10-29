/**
 * The five currencies Dandelist shows prices in (owner, recording 03: "5 top currencies starting with USD"). Wishes
 * are kept in US cents on the server; displayed figures use the selected currency's available rate. Pure, so it
 * has tests.
 */
export const CURRENCIES = [
  { code: "USD", name: "US dollar", unit: 1, symbol: "$" },
  { code: "EUR", name: "Euro", unit: 1, symbol: "€" },
  { code: "GBP", name: "British pound", unit: 1, symbol: "£" },
  // A yen or a yuan is worth much less than a dollar; ladders like the income fader count in larger units there so
  // the notches stay round numbers (¥1,000,000, not ¥1,523,000).
  { code: "JPY", name: "Japanese yen", unit: 100, symbol: "¥" },
  { code: "CNY", name: "Chinese yuan", unit: 10, symbol: "CN¥" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === "string" && CURRENCIES.some((x) => x.code === c);
export const unitOf = (code: CurrencyCode) => CURRENCIES.find((c) => c.code === code)!.unit;

/** Units of each currency per US dollar. */
export type Rates = Record<CurrencyCode, number>;

/**
 * Static estimates for a first frame or a never-online device. fx-rates keeps their fallback origin explicit.
 */
export const FALLBACK_RATES: Rates = { USD: 1, EUR: 0.92, GBP: 0.78, JPY: 152, CNY: 7.2 };

// Only plain currency formatting goes through Intl. On iOS, Hermes builds Intl on NSNumberFormatter, which has no
// formatToParts (calling it threw on the first frame and crashed iOS builds 11 and 12 at launch) and silently ignores
// notation: "compact". So symbols come from the table above and short figures are built by hand.
const formatters = new Map<CurrencyCode, Intl.NumberFormat>();
function formatter(code: CurrencyCode): Intl.NumberFormat {
  let f = formatters.get(code);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    formatters.set(code, f);
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
  return formatter(code).format(Math.round(local / 100));
}

const STEPS = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const;

/** "$7.2M", "€940K": for incomes and tight places. Matches Intl's en-US compact currency on every platform. */
export function formatCompact(code: CurrencyCode, rate: number, usdCents: number): string {
  const units = toLocal(usdCents, rate) / 100;
  const abs = Math.abs(units);
  const tenths = (v: number) => Math.round(v * 10) / 10;
  let figure = tenths(abs);
  let suffix = "";
  for (let i = 0; i < STEPS.length; i++) {
    const [size, name] = STEPS[i]!;
    if (abs < size) continue;
    figure = tenths(abs / size);
    suffix = name;
    // 999,960 rounds to "1000K"; Intl calls that "1M".
    if (figure >= 1000 && i > 0) [figure, suffix] = [tenths(abs / STEPS[i - 1]![0]), STEPS[i - 1]![1]];
    break;
  }
  return `${units < 0 && figure !== 0 ? "-" : ""}${symbolOf(code)}${figure}${suffix}`;
}

/** The symbol alone ("$", "€", "£", "¥", "CN¥"), for chips. */
export function symbolOf(code: CurrencyCode): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
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
