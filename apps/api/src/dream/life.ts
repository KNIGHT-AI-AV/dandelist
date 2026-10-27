import type { LifeContext } from "@dandelist/catalogue/dream";
import { z } from "zod";
import type { Db } from "../db";

/**
 * Where someone wants to live. Regional things (homes, staff, services, utilities, taxes) are priced for `home`;
 * goods and cars ignore it apart from the currency they are shown in and the insurance that keeps them.
 */

export type Home = NonNullable<LifeContext["home"]>;

export const DEFAULT_LIFE: LifeContext = { home: null, currency: "USD" };

/** The currency each country prices in, for the countries people most often dream about. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", CR: "CRC", PA: "USD",
  GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", ES: "EUR", PT: "EUR", NL: "EUR", BE: "EUR", LU: "EUR",
  AT: "EUR", GR: "EUR", MT: "EUR", CY: "EUR", FI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", SK: "EUR", SI: "EUR",
  HR: "EUR", MC: "EUR", AD: "EUR", ME: "EUR", CH: "CHF", LI: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", IS: "ISK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", RS: "RSD", AL: "ALL",
  AE: "AED", SA: "SAR", QA: "QAR", BH: "BHD", KW: "KWD", OM: "OMR", IL: "ILS", EG: "EGP", MA: "MAD",
  ZA: "ZAR", NG: "NGN", KE: "KES", GH: "GHS", MU: "MUR", SC: "SCR", TZ: "TZS",
  IN: "INR", LK: "LKR", MV: "MVR", TH: "THB", ID: "IDR", MY: "MYR", SG: "SGD", PH: "PHP", VN: "VND", KH: "KHR",
  JP: "JPY", KR: "KRW", CN: "CNY", HK: "HKD", TW: "TWD", AU: "AUD", NZ: "NZD", FJ: "FJD",
  BS: "BSD", BB: "BBD", JM: "JMD", DO: "DOP", KY: "KYD", VG: "USD", TC: "USD", BM: "BMD", AW: "AWG",
};

export function currencyFor(country: string): string | undefined {
  return CURRENCY_BY_COUNTRY[country.toUpperCase()];
}

export const homeSchema = z.object({
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((c) => c.toUpperCase()),
  region: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  label: z.string().trim().min(1).max(80),
});

export const lifeBody = z.object({
  home: homeSchema.nullable(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()).optional(),
  household: z.object({ adults: z.number().int().min(0).max(20), children: z.number().int().min(0).max(20) }).optional(),
});

type Row = { home: unknown; currency: string; household: unknown };
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export async function readLife(db: Db, userId: string): Promise<LifeContext> {
  const { rows } = await db.query<Row>("select home, currency, household from life_context where user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return { ...DEFAULT_LIFE };
  const home = parse(r.home) as Home | null;
  const household = parse(r.household) as LifeContext["household"] | null;
  return { home: home ?? null, currency: r.currency, ...(household ? { household } : {}) };
}

/**
 * Saves the life context. When the home moves to another country and no currency is given, the currency follows the
 * country, so "I'll live in Malta" prices in euros from then on.
 */
export async function writeLife(
  db: Db,
  userId: string,
  next: { home: Home | null; currency?: string; household?: LifeContext["household"] },
  from: string,
  now: Date,
): Promise<LifeContext> {
  const prev = await readLife(db, userId);
  const moved = next.home && next.home.country !== prev.home?.country;
  const currency = next.currency ?? (moved ? currencyFor(next.home!.country) : undefined) ?? prev.currency;
  const household = next.household ?? prev.household;
  const home = next.home ? clean(next.home) : null;
  await db.query(
    `insert into life_context (user_id, home, currency, household, updated_from, updated_at) values ($1, $2::jsonb, $3, $4::jsonb, $5, $6)
     on conflict (user_id) do update set home = excluded.home, currency = excluded.currency, household = excluded.household,
       updated_from = excluded.updated_from, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(home), currency, household ? JSON.stringify(household) : null, from, now.toISOString()],
  );
  return { home, currency, ...(household ? { household } : {}) };
}

function clean(h: Home): Home {
  return { country: h.country.toUpperCase(), label: h.label, ...(h.region ? { region: h.region } : {}), ...(h.city ? { city: h.city } : {}) };
}

/** The cache key for regional evidence: the country, plus the region or city when one is named. */
export function regionKey(h: Home): string {
  const sub = (h.region || h.city || "").trim().toLowerCase();
  return sub ? `${h.country.toUpperCase()}:${sub}` : h.country.toUpperCase();
}

export const sameHome = (a: Home | null | undefined, b: Home | null | undefined) => !!a && !!b && regionKey(a) === regionKey(b);
