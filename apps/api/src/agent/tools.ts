import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The research agent's own tools. Pages are fetched by our server, never by the model, and their text is
 * returned as data. Only public http(s) hosts are reachable, so a page can't steer the agent into our network.
 */

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 6000;
const TIMEOUT_MS = 8000;
// A browser-like agent string: many stores refuse unknown clients outright. One read per page, never a crawl.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface PageResult {
  ok: boolean;
  url: string;
  status: number;
  title: string;
  text: string;
  /** Prices the page states in structured data (JSON-LD offers or product meta tags), as written. */
  structuredPrices: { amount: number; currency?: string }[];
  imageUrl?: string;
  error?: string;
}

export type Fetcher = typeof fetch;

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateV4(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
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

export async function getPage(raw: string, fetcher: Fetcher = fetch): Promise<PageResult> {
  const empty = { ok: false, url: raw, status: 0, title: "", text: "", structuredPrices: [] };
  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
  try {
    // Redirects are followed by hand so each hop is checked against the private-host rule.
    let res: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      url = await assertPublicUrl(new URL(next, url).toString());
    }
    if (!res) return { ...empty, error: "No response" };
    const type = res.headers.get("content-type") ?? "";
    if (!/html|text|json/i.test(type)) return { ...empty, url: url.toString(), status: res.status, error: `Not a web page (${type || "unknown type"})` };
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
      error: res.ok ? undefined : `The page answered ${res.status}`,
    };
  } catch (e) {
    return { ...empty, url: url.toString(), error: (e as Error).name === "TimeoutError" ? "The page took too long" : "The page couldn't be opened" };
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
