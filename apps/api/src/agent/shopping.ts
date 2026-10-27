import type { Fetcher } from "./tools";

/**
 * Shopping search through Apify's Google Shopping actor. Big stores like B&H and Adorama refuse our page reads, but
 * their prices still show up in Google Shopping, so this is how the agent sees current listings from them.
 *
 * Actor: damilo/google-shopping-apify, chosen 2026-10-27 as the most used Google Shopping actor in the Apify Store
 * (about 1,200 users, 265 active in the last 30 days, 94% of its runs succeeding, rated 4.6, updated 2026-10-18).
 * It is pay-per-event at $0.0035 per result with no start fee, and `maxTotalChargeUsd` caps each run, so a search
 * can never cost more than SHOPPING_MAX_RESULTS results.
 */

export const SHOPPING_ACTOR = "damilo~google-shopping-apify";
export const SHOPPING_PRICE_PER_RESULT_USD = 0.0035;
export const SHOPPING_MAX_RESULTS = 6;
const RUN_TIMEOUT_SECS = 40;
const APIFY = "https://api.apify.com/v2";

export interface ShoppingOffer {
  title: string;
  price: number;
  currency: string;
  merchant: string;
  /** Google Shopping's page for the offer; the merchant's own page has to be found separately. */
  link?: string;
  image?: string;
  /** Only when the listing says so; the feed has no condition field of its own. */
  condition?: "new" | "used" | "refurbished";
  rating?: number;
  reviews?: number;
}

export interface ShoppingResult {
  offers: ShoppingOffer[];
  /** What the run is billed: one event per dataset item it returned. */
  costUsd: number;
}

const SYMBOLS: [RegExp, string][] = [
  [/€|\bEUR\b/i, "EUR"],
  [/£|\bGBP\b/i, "GBP"],
  [/¥|\bJPY\b/i, "JPY"],
  [/₹|\bINR\b/i, "INR"],
  [/\bCHF\b/i, "CHF"],
  [/\bA\$|\bAU\$|\bAUD\b/i, "AUD"],
  [/\bC\$|\bCA\$|\bCAD\b/i, "CAD"],
  [/\bNZ\$|\bNZD\b/i, "NZD"],
  [/\bUSD\b|US\$/i, "USD"],
];

