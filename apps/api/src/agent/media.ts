import { z } from "zod";
import { safeGet, type Fetcher } from "./tools";

/**
 * Media hunting: real photos first, at the highest resolution we can find, with their source and credit. Products
 * and cars get the images their pages and shopping listings offer; places and trips get photographers' work from
 * Wikimedia Commons; vehicles and well-liked products get a Sketchfab 3D model when one truly matches.
 */

export const MEDIA_KINDS = ["product", "vehicle", "place", "experience", "other"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaImage {
  url: string;
  width?: number;
  height?: number;
  /** The site or feed the image came from, like leicacamerausa.com, Google Shopping or commons.wikimedia.org. */
  source: string;
  credit?: string;
  license?: string;
  /** A transparent or cut-out background, ready to float on the app's dark stage. */
  clean?: boolean;
  /** Made or reworked by Muse Image, so the app can label it honestly. */
  generated?: boolean;
}

export interface Model3d {
  provider: "sketchfab";
  uid: string;
  name: string;
  author: string;
  license: string;
  embedUrl: string;
  thumbnail: string;
}

export interface Cutout {
  url: string;
  width: number;
  height: number;
  /** The real photo SAM cut the product out of. */
  from: string;
  model: "sam-3.1";
}

export interface Media {
  kind: MediaKind;
  images: MediaImage[];
  model3d?: Model3d;
  cutout?: Cutout;
}

const webUrl = z.string().max(2000).regex(/^https?:\/\/[^\s]+$/);
const px = z.number().int().positive().max(100_000);
/** Checks media a client saves with a wish, so only web images and Sketchfab embeds come back out. */
export const mediaSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  images: z
    .array(
      z.object({
        url: webUrl,
        width: px.optional(),
        height: px.optional(),
        source: z.string().max(120),
        credit: z.string().max(200).optional(),
        license: z.string().max(80).optional(),
        clean: z.boolean().optional(),
        generated: z.boolean().optional(),
      }),
    )
    .max(8),
  model3d: z
    .object({
      provider: z.literal("sketchfab"),
      uid: z.string().regex(/^[a-f0-9]{32}$/),
      name: z.string().max(200),
      author: z.string().max(120),
      license: z.string().max(80),
      embedUrl: z.string().regex(/^https:\/\/sketchfab\.com\/models\/[a-f0-9]{32}\/embed\?[a-z0-9_=&]*$/),
      thumbnail: webUrl,
    })
    .optional(),
  cutout: z.object({ url: webUrl, width: px, height: px, from: webUrl, model: z.literal("sam-3.1") }).optional(),
});

/* ---------- reading image sizes from headers ---------- */

export interface ImageInfo {
  type: "png" | "jpeg" | "webp" | "gif";
  width: number;
  height: number;
  /** The format carries transparency (PNG alpha or tRNS, WebP alpha). */
  alpha: boolean;
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** Width, height and type of a PNG, JPEG, WebP or GIF from its first bytes, without decoding it. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 26 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && ascii(b, 12, 16) === "IHDR") {
    const colorType = b[25]!;
    let alpha = colorType === 4 || colorType === 6;
    for (let i = 33; !alpha && i + 8 <= b.length; ) {
      const len = u32be(b, i);
      const kind = ascii(b, i + 4, i + 8);
      if (kind === "tRNS") alpha = true;
      if (kind === "IDAT" || kind === "IEND") break;
      i += 12 + len;
    }
    return { type: "png", width: u32be(b, 16), height: u32be(b, 20), alpha };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { type: "jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7), alpha: false };
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") {
    const chunk = ascii(b, 12, 16);
    if (chunk === "VP8X") return { type: "webp", width: 1 + u24le(b, 24), height: 1 + u24le(b, 27), alpha: (b[20]! & 0x10) !== 0 };
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { type: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, alpha: false };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
    }
    return null;
  }
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return { type: "gif", width: u16le(b, 6), height: u16le(b, 8), alpha: false };
  return null;
}

export interface ProbedImage extends ImageInfo {
  url: string;
}

const PROBE_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 6000;

