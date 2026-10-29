import { assertPublicUrl, htmlToText, priceBasis, publicFetch, structuredPrices, type Fetcher, type MarkupPrice } from "../agent/tools";

/**
 * Reads one listing page (a home, a car, a provider) the way the price agent reads product pages: our server fetches
 * it, only public hosts are reachable on every redirect hop, and nothing on the page is ever treated as instructions.
 * On top of the price agent's reading it pulls what a swipe card needs: schema.org Residence, Offer and Vehicle data,
 * the listing's photos, and plain facts like bedrooms and floor area.
 */

export const PAGE_TIMEOUT_MS = 7000;
const MAX_BYTES = 1_500_000;
const MAX_TEXT = 20_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface ListingData {
  name?: string;
  price?: number;
  currency?: string;
  bedrooms?: number;
  bathrooms?: number;
  floorM2?: number;
  locality?: string;
  region?: string;
  country?: string;
  /** Combined fuel use, litres per 100 km. */
  fuelL100?: number;
  mileageKm?: number;
  year?: number;
  color?: string;
}

export interface ListingPage {
  ok: boolean;
  url: string;
  status: number;
  title: string;
  text: string;
  /** Prices stated in markup (JSON-LD offers, product meta tags). */
  prices: MarkupPrice[];
  images: string[];
  data: ListingData;
  /** Same-site links that look like single listings, for a results page the hunt can follow one level. */
  links: string[];
  error?: string;
}

/** Hosts that show up in searches but never hold a listing or a published rate. */
export const NOT_A_SOURCE = /(^|\.)(linkedin|facebook|instagram|youtube|pinterest|tiktok|twitter|x|reddit|overdrive|scribd|issuu|medium)\.(com|org)$/i;

/** Links on a results page that look like single listings: same site, an id-like run of digits or a listing path. */
export function listingLinks(html: string, base: string, max = 12): string[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1]!.replace(/&amp;/g, "&"), origin);
    } catch {
      continue;
    }
    if (u.hostname !== origin.hostname || !/^https?:$/.test(u.protocol)) continue;
    if (u.pathname === origin.pathname || /\.(pdf|jpe?g|png|webp)$/i.test(u.pathname) || /pdf|login|contact|favourite|compare|print/i.test(u.pathname)) continue;
    if (!/\d{5,}/.test(u.pathname) && !/\/(property|properties|listing|listings|for-sale|detail|details|inserat|vehicle|vehicles|car-details)\/[^/]+-[^/]+/i.test(u.pathname)) continue;
    u.hash = "";
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const RESIDENCE = /^(Residence|House|SingleFamilyResidence|Apartment|Accommodation|Place|RealEstateListing|Product|Offer|Car|Vehicle|Motorcycle|IndividualProduct|Villa|LodgingBusiness|Service)$/i;

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const types = (o: Record<string, unknown>): string[] => {
  const t = o["@type"];
  return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
};

function imageUrls(v: unknown, out: string[]) {
  if (!v) return;
  if (typeof v === "string") return void out.push(v);
  if (Array.isArray(v)) return v.forEach((x) => imageUrls(x, out));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    imageUrls(o.contentUrl ?? o.url, out);
  }
}

/**
 * schema.org data from every JSON-LD block, merged with the first value of each field winning. The price is the first
 * one that is the thing's own price, never a monthly payment, a member's or a former price, and a list price only when
 * the page states no other (priceBasis).
 */
