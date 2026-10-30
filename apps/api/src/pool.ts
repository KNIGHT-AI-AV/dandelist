import { entries as catalogue, heroOf, type Entry } from "@dandelist/catalogue";
import type { Period } from "@dandelist/cost";
import type { Db } from "./db";
import type { ArchiveEntity } from "./archive/archive";
import { selectDeliverablePhotos } from "./archive/photo-delivery";

/**
 * The pool the pre-login this-or-that draws from (owner, 2026-10-28: "random items, changes every time, from our
 * giant pool"): the priced catalogue, plus archive subjects with one approved hero and a typical price paid once
 * (a trip, a car, a home). Monthly and yearly subjects stay out, because their typical price isn't an upfront cost.
 * Archive prices are the low end of the master list's typical range and always say "typical", never "checked".
 */

export type PoolGroup = "travel" | "things" | "home";

export interface PoolImage {
  url: string;
  width?: number;
  height?: number;
  source: string;
  credit?: string;
  license?: string;
  /** An Unsplash photo's photographer, with the tagged link its credit carries. */
  author?: { name: string; url: string };
}

export interface PoolItem {
  id: string;
  name: string;
  kind: "buy" | "own" | "do" | "visit";
  /** The catalogue's categories, used for the stand-in picture while a photo loads. */
  category: string;
  group: PoolGroup;
  upfrontCents: number;
  recurring: { label: string; amountCents: number; period: Period }[];
  status: "verified" | "estimate";
  seller: string;
  /** The page the price was checked on; empty for a typical price, which has no single page. */
  url: string;
  checkedAt: string;
  /** Shown instead of the source line, e.g. "Typical price · 7 nights for two incl. economy flights". */
  note?: string;
  /** The hero photo's credit, for photos whose licence asks for one. */
  credit?: string;
  media?: { kind: string; images: PoolImage[] };
}

/** Archive ids carry a prefix so they never collide with the catalogue's. */
export const ARCHIVE_PREFIX = "a:";

const CATALOGUE_GROUP: Record<string, PoolGroup> = { drive: "things", capture: "things", wear: "things", move: "things", travel: "travel", live: "home" };

export function fromCatalogue(e: Entry): PoolItem {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    category: e.category,
    group: CATALOGUE_GROUP[e.category] ?? "things",
    upfrontCents: e.upfrontCents,
    recurring: e.recurring.map(({ label, amountCents, period }) => ({ label, amountCents, period })),
    status: e.status,
    seller: e.seller,
    url: e.url,
    checkedAt: e.checkedAt,
    // The photographer travels with an Unsplash photo, so the card can credit it as Unsplash's guidelines ask.
    ...(e.media ? { media: { kind: e.media.kind, images: e.media.images.map(({ url, width, height, source, credit, license, author }) => ({ url, width, height, source, credit, license, ...(author ? { author } : {}) })) } } : heroOf(e) ? { media: { kind: "other", images: [{ url: heroOf(e)!, source: e.seller }] } } : {}),
  };
}

/** How an archive subject is wished for, by its kind and how it's priced. Anything else stays out of the pool. */
const SHAPE: Record<string, { kind: PoolItem["kind"]; group: PoolGroup; category: string }> = {
  "place/trip": { kind: "visit", group: "travel", category: "travel" },
  "trip/trip": { kind: "visit", group: "travel", category: "travel" },
  "trip/one-off": { kind: "visit", group: "travel", category: "travel" },
  "experience/per-event": { kind: "do", group: "travel", category: "travel" },
  "experience/one-off": { kind: "do", group: "travel", category: "travel" },
  "home/property": { kind: "own", group: "home", category: "live" },
  "home/one-off": { kind: "own", group: "home", category: "live" },
  "land/property": { kind: "own", group: "home", category: "live" },
  "vehicle/one-off": { kind: "own", group: "things", category: "drive" },
  "product/one-off": { kind: "buy", group: "things", category: "capture" },
  "milestone/one-off": { kind: "do", group: "home", category: "live" },
};
/** Products sit in the catalogue category their domain is closest to (only the stand-in picture depends on it). */
const PRODUCT_CATEGORY: Record<string, string> = { "Watches & jewellery": "wear", "Fashion & bags": "wear", "Home & design": "live", "Art & collectibles": "live", "Hobbies & sport": "move" };

export interface ArchiveRow {
  id: string;
  name: string;
  kind: string;
  price_model: string;
  domain: string;
  typical: { low?: number; high?: number; currency?: string; unit?: string } | string | null;
  photos: { url: string; width: number; height: number; source: string; photographer: string | null; license: string; hero: boolean }[] | string;
}

const SOURCE_SITE: Record<string, string> = { commons: "commons.wikimedia.org", unsplash: "unsplash.com", pexels: "pexels.com" };
const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

/** An archive subject's typical price paid once, as a card shows it: the low end of its range and what it covers. */
export interface Typical {
  kind: PoolItem["kind"];
  group: PoolGroup;
  category: string;
  upfrontCents: number;
  note: string;
}

