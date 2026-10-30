import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admissible, pgArchive } from "../src/archive/archive";
import type { SeedEntity } from "../src/archive/seed";
import { migrate, type Db } from "../src/db";
import { ARCHIVE_PREFIX, poolSource } from "../src/pool";

// Desired contract, not a passing baseline characterization: a live entity needs exactly one approved,
// explicitly designated hero. One photo can suffice; additional approved gallery photos may remain.
// These synthetic administrative states do not establish visual review, rights or live delivery.
// Only the real database migrations and consumers run; no provider/model client is constructed.
const now = () => new Date("2026-10-29T12:00:00Z");
const imageUrl = (key: string) => `https://upload.wikimedia.org/fixture/${key}.jpg`;
type Entity = { id: string; name: string };
type PhotoState = {
  hero?: boolean;
  status?: "approved" | "pending" | "rejected";
  width?: number;
  createdAt?: string;
};

let lite: PGlite | undefined;
let db: Db;
const dbFailures: unknown[] = [];
const networkAttempts: string[] = [];

beforeAll(async () => {
  // No data directory: one in-memory instance for this file, closed even after a failed assertion.
  lite = new PGlite();
  db = {
    query: async (text, params) => {
      try {
        return await lite!.query(text, params) as never;
      } catch (error) {
        dbFailures.push(error);
        throw error;
      }
    },
    exec: async (sql) => {
      try {
        return await lite!.exec(sql);
      } catch (error) {
        dbFailures.push(error);
        throw error;
      }
    },
  };
  await migrate(db);
}, 30_000);

beforeEach(async () => {
  dbFailures.length = 0;
  networkAttempts.length = 0;
  vi.stubGlobal("fetch", async () => {
    networkAttempts.push("fetch");
    throw new Error("Network is forbidden in the archive hero contract fixture");
  });
  // This database contains only fixture rows. Foreign-key cascades clear their photo associations too.
  await db.exec("delete from archive_entities");
});

afterEach(() => {
  vi.unstubAllGlobals();
  // poolSource catches database errors and returns catalogue-only data. That must not fake a valid exclusion.
  expect(dbFailures).toEqual([]);
  expect(networkAttempts).toEqual([]);
});

afterAll(async () => {
  await lite?.close();
});

async function entity(id = "amber", status: "live" | "pending" | "retired" = "live"): Promise<Entity> {
  const row = { id: `hero-fixture-${id}`, name: `Fixture Harbor ${id}` };
  await db.query(
    `insert into archive_entities
       (id, domain, category, subcategory, name, kind, price_model, typical, tier, origin, status)
     values ($1, 'Travel', 'Fixture', 'Fixture', $2, 'place', 'trip', $3::jsonb, 1, 'seed', $4)`,
    [row.id, row.name, JSON.stringify({ low: 2500, high: 3500, currency: "USD", unit: "Fixture trip for two" }), status],
  );
  return row;
}

async function photo(owner: Entity, key: string, state: PhotoState = {}) {
  await db.query(
    `insert into archive_photos
       (entity_id, url, width, height, source, source_page, photographer, license, hero, status, contributed_by, created_at)
     values ($1, $2, $3, 2560, 'commons', $4, 'Fixture photographer', 'CC BY-SA 4.0', $5, $6, 'seed', $7::timestamptz)`,
    [
      owner.id, imageUrl(key), state.width ?? 3840,
      `https://commons.wikimedia.org/wiki/File:Fixture_${key}.jpg`,
      state.hero ?? false, state.status ?? "approved", state.createdAt ?? "2026-10-28T12:00:00Z",
    ],
  );
}

async function observe(owner: Entity) {
  // Fresh instances also follow a mutation: this checks eligibility, not immediate invalidation of TTL caches.
  const archive = await pgArchive(db, now).lookup(owner.name, "place");
  const pool = await poolSource(db, now)();
  return { archive, pool: pool.find((item) => item.id === `${ARCHIVE_PREFIX}${owner.id}`) };
}