export function listingData(html: string): { data: ListingData; images: string[] } {
  const data: ListingData = {};
  const images: string[] = [];
  let listed: { price?: number; currency?: string } | undefined;
  const set = <K extends keyof ListingData>(k: K, v: ListingData[K] | undefined) => {
    if (v !== undefined && data[k] === undefined) data[k] = v;
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let root: unknown;
    try {
      root = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const walk = (node: unknown, depth: number) => {
      if (!node || typeof node !== "object" || depth > 7) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      const o = node as Record<string, unknown>;
      const t = types(o);
      if (t.some((x) => RESIDENCE.test(x))) {
        if (typeof o.name === "string" && !/^(offer|aggregateoffer)$/i.test(t[0] ?? "")) set("name", o.name.trim().slice(0, 160));
        imageUrls(o.image ?? o.photo, images);
        set("bedrooms", num(o.numberOfBedrooms) ?? (t.some((x) => /Residence|House|Apartment|Accommodation/i.test(x)) ? num(o.numberOfRooms) : undefined));
        set("bathrooms", num(o.numberOfBathroomsTotal ?? o.numberOfFullBathrooms));
        const floor = o.floorSize as Record<string, unknown> | undefined;
        if (floor && typeof floor === "object") {
          const v = num(floor.value);
          const unit = String(floor.unitCode ?? floor.unitText ?? "").toUpperCase();
          if (v) set("floorM2", /FTK|FT|SQ ?FT|FEET/.test(unit) ? Math.round(v * 0.092903) : v);
        }
        const addr = o.address as Record<string, unknown> | undefined;
        if (addr && typeof addr === "object") {
          if (typeof addr.addressLocality === "string") set("locality", addr.addressLocality);
          if (typeof addr.addressRegion === "string") set("region", addr.addressRegion);
          const c = addr.addressCountry;
          if (typeof c === "string") set("country", c);
          else if (c && typeof c === "object" && typeof (c as Record<string, unknown>).name === "string") set("country", (c as Record<string, string>).name);
        }
        const fuel = o.fuelConsumption as Record<string, unknown> | undefined;
        if (fuel && typeof fuel === "object") set("fuelL100", num(fuel.value));
        const odo = o.mileageFromOdometer as Record<string, unknown> | undefined;
        if (odo && typeof odo === "object") set("mileageKm", num(odo.value));
        set("year", num(o.vehicleModelDate ?? o.modelDate ?? o.productionDate));
        if (typeof o.color === "string") set("color", o.color);
      }
      const priced = ("price" in o && (t.some((x) => /Offer/i.test(x)) || t.some((x) => RESIDENCE.test(x)))) || t.some((x) => /PriceSpecification/i.test(x));
      const basis = priced ? priceBasis(o) : undefined;
      const currency = typeof o.priceCurrency === "string" ? o.priceCurrency.toUpperCase() : undefined;
      if (basis === "price") {
        set("price", num(o.price));
        set("currency", currency);
      } else if (basis === "list" && !listed?.price) listed = { price: num(o.price), currency };
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(root, 0);
  }
  if (data.price === undefined && listed?.price) {
    data.price = listed.price;
    set("currency", listed.currency);
  }
  return { data, images };
}

const NOT_A_PHOTO = /logo|icon|sprite|avatar|favicon|placeholder|blank|pixel|badge|flag|banner-ad|\.svg(\?|$)|\.gif(\?|$)/i;

/** The page's photos, best first: schema.org images, then og and twitter cards, then large inline images. */
export function pagePhotos(html: string, base: string, fromLd: string[], max = 10): string[] {
  const found: string[] = [...fromLd];
  for (const p of ["og:image", "og:image:secure_url", "twitter:image"]) {
    const v = meta(html, p);
    if (v) found.push(v);
  }
  if (found.length < 3) {
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = /\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!src || !/\.(jpe?g|webp|png)(\?|$)/i.test(src)) continue;
      const w = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1] ?? 0);
      if (w && w < 400) continue;
      found.push(src);
      if (found.length > max * 2) break;
    }
  }
  const out: string[] = [];
  for (const raw of found) {
    let u: URL;
    try {
      u = new URL(raw.replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || NOT_A_PHOTO.test(u.pathname)) continue;
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const LIVING = /\b(built|internal|living|floor|interior|total|size|area|indoor|habitable)\b/i;
const OUTSIDE = /\b(plot|land|lot|terrace|garden|site|pool|balcony|garage)\b/i;

/** The home's own floor area: a figure introduced as built or living area first, never a plot or terrace size. */
const area = (text: string): number | undefined => {
  const found: { m2: number; before: string }[] = [];
  for (const m of text.matchAll(/(\d[\d,.]{0,6})\s*(m2|m²|sqm|sq\.?\s?m(?:etres|eters)?\b|square met|sq\.?\s?ft|sqft|square feet|ft²)/gi)) {
    const v = num(m[1]!.replace(/,/g, ""));
    if (!v) continue;
    const m2 = /ft|feet/i.test(m[2]!) ? Math.round(v * 0.092903) : v;
    found.push({ m2, before: text.slice(Math.max(0, m.index! - 40), m.index!) });
    if (found.length >= 12) break;
  }
  const living = found.find((f) => LIVING.test(f.before) && !OUTSIDE.test(f.before.slice(-20)));
  return (living ?? found.find((f) => !OUTSIDE.test(f.before.slice(-20))))?.m2;
};

/** Facts the page states in its text, for pages without structured data. */
export function textFacts(text: string): Pick<ListingData, "bedrooms" | "bathrooms" | "floorM2"> {
  const beds = /(\d{1,2})\s*(?:-|\s)?(?:bed(?:room)?s?\b|br\b)/i.exec(text)?.[1];
  const baths = /(\d{1,2})\s*(?:-|\s)?(?:bath(?:room)?s?\b)/i.exec(text)?.[1];
  return { bedrooms: num(beds), bathrooms: num(baths), floorM2: area(text) };
}

export async function readListing(raw: string, fetcher: Fetcher = publicFetch, timeoutMs = PAGE_TIMEOUT_MS): Promise<ListingPage> {
  const empty: ListingPage = { ok: false, url: raw, status: 0, title: "", text: "", prices: [], images: [], data: {}, links: [] };
  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
  try {
    let res: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      url = await assertPublicUrl(new URL(next, url).toString());
    }
    if (!res) return { ...empty, error: "No response" };
    const type = res.headers.get("content-type") ?? "";
    if (!/html|text/i.test(type)) return { ...empty, url: url.toString(), status: res.status, error: `Not a web page (${type || "unknown type"})` };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    const text = htmlToText(html).slice(0, MAX_TEXT);
    const { data, images } = listingData(html);
    const fromText = textFacts(text);
    const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 200);
    return {
      ok: res.ok,
      url: url.toString(),
      status: res.status,
      title: data.name ?? (meta(html, "og:title") ? htmlToText(meta(html, "og:title")!) : title),
      text,
      prices: structuredPrices(html),
      images: pagePhotos(html, url.toString(), images),
      links: listingLinks(html, url.toString()),
      data: { bedrooms: fromText.bedrooms, bathrooms: fromText.bathrooms, floorM2: fromText.floorM2, ...strip(data) },
      error: res.ok ? undefined : `The page answered ${res.status}`,
    };
  } catch (e) {
    return { ...empty, url: url.toString(), error: (e as Error).name === "TimeoutError" ? "The page took too long" : "The page couldn't be opened" };
  }
}

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Feature words a listing can show, matched in its own text so a card never claims what the page doesn't say. */
export const FEATURE_PATTERNS: Record<string, { label: string; re: RegExp }> = {
  pool: { label: "Pool", re: /\b(swimming[- ]?)?pool\b/i },
  sea_view: { label: "Sea view", re: /\bsea[- ]?views?\b|\bocean[- ]?views?\b|views? (?:of|over|across) the (?:sea|ocean|bay)|\bseafront\b|\bsea front\b|\bbeachfront\b/i },
  wine_cellar: { label: "Wine cellar", re: /\bwine (?:cellar|room|cave|store|vault)\b/i },
  smart_home: { label: "Smart home", re: /\bsmart[- ]home\b|\bhome automation\b|\bdomotics?\b|\bknx\b/i },
  garden: { label: "Garden", re: /\bgardens?\b/i },
  garage: { label: "Garage", re: /\bgarages?\b|\bparking for \d/i },
  gym: { label: "Gym", re: /\bgym\b|\bfitness (?:room|studio)\b/i },
  lift: { label: "Lift", re: /\blift\b|\belevator\b/i },
  cinema: { label: "Home cinema", re: /\bcinema\b|\bhome theat(?:er|re)\b|\bmedia room\b/i },
  terrace: { label: "Terrace", re: /\bterraces?\b|\broof garden\b|\broof terrace\b/i },
  spa: { label: "Spa", re: /\bjacuzzi\b|\bhot tub\b|\bsauna\b|\bspa\b/i },
  guest_house: { label: "Guest house", re: /\bguest (?:house|suite|apartment|cottage)\b/i },
  staff_quarters: { label: "Staff quarters", re: /\bstaff (?:quarters|accommodation|apartment)\b|\bmaid'?s room\b/i },
  solar: { label: "Solar", re: /\bsolar\b|\bphotovoltaic\b|\bpv panels\b/i },
  air_con: { label: "Air conditioning", re: /\bair[- ]?condition(?:ing|ed)\b|\bclimate control\b/i },
  fireplace: { label: "Fireplace", re: /\bfireplace\b/i },
};

export const featureId = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/** The pattern for a feature id or label, falling back to the words themselves for things like "Gaggenau kitchen". */
export function featurePattern(f: string): { id: string; label: string; re: { test(text: string): boolean } } {
  const id = featureId(f);
  const known = FEATURE_PATTERNS[id] ?? Object.entries(FEATURE_PATTERNS).find(([, p]) => p.re.test(f))?.[1];
  if (known) return { id: Object.entries(FEATURE_PATTERNS).find(([, p]) => p === known)?.[0] ?? id, ...known };
  // Every word must appear somewhere on the page: one plain pattern per word, never a chain of lookaheads, which
  // rescans the whole page from every position and can stall the server on a long page.
  const words = f
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .map((w) => new RegExp(`\\b${w.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  return { id, label: f.trim().slice(0, 40), re: { test: (text: string) => words.length > 0 && words.every((w) => w.test(text)) } };
}

/** A home's recurring fee if the page states one: HOA, condo or service charge, with its period. */
export function statedFee(text: string): { amount: number; period: "month" | "year"; quote: string } | null {
  const re = /\b(HOA(?: fees?| dues)?|condo(?:minium)? fees?|service charges?|community fees?|maintenance fees?|common charges?)\b[^0-9\n]{0,30}?([$€£]\s?)?(\d[\d,]*(?:\.\d{1,2})?)\s*(€|EUR|USD|GBP)?\s*(\/\s*(?:month|mo|year|yr|annum)|per (?:month|year|annum)|monthly|annually|a (?:month|year)|p\.?a\.?|pcm)?/gi;
  for (const m of text.matchAll(re)) {
    const amount = num(m[3]!.replace(/,/g, ""));
    if (!amount) continue;
    const per = (m[5] ?? "").toLowerCase();
    if (!per) continue;
    const period = /yr|year|annum|annually|p\.?a/.test(per) ? "year" : "month";
    return { amount, period, quote: m[0].trim().slice(0, 120) };
  }
  return null;
}