/** Reads just enough of an image to learn its size. Public hosts only, like every other fetch the agent makes. */
export async function probeImage(raw: string, fetcher: Fetcher): Promise<ProbedImage | null> {
  try {
    // Asking for JPEG or PNG first: CDNs like Shopify's otherwise answer a .jpg link with WebP, which can't be cut out.
    const { res, url } = await safeGet(raw, fetcher, { Accept: "image/jpeg,image/png;q=0.9,image/*;q=0.5", Range: "bytes=0-131071" }, PROBE_TIMEOUT_MS);
    if (!(res.ok || res.status === 206) || !/^image\//i.test(res.headers.get("content-type") ?? "")) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let info: ImageInfo | null = null;
    while (reader && size < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      info = imageInfo(Buffer.concat(chunks));
      if (info) break;
    }
    await reader?.cancel().catch(() => undefined);
    if (!info) info = imageInfo(Buffer.concat(chunks));
    return info && info.width > 0 && info.height > 0 ? { ...info, url: url.toString() } : null;
  } catch {
    return null;
  }
}

/* ---------- finding larger originals ---------- */

const RESIZE_KEYS = new Set(["w", "width", "h", "height", "wid", "hei", "size", "sw", "sh", "resize", "fit", "crop", "imwidth", "imheight", "dpr", "scale", "qlt", "quality", "odnwidth", "odnheight", "odnbg"]);

/**
 * Larger versions of a CDN image worth trying: resize query parameters dropped, and the size suffixes Shopify,
 * WordPress, Amazon and Cloudinary add to file names removed. The caller probes each and keeps what really is larger.
 */
export function upsizedVariants(raw: string): string[] {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return [];
  }
  if (/(^|\.)(gstatic|googleusercontent)\.com$/.test(u.hostname)) return [];
  const out = new Set<string>();
  // Drupal image styles: /files/styles/<style>/public/<file>.png.webp?itok=... is a resized copy of /files/<file>.png
  if (/\/files\/styles\/[^/]+\/public\//.test(u.pathname)) {
    const original = new URL(u.origin + u.pathname.replace(/\/styles\/[^/]+\/public\//, "/").replace(/(\.(png|jpe?g))\.webp$/i, "$1"));
    out.add(original.toString());
  }
  const stripped = new URL(u);
  for (const k of [...stripped.searchParams.keys()]) if (RESIZE_KEYS.has(k.toLowerCase()) || (k === "q" && /^\d+$/.test(stripped.searchParams.get(k) ?? ""))) stripped.searchParams.delete(k);
  stripped.pathname = stripped.pathname
    .replace(/_(\d+x\d*|\d*x\d+)(_crop_[a-z]+)?(@\dx)?(?=\.(jpe?g|png|webp)$)/i, "")
    .replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp)$)/i, "")
    .replace(/\._[A-Z0-9_,]+_(?=\.(jpe?g|png)$)/i, "")
    .replace(/\/upload\/(?:[a-z]{1,3}_[^/]+,?)+\//i, "/upload/");
  if (stripped.toString() !== u.toString()) out.add(stripped.toString());
  return [...out].slice(0, 2);
}

export interface FoundImage extends ProbedImage {
  source: string;
  credit?: string;
}

const longEdge = (i: { width: number; height: number }) => Math.max(i.width, i.height);

/** Past 4K a phone shows no difference, only a heavier download, so every image at or above it ranks the same. */
const RESOLUTION_CEILING = 4096;

/**
 * The same picture under different names: one CDN file in several sizes (_600x600_crop_center, -1024x768, styles),
 * or one manufacturer file that two shops both serve. Returns the keys that identify it.
 */
export function sameImageKeys(raw: string, width: number, height: number): string[] {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .toLowerCase()
      .replace(/\/styles\/[^/]+\/public\//, "/")
      .replace(/(\.(png|jpe?g))\.webp$/, "$1")
      .replace(/_(\d+x\d*|\d*x\d+)(_crop_[a-z]+)?(@\dx)?(?=\.(jpe?g|png|webp|gif)$)/, "")
      .replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp)$)/, "")
      .replace(/\._[a-z0-9_,]+_(?=\.(jpe?g|png)$)/, "");
    const file = path.split("/").pop() ?? "";
    return [`${u.hostname}${path}`, ...(file.length >= 12 ? [`${file}|${width}x${height}`] : [])];
  } catch {
    return [raw];
  }
}

/**
 * Best first: resolution (up to 4K), then a clean (transparent) background, then the lighter of two 4K-class
 * images. Drops icons, banners and repeats.
 */
export function rankImages<T extends FoundImage>(list: T[]): T[] {
  const seen = new Set<string>();
  const res = (i: FoundImage) => Math.min(longEdge(i), RESOLUTION_CEILING);
  return list
    .filter((i) => Math.min(i.width, i.height) >= 200 && longEdge(i) >= 300 && i.width / i.height <= 3 && i.height / i.width <= 3)
    .sort((a, b) => res(b) - res(a) || Number(b.alpha) - Number(a.alpha) || longEdge(a) - longEdge(b))
    .filter((i) => {
      const keys = sameImageKeys(i.url, i.width, i.height);
      if (keys.some((k) => seen.has(k))) return false;
      for (const k of keys) seen.add(k);
      return true;
    });
}

