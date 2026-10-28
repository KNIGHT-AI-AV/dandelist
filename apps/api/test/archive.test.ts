import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { admissible, exactEntity, matchEntity, pgArchive, words, type ArchiveEntity, type ArchivePhoto } from "../src/archive/archive";
import { loadSeed } from "../src/archive/seed";
import { migrate, type Db } from "../src/db";

const e = (id: string, name: string, kind: string, aliases: string[] = [], tier = 1): ArchiveEntity => ({ id, name, aliases, kind, tier, subcategory: "x" });
const ENTITIES = [
  e("porsche-911-carrera-992", "Porsche 911 Carrera (992)", "vehicle", ["Porsche 911 Carrera", "911 Carrera"]),
  e("porsche-911-gt3-992", "Porsche 911 GT3 (992)", "vehicle", ["Porsche 911 GT3", "911 GT3"]),
  e("mercedes-g63", "Mercedes-AMG G 63", "vehicle", ["G-Wagon", "G Wagon", "G63"]),
  e("lisbon", "Lisbon", "place", ["Lisboa"]),
  e("kyoto", "Kyoto", "place"),
  e("lisbon-apartment", "A 2-bed apartment in Lisbon", "home", ["Lisbon apartment"], 2),
];

const photo = (n: number, over: Partial<ArchivePhoto> = {}): ArchivePhoto => ({
  url: `https://upload.wikimedia.org/x/${n}.jpg`,
  width: 3840,
  height: 2560,
  source: "commons",
  sourcePage: `https://commons.wikimedia.org/wiki/File:${n}.jpg`,
  photographer: "A. Photographer",
  license: "CC BY-SA 4.0",
  hero: false,
  ...over,
});

describe("archive matching", () => {
  it("drops filler, so a trip or a colour still finds its subject", () => {
    expect(words("A month in Lisbon")).toEqual(["lisbon"]);
    expect(words("a black G-Wagon")).toEqual(["g", "wagon"]);
  });

  it("matches what people type to the right entity", () => {
    expect(matchEntity("A month in Lisbon", "place", ENTITIES)?.id).toBe("lisbon");
    expect(matchEntity("Two weeks in Kyoto", "place", ENTITIES)?.id).toBe("kyoto");
    expect(matchEntity("A black G-Wagon", "vehicle", ENTITIES)?.id).toBe("mercedes-g63");
    expect(matchEntity("Porsche 911 Carrera", "vehicle", ENTITIES)?.id).toBe("porsche-911-carrera-992");
    expect(matchEntity("Porsche 911 GT3", "vehicle", ENTITIES)?.id).toBe("porsche-911-gt3-992");
  });

  it("never lends one model's photos to another, or a city's to a flat", () => {
    expect(matchEntity("Porsche 911 GT3 RS Weissach", "vehicle", ENTITIES)).toBeNull();
    expect(matchEntity("Porsche Cayenne", "vehicle", ENTITIES)).toBeNull();
    expect(matchEntity("Lisbon", "vehicle", ENTITIES)).toBeNull();
    expect(matchEntity("A Lisbon apartment", "place", ENTITIES)?.id).toBe("lisbon-apartment");
  });

  it("lets offers add only to an entity the subject names word for word", () => {
    expect(exactEntity("Porsche 911 Carrera", "vehicle", ENTITIES)?.id).toBe("porsche-911-carrera-992");
    expect(exactEntity("Lisboa", "place", ENTITIES)?.id).toBe("lisbon");
    expect(exactEntity("Lisbon red", "place", ENTITIES)).toBeNull();
    expect(exactEntity("A month in Lisbon", "place", ENTITIES)).toBeNull();
    expect(exactEntity("Lisbon", "vehicle", ENTITIES)).toBeNull();
    expect(exactEntity("Lisbon (anything)", "place", ENTITIES)).toBeNull();
    expect(exactEntity(`Lisbon ${String.fromCodePoint(0x1f525)}`, "place", ENTITIES)).toBeNull();
    expect(exactEntity("Porsche 911 Carrera (992)", "vehicle", ENTITIES)).toBeNull();
    expect(exactEntity("porsche  911-carrera", "vehicle", ENTITIES)?.id).toBe("porsche-911-carrera-992");
  });

  it("admits only API-licensed real photos of 3000 px or more", () => {
    expect(admissible(photo(1))).toBe(true);
    expect(admissible(photo(2, { license: "Unsplash License", source: "unsplash" }))).toBe(true);
    expect(admissible(photo(3, { width: 2400, height: 1600 }))).toBe(false);
    expect(admissible(photo(4, { license: "CC BY-ND 4.0" }))).toBe(false);
    expect(admissible(photo(5, { license: "All rights reserved" }))).toBe(false);
    expect(admissible(photo(6, { source: "pinterest" as ArchivePhoto["source"] }))).toBe(false);
  });
});

