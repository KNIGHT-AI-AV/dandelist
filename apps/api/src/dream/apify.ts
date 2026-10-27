import type { Listing } from "@dandelist/catalogue/dream";
import { createHash } from "node:crypto";
import type { DreamCtx } from "./context";
import type { CarCriteria, HomeCriteria } from "./types";

/**
 * Listing portals through Apify, on the free plan only. Each actor was picked on 2026-10-27 as a well-used, recently
 * updated scraper for its market. Every run is capped (results, memory, time and `maxTotalChargeUsd`), recorded in the
 * spend ledger under the "apify:" model prefix the price agent's shopping search uses, and refused before it starts
 * when it could push today's Apify spend past the shared daily cap.
 */

const APIFY = "https://api.apify.com/v2";
const RUN_TIMEOUT_SECS = 50;
const MAX_ITEMS = 10;
export const TOOL_MODEL_PREFIX = "apify:";

interface Actor<C> {
  id: string;
  market: string;
  /** Worst-case cost of one capped run, for the daily cap. */
  worstUsd: number;
  input: (c: C) => Record<string, unknown>;
  toListing: (item: Record<string, unknown>, checkedAt: string) => Listing | null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[^0-9.]/g, "")) || undefined : undefined);
const idOf = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 16);
const https = (u: unknown) => (typeof u === "string" && /^https:\/\//.test(u) ? u : undefined);

/** Idealista: Spain, Portugal, Italy and France (igolaizola/idealista-scraper, about 2,600 users, updated 2026-09-21). */
const IDEALISTA_PRICES = [
  50000, 75000, 100000, 125000, 150000, 175000, 200000, 225000, 250000, 275000, 300000, 325000, 350000, 375000, 400000, 425000, 450000, 475000, 500000, 550000, 600000,
  650000, 700000, 750000, 800000, 850000, 900000, 950000, 1000000, 1100000, 1200000, 1300000, 1400000, 1500000, 1600000, 1700000, 1800000, 1900000, 2000000, 2250000,
  2500000, 2750000, 3000000, 3500000, 4000000,
];
const idealista: Actor<HomeCriteria> = {
  id: "igolaizola~idealista-scraper",
  market: "idealista",
  worstUsd: 0.02,
  input: (c) => {
    const f = c.features.join(" ").toLowerCase();
    const max = c.maxPrice ? IDEALISTA_PRICES.find((p) => p >= c.maxPrice!) : undefined;
    return {
      operation: "sale",
      propertyType: "homes",
      country: c.place!.country.toLowerCase(),
      location: c.place!.city || c.place!.region || "",
      maxItems: MAX_ITEMS,
      sortBy: "relevance",
      ...(max ? { maxPrice: String(max) } : {}),
      ...(c.bedrooms ? { bedrooms: [String(Math.min(4, c.bedrooms))] } : {}),
      ...(/villa|house|estate|mansion/i.test(`${c.notes} ${c.styles.join(" ")}`) ? { homeType: ["villa", "detachedHouse", "countryHouse"] } : {}),
      swimmingPool: /pool/.test(f),
      seaViews: /sea/.test(f),
      garden: /garden/.test(f),
      terrace: /terrace/.test(f),
      luxury: (c.maxPrice ?? 0) >= 1_000_000 || /luxury/i.test(c.notes),
    };
  },
  toListing: (it, checkedAt) => {
    const url = https(it.url);
    const price = n((it.priceInfo as Record<string, any> | undefined)?.price?.amount) ?? n(it.price);
    if (!url || !price) return null;
    const imgs = ((it.multimedia as Record<string, any> | undefined)?.images ?? []) as { url?: string }[];
    const images = imgs.map((i) => https(i.url)).filter((u): u is string => !!u).slice(0, 10);
    if (!images.length && https(it.thumbnail)) images.push(it.thumbnail as string);
    const feats = (it.features ?? {}) as Record<string, boolean>;
    const facts = [
      n(it.rooms) ? `${n(it.rooms)} bedrooms` : "",
      n(it.size) ? `${Math.round(n(it.size)!)} m²` : "",
      feats.hasSwimmingPool ? "Pool" : "",
      feats.hasGarden ? "Garden" : "",
      feats.hasTerrace ? "Terrace" : "",
      it.hasLift ? "Lift" : "",
    ].filter(Boolean);
    const where = [str(it.neighborhood), str(it.municipality), str(it.province)].filter(Boolean).join(", ");
    return {
      id: idOf(url),
      title: str((it.suggestedTexts as Record<string, unknown> | undefined)?.title) || str(it.address) || "Home for sale",
      priceCents: Math.round(price * 100),
      currency: "EUR",
      url,
      source: "idealista",
      images: images.map((u) => ({ url: u, source: "idealista" })),
      facts,
      ...(where ? { region: where } : {}),
      status: "verified",
      checkedAt,
    };
  },
};

/** Realtor.com: the United States (epctex/realtor-scraper, about 1,900 users, updated 2026-10-27). */
const realtor: Actor<HomeCriteria> = {
  id: "epctex~realtor-scraper",
  market: "realtor.com",
  worstUsd: 0.03,
  input: (c) => ({
    search: c.place!.city || c.place!.region || c.place!.label,
    mode: "BUY",
    maxItems: MAX_ITEMS,
    includeDetails: false,
    type: ["single-family-home"],
    sort: "relevant",
    ...(c.maxPrice ? { maxPrice: Math.round(c.maxPrice) } : {}),
    ...(c.bedrooms ? { minBed: c.bedrooms } : {}),
    ...(/pool/i.test(c.features.join(" ")) ? { tags: ["swimming-pool"] } : {}),
  }),
  toListing: (it, checkedAt) => {
    const url = https(it.url) ?? (str(it.permalink) ? `https://www.realtor.com/realestateandhomes-detail/${str(it.permalink)}` : undefined);
    const price = n(it.listPrice);
    if (!url || !price) return null;
    const photos = ((it.photos ?? []) as { href?: string }[]).map((p) => https(p.href)).filter((u): u is string => !!u).slice(0, 10);
    const addr = (it.address ?? {}) as Record<string, string>;
    const facts = [n(it.beds) ? `${n(it.beds)} bedrooms` : "", n(it.baths) ? `${n(it.baths)} bathrooms` : "", n(it.sqft) ? `${Math.round(n(it.sqft)! * 0.092903)} m²` : ""].filter(Boolean);
    return {
      id: idOf(url),
      title: [addr.street, addr.locality].filter(Boolean).join(", ") || "Home for sale",
      priceCents: Math.round(price * 100),
      currency: "USD",
      url,
      source: "realtor.com",
      images: photos.map((u) => ({ url: u, source: "realtor.com" })),
      facts,
      ...(addr.locality ? { region: [addr.locality, addr.region].filter(Boolean).join(", ") } : {}),
      status: "verified",
      checkedAt,
    };
  },
};

const COLOURS = ["BLACK", "WHITE", "SILVER", "GREY", "BLUE", "RED", "GREEN", "YELLOW", "BROWN", "BEIGE", "GOLD", "ORANGE", "VIOLET"];
/** mobile.de: Europe's largest car market (blackfalcondata/mobile-de-scraper, pay per result, updated 2026-10-27). */
const mobileDe: Actor<CarCriteria> = {
  id: "blackfalcondata~mobile-de-scraper",
  market: "mobile.de",
  worstUsd: 0.005 + MAX_ITEMS * 0.00059 + 0.002,
  input: (c) => {
    const colour = COLOURS.find((x) => c.colour.toUpperCase().includes(x)) ?? (/grey|gray/i.test(c.colour) ? "GREY" : undefined);
    const model = c.model.toLowerCase().startsWith(c.make.toLowerCase()) ? c.model.slice(c.make.length).trim() : c.model;
    // mobile.de files AMG models as "G 63 AMG"; a free-text query matches loosely (C 63, GLC 63), so the model filter
    // carries the search and a comma list covers both spellings. Checked live on 2026-10-27.
    const amg = /mercedes/i.test(c.make) && !/amg/i.test(model) ? `,${model} AMG` : "";
    return {
      make: c.make,
      model: `${model}${amg}`,
      maxResults: MAX_ITEMS,
      includeDetails: false,
      sort: "registration_desc",
      ...(c.condition === "new" ? { condition: ["NEW"] } : c.condition === "used" ? { condition: ["USED"] } : {}),
      ...(colour ? { exteriorColor: [colour] } : {}),
      ...(c.maxPrice && c.currency === "EUR" ? { priceMax: Math.round(c.maxPrice) } : {}),
      damageStatus: "EXCLUDE",
    };
  },
  toListing: (it, checkedAt) => {
    const url = https(it.canonicalUrl) ?? https(it.sourceUrl);
    const price = n(it.price);
    if (!url || !price) return null;
    const images = ((it.imageUrls ?? []) as string[]).map(https).filter((u): u is string => !!u).slice(0, 10);
    const reg = str(it.firstRegistration);
    const facts = [
      reg ? `First registered ${reg}` : str(it.condition) === "NEW" || /new/i.test(str(it.condition)) ? "New" : "",
      typeof it.mileageKm === "number" ? `${Math.round(it.mileageKm).toLocaleString("en-US")} km` : "",
      n(it.powerPs) ? `${n(it.powerPs)} hp` : "",
      str(it.colorManufacturer) || str(it.color),
      n(it.fuelConsumptionCombined) ? `${n(it.fuelConsumptionCombined)} L/100 km` : "",
    ].filter(Boolean);
    return {
      id: idOf(url),
      title: str(it.title) || `${str(it.make)} ${str(it.model)}`.trim(),
      priceCents: Math.round(price * 100),
      currency: (str(it.priceCurrency) || "EUR").toUpperCase(),
      url,
      source: "mobile.de",
      images: images.map((u) => ({ url: u, source: "mobile.de" })),
      facts,
      ...(str(it.location) ? { region: str(it.location) } : {}),
      status: "verified",
      checkedAt,
    };
  },
};

export function homeActor(c: HomeCriteria): Actor<HomeCriteria> | undefined {
  const country = c.place?.country.toUpperCase();
  if (country && ["ES", "PT", "IT", "FR"].includes(country)) return idealista;
  if (country === "US") return realtor;
  return undefined;
}
export const carActor = (): Actor<CarCriteria> => mobileDe;

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Runs one actor synchronously and returns its listings; refuses quietly (empty list) when the daily cap is near. */
export async function runActor<C>(ctx: DreamCtx, actor: Actor<C>, criteria: C): Promise<{ listings: Listing[]; costUsd: number; skipped?: string }> {
  const apify = ctx.apify;
  if (!apify) return { listings: [], costUsd: 0, skipped: "off" };
  const now = ctx.now();
  const { rows } = await ctx.db.query<{ spent: string | null }>("select coalesce(sum(cost_usd), 0) as spent from spend_ledger where model like $1 and created_at >= $2", [
    `${TOOL_MODEL_PREFIX}%`,
    dayStart(now).toISOString(),
  ]);
  if (Number(rows[0]?.spent ?? 0) + actor.worstUsd > apify.dailyUsd) return { listings: [], costUsd: 0, skipped: "cap" };
  const url = `${APIFY}/acts/${actor.id}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}&memory=1024&maxItems=${MAX_ITEMS}&maxTotalChargeUsd=${actor.worstUsd.toFixed(4)}&clean=true&format=json`;
  const fetcher = apify.fetch ?? ctx.api;
  let items: unknown = [];
  try {
    const res = await fetcher(url, {
      method: "POST",
      // The token goes in a header, never the URL, so it can't end up in a log line.
      headers: { Authorization: `Bearer ${apify.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(actor.input(criteria)),
      signal: AbortSignal.timeout((RUN_TIMEOUT_SECS + 15) * 1000),
    });
    if (res.ok) items = await res.json();
    else console.warn("apify run answered", actor.id, res.status);
  } catch (e) {
    console.warn("apify run failed", actor.id, (e as Error).name);
  }
  const list = Array.isArray(items) ? (items as Record<string, unknown>[]).slice(0, MAX_ITEMS) : [];
  // Bill what a run can cost: its start plus what came back, never more than the cap the run was given.
  const costUsd = Math.min(actor.worstUsd, 0.005 + list.length * 0.0015);
  await ctx.db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, $2, 'dream', $3, $4)", [
    ctx.userId,
    `${TOOL_MODEL_PREFIX}${actor.id}`,
    costUsd.toFixed(6),
    now.toISOString(),
  ]);
  const checkedAt = now.toISOString();
  return { listings: list.map((it) => actor.toListing(it, checkedAt)).filter((l): l is Listing => !!l), costUsd };
}