/** Probes candidates a few at a time, trying the larger CDN variants of each, and returns what loaded, best first. */
export async function huntImages(candidates: { url: string; source: string; credit?: string }[], probe: (url: string) => Promise<ProbedImage | null>, maxProbes = 12): Promise<FoundImage[]> {
  const queue: { url: string; source: string; credit?: string }[] = [];
  for (const c of candidates) {
    for (const v of upsizedVariants(c.url)) queue.push({ ...c, url: v });
    queue.push(c);
  }
  const unique = queue.filter((c, i) => queue.findIndex((d) => d.url === c.url) === i).slice(0, maxProbes);
  const found: FoundImage[] = [];
  for (let i = 0; i < unique.length; i += 4) {
    const batch = await Promise.all(unique.slice(i, i + 4).map(async (c) => {
      const p = await probe(c.url);
      return p ? { ...p, source: c.source, ...(c.credit ? { credit: c.credit } : {}) } : null;
    }));
    for (const f of batch) if (f) found.push(f);
  }
  return rankImages(found);
}

export const toMediaImage = (i: FoundImage): MediaImage => ({
  url: i.url,
  width: i.width,
  height: i.height,
  source: i.source,
  ...(i.credit ? { credit: i.credit } : {}),
  ...(i.alpha ? { clean: true } : {}),
});

/* ---------- Wikimedia Commons ---------- */

/** Wikimedia asks API clients to identify themselves. */
export const COMMONS_UA = "Dandelist/0.1 (https://github.com/KNIGHT-AI-AV/dandelist)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const FEATURED = "Category:Featured pictures on Wikimedia Commons";
const QUALITY = "Category:Quality images";
const MAX_WIDTH = 3840;

export interface CommonsPhoto {
  id: string;
  title: string;
  /** The file's page on Commons, where its licence and author are stated. */
  page: string;
  description: string;
  url: string;
  width: number;
  height: number;
  type: "jpeg" | "png";
  credit: string;
  license: string;
  featured: boolean;
  quality: boolean;
}

const stripHtml = (s: unknown) => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim() : "");
const noTracking = (raw: string) => {
  const u = new URL(raw);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  return u.toString();
};

/** A search term CirrusSearch reads literally. */
const cirrusTerm = (s: string) => s.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/**
 * Landscape photos of a subject from Wikimedia Commons, Featured and Quality images first, each with its author and
 * license. Widths over 3840 come as Commons' own 3840 px rendering, which is still 4K but a fraction of the bytes.
 */
export async function commonsPhotos(subject: string, fetcher: Fetcher, opts: { minWidth?: number; limit?: number } = {}): Promise<CommonsPhoto[]> {
  const term = cirrusTerm(subject);
  if (!term) return [];
  const minWidth = opts.minWidth ?? 1600;
  const found = new Map<string, CommonsPhoto>();
  const searches = [
    `intitle:"${term}" incategory:Featured_pictures_on_Wikimedia_Commons|Quality_images filetype:bitmap`,
    `"${term}" incategory:Featured_pictures_on_Wikimedia_Commons|Quality_images filetype:bitmap`,
    `intitle:"${term}" filetype:bitmap`,
  ];
  for (const gsrsearch of searches) {
    if (found.size >= (opts.limit ?? 24)) break;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrlimit: "30",
      gsrsearch,
      prop: "imageinfo|categories",
      clcategories: `${FEATURED}|${QUALITY}`,
      cllimit: "max",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: String(MAX_WIDTH),
      iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription",
    });
    let body: { query?: { pages?: Record<string, unknown> } };
    try {
      const res = await fetcher(`${COMMONS_API}?${params}`, { headers: { "User-Agent": COMMONS_UA }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      body = (await res.json()) as typeof body;
    } catch {
      continue;
    }
    const pages = Object.values(body.query?.pages ?? {}) as { pageid: number; title: string; index?: number; imageinfo?: Record<string, any>[]; categories?: { title: string }[] }[];
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info || found.has(String(p.pageid))) continue;
      const w = Number(info.width);
      const h = Number(info.height);
      // Landscape, but not a panorama: a slideshow frame is about 3:2 to 2:1.
      if (!/^image\/(jpeg|png)$/.test(String(info.mime)) || w < minWidth || w < h * 1.2 || w > h * 2.4) continue;
      const m = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>;
      const cats = (p.categories ?? []).map((c) => c.title);
      const scaled = w > MAX_WIDTH && typeof info.thumburl === "string";
      found.set(String(p.pageid), {
        id: String(p.pageid),
        title: p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
        page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
        description: stripHtml(m.ImageDescription?.value).slice(0, 160),
        url: noTracking(scaled ? info.thumburl : String(info.url)),
        width: scaled ? MAX_WIDTH : w,
        height: scaled ? Math.round((h * MAX_WIDTH) / w) : h,
        type: String(info.mime) === "image/png" ? "png" : "jpeg",
        credit: stripHtml(m.Artist?.value).slice(0, 120) || "Wikimedia Commons contributor",
        license: stripHtml(m.LicenseShortName?.value).slice(0, 60) || "See Wikimedia Commons",
        featured: cats.includes(FEATURED),
        quality: cats.includes(QUALITY),
      });
    }
  }
  return [...found.values()].sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.quality) - Number(a.quality) || b.width - a.width);
}