/** The typical price of an archive subject whose shape the pool can price honestly; null for any other. */
export function typicalOf(row: Pick<ArchiveRow, "kind" | "price_model" | "domain" | "typical">): Typical | null {
  const shape = SHAPE[`${row.kind}/${row.price_model}`];
  const typical = row.typical ? parse(row.typical) : null;
  if (!shape || !typical || typical.currency !== "USD" || !(Number(typical.low) > 0)) return null;
  // "7 nights for two incl. economy flights; mid-range hotel (low) to luxury hotel (high)" -> the part before the range.
  const unit = (typical.unit ?? "").split(";")[0]!.trim();
  return {
    kind: shape.kind,
    group: shape.group,
    category: shape.kind === "buy" ? (PRODUCT_CATEGORY[row.domain] ?? shape.category) : shape.category,
    upfrontCents: Math.round(Number(typical.low) * 100),
    note: unit && !/^typical/i.test(unit) ? `Typical price · ${unit}` : "Typical price",
  };
}

export function fromArchive(row: ArchiveRow, checkedAt: string): PoolItem | null {
  const price = typicalOf(row);
  const photos = selectDeliverablePhotos(parse(row.photos) ?? []);
  if (!price || !photos) return null;
  const hero = photos[0]!;
  return {
    id: `${ARCHIVE_PREFIX}${row.id}`,
    name: row.name,
    kind: price.kind,
    category: price.category,
    group: price.group,
    upfrontCents: price.upfrontCents,
    recurring: [],
    status: "estimate",
    seller: "Typical price",
    url: "",
    checkedAt,
    note: price.note,
    ...(hero.photographer ? { credit: `Photo: ${hero.photographer}, ${hero.license}` } : {}),
    media: {
      kind: price.group === "travel" ? "place" : price.group === "home" ? "place" : "product",
      images: photos.slice(0, 4).map((p) => ({ url: p.url, width: p.width, height: p.height, source: SOURCE_SITE[p.source] ?? p.source, ...(p.photographer ? { credit: p.photographer } : {}), license: p.license })),
    },
  };
}

const POOL_TTL_MS = 10 * 60 * 1000;

/** The pool, read from the archive at most every ten minutes; the catalogue alone when the archive can't be read. */
export function poolSource(db: Db, now: () => Date = () => new Date()) {
  let cached: { at: number; items: PoolItem[] } | null = null;
  return async (): Promise<PoolItem[]> => {
    const t = now().getTime();
    if (cached && t - cached.at < POOL_TTL_MS) return cached.items;
    const items = catalogue.map(fromCatalogue);
    try {
      const { rows } = await db.query<ArchiveRow>(
        `select e.id, e.name, e.kind, e.price_model, e.domain, e.typical,
                json_agg(json_build_object('url', p.url, 'width', p.width, 'height', p.height, 'source', p.source, 'photographer', p.photographer, 'license', p.license, 'hero', p.hero) order by p.hero desc, p.created_at) as photos
           from archive_entities e
           join archive_photos p on p.entity_id = e.id and p.status = 'approved'
          where e.status = 'live' and e.typical is not null
          group by e.id`,
      );
      const day = now().toISOString();
      for (const row of rows) {
        const item = fromArchive(row, day);
        if (item) items.push(item);
      }
    } catch (e) {
      console.error("pool: archive unreadable, catalogue only", (e as Error).message);
    }
    cached = { at: t, items };
    return items;
  };
}

/** An archive subject with a typical price paid once, photographed or not: what a this-or-that card is priced from. */
export interface TypicalEntity extends ArchiveEntity {
  price: Typical;
}

/**
 * Every live archive subject with a typical price the pool's shapes allow, read at most every ten minutes; none when
 * the archive can't be read (a card then carries the agent's own rounded estimate, marked typical like these).
 */
export function typicalSource(db: Db, now: () => Date = () => new Date()) {
  let cached: { at: number; items: TypicalEntity[] } | null = null;
  return async (): Promise<TypicalEntity[]> => {
    const t = now().getTime();
    if (cached && t - cached.at < POOL_TTL_MS) return cached.items;
    const items: TypicalEntity[] = [];
    try {
      const { rows } = await db.query<Omit<ArchiveRow, "photos"> & { aliases: string[] | null; tier: number; subcategory: string }>(
        "select id, name, aliases, kind, price_model, domain, typical, tier, subcategory from archive_entities where status = 'live' and typical is not null",
      );
      for (const r of rows) {
        const price = typicalOf(r);
        if (price) items.push({ id: r.id, name: r.name, aliases: r.aliases ?? [], kind: r.kind, tier: Number(r.tier), subcategory: r.subcategory, price });
      }
    } catch (e) {
      console.error("typical prices: archive unreadable", (e as Error).message);
    }
    cached = { at: t, items };
    return items;
  };
}

/** The pool items these ids name, in order; unknown ids are dropped. */
export function resolvePicks(ids: string[], pool: PoolItem[]): PoolItem[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is PoolItem => !!p);
}
