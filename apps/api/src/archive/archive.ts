import type { Db } from "../db";
import type { MediaImage, MediaKind } from "../agent/media";

/**
 * The shared archive (owner, 2026-10-27). Before the agent hunts photos for a wish, it asks the archive: a match
 * with approved photos skips the hunt. After a hunt, freely licensed photos it found are offered back, so the next
 * person who wants the same thing gets them at once. Seeded from the master list (src/archive/seed.ts).
 */

export interface ArchiveEntity {
  id: string;
  name: string;
  aliases: string[];
  kind: string;
  tier: number;
  subcategory: string;
}

export interface ArchivePhoto {
  url: string;
  width: number;
  height: number;
  source: "commons" | "unsplash" | "pexels";
  sourcePage: string;
  photographer: string | null;
  license: string;
  hero: boolean;
}

export interface ArchiveHit {
  entity: ArchiveEntity;
  photos: ArchivePhoto[];
}

export interface Archive {
  /** The entity a subject names, with its approved photos (hero first), or null. */
  lookup(subject: string, kind: MediaKind): Promise<ArchiveHit | null>;
  /** Offers photos the agent found for a subject; only those that pass the guard are kept. */
  contribute(subject: string, kind: MediaKind, photos: ArchivePhoto[], by: string): Promise<number>;
}

/** Words that say how much or which colour, not what: "a month in Lisbon" is Lisbon, "a black G-Wagon" a G-Wagon. */
const FILLER = new Set(
  (
    "a an the my our your in at on of for to with and or by from new used brand " +
    "one two three four five six seven eight nine ten few couple " +
    "day days night nights week weeks weekend month months year years trip trips holiday holidays vacation getaway stay visit tour " +
    "spring summer autumn fall winter " +
    "black white red blue green silver grey gray yellow orange pink purple brown gold beige navy"
  ).split(" "),
);

export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !FILLER.has(w));

/** Media kinds each entity kind can serve. */
const SERVES: Record<MediaKind, string[]> = {
  place: ["place", "trip", "stay", "home", "land"],
  vehicle: ["vehicle"],
  product: ["product"],
  experience: ["experience", "trip", "place", "stay", "service", "membership", "milestone", "animal"],
  other: [],
};

/**
 * The entity a subject names. Every word of one of its names must appear in the subject, and that name must cover
 * at least two thirds of the subject's own words, so "Porsche 911 GT3 RS Weissach" never borrows a GT3's photos.
 */
export function matchEntity(subject: string, kind: MediaKind, entities: ArchiveEntity[]): ArchiveEntity | null {
  const said = new Set(words(subject));
  if (!said.size) return null;
  const allowed = SERVES[kind];
  let best: { e: ArchiveEntity; cover: number; len: number } | null = null;
  for (const e of entities) {
    if (allowed.length && !allowed.includes(e.kind)) continue;
    for (const name of [e.name, ...e.aliases]) {
      const w = [...new Set(words(name.replace(/\([^)]*\)/g, " ")))];
      if (!w.length || !w.every((x) => said.has(x))) continue;
      const cover = w.length / said.size;
      if (cover < 0.65) continue;
      if (!best || cover > best.cover || (cover === best.cover && (w.length > best.len || (w.length === best.len && e.tier < best.e.tier)))) best = { e, cover, len: w.length };
    }
  }
  return best?.e ?? null;
}

/** Licences an API reported that allow use in the app without asking: CC0, public domain, CC BY, CC BY-SA, Unsplash, Pexels. */
export const FREE_LICENSE = /^(cc0|public domain|pd\b|pdm|cc[ -]by(-sa)?[ -]\d|unsplash license|pexels license)/i;

/** The archive's bar: a free licence from an API that reports it, a real photo at least 3000 px on the long edge. */
export function admissible(p: ArchivePhoto): boolean {
  return (
    ["commons", "unsplash", "pexels"].includes(p.source) &&
    FREE_LICENSE.test(p.license.trim()) &&
    !/\bnd\b|-nd/i.test(p.license) &&
    Math.max(p.width, p.height) >= 3000 &&
    /^https:\/\//.test(p.url) &&
    /^https:\/\//.test(p.sourcePage)
  );
}

export const toMediaImage = (p: ArchivePhoto): MediaImage => ({
  url: p.url,
  width: p.width,
  height: p.height,
  source: p.source === "commons" ? "commons.wikimedia.org" : `${p.source}.com`,
  credit: p.photographer ?? undefined,
  license: p.license,
});

const slug = (s: string) => words(s).join("-").slice(0, 80);

/** The archive in Postgres. Entities are cached for ten minutes; photos are read per lookup. */
export function pgArchive(db: Db, now: () => Date = () => new Date()): Archive {
  let cache: { at: number; entities: ArchiveEntity[] } | null = null;
  const entities = async () => {
    if (cache && now().getTime() - cache.at < 10 * 60_000) return cache.entities;
    const { rows } = await db.query<ArchiveEntity>("select id, name, aliases, kind, tier, subcategory from archive_entities where status = 'live'");
    cache = { at: now().getTime(), entities: rows };
    return rows;
  };
  const photosOf = async (id: string) =>
    (
      await db.query<ArchivePhoto>(
        `select url, width, height, source, source_page as "sourcePage", photographer, license, hero
           from archive_photos where entity_id = $1 and status = 'approved' order by hero desc, width desc limit 8`,
        [id],
      )
    ).rows;
  return {
    async lookup(subject, kind) {
      const e = matchEntity(subject, kind, await entities());
      if (!e) return null;
      const photos = await photosOf(e.id);
      return photos.length >= 2 ? { entity: e, photos } : null;
    },
    async contribute(subject, kind, photos, by) {
      const ok = photos.filter(admissible);
      if (!ok.length) return 0;
      let e = matchEntity(subject, kind, await entities());
      let status: "approved" | "pending" = "approved";
      if (!e) {
        // Something new: it waits as a pending entity until a second person's agent finds it too.
        const id = slug(subject);
        if (!id || kind === "other") return 0;
        await db.query(
          `insert into archive_entities (id, domain, category, subcategory, name, kind, price_model, tier, origin, status)
           values ($1, 'proposed', 'proposed', 'proposed', $2, $3, 'one-off', 3, 'agent', 'pending') on conflict (id) do nothing`,
          [id, subject.slice(0, 120), kind],
        );
        const others = await db.query<{ n: number }>("select count(distinct contributed_by)::int as n from archive_photos where entity_id = $1 and contributed_by <> $2", [id, by]);
        if ((others.rows[0]?.n ?? 0) >= 1) {
          await db.query("update archive_entities set status = 'live', updated_at = now() where id = $1 and status = 'pending'", [id]);
          await db.query("update archive_photos set status = 'approved' where entity_id = $1 and status = 'pending'", [id]);
          cache = null;
        } else status = "pending";
        e = { id, name: subject, aliases: [], kind, tier: 3, subcategory: "proposed" };
      }
      let kept = 0;
      for (const p of ok.slice(0, 6)) {
        const r = await db.query(
          `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, status, contributed_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (url) do nothing returning id`,
          [e.id, p.url, p.width, p.height, p.source, p.sourcePage, p.photographer, p.license, status, by],
        );
        kept += r.rows.length;
      }
      return kept;
    },
  };
}
