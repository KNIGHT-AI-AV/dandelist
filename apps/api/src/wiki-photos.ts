import { safeCommonsSourcePage } from "@dandelist/catalogue";
import { COMMONS_UA, type MediaImage } from "./agent/media";
import type { Fetcher } from "./agent/tools";
import { words } from "./archive/archive";

/*
 * Photographs of things and places from what Wikipedia's and Wikidata's editors chose to show them. Moved out of
 * pairs.ts so the hunt's choices can use them too without importing the pairs' routes.
 */

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
/**
 * Photos are fetched as Wikimedia's own rendering this wide: sharp on a phone card, a fraction of the original.
 * Wikimedia renders standard widths (1920 is one; a request for 2048 came back at 3840, 2026-10-30).
 */
const PHOTO_WIDTH = 1920;
/** Wikimedia adds its own tracking parameters to the addresses its API hands out; a saved photo keeps none. */
const untracked = (raw: string) => {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
};
/**
 * File names that say the picture is not a photograph of the thing or place: a flag (most countries' articles lead with
 * one), a map, a seal, a logo, a diagram, a collage, or a picture from orbit (islands' articles often lead with one).
 */
const NOT_A_VIEW = /\b(flag|flags|logo|map|maps|locator|coat of arms|seal of|emblem of|diagram|chart|icon|signature|wordmark)\b|montage|collage|mosaic|composite|\bISS\d{3}|astronaut|satellite|landsat|from space/i;

/** An article title as Wikipedia can take it: no section, none of the characters a title can't hold. The lookup's key. */
export const articleTitle = (t: string) => t.replace(/#.*$/, "").replace(/[|<>[\]{}]/g, " ").replace(/\s+/g, " ").trim();

const stripHtml = (s: unknown) => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim() : "");
const fileKey = (name: string) => name.replace(/^File:/i, "").replace(/_/g, " ").trim().toLowerCase();

/** A photograph fit for a card by its file alone: a JPEG at least 1200 by 900, not a strip, a flag, a map or a collage. */
export function leadFileOk(name: string, mime: string, width: number, height: number): boolean {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return mime === "image/jpeg" && short >= 900 && long >= 1200 && long / short <= 2.4 && !NOT_A_VIEW.test(name.replace(/_/g, " "));
}

/** Roman numerals and generation words name a version, not the thing: "Phantom VIII" is still a Phantom. */
const VERSION = /^(i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,3}|mk\d*|series|gen|generation)$/;

/**
 * The article's photo is of this very thing: the article names the title's own last word (the model, the place:
 * "Daytona", "Birkin", "Bora"), and every word with a number in it ("X100VI", "911"). A brand's article ("Porsche" for
 * a Taycan) or an older model's ("Fujifilm X100" for an X100VI) never lends its photo.
 */
export function leadFits(title: string, article: string): boolean {
  const mine = words(title);
  const theirs = new Set(words(article.replace(/\([^)]*\)/g, " ")));
  const named = [...mine].reverse().find((w) => !VERSION.test(w));
  if (!named || !theirs.has(named)) return false;
  return mine.filter((w) => /\d/.test(w)).every((w) => theirs.has(w));
}

export interface WikiPhoto {
  /** The article the title landed on, through Wikipedia's redirects. */
  article: string;
  /** Its lead photo when that is a photograph fit for a card, else its Wikidata item's own image when that is. */
  image: MediaImage;
}

/**
 * A photograph for each article, from what Wikipedia's and Wikidata's editors chose to show it, in a few requests for
 * all of them: where each title lands and its lead photo (Wikipedia's free-licence pick); each file's size, type, author
 * and licence; then, only for those whose lead photo isn't a photograph (a country's flag, an island from orbit), the
 * Wikidata item's own image. A title that lands on a disambiguation page or on one section of a broader article gets
 * none: that article's photo shows something else. Keyed by the title asked for.
 */
