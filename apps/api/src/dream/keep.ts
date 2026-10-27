import type { KeepLine } from "@dandelist/catalogue/dream";
import type { Period } from "@dandelist/cost";

/**
 * The cost-to-keep estimator. Every amount here is arithmetic on evidence: a regional rate someone published (with
 * its source and check time), a fee the listing states, or the owner's stated rule of thumb for upkeep. The model
 * never produces an amount; it only helps find the evidence.
 */

export type RateUnit =
  | "percent_of_value_per_year"
  | "per_year"
  | "per_month"
  | "per_week"
  | "per_day"
  | "per_hour"
  | "per_litre"
  | "per_kwh"
  | "km_per_year"
  | "litres_per_100km"
  | "kwh_per_100km";

export interface Rate {
  key: string;
  /** As the source states it: 0.42 for 0.42%, 25 for EUR 25 an hour. */
  amount: number;
  unit: RateUnit;
  /** For money units. */
  currency?: string;
  /** The words on the source that state the figure. */
  quote: string;
  sourceUrl?: string;
  sourceName?: string;
  checkedAt: string;
  /** True when the figure was found on the source page by our own read. */
  verified: boolean;
  /** statutory: a published tax or fee rate. average: a survey or index. quote: a provider's published price. */
  kind: "statutory" | "average" | "quote";
  /** What the figure is, in a few words, e.g. "Malta property tax". */
  label: string;
}

/** Multipliers from a currency to the wish's currency (ECB rates), fetched before any arithmetic. */
export interface Fx {
  to: string;
  rates: Record<string, number>;
  date?: string;
}

export function convert(amount: number, currency: string | undefined, fx: Fx): number | null {
  const c = (currency ?? fx.to).toUpperCase();
  if (c === fx.to) return amount;
  const r = fx.rates[c];
  return r ? amount * r : null;
}

/** Non-breaking and narrow no-break spaces, which Intl puts in money strings; the app shows plain spaces. */
export const NBSP = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");

const whole = new Map<string, Intl.NumberFormat>();
/** Money the way the app shows it: whole units with the currency's own symbol, e.g. "€2,400,000". */
export function money(cents: number, currency: string): string {
  const c = currency.toUpperCase();
  let f = whole.get(c);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    } catch {
      f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    }
    whole.set(c, f);
  }
  return f.format(Math.round(cents) / 100).replace(NBSP, " ");
}

const compactF = new Map<string, Intl.NumberFormat>();
export function compact(cents: number, currency: string): string {
  const c = currency.toUpperCase();
  let f = compactF.get(c);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: c, notation: "compact", maximumFractionDigits: 1 });
    } catch {
      f = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
    }
    compactF.set(c, f);
  }
  return f.format(Math.round(cents) / 100).replace(NBSP, " ");
}

const unitF = new Map<string, Intl.NumberFormat>();
/** A rate in whole currency units with up to two decimals, e.g. "€1.34" or "€25". */
export function rateMoney(amount: number, currency: string): string {
  const c = currency.toUpperCase();
  let f = unitF.get(c);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: c, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    }
    unitF.set(c, f);
  }
  return f.format(amount).replace(NBSP, " ");
}

/** Rate amounts as written in a basis: "0.42", "1.5", "25.5". */
const figure = (n: number) => String(Math.round(n * 100) / 100);

const source = (r: Rate): KeepLine["source"] => (r.sourceUrl ? { url: r.sourceUrl, checkedAt: r.checkedAt } : undefined);
const from = (r: Rate) => `${r.label}${r.verified ? "" : ", source not confirmed on its page"}`;

function line(label: string, amountCents: number, period: Period, basis: string, r: Rate | null, estimate: boolean): KeepLine {
  const src = r ? source(r) : undefined;
  return { label, amountCents: Math.max(0, Math.round(amountCents)), period, basis, ...(src ? { source: src } : {}), estimate };
}

const PERIOD_OF: Partial<Record<RateUnit, Period>> = { per_year: "year", per_month: "month", per_week: "week" };

/** A yearly cost from a rate that is either a percent of the value or a stated amount per period. */
function valueRate(label: string, r: Rate, valueCents: number, currency: string, fx: Fx, statutory: boolean): KeepLine | null {
  const est = !(statutory && r.kind === "statutory" && r.verified);
  if (r.unit === "percent_of_value_per_year") {
    const cents = (valueCents * r.amount) / 100;
    const basis = r.amount === 0 ? `None: ${from(r)}` : `${figure(r.amount)}% of ${money(valueCents, currency)} a year (${from(r)})`;
    return line(label, cents, "year", basis, r, est);
  }
  const period = PERIOD_OF[r.unit];
  if (!period) return null;
  const amount = convert(r.amount, r.currency, fx);
  if (amount === null) return null;
  const stated = `${rateMoney(r.amount, r.currency ?? currency)} a ${period}`;
  const basis = r.amount === 0 ? `None: ${from(r)}` : r.currency && r.currency !== currency ? `${stated}, converted at the ECB rate (${from(r)})` : `${stated} (${from(r)})`;
  return line(label, amount * 100, period, basis, r, est);
}