describe("archive store", () => {
  let db: Db;
  beforeEach(async () => {
    const lite = new PGlite();
    db = { query: (t, p) => lite.query(t, p) as never, exec: (s) => lite.exec(s) };
    await migrate(db);
  });

  async function seed(entities: unknown[]) {
    const dir = await mkdtemp(join(tmpdir(), "seed-"));
    const path = join(dir, "seed.json");
    await writeFile(path, JSON.stringify({ entities }));
    return path;
  }

  it("loads the master list once per version and serves its photos", async () => {
    const path = await seed([
      { id: "lisbon", domain: "Travel", category: "City breaks", subcategory: "Iberia", name: "Lisbon", kind: "place", priceModel: "trip", tier: 1, photos: [photo(1, { hero: true }), photo(2), photo(3, { width: 1000, height: 800 })] },
    ]);
    expect(await loadSeed(db, path)).toMatchObject({ entities: 1, photos: 2 });
    expect(await loadSeed(db, path)).toBeNull();
    const hit = await pgArchive(db).lookup("A month in Lisbon", "place");
    expect(hit?.entity.id).toBe("lisbon");
    expect(hit?.photos.map((p) => p.hero)).toEqual([true, false]);
  });

  it("keeps shared seed URLs attached to each destination with independent heroes", async () => {
    const path = await seed([
      { id: "positano", domain: "Travel", category: "Coasts", subcategory: "Italy", name: "Positano", kind: "place", priceModel: "trip", tier: 1, photos: [photo(50, { hero: true }), photo(51)] },
      { id: "amalfi-coast", domain: "Travel", category: "Coasts", subcategory: "Italy", name: "Amalfi Coast", kind: "place", priceModel: "trip", tier: 1, photos: [photo(50), photo(51, { hero: true })] },
    ]);
    expect(await loadSeed(db, path)).toMatchObject({ entities: 2, photos: 4 });
    const archive = pgArchive(db);
    const positano = await archive.lookup("Positano", "place");
    const coast = await archive.lookup("Amalfi Coast", "place");
    expect(positano?.photos).toHaveLength(2);
    expect(coast?.photos).toHaveLength(2);
    expect(positano?.photos.find((p) => p.hero)?.url).toBe(photo(50).url);
    expect(coast?.photos.find((p) => p.hero)?.url).toBe(photo(51).url);
    const { rows } = await db.query("select id from archive_photos");
    expect(rows).toHaveLength(4);
    expect(await loadSeed(db, path)).toBeNull();
  });

  it("never counts cross-subject photo offers toward another entity's approval", async () => {
    await loadSeed(db, await seed([
      { id: "positano", domain: "Travel", category: "Coasts", subcategory: "Italy", name: "Positano", kind: "place", priceModel: "trip", tier: 1 },
      { id: "amalfi-coast", domain: "Travel", category: "Coasts", subcategory: "Italy", name: "Amalfi Coast", kind: "place", priceModel: "trip", tier: 1 },
    ]));
    const archive = pgArchive(db);
    const photos = [photo(60), photo(61)];
    await archive.contribute("Positano", "place", photos, "user-a");
    await archive.contribute("Amalfi Coast", "place", photos, "user-b");
    await archive.contribute("Positano", "place", photos, "user-a");
    await archive.contribute("Amalfi Coast", "place", photos, "user-b");
    expect(await archive.lookup("Positano", "place")).toBeNull();
    expect(await archive.lookup("Amalfi Coast", "place")).toBeNull();

    await archive.contribute("Positano", "place", photos, "user-c");
    expect((await archive.lookup("Positano", "place"))?.photos).toHaveLength(2);
    expect(await archive.lookup("Amalfi Coast", "place")).toBeNull();
    await archive.contribute("Amalfi Coast", "place", photos, "user-a");
    expect((await archive.lookup("Amalfi Coast", "place"))?.photos).toHaveLength(2);
    const { rows } = await db.query<{ entity_id: string; vouchers: string[] }>("select entity_id, vouchers from archive_photos");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.vouchers.sort()).toEqual(row.entity_id === "positano" ? ["user-a", "user-c"] : ["user-a", "user-b"]);
    }
  });

  it("preserves legacy photo records while quarantining votes that cannot be tied to their subject", async () => {
    await loadSeed(db, await seed([
      { id: "lisbon", domain: "Travel", category: "City breaks", subcategory: "Iberia", name: "Lisbon", kind: "place", priceModel: "trip", tier: 1, photos: [photo(70), photo(71), photo(72, { hero: true })] },
    ]));
    await db.query("update archive_photos set contributed_by = 'user-a', vouchers = array['user-a', 'other-subject-user'] where url = $1", [photo(70).url]);
    await db.query("update archive_photos set contributed_by = 'user-b', status = 'rejected', vouchers = array['user-b'] where url = $1", [photo(71).url]);
    const before = (await db.query<{ id: string; url: string }>("select id, url from archive_photos order by url")).rows;
    // Restore the former URL constraint to exercise the upgrade against populated legacy rows.
    await db.exec("drop index archive_photos_entity_url; alter table archive_photos add constraint archive_photos_url_key unique (url)");
    const migration = await readFile(new URL("../sql/008_archive_photo_associations.sql", import.meta.url), "utf8");
    await db.exec(migration);
    const after = (await db.query<{ id: string; url: string; status: string; vouchers: string[]; contributed_by: string }>("select id, url, status, vouchers, contributed_by from archive_photos order by url")).rows;
    expect(after.map(({ id, url }) => ({ id, url }))).toEqual(before);
    expect(after[0]).toMatchObject({ status: "pending", vouchers: [], contributed_by: "user-a" });
    expect(after[1]).toMatchObject({ status: "rejected", vouchers: [], contributed_by: "user-b" });
    expect(after[2]).toMatchObject({ status: "approved", contributed_by: "seed" });
    const audit = (await db.query<{ previous_status: string; previous_vouchers: string[] }>("select previous_status, previous_vouchers from archive_photo_vote_resets where photo_id = $1", [before[0]!.id])).rows[0];
    expect(audit).toEqual({ previous_status: "approved", previous_vouchers: ["user-a", "other-subject-user"] });
    await pgArchive(db).contribute("Lisbon", "place", [photo(70)], "fresh-user");
    await db.exec(migration);
    expect((await db.query<{ vouchers: string[] }>("select vouchers from archive_photos where url = $1", [photo(70).url])).rows[0]?.vouchers).toEqual(["fresh-user"]);
  });

  it("replaces an offered association with reviewed seed provenance and protects it from later votes", async () => {
    const entity = { id: "lisbon", domain: "Travel", category: "City breaks", subcategory: "Iberia", name: "Lisbon", kind: "place", priceModel: "trip", tier: 1 };
    await loadSeed(db, await seed([entity]));
    const archive = pgArchive(db);
    await archive.contribute("Lisbon", "place", [photo(80, { width: 6000, photographer: "Proposed credit" })], "user-a");
    const before = (await db.query<{ id: string }>("select id from archive_photos where url = $1", [photo(80).url])).rows[0];
    await loadSeed(db, await seed([{ ...entity, photos: [photo(80, { hero: true })] }]));
    const row = (await db.query("select id, width, photographer, hero, status, contributed_by, vouchers from archive_photos where url = $1", [photo(80).url])).rows[0];
    expect(row).toMatchObject({ id: before?.id, width: 3840, photographer: "A. Photographer", hero: true, status: "approved", contributed_by: "seed", vouchers: [] });
    expect(await archive.contribute("Lisbon", "place", [photo(80)], "user-b")).toBe(0);
  });

  it("puts an agent's finds live only when a second person's agent offers the same photos", async () => {
    await loadSeed(db, await seed([{ id: "kyoto", domain: "Travel", category: "City breaks", subcategory: "Japan", name: "Kyoto", kind: "place", priceModel: "trip", tier: 1 }]));
    const archive = pgArchive(db);
    expect(await archive.contribute("Kyoto", "place", [photo(10), photo(11), photo(12, { license: "All rights reserved" })], "user-a")).toBe(2);
    expect(await archive.lookup("Kyoto", "place")).toBeNull();
    await archive.contribute("Kyoto", "place", [photo(10), photo(11)], "user-a");
    expect(await archive.lookup("Kyoto", "place")).toBeNull();
    await archive.contribute("Kyoto temples at dusk", "place", [photo(10), photo(11)], "user-b");
    expect(await archive.lookup("Kyoto", "place")).toBeNull();
    await archive.contribute("Kyoto", "place", [photo(10), photo(11)], "user-b");
    expect((await archive.lookup("Kyoto", "place"))?.photos).toHaveLength(2);
    expect(await archive.contribute("Kyoto", "place", [photo(13)], "anonymous")).toBe(0);
  });

  it("withdraws omitted seed photos without deleting provenance or changing other associations", async () => {
    const entity = { id: "kyoto", domain: "Travel", category: "City breaks", subcategory: "Japan", name: "Kyoto", kind: "place", priceModel: "trip", tier: 1 };
    const other = { ...entity, id: "japan-trip", name: "Japan trip", kind: "trip" };
    const reviewed = [photo(90, { hero: true }), photo(91), photo(92)];
    await loadSeed(db, await seed([{ ...entity, photos: reviewed }, { ...other, photos: reviewed }]));
    const archive = pgArchive(db);
    await archive.contribute("Kyoto", "place", [photo(93), photo(94)], "user-a");
    await archive.contribute("Kyoto", "place", [photo(93), photo(94)], "user-b");
    const before = (await db.query("select id, url, source_page, photographer, license from archive_photos where entity_id = 'kyoto' and contributed_by = 'seed' order by url")).rows;
    const revised = await seed([{ ...entity, photos: [] }, { ...other, photos: reviewed }]);
    expect(await loadSeed(db, revised)).toMatchObject({ entities: 2, photos: 3 });
    expect((await archive.lookup("Kyoto", "place"))?.photos.map((p) => p.url).sort()).toEqual([photo(93).url, photo(94).url].sort());
    expect((await archive.lookup("Japan trip", "place"))?.photos).toHaveLength(3);
    const after = (await db.query("select id, url, source_page, photographer, license from archive_photos where entity_id = 'kyoto' and contributed_by = 'seed' order by url")).rows;
    expect(after).toEqual(before);
    expect((await db.query<{ status: string; hero: boolean }>("select status, hero from archive_photos where entity_id = 'kyoto' and contributed_by = 'seed'")).rows).toEqual(reviewed.map(() => ({ status: "rejected", hero: false })));
    expect(await archive.contribute("Kyoto", "place", reviewed, "user-c")).toBe(0);
    expect(await loadSeed(db, revised)).toBeNull();
  });

  it("does not keep a retired seed hero when a reviewed replacement set arrives", async () => {
    const entity = { id: "kyoto", domain: "Travel", category: "City breaks", subcategory: "Japan", name: "Kyoto", kind: "place", priceModel: "trip", tier: 1 };
    await loadSeed(db, await seed([{ ...entity, photos: [photo(100, { hero: true }), photo(101), photo(102)] }]));
    await loadSeed(db, await seed([{ ...entity, photos: [photo(103, { hero: true }), photo(104), photo(105)] }]));
    const hit = await pgArchive(db).lookup("Kyoto", "place");
    expect(hit?.photos).toHaveLength(3);
    expect(hit?.photos.filter((p) => p.hero).map((p) => p.url)).toEqual([photo(103).url]);
    expect(hit?.photos.map((p) => p.url).sort()).toEqual([photo(103).url, photo(104).url, photo(105).url].sort());
    expect((await db.query("select id from archive_photos where entity_id = 'kyoto'")).rows).toHaveLength(6);
  });

  it("keeps something new waiting for review, however many people offer it", async () => {
    const archive = pgArchive(db);
    await archive.contribute("Faroe Islands", "place", [photo(20), photo(21)], "user-a");
    await archive.contribute("Faroe Islands", "place", [photo(20), photo(21)], "user-b");
    await archive.contribute("Faroe Islands", "place", [photo(20)], "user-c");
    expect(await archive.lookup("Faroe Islands", "place")).toBeNull();
    const { rows } = await db.query<{ status: string }>("select status from archive_entities where origin = 'agent' and name = 'Faroe Islands'");
    expect(rows[0]?.status).toBe("pending");
  });

  it("never lets a new subject's photos land on a seed entity with the same name", async () => {
    await loadSeed(db, await seed([{ id: "lisbon", domain: "Travel", category: "City breaks", subcategory: "Iberia", name: "Lisbon", kind: "place", priceModel: "trip", tier: 1 }]));
    const archive = pgArchive(db);
    await archive.contribute("Lisbon", "vehicle", [photo(30)], "user-a");
    await archive.contribute("Lisbon", "vehicle", [photo(30)], "user-b");
    const { rows } = await db.query<{ entity_id: string }>("select entity_id from archive_photos where url = $1", [photo(30).url]);
    expect(rows[0]?.entity_id).toMatch(/^agent-lisbon-[0-9a-f]{10}$/);
  });
});
