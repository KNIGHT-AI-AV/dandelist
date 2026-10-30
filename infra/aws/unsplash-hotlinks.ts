import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Serves the catalogue's Unsplash photos from Unsplash itself (owner, 2026-10-30: "Keep the hotlink rule. ... move all
 * 31 photos to Unsplash's own links"). Each photo tagged `unsplash: { id, rect, size }` (the crop our old copy was cut
 * from, found by matching it against the original) gets the API's raw URL, which carries the ixid Unsplash counts
 * views by, cut to that rectangle and sized by Unsplash's image server: the photo, its smaller copies and the entry's
 * imageUrl alias. It records one download per photo, as the API guidelines ask, and the photographer for the credit.
 *
 *   corepack pnpm --filter @dandelist/infra-aws exec tsx unsplash-hotlinks.ts           # the plan, no API calls
 *   corepack pnpm --filter @dandelist/infra-aws exec tsx unsplash-hotlinks.ts --apply   # rewrite catalogue.json
 *
 * The key is read from the vault at run time and never printed. Demo keys allow 50 calls an hour; --apply makes two
 * per photo (20 photos, 40 calls), so it runs once.
 */

const VAULT_GET = "C:/Users/Copper Mile/KNIGHT AI+AV/knight-aiav-backend/tools/vault-get.mjs";
const CATALOGUE = new URL("../../packages/catalogue/src/catalogue.json", import.meta.url);
const APP = "dandelist"; // utm_source for every link back to Unsplash, as the guidelines ask
const WIDTHS = [800, 1200, 1600];
const apply = process.argv.includes("--apply");

type Rect = [number, number, number, number];
interface Image {
  url: string;
  width?: number;
  height?: number;
  credit?: string;
  variants?: { width: number; height: number; url: string }[];
  author?: { name: string; url: string };
  page?: string;
  unsplash?: { id: string; rect: Rect; size: [number, number]; tracked?: string };
}
interface Entry {
  id: string;
  imageUrl?: string;
  media?: { images: Image[] };
}
interface Photo {
  width: number;
  height: number;
  urls: { raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

const entries = JSON.parse(readFileSync(CATALOGUE, "utf8")) as Entry[];
if (!apply) {
  const tagged = entries.flatMap((e) => (e.media?.images ?? []).filter((i) => i.unsplash).map((i) => ({ e, i })));
  for (const { e, i } of tagged) console.log(`${e.id.padEnd(18)} ${i.unsplash!.id.padEnd(12)} rect ${i.unsplash!.rect.join(",")} of ${i.unsplash!.size.join("x")}`);
  const aliases = entries.filter((e) => e.imageUrl && !(e.media?.images ?? []).some((i) => i.url === e.imageUrl && i.unsplash)).map((e) => e.id);
  console.log(`${tagged.length} images on ${new Set(tagged.map(({ i }) => i.unsplash!.id)).size} photos; imageUrl not an Unsplash image: ${aliases.join(", ") || "none"}`);
  process.exit(0);
}

const key = execFileSync("node", [VAULT_GET, "accounting/unsplash-access-key"], { encoding: "utf8" }).trim();
const api = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.replace(/\?.*$/, "")}`);
  return (await res.json()) as T;
};
const utm = (url: string) => `${url}${url.includes("?") ? "&" : "?"}utm_source=${APP}&utm_medium=referral`;

/** The raw URL cut to the rectangle and sized: rect selects the region first, then w/h/fit size it. */
export function cut(raw: string, rect: Rect, width: number, height: number): string {
  const u = new URL(raw);
  u.searchParams.set("rect", rect.join(","));
  u.searchParams.set("w", String(width));
  u.searchParams.set("h", String(height));
  u.searchParams.set("fit", "crop");
  u.searchParams.set("fm", "jpg");
  u.searchParams.set("q", "80");
  return u.toString();
}

const photos = new Map<string, Photo>();
let changed = 0;
for (const e of entries) {
  for (const img of e.media?.images ?? []) {
    if (!img.unsplash || !img.width || !img.height) continue;
    const { id, size } = img.unsplash;
    let photo = photos.get(id);
    if (!photo) {
      photo = await api<Photo>(`https://api.unsplash.com/photos/${encodeURIComponent(id)}`);
      await api(photo.links.download_location); // the one download the guidelines ask for when a photo is chosen
      photos.set(id, photo);
    }
    // The rectangle was measured on the downloaded original; scale it if Unsplash's original differs in size.
    const k = photo.width / size[0];
    if (Math.abs(photo.height / size[1] - k) > 0.01) throw new Error(`${id}: original is ${photo.width}x${photo.height}, the crop was measured on ${size.join("x")}`);
    const rect = img.unsplash.rect.map((v) => Math.round(v * k)) as Rect;
    if (k !== 1) console.log(`${id}: original ${photo.width}x${photo.height}, crop scaled by ${k.toFixed(4)}`);
    img.unsplash.tracked = new Date().toISOString();
    const old = img.url;
    img.url = cut(photo.urls.raw, rect, img.width, img.height);
    img.variants = WIDTHS.filter((w) => w < img.width!).map((w) => {
      const h = Math.round((w * img.height!) / img.width!);
      return { width: w, height: h, url: cut(photo!.urls.raw, rect, w, h) };
    });
    img.credit = photo.user.name;
    img.author = { name: photo.user.name, url: utm(photo.user.links.html) };
    img.page = utm(photo.links.html);
    if (e.imageUrl === old) e.imageUrl = img.url;
    changed++;
    console.log(`${e.id.padEnd(18)} ${id.padEnd(12)} ${img.width}x${img.height}  ${photo.user.name}`);
  }
}
writeFileSync(CATALOGUE, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`${changed} images on ${photos.size} Unsplash photos; catalogue.json rewritten, one download recorded per photo`);