export interface HomeKeepInput {
  valueCents: number;
  currency: string;
  place: string;
  coastal: boolean;
  tropical: boolean;
  floorM2?: number;
  bedrooms?: number;
  fee?: { amount: number; currency: string; period: "month" | "year"; quote: string; url: string; checkedAt: string };
  rates: { propertyTax?: Rate; insurance?: Rate; utilities85?: Rate };
  fx: Fx;
}

/** Upkeep: the owner's rule of thumb, 1% to 2% of value a year, with coastal and tropical homes running higher. */
export function maintenancePercent(coastal: boolean, tropical: boolean): number {
  return 1 + (coastal ? 0.5 : 0) + (tropical ? 0.5 : 0);
}

/** A home's size when the listing doesn't state it: about 45 m² a bedroom plus 40 m² of living space. */
export const sizeFromBedrooms = (bedrooms: number) => bedrooms * 45 + 40;

/** Bills don't grow without limit with floor area; a figure past this is more likely a plot size than a house. */
export const MAX_UTILITY_SCALE = 8;

export function homeKeep(i: HomeKeepInput): KeepLine[] {
  const out: KeepLine[] = [];
  const { valueCents, currency, fx } = i;
  if (i.rates.propertyTax) {
    const l = valueRate("Property tax", i.rates.propertyTax, valueCents, currency, fx, true);
    if (l) out.push(l);
  }
  if (i.rates.insurance) {
    const l = valueRate("Home insurance", i.rates.insurance, valueCents, currency, fx, false);
    if (l) out.push(l);
  }
  const pct = maintenancePercent(i.coastal, i.tropical);
  const why = i.coastal && i.tropical ? "coastal and tropical homes run higher" : i.coastal ? "coastal homes run higher" : i.tropical ? "tropical homes run higher" : "1% to 2% is typical";
  out.push(line("Maintenance", (valueCents * pct) / 100, "year", `${figure(pct)}% of ${money(valueCents, currency)} a year (upkeep rule of thumb; ${why})`, null, true));
  const u = i.rates.utilities85;
  if (u && u.unit === "per_month") {
    const monthly = convert(u.amount, u.currency, fx);
    if (monthly !== null) {
      const m2 = i.floorM2 ?? (i.bedrooms ? sizeFromBedrooms(i.bedrooms) : undefined);
      const raw = m2 ? Math.max(1, m2 / 85) : 1;
      const scale = Math.min(MAX_UTILITY_SCALE, raw);
      const capped = raw > MAX_UTILITY_SCALE ? `, capped at ${MAX_UTILITY_SCALE} times` : "";
      const size = i.floorM2 ? `${Math.round(i.floorM2)} m²${capped}` : i.bedrooms ? `about ${Math.round(m2!)} m² for ${i.bedrooms} bedrooms${capped}` : "size not stated, priced for 85 m²";
      const stated = rateMoney(u.amount, u.currency ?? currency);
      out.push(line("Utilities", monthly * 100 * scale, "month", `${stated} a month for 85 m² in ${i.place}, scaled to ${size} (${from(u)})`, u, true));
    }
  }
  if (i.fee) {
    const amount = convert(i.fee.amount, i.fee.currency, fx);
    if (amount !== null) {
      out.push({
        label: "HOA or service charge",
        amountCents: Math.round(amount * 100),
        period: i.fee.period,
        basis: `The listing states "${i.fee.quote}"`,
        source: { url: i.fee.url, checkedAt: i.fee.checkedAt },
        estimate: false,
      });
    }
  }
  return out;
}

export interface CarKeepInput {
  valueCents: number;
  currency: string;
  place: string;
  /** From the listing or the maker's figures. */
  consumption?: { amount: number; unit: "litres_per_100km" | "kwh_per_100km"; label: string; url?: string; checkedAt?: string };
  rates: { insurance?: Rate; annualKm?: Rate; fuelPrice?: Rate; electricityPrice?: Rate; maintenance?: Rate; registration?: Rate };
  fx: Fx;
}

