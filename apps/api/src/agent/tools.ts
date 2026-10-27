import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * The research agent's own tools. Pages are fetched by our server, never by the model, and their text is
 * returned as data. Only public http(s) hosts are reachable, so a page can't steer the agent into our network.
 */

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 6000;
const TIMEOUT_MS = 8000;
// A browser-like agent string: many stores refuse unknown clients outright. One read per page, never a crawl.
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface PageResult {
  ok: boolean;
  url: string;
  status: number;
  title: string;
  text: string;
  /** Prices the page states in structured data (JSON-LD offers or product meta tags), as written. */
  structuredPrices: { amount: number; currency?: string }[];
  imageUrl?: string;
  /** Candidate product images the page offers, most trusted first (see pageImages). */
  images: string[];
  error?: string;
}

export type Fetcher = typeof fetch;

// Every range that isn't globally routable unicast. BlockList also matches IPv4-mapped IPv6 forms
// (::ffff:127.0.0.1 and ::ffff:7f00:1) against the IPv4 rules.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, bits, "ipv6");

export function privateIp(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Throws unless the URL is http(s) on a public host. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a valid link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web links can be opened");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new Error("That host is private");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(privateIp)) throw new Error("That host is private");
  return url;
}

/**
 * Checks the addresses again at the moment of connecting, so a host that resolves to a public address for the
 * check and a private one for the request (DNS rebinding) still can't reach our network.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!list.length || list.some((a) => privateIp(a.address))) return callback(new Error("That host is private"), "", 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};
const publicOnly = new Agent({ connect: { lookup: safeLookup } });
export const publicFetch: Fetcher = ((url: string | URL, init?: RequestInit) =>
  undiciFetch(url, { ...(init as object), dispatcher: publicOnly } as never)) as unknown as Fetcher;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#36": "$", euro: "€", pound: "£" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) || m : m))
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
}

/** Offers from JSON-LD and product meta tags. Pages that state a price in markup are the easiest to verify. */
export function structuredPrices(html: string): { amount: number; currency?: string }[] {
  const out: { amount: number; currency?: string }[] = [];
  const push = (amount: unknown, currency: unknown) => {
    const n = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) out.push({ amount: n, currency: typeof currency === "string" ? currency : undefined });
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const walk = (node: unknown, depth: number) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      const o = node as Record<string, unknown>;
      if ("price" in o) push(o.price, o.priceCurrency);
      if ("lowPrice" in o) push(o.lowPrice, o.priceCurrency);
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(data, 0);
  }
  push(meta(html, "product:price:amount") ?? meta(html, "og:price:amount"), meta(html, "product:price:currency") ?? meta(html, "og:price:currency"));
  return out.slice(0, 20);
}

/**
 * GETs a public URL. Redirects are followed by hand so each hop is checked against the private-host rule.
 * Throws when the URL or a redirect points somewhere private.
 */
export async function safeGet(raw: string, fetcher: Fetcher, headers: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<{ res: Response; url: URL }> {
  let url = await assertPublicUrl(raw);
  let res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, ...headers } });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = await assertPublicUrl(new URL(next, url).toString());
  }
  if (!res) throw new Error("No response");
  return { res, url };
}

/** Reads a response body, stopping once it passes `max` bytes. */
export async function readCapped(res: Response, max: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return { bytes: Buffer.concat(chunks), truncated: true };
    }
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);
const decodeAttr = (v: string) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();