/** Licenses that allow a cutout (a derivative) without passing on share-alike terms: CC0, public domain, CC BY. */
export const allowsCutout = (license: string) => /^(cc0|public domain|pd\b|cc[ -]by[ -]\d)/i.test(license.trim()) && !/\b(sa|nd)\b|-sa|-nd/i.test(license);

export const commonsImage = (p: CommonsPhoto): MediaImage => ({ url: p.url, width: p.width, height: p.height, source: "commons.wikimedia.org", credit: p.credit, license: p.license });

/* ---------- Sketchfab ---------- */

export interface ModelCandidate {
  uid: string;
  name: string;
  author: string;
  license: string;
  likes: number;
  viewCount: number;
  thumbnail: string;
  isAgeRestricted: boolean;
}

/** Sketchfab's player on the app's dark stage. The app draws its own "drag to turn" hint, so Sketchfab's is off. */
export const embedUrlFor = (uid: string) => `https://sketchfab.com/models/${uid}/embed?autostart=1&ui_theme=dark&transparent=1&ui_hint=0`;

/** Sketchfab's public model search; no key needed. Age-restricted models never come back. */
export async function sketchfabSearch(query: string, fetcher: Fetcher): Promise<ModelCandidate[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!q) return [];
  const res = await fetcher(`https://api.sketchfab.com/v3/search?type=models&count=8&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Sketchfab answered ${res.status}`);
  const body = (await res.json()) as { results?: Record<string, any>[] };
  const out: ModelCandidate[] = [];
  for (const r of body.results ?? []) {
    if (typeof r.uid !== "string" || !/^[a-f0-9]{32}$/.test(r.uid) || r.isAgeRestricted) continue;
    const thumbs = ((r.thumbnails?.images ?? []) as { url?: string; width?: number }[]).filter((t) => typeof t.url === "string" && /^https:\/\//.test(t.url));
    const thumb = thumbs.filter((t) => (t.width ?? 0) <= 1920).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? thumbs[0];
    out.push({
      uid: r.uid,
      name: String(r.name ?? "").slice(0, 200),
      author: String(r.user?.displayName || r.user?.username || "Sketchfab creator").slice(0, 120),
      license: String(r.license?.label ?? "Not specified").slice(0, 80),
      likes: Number(r.likeCount ?? 0),
      viewCount: Number(r.viewCount ?? 0),
      thumbnail: thumb?.url ?? "",
      isAgeRestricted: false,
    });
  }
  return out;
}

export const toModel3d = (c: ModelCandidate): Model3d => ({ provider: "sketchfab", uid: c.uid, name: c.name, author: c.author, license: c.license, embedUrl: embedUrlFor(c.uid), thumbnail: c.thumbnail });

/* ---------- generated fallback ---------- */

/**
 * A prompt for when no real photo reaches 4K-class quality: campaign-grade, editorial and quiet, never text or
 * logos, and no people. The picture is always labelled generated.
 */
export function premiumPrompt(kind: MediaKind, subject: string): string {
  const s = subject.replace(/[\r\n"]/g, " ").slice(0, 120);
  const look =
    "Shot like a Louis Vuitton, Rimowa or Ritz-Carlton campaign: editorial and cinematic, medium-format look, deliberate soft directional light, restrained palette, generous negative space, impeccable detail. No text, no logos, no watermarks, no people.";
  switch (kind) {
    case "product":
      return `A still life of ${s} on a seamless warm-grey backdrop, a single sculpted key light with a gentle falloff. ${look}`;
    case "vehicle":
      return `${s} parked on an empty coastal road at blue hour, three-quarter front view, wet asphalt reflections. ${look}`;
    case "place":
      return `${s} at golden hour, an iconic view, calm streets and soft haze. ${look}`;
    case "experience":
      return `The setting of ${s}, an inviting quiet moment just before it begins. ${look}`;
    default:
      return `${s}, presented as an object of desire. ${look}`;
  }
}

/** The quality bar a real photo has to reach before a generated picture is even considered. */
export const qualityBar = (kind: MediaKind) => (kind === "product" ? 2000 : 3840);
