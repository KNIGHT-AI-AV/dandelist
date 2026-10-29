import { CURRENCIES, FALLBACK_RATES, type CurrencyCode } from "./fx";

export type RateObservation = {
  rate: number;
  source: "identity" | "ecb" | "fallback" | "legacy";
  referenceDate: string | null;
  fetchedAt: string | null;
  retained: boolean;
};
export type RateObservations = Record<CurrencyCode, RateObservation>;
export type RateUpdate = Partial<RateObservations>;

const identity = (): RateObservation => ({ rate: 1, source: "identity", referenceDate: null, fetchedAt: null, retained: false });

export function initialRateObservations(): RateObservations {
  return Object.fromEntries(CURRENCIES.map(({ code }) => [code, code === "USD" ? identity() : {
    rate: FALLBACK_RATES[code], source: "fallback", referenceDate: null, fetchedAt: null, retained: false,
  }])) as RateObservations;
}

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const validRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const date = (v: unknown): string | null => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;
const instant = (v: unknown): string | null => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Read only observed currencies. Missing entries must not become fallback updates. */
export function readRateObservations(value: unknown, from: "cache" | "network"): RateUpdate | null {
  const body = object(value);
  if (!body || (from === "network" ? body.base !== "USD" : body.base !== undefined && body.base !== "USD")) return null;
  const rates = object(body.rates);
  if (!rates) return null;
  const metadata = object(body.observations);
  if (body.observations !== undefined && !metadata) return null;
  const out: RateUpdate = {};
  for (const { code } of CURRENCIES) {
    if (code === "USD" || !validRate(rates[code])) continue;
    const rate = rates[code];
    const entry = metadata ? object(metadata[code]) : null;
    if (metadata) {
      if (!entry || entry.rate !== rate) continue;
      if (entry.source === "ecb") {
        const referenceDate = date(entry.referenceDate);
        const fetchedAt = instant(entry.fetchedAt);
        if (!referenceDate || (entry.fetchedAt !== null && !fetchedAt)) continue;
        out[code] = { rate, source: "ecb", referenceDate, fetchedAt, retained: from === "cache" || entry.retained === true };
      } else if (from === "cache" && (entry.source === "legacy" || entry.source === "fallback")) {
        out[code] = { rate, source: entry.source, referenceDate: null, fetchedAt: null, retained: true };
      }
    } else if (from === "network" && date(body.date)) {
      // Older API: its rates have a reference date, but no successful-fetch timestamp.
      out[code] = { rate, source: "ecb", referenceDate: date(body.date), fetchedAt: null, retained: true };
    } else if (from === "cache") {
      // Old caches stored only numbers; their provider/date cannot be reconstructed.
      out[code] = { rate, source: "legacy", referenceDate: null, fetchedAt: null, retained: true };
    }
  }
  return Object.keys(out).length ? { ...out, USD: identity() } : null;
}

/** Known provider observations beat legacy/fallback values; source date beats delivery order. */
export function mergeRateObservations(current: RateObservations, update: RateUpdate, from: "cache" | "network" = "network"): RateObservations {
  const next = { ...current, USD: identity() };
  const rank = (o: RateObservation) => o.source === "ecb" ? 2 : o.source === "legacy" ? 1 : 0;
  for (const { code } of CURRENCIES) {
    if (code === "USD") continue;
    const incoming = update[code], previous = current[code];
    if (!incoming || rank(incoming) < rank(previous)) continue;
    if (incoming.source === "ecb" && previous.source === "ecb") {
      if (incoming.referenceDate! < previous.referenceDate!) continue;
      if (incoming.referenceDate === previous.referenceDate) {
        if ((incoming.fetchedAt ?? "") < (previous.fetchedAt ?? "")) continue;
        // On equal evidence, the live response wins over hydration, including older APIs without fetch times.
        if (from === "cache" && incoming.fetchedAt === previous.fetchedAt) continue;
      }
    }
    next[code] = incoming;
  }
  return next;
}

export function retainedRates(current: RateObservations): RateObservations {
  return Object.fromEntries(CURRENCIES.map(({ code }) => [code, code === "USD" ? identity() : { ...current[code], retained: true }])) as RateObservations;
}

/** Old clients can still read rates; new clients retain each currency's provenance. */
export function storeRateObservations(observations: RateObservations): string {
  return JSON.stringify({ version: 2, base: "USD", rates: Object.fromEntries(CURRENCIES.map(({ code }) => [code, observations[code].rate])), observations });
}

export function rateDescription(observation: RateObservation): string {
  if (observation.source === "identity") return "Prices are shown in US dollars.";
  if (observation.source === "fallback") return "Approximate conversion. Exchange rate unavailable.";
  if (observation.source === "legacy") return "Saved conversion rate. Date unavailable.";
  if (observation.fetchedAt === null) return "ECB reference rate from " + observation.referenceDate + ". Refresh time unavailable.";
  return observation.retained ? "Using the saved ECB rate from " + observation.referenceDate + "." : "ECB reference rate from " + observation.referenceDate + ".";
}