/** The largest candidate in a srcset, by its width or density descriptor. */
export function largestFromSrcset(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = desc ? parseFloat(desc) * (desc.endsWith("x") ? 1000 : 1) : 1;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

/**
 * Product images a page offers, most trusted first: JSON-LD image arrays (often the full-size originals), the
 * share images (og:image, twitter:image), zoom and large variants in data attributes, and the largest srcset entry
 * of images whose alt text names the product. Returns absolute URLs.
 */
export function pageImages(html: string, base: URL | string, max = 12): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim() || raw.trim().startsWith("data:")) return;
    try {
      const u = new URL(decodeAttr(raw), base);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(u.toString())) out.push(u.toString());
    } catch {
      /* not a URL */
    }
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const walk = (node: unknown, depth: number) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      const o = node as Record<string, unknown>;
      for (const key of ["image", "contentUrl", "thumbnailUrl"]) {
        const v = o[key];
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (typeof item === "string") add(item);
          else if (item && typeof item === "object") add((item as Record<string, unknown>).contentUrl ?? (item as Record<string, unknown>).url);
        }
      }
      for (const [k, v] of Object.entries(o)) if (k !== "image" && typeof v === "object") walk(v, depth + 1);
    };
    walk(data, 0);
  }
  for (const p of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) add(meta(html, p));
  add(/<link[^>]+rel=["']image_src["'][^>]*>/i.exec(html)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1]);
  // A gallery image counts only when its alt text names the product: two of the first words of the page's title.
  const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").toLowerCase().split(/\s[|–—-]\s/)[0] ?? "";
  const words = [...new Set(title.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, 4);
  const names = (alt: string) => words.filter((w) => alt.includes(w)).length >= Math.min(2, words.length);
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    for (const name of ["data-zoom-image", "data-zoom", "data-zoom-src", "data-large", "data-large-image", "data-full", "data-old-hires", "data-hires"]) add(attr(tag, name));
    const dynamic = attr(tag, "data-a-dynamic-image");
    if (dynamic) {
      try {
        const sizes = JSON.parse(decodeAttr(dynamic)) as Record<string, [number, number]>;
        add(Object.entries(sizes).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0]?.[0]);
      } catch {
        /* not JSON */
      }
    }
    const alt = (attr(tag, "alt") ?? "").toLowerCase();
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    if (srcset && words.length && names(alt)) add(largestFromSrcset(decodeAttr(srcset)));
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export async function getPage(raw: string, fetcher: Fetcher = publicFetch): Promise<PageResult> {
  const empty = { ok: false, url: raw, status: 0, title: "", text: "", structuredPrices: [], images: [] };
  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
  try {
    const got = await safeGet(url.toString(), fetcher, { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" });
    const res = got.res;
    url = got.url;
    const type = res.headers.get("content-type") ?? "";
    if (!/html|text|json/i.test(type)) return { ...empty, url: url.toString(), status: res.status, error: `Not a web page (${type || "unknown type"})` };
    const html = new TextDecoder().decode((await readCapped(res, MAX_BYTES)).bytes);
    const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 200);
    const image = meta(html, "og:image");
    return {
      ok: res.ok,
      url: url.toString(),
      status: res.status,
      title,
      text: htmlToText(html).slice(0, MAX_TEXT),
      structuredPrices: structuredPrices(html),
      imageUrl: image ? new URL(image, url).toString() : undefined,
      images: res.ok ? pageImages(html, url) : [],
      error: res.ok ? undefined : `The page answered ${res.status}`,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return { ...empty, url: url.toString(), error: (e as Error).name === "TimeoutError" ? "The page took too long" : msg === "That host is private" ? msg : "The page couldn't be opened" };
  }
}

/** Daily reference rates from the European Central Bank, via Frankfurter. */
export async function fxRate(from: string, to: string, fetcher: Fetcher = fetch): Promise<{ rate: number; date: string }> {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b) return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  if (!/^[A-Z]{3}$/.test(a) || !/^[A-Z]{3}$/.test(b)) throw new Error("Use three-letter currency codes");
  const res = await fetcher(`https://api.frankfurter.dev/v1/latest?base=${a}&symbols=${b}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`No rate for ${a} to ${b}`);
  const body = (await res.json()) as { date: string; rates: Record<string, number> };
  const rate = body.rates[b];
  if (!rate) throw new Error(`No rate for ${a} to ${b}`);
  return { rate, date: body.date };
}

/** Words in shop names that say nothing about who the shop is. */
const GENERIC_WORDS = new Set([
  "the", "and", "of", "official", "store", "shop", "shops", "online", "inc", "llc", "ltd", "co", "company", "corp", "group", "usa", "us", "uk", "eu",
  "camera", "cameras", "photo", "video", "audio", "airline", "airlines", "air", "airways", "hotel", "hotels", "resort", "travel", "direct", "international", "com",
]);
/** Second-level labels under a country code, as in example.co.uk. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac"]);
/** Bits a shop's own domain may add around its name: flytap, onepeloton, leicacamerausa, store.hermanmiller. */
const AFFIXES = ["official", "online", "global", "direct", "store", "shop", "buy", "get", "fly", "one", "the", "app", "usa", "my", "go", "us", "uk", "hq"];

/** True when the fragment is made only of filler words: affixes and the generic words above. */
function filler(fragment: string): boolean {
  let rest = fragment;
  for (let changed = true; rest && changed; ) {
    changed = false;
    for (const w of [...AFFIXES, ...GENERIC_WORDS]) {
      if (rest.startsWith(w)) (rest = rest.slice(w.length)), (changed = true);
      else if (rest.endsWith(w)) (rest = rest.slice(0, -w.length)), (changed = true);
    }
  }
  return rest === "";
}

/**
 * True when a page's host belongs to the seller: leica-camera.com for "Leica Camera", bhphotovideo.com for "B&H",
 * flytap.com for "TAP Air Portugal", dwr.com for "Design Within Reach". The seller's name (or its initials) has to
 * account for the whole site name, apart from filler like "fly", "store" or "usa". So a price on anyone else's
 * page, such as a blog whose name merely shares a word with the seller, can't count as checked with that seller.
 */
export function sellerOwnsHost(seller: string, url: string): boolean {
  let labels: string[];
  try {
    labels = new URL(url).hostname.toLowerCase().replace(/^www\d*\./, "").split(".");
  } catch {
    return false;
  }
  if (isIP(labels.join(".")) || labels.length < 2) return false;
  const tld = labels.length > 2 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 2 : 1;
  const site = labels.slice(0, -tld).join("").replace(/[^a-z0-9]/g, "");
  const tokens = seller.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  if (!site || !tokens.length) return false;
  const compact = tokens.join("");
  const initials = tokens.length >= 2 ? tokens.map((t) => t[0]).join("") : "";
  const pieces = [...new Set([compact, initials, ...tokens.filter((t) => t.length >= 2)])].filter(Boolean).sort((a, b) => b.length - a.length);
  let rest = site;
  let named = false;
  for (const p of pieces) {
    if (!rest.includes(p)) continue;
    rest = rest.split(p).join("|");
    if (!GENERIC_WORDS.has(p)) named = true;
  }
  return named && rest.split("|").every(filler);
}

/** Words in an option's label that don't say which thing it is. */
const DESCRIPTIVE_WORDS = new Set([
  "new", "used", "with", "from", "for", "body", "only", "kit", "bundle", "package", "edition", "black", "white", "silver", "digital", "base", "msrp", "model",
  "room", "rooms", "double", "single", "twin", "suite", "night", "nights", "week", "return", "flight", "flights", "ticket", "tickets", "fare", "trip", "via", "price",
]);

/**
 * True when the page names the thing being priced: at least one telling word of its label is on the page. A bare
 * number on a generic page (a search landing page, a home page) proves nothing about this item.
 */
export function pageNamesItem(page: Pick<PageResult, "title" | "text">, label: string): boolean {
  const haystack = `${page.title} ${page.text}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w) && !DESCRIPTIVE_WORDS.has(w));
  return words.length === 0 || words.some((w) => haystack.includes(w));
}

/** True when the page shows this amount, written any common way: 2495, 2,495, 2,495.00, 2.495,00. */
export function pageShowsPrice(page: Pick<PageResult, "text" | "structuredPrices">, amount: number): boolean {
  if (page.structuredPrices.some((p) => Math.abs(p.amount - amount) < 0.005)) return true;
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  const grouped = whole.toLocaleString("en-US");
  const forms = new Set<string>();
  if (cents === 0) {
    forms.add(grouped).add(String(whole)).add(grouped.replace(/,/g, ".")).add(grouped.replace(/,/g, " "));
  }
  const c = String(cents).padStart(2, "0");
  forms.add(`${grouped}.${c}`).add(`${whole}.${c}`).add(`${grouped.replace(/,/g, ".")},${c}`).add(`${whole},${c}`);
  const text = page.text.replace(/ /g, " ");
  return [...forms].some((f) => new RegExp(`(^|[^0-9.,])${f.replace(/[.]/g, "\\.")}(?![0-9]|[.,][0-9])`).test(text));
}