export function carKeep(i: CarKeepInput): KeepLine[] {
  const out: KeepLine[] = [];
  const { valueCents, currency, fx } = i;
  if (i.rates.insurance) {
    const l = valueRate("Insurance", i.rates.insurance, valueCents, currency, fx, false);
    if (l) out.push(l);
  }
  const km = i.rates.annualKm;
  const c = i.consumption;
  const energy = c?.unit === "kwh_per_100km" ? i.rates.electricityPrice : i.rates.fuelPrice;
  if (km && c && energy && km.unit === "km_per_year") {
    const price = convert(energy.amount, energy.currency, fx);
    if (price !== null) {
      const units = (km.amount * c.amount) / 100;
      const unitWord = c.unit === "kwh_per_100km" ? "kWh" : "L";
      const label = c.unit === "kwh_per_100km" ? "Charging" : "Fuel";
      out.push(
        line(
          label,
          units * price * 100,
          "year",
          `${Math.round(km.amount).toLocaleString("en-US")} km a year (${from(km)}) at ${figure(c.amount)} ${unitWord}/100 km (${c.label}) and ${rateMoney(energy.amount, energy.currency ?? currency)} per ${unitWord} (${from(energy)})`,
          energy,
          true,
        ),
      );
    }
  }
  if (i.rates.maintenance) {
    const l = valueRate("Maintenance", i.rates.maintenance, valueCents, currency, fx, false);
    if (l) out.push(l);
  }
  if (i.rates.registration) {
    const l = valueRate("Registration and road licence", i.rates.registration, valueCents, currency, fx, true);
    if (l) out.push(l);
  }
  return out;
}

export interface ServiceComponent {
  label: string;
  rate: Rate;
  /** People or vehicles. */
  count: number;
  hoursPerDay: number;
  daysPerWeek: number;
}

/** Weeks in a month on a 52-week year, matching the cost engine. */
const WEEKS_PER_MONTH = 52 / 12;
/** The working week a monthly or yearly salary pays for. */
export const FULL_TIME_HOURS = 40;

/** One monthly line per component: rate x count x hours x days, converted to the wish's currency. */
export function serviceLines(components: ServiceComponent[], currency: string, fx: Fx): KeepLine[] {
  const out: KeepLine[] = [];
  for (const c of components) {
    const r = c.rate;
    const rate = convert(r.amount, r.currency, fx);
    if (rate === null) continue;
    const stated = rateMoney(r.amount, r.currency ?? currency);
    let units: number;
    let basis: string;
    const n = c.count === 1 ? "" : `${c.count} x `;
    if (r.unit === "per_hour") {
      units = c.count * c.hoursPerDay * c.daysPerWeek * WEEKS_PER_MONTH;
      basis = `${n}${c.hoursPerDay} h a day x ${c.daysPerWeek} days a week at ${stated} an hour (${from(r)})`;
    } else if (r.unit === "per_day") {
      units = c.count * c.daysPerWeek * WEEKS_PER_MONTH;
      basis = `${n}${c.daysPerWeek} days a week at ${stated} a day (${from(r)})`;
    } else if (r.unit === "per_week" || r.unit === "per_month" || r.unit === "per_year") {
      // A salary covers one full-time person; cover beyond a 40-hour week takes more people (24/7 is 4.2 per post).
      const hours = c.hoursPerDay * c.daysPerWeek;
      const staff = hours > FULL_TIME_HOURS ? (c.count * hours) / FULL_TIME_HOURS : c.count;
      const per = r.unit === "per_week" ? WEEKS_PER_MONTH : r.unit === "per_month" ? 1 : 1 / 12;
      units = staff * per;
      const word = r.unit === "per_week" ? "a week" : r.unit === "per_month" ? "a month" : "a year, spread monthly";
      basis =
        hours > FULL_TIME_HOURS
          ? `${c.count === 1 ? "" : `${c.count} posts x `}${c.hoursPerDay} h a day x ${c.daysPerWeek} days a week = ${figure(staff)} full-time staff at ${stated} ${word} (${from(r)})`
          : `${n}${stated} ${word} (${from(r)})`;
    } else continue;
    if (r.currency && r.currency !== currency) basis += ", converted at the ECB rate";
    out.push(line(c.label, rate * units * 100, "month", basis, r, true));
  }
  return out;
}

/** Countries whose homes sit in the tropics, where upkeep runs higher. */
const TROPICAL = new Set(["ID", "TH", "MY", "SG", "PH", "VN", "KH", "LK", "MV", "IN", "BR", "CO", "CR", "PA", "MX", "BS", "BB", "JM", "DO", "KY", "VG", "TC", "AW", "SC", "MU", "TZ", "KE", "NG", "GH", "FJ"]);
export const isTropical = (country: string) => TROPICAL.has(country.toUpperCase());