export async function wikiPhotos(titles: string[], api: Fetcher, ms = 6_000): Promise<Map<string, WikiPhoto>> {
  const out = new Map<string, WikiPhoto>();
  const wanted = [...new Set(titles.map(articleTitle).filter(Boolean))].slice(0, 20);
  if (!wanted.length) return out;
  const get = async (base: string, params: Record<string, string>) => {
    const res = await api(`${base}?${new URLSearchParams({ format: "json", ...params })}`, { headers: { "User-Agent": COMMONS_UA }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`${new URL(base).hostname} ${res.status}`);
    return (await res.json()) as Record<string, any>;
  };
  /** Each file's photo for a card, when it is one, by file. */
  const photosOf = async (files: string[]): Promise<Map<string, MediaImage>> => {
    const found = new Map<string, MediaImage>();
    const unique = [...new Set(files)];
    if (!unique.length) return found;
    const info = await get(WIKIPEDIA_API, { action: "query", formatversion: "2", titles: unique.map((f) => `File:${f}`).join("|"), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(PHOTO_WIDTH), iiextmetadatafilter: "Artist|LicenseShortName" });
    for (const p of (info.query?.pages as { title: string; imagerepository?: string; imageinfo?: Record<string, any>[] }[]) ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const width = Number(ii.width);
      const height = Number(ii.height);
      if (!leadFileOk(p.title.replace(/^File:/, ""), String(ii.mime), width, height) || typeof ii.url !== "string" || !/^https:\/\//.test(ii.url)) continue;
      // Wikimedia's own rendering when the original is wider than a card needs.
      const scaled = width > PHOTO_WIDTH && typeof ii.thumburl === "string" && /^https:\/\//.test(ii.thumburl);
      const artist = stripHtml(ii.extmetadata?.Artist?.value).slice(0, 80);
      const license = stripHtml(ii.extmetadata?.LicenseShortName?.value).slice(0, 60);
      // Imageinfo already supplies the description URL; only an explicit shared repository can identify Commons.
      const sourcePage = p.imagerepository === "shared" ? safeCommonsSourcePage({ source: "commons.wikimedia.org", sourcePage: ii.descriptionurl }) : undefined;
      found.set(fileKey(p.title), {
        url: untracked(scaled ? ii.thumburl : ii.url),
        width: scaled ? Number(ii.thumbwidth) || PHOTO_WIDTH : width,
        height: scaled ? Number(ii.thumbheight) || Math.round((height * PHOTO_WIDTH) / width) : height,
        source: p.imagerepository === "local" ? "wikipedia.org" : "commons.wikimedia.org",
        credit: artist && !/see file history/i.test(artist) ? artist : "Wikimedia Commons contributor",
        ...(license ? { license } : {}),
        ...(sourcePage ? { sourcePage } : {}),
      });
    }
    return found;
  };
  /** The Wikidata item's own image (P18): its preferred one, else its first. */
  const itemImage = async (item: string): Promise<string | null> => {
    const body = await get(WIKIDATA_API, { action: "wbgetclaims", entity: item, property: "P18" }).catch(() => null);
    const claims = ((body?.claims?.P18 as { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } }[]) ?? []).filter((c) => c.rank !== "deprecated");
    const value = (claims.find((c) => c.rank === "preferred") ?? claims[0])?.mainsnak?.datavalue?.value;
    return typeof value === "string" ? value : null;
  };
  try {
    const q = (await get(WIKIPEDIA_API, { action: "query", formatversion: "2", titles: wanted.join("|"), prop: "pageimages|pageprops", piprop: "name", ppprop: "wikibase_item|disambiguation", redirects: "1" })).query ?? {};
    const hop = new Map<string, { to: string; section: boolean }>();
    const hops: { from: string; to: string; tofragment?: string }[] = [...(q.normalized ?? []), ...(q.redirects ?? [])];
    for (const r of hops) hop.set(r.from, { to: r.to, section: !!r.tofragment });
    const pages = new Map(((q.pages as { title: string; missing?: boolean; pageimage?: string; pageprops?: Record<string, string> }[]) ?? []).map((p) => [p.title, p]));
    const landed = wanted.flatMap((asked) => {
      let at = asked;
      let section = false;
      for (let i = 0; i < 4 && hop.has(at); i++) {
        const h = hop.get(at)!;
        section ||= h.section;
        at = h.to;
      }
      const p = pages.get(at);
      if (!p || p.missing || section || (p.pageprops && "disambiguation" in p.pageprops)) return [];
      return [{ asked, article: at, lead: p.pageimage, item: p.pageprops?.wikibase_item }];
    });
    const leads = await photosOf(landed.flatMap((l) => (l.lead ? [l.lead] : [])));
    const lacking = landed.filter((l) => !(l.lead && leads.has(fileKey(l.lead))) && !!l.item && /^Q\d+$/.test(l.item));
    const files = await Promise.all(lacking.map((l) => itemImage(l.item!)));
    const items = await photosOf(files.flatMap((f) => (f ? [f] : [])));
    for (const l of landed) {
      const file = files[lacking.indexOf(l)];
      const image = (l.lead ? leads.get(fileKey(l.lead)) : undefined) ?? (file ? items.get(fileKey(file)) : undefined);
      if (image) out.set(l.asked, { article: l.article, image });
    }
  } catch (e) {
    console.warn("pairs: wikipedia photos failed", (e as Error).message);
  }
  return out;
}
