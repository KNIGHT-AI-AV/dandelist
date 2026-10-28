import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "../db";
import { admissible, type ArchivePhoto } from "./archive";

/** One entity of the master list, as data/archive-seed.json carries it. */
export interface SeedEntity {
  id: string;
  domain: string;
  category: string;
  subcategory: string;
  name: string;
  aliases?: string[];
  kind: string;
  priceModel: string;
  typical?: unknown;
  running?: unknown;
  tier: number;
  regions?: string[];
  photos?: ArchivePhoto[];
}

const SEED = fileURLToPath(new URL("../../data/archive-seed.json", import.meta.url));

/**
 * Loads the master list into the archive when the seed file has changed since the last load: entities are
 * upserted, seed photos that pass the guard are added. Runs after the server is listening, so a big seed never
 * holds up a deploy's health check. Reviewed seed metadata takes ownership of matching entity/photo rows;
 * unrelated agent-contributed associations are left alone.
 */
export async function loadSeed(db: Db, path = SEED): Promise<{ version: string; entities: number; photos: number } | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const version = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const seen = await db.query("select 1 from archive_seed_runs where version = $1", [version]);
  if (seen.rows.length) return null;
  const { entities } = JSON.parse(raw) as { entities: SeedEntity[] };
  let photos = 0;
  for (const e of entities) {
    await db.query(
      `insert into archive_entities (id, domain, category, subcategory, name, aliases, kind, price_model, typical, running, tier, regions, origin, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'seed', 'live')
       on conflict (id) do update set domain = excluded.domain, category = excluded.category, subcategory = excluded.subcategory,
         name = excluded.name, aliases = excluded.aliases, kind = excluded.kind, price_model = excluded.price_model,
         typical = excluded.typical, running = excluded.running, tier = excluded.tier, regions = excluded.regions,
         origin = 'seed', status = 'live', updated_at = now()`,
      [e.id, e.domain, e.category, e.subcategory, e.name, e.aliases ?? [], e.kind, e.priceModel, e.typical ?? null, e.running ?? null, e.tier, e.regions ?? ["US", "EU"]],
    );
    for (const p of (e.photos ?? []).filter(admissible)) {
      const r = await db.query(
        `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, hero, status, contributed_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', 'seed')
         on conflict (entity_id, url) do update set
           width = excluded.width, height = excluded.height, source = excluded.source,
           source_page = excluded.source_page, photographer = excluded.photographer, license = excluded.license,
           hero = excluded.hero, status = 'approved', contributed_by = 'seed', vouchers = '{}'
         returning id`,
        [e.id, p.url, p.width, p.height, p.source, p.sourcePage, p.photographer, p.license, p.hero],
      );
      photos += r.rows.length;
    }
  }
  await db.query("insert into archive_seed_runs (version, entities, photos) values ($1, $2, $3)", [version, entities.length, photos]);
  return { version, entities: entities.length, photos };
}