/** Reads a listed price like "$7,350.00", "7.350,00 €" or "£1,299" into an amount and an ISO currency. */
export function parsePrice(text: string, fallbackCurrency: string): { amount: number; currency: string } | null {
  const t = text.replace(/ /g, " ").trim();
  const num = /\d[\d.,\s]*/.exec(t)?.[0]?.trim();
  if (!num) return null;
  let s = num.replace(/\s/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot) {
    // 7.350,00 or 1299,99: the comma is the decimal mark when two digits follow it
    s = /,\d{2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else {
    s = s.replace(/,/g, "");
    if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  }
  const amount = Number(s);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = SYMBOLS.find(([re]) => re.test(t))?.[1] ?? fallbackCurrency.toUpperCase();
  return { amount, currency };
}

export function conditionOf(title: string): ShoppingOffer["condition"] {
  if (/\b(refurb\w*|renewed|reconditioned)\b/i.test(title)) return "refurbished";
  if (/\b(used|pre-?owned|second[- ]hand|like new|open[- ]box|demo)\b/i.test(title)) return "used";
  if (/\b(brand new|new in box|factory sealed)\b/i.test(title)) return "new";
  return undefined;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Turns the actor's dataset items into offers, dropping prices far below the rest (accessories, typos, ads). */
export function toOffers(items: unknown[], fallbackCurrency: string): ShoppingOffer[] {
  const offers: ShoppingOffer[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const title = typeof it.title === "string" ? it.title.trim().slice(0, 200) : "";
    const merchant = typeof it.source === "string" ? it.source.trim().slice(0, 80) : typeof it.merchant === "string" ? it.merchant.trim().slice(0, 80) : "";
    const price = typeof it.price === "string" ? parsePrice(it.price, fallbackCurrency) : typeof it.price === "number" ? { amount: it.price, currency: fallbackCurrency.toUpperCase() } : null;
    if (!title || !merchant || !price) continue;
    const link = typeof it.link === "string" && /^https:\/\//.test(it.link) ? it.link : undefined;
    const image = typeof it.imageUrl === "string" && /^https:\/\//.test(it.imageUrl) ? it.imageUrl : undefined;
    offers.push({
      title,
      price: price.amount,
      currency: price.currency,
      merchant,
      ...(link ? { link } : {}),
      ...(image ? { image } : {}),
      ...(conditionOf(title) ? { condition: conditionOf(title) } : {}),
      ...(typeof it.rating === "number" ? { rating: it.rating } : {}),
      ...(typeof it.ratingCount === "number" ? { reviews: it.ratingCount } : {}),
    });
  }
  if (offers.length < 3) return offers;
  const mid = median(offers.map((o) => o.price));
  return offers.filter((o) => o.price >= mid * 0.3);
}

/** Google's country codes are ISO 3166 except the UK. */
const countryFor = (region: string) => {
  const r = region.toLowerCase();
  return r === "uk" ? "gb" : /^[a-z]{2}$/.test(r) ? r : "us";
};

export interface ShoppingConfig {
  token: string;
  fetcher?: Fetcher;
  actor?: string;
  maxResults?: number;
}

/** One synchronous actor run; returns the top offers and what the run costs. */
export async function shoppingSearch(query: string, region: string, currency: string, config: ShoppingConfig): Promise<ShoppingResult> {
  const fetcher = config.fetcher ?? fetch;
  const max = Math.max(1, Math.min(config.maxResults ?? SHOPPING_MAX_RESULTS, 10));
  const cap = (max * SHOPPING_PRICE_PER_RESULT_USD).toFixed(4);
  const url = `${APIFY}/acts/${config.actor ?? SHOPPING_ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}&maxTotalChargeUsd=${cap}&clean=true&format=json`;
  const res = await fetcher(url, {
    method: "POST",
    // The token goes in a header, never the URL, so it can't end up in a log line.
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    // The actor only accepts num of 10, 20 ... 100; maxTotalChargeUsd is what stops it at `max` results.
    body: JSON.stringify({ query: query.slice(0, 200), country: countryFor(region), language: "en", num: "10", max_pages: 1 }),
    signal: AbortSignal.timeout((RUN_TIMEOUT_SECS + 15) * 1000),
  });
  if (!res.ok) throw new Error(res.status === 402 || res.status === 403 ? "The shopping search allowance is used up." : `Shopping search answered ${res.status}`);
  const items = (await res.json()) as unknown;
  const list = Array.isArray(items) ? items.slice(0, max) : [];
  return { offers: toOffers(list, currency), costUsd: (Array.isArray(items) ? Math.min(items.length, max) : 0) * SHOPPING_PRICE_PER_RESULT_USD };
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.(com|co\.uk|net|org|de|fr)\b.*$/, "").replace(/[^a-z0-9]/g, "");

/** The shopping offer an option's price came from: same merchant (by name or link host), same currency, same price. */
export function matchOffer(offers: ShoppingOffer[], option: { seller: string; url: string; currency: string; price: number }): ShoppingOffer | undefined {
  let host = "";
  try {
    host = new URL(option.url).hostname;
  } catch {
    /* not a URL */
  }
  const names = [norm(option.seller), norm(host)].filter((n) => n.length > 2);
  return offers.find((o) => {
    const m = norm(o.merchant);
    const sameMerchant = m.length > 2 && names.some((n) => n.includes(m) || m.includes(n));
    return sameMerchant && o.currency === option.currency.toUpperCase() && Math.abs(o.price - option.price) <= Math.max(0.01, option.price * 0.005);
  });
}
