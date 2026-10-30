import { createHash } from "node:crypto";
import type { Db } from "../db";
import type { MediaImage, MediaKind } from "../agent/media";
import { selectHeroPhotos } from "./photo-selection";

/**
 * The shared archive (owner, 2026-10-27). It supplies approved photos when a matching entity has exactly one
 * designated hero. Two contributors' offers can approve a photo, but do not select its hero; new subjects
 * still wait for review. Seeded from the master list (src/archive/seed.ts).
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
  /** The entity a subject names, with its approved photos and one designated hero first, or null. */
  lookup(subject: string, kind: MediaKind): Promise<ArchiveHit | null>;
  /** Offers photos the agent found for a subject; returns how many were recorded (pending until vouched for). */
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
    .replace(/[\u0300-\u036f]/g, "")
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

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s'&.+-]+/g, " ")
    .trim();

/** A subject is only ever an exact name when it holds letters, digits, spaces and simple punctuation: nothing a
 * search would quietly drop (brackets, symbols, emoji). */
const SIMPLE = /^[\p{L}\p{N}\s'&.+-]+$/u;

/**
 * The entity whose name or alias is the subject word for word (nothing dropped, not even filler), used for offers:
 * the photos were found by searching the subject as typed, so only a subject that is exactly a known name may add
 * to that entity. Parenthesised notes are dropped from entity names only ("Porsche 911 Carrera (992)").
 */
export function exactEntity(subject: string, kind: MediaKind, entities: ArchiveEntity[]): ArchiveEntity | null {
  if (!SIMPLE.test(subject)) return null;
  const key = plain(subject);
  const allowed = SERVES[kind];
  if (!key) return null;
  return entities.find((e) => (!allowed.length || allowed.includes(e.kind)) && [e.name, ...e.aliases].some((n) => plain(n.replace(/\([^)]*\)/g, " ")) === key)) ?? null;
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
  // Hero-first ordering keeps any second approved hero inside the limit, so ambiguity cannot be hidden.
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
      const photos = selectHeroPhotos(await photosOf(e.id));
      return photos ? { entity: e, photos } : null;
    },
    async contribute(subject, kind, photos, by) {
      // Only a signed-in person's agent may offer photos, and only real API-licensed 4K ones.
      const ok = photos.filter(admissible);
      if (!ok.length || !by || by === "anonymous" || by === "seed") return 0;
      // Offers attach to a known entity only when the subject is exactly one of its names ("Porsche 911 Carrera",
      // not "Porsche 911 Carrera plus anything"), so extra words can't steer what a search finds onto a known page.
      let e = exactEntity(subject, kind, await entities());
      if (!e) {
        // Something new waits, with its photos, until someone reviews it; it is never promoted automatically. Its id
        // is in its own namespace, so it can never land on a seed entity.
        const key = plain(subject);
        if (!SIMPLE.test(subject) || !key || kind === "other") return 0;
        const id = `agent-${key.replace(/ /g, "-").slice(0, 60)}-${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
        await db.query(
          `insert into archive_entities (id, domain, category, subcategory, name, kind, price_model, tier, origin, status)
           values ($1, 'proposed', 'proposed', 'proposed', $2, $3, 'one-off', 3, 'agent', 'pending') on conflict (id) do nothing`,
          [id, subject.slice(0, 120), kind],
        );
        const own = await db.query<{ origin: string; status: string; name: string }>("select origin, status, name from archive_entities where id = $1", [id]);
        const row = own.rows[0];
        if (!row || row.origin !== "agent" || row.status !== "pending" || plain(row.name) !== key) return 0;
        e = { id, name: subject, aliases: [], kind, tier: 3, subcategory: "proposed" };
      }
      // Two contributors' offers approve a photo for this entity; hero selection is a separate review.
      // Rejected photos stay rejected; seed photos are never touched.
      let kept = 0;
      for (const p of ok.slice(0, 6)) {
        const r = await db.query(
          `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, status, contributed_by, vouchers)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, array[$9])
           on conflict (entity_id, url) do update set
             vouchers = array(select distinct v from unnest(archive_photos.vouchers || excluded.vouchers) v),
             status = case
               when archive_photos.status = 'pending' and archive_photos.entity_id = excluded.entity_id
                 and cardinality(array(select distinct v from unnest(archive_photos.vouchers || excluded.vouchers) v)) >= 2
                 and exists (select 1 from archive_entities a where a.id = excluded.entity_id and a.status = 'live')
               then 'approved' else archive_photos.status end
           where archive_photos.contributed_by <> 'seed'
           returning id`,
          [e.id, p.url, p.width, p.height, p.source, p.sourcePage, p.photographer, p.license, by],
        );
        kept += r.rows.length;
      }
      return kept;
    },
  };
}