type Observation = Awaited<ReturnType<typeof observe>>;

function expectEligible(result: Observation, owner: Entity, hero: string, count: number) {
  expect.soft(result.archive?.entity.id).toBe(owner.id);
  expect.soft(result.archive?.photos).toHaveLength(count);
  expect.soft(result.archive?.photos[0]).toMatchObject({ url: imageUrl(hero), hero: true });
  expect.soft(result.pool).toMatchObject({
    id: `${ARCHIVE_PREFIX}${owner.id}`, upfrontCents: 250_000, status: "estimate", seller: "Typical price",
  });
  expect.soft(result.pool?.media?.images).toHaveLength(count);
  expect.soft(result.pool?.media?.images[0]?.url).toBe(imageUrl(hero));
}

function expectWithheld(result: Observation) {
  expect.soft(result.archive).toBeNull();
  expect.soft(result.pool).toBeUndefined();
}

describe("the archive and onboarding pool share explicit-hero eligibility", () => {
  it("accepts one approved hero without requiring a second photo", async () => {
    const owner = await entity();
    await photo(owner, "only", { hero: true });
    expectEligible(await observe(owner), owner, "only", 1);
  });

  it("keeps the designated hero ahead of a larger, older nonhero and preserves both photos", async () => {
    const owner = await entity();
    await photo(owner, "larger", { width: 8000, createdAt: "2026-10-27T12:00:00Z" });
    await photo(owner, "chosen", { hero: true, createdAt: "2026-10-28T12:00:00Z" });
    expectEligible(await observe(owner), owner, "chosen", 2);
  });

  it("withholds an entity whose photos are all pending or rejected", async () => {
    const owner = await entity();
    await photo(owner, "pending", { hero: true, status: "pending" });
    await photo(owner, "rejected", { hero: true, status: "rejected" });
    expectWithheld(await observe(owner));
  });

  it("does not invent a hero from two approved nonhero photos", async () => {
    const owner = await entity();
    await photo(owner, "unselected-a");
    await photo(owner, "unselected-b", { width: 8000 });
    expectWithheld(await observe(owner));
  });

  it("withholds ambiguous selection when two approved photos are designated heroes", async () => {
    const owner = await entity();
    await photo(owner, "hero-a", { hero: true });
    await photo(owner, "hero-b", { hero: true, width: 8000 });
    expectWithheld(await observe(owner));
  });

  it("finds a smaller hero before the archive and pool gallery limits", async () => {
    const owner = await entity();
    for (let i = 0; i < 9; i++) await photo(owner, `large-${i}`, { width: 8000 + i });
    await photo(owner, "small-hero", { hero: true });
    const result = await observe(owner);
    expect(result.archive?.photos).toHaveLength(8);
    expect(result.archive?.photos[0]).toMatchObject({ url: imageUrl("small-hero"), hero: true });
    expect(result.pool?.media?.images).toHaveLength(4);
    expect(result.pool?.media?.images[0]?.url).toBe(imageUrl("small-hero"));
  });

  it("does not hide a second hero behind larger gallery photos or result limits", async () => {
    const owner = await entity();
    await photo(owner, "first-hero", { hero: true });
    for (let i = 0; i < 9; i++) await photo(owner, `large-${i}`, { width: 8000 + i });
    await photo(owner, "last-hero", { hero: true, width: 3200 });
    expectWithheld(await observe(owner));
  });

  it("does not replace a withdrawn hero with an approved nonhero", async () => {
    const owner = await entity();
    await photo(owner, "withdrawn", { hero: true, status: "rejected" });
    await photo(owner, "remaining-a");
    await photo(owner, "remaining-b");
    expectWithheld(await observe(owner));
    const retained = await db.query("select status, hero from archive_photos where entity_id = $1 and url = $2", [owner.id, imageUrl("withdrawn")]);
    expect(retained.rows).toEqual([{ status: "rejected", hero: true }]);
  });

  it("counts only approved heroes, leaving historical and pending hero records intact", async () => {
    const owner = await entity();
    await photo(owner, "current", { hero: true });
    await photo(owner, "gallery");
    await photo(owner, "old", { hero: true, status: "rejected" });
    await photo(owner, "proposed", { hero: true, status: "pending" });
    expectEligible(await observe(owner), owner, "current", 2);
    expect((await db.query("select id from archive_photos where entity_id = $1", [owner.id])).rows).toHaveLength(4);
  });

  it.each(["pending", "retired"] as const)("does not publish a %s entity even when its photo is approved", async (status) => {
    const owner = await entity("amber", status);
    await photo(owner, "approved", { hero: true });
    expectWithheld(await observe(owner));
  });

  it("keeps a shared original's approval and hero selection scoped to each entity", async () => {
    const amber = await entity("amber");
    const birch = await entity("birch");
    await photo(amber, "shared-a", { hero: true });
    await photo(amber, "shared-b");
    await photo(birch, "shared-a");
    await photo(birch, "shared-b", { hero: true });
    expectEligible(await observe(amber), amber, "shared-a", 2);
    expectEligible(await observe(birch), birch, "shared-b", 2);

    await db.query("update archive_photos set status = 'rejected' where entity_id = $1 and url = $2", [amber.id, imageUrl("shared-a")]);
    expectWithheld(await observe(amber));
    expectEligible(await observe(birch), birch, "shared-b", 2);
    const associations = await db.query<{ entity_id: string; status: string; hero: boolean }>(
      "select entity_id, status, hero from archive_photos where url = $1 order by entity_id", [imageUrl("shared-a")],
    );
    expect(associations.rows).toEqual([
      { entity_id: amber.id, status: "rejected", hero: true },
      { entity_id: birch.id, status: "approved", hero: false },
    ]);
  });

  it("preserves the populated travel seed's existing heroes and typical-price eligibility", async () => {
    const source = JSON.parse(await readFile(new URL("../data/archive-seed.json", import.meta.url), "utf8")) as { entities: SeedEntity[] };
    // The current cohort is 31 records. Other future kinds/price models keep their separate pool rules.
    const cohort = source.entities.filter((e) => e.photos?.length && (e.kind === "place" || e.kind === "trip") && e.priceModel === "trip");
    expect(cohort.length).toBeGreaterThan(0);
    for (const e of cohort) {
      const photos = e.photos!.filter(admissible);
      expect(photos).toHaveLength(e.photos!.length);
      expect(photos.filter((p) => p.hero)).toHaveLength(1);
      await db.query(
        `insert into archive_entities (id, domain, category, subcategory, name, aliases, kind, price_model, typical, tier)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [e.id, e.domain, e.category, e.subcategory, e.name, e.aliases ?? [], e.kind, e.priceModel, e.typical, e.tier],
      );
      for (const p of photos) {
        await db.query(
          `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, hero)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [e.id, p.url, p.width, p.height, p.source, p.sourcePage, p.photographer, p.license, p.hero],
        );
      }
    }
    const archive = pgArchive(db, now);
    const pool = await poolSource(db, now)();
    expect(pool.filter((item) => item.id.startsWith(ARCHIVE_PREFIX))).toHaveLength(cohort.length);
    for (const e of cohort) {
      const hero = e.photos!.find((p) => p.hero)!;
      const hit = await archive.lookup(e.name, "place");
      const item = pool.find((p) => p.id === `${ARCHIVE_PREFIX}${e.id}`);
      expect(hit?.entity.id).toBe(e.id);
      expect(hit?.photos[0]).toMatchObject({ url: hero.url, hero: true, license: hero.license, photographer: hero.photographer });
      expect(hit?.photos).toHaveLength(Math.min(8, e.photos!.length));
      expect(item?.media?.images[0]?.url).toBe(hero.url);
      expect(item?.media?.images).toHaveLength(Math.min(4, e.photos!.length));
      expect(item?.status).toBe("estimate");
      expect(item?.seller).toBe("Typical price");
    }
  });
});
