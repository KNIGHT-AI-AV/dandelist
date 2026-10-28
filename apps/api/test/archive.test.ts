import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { admissible, matchEntity, pgArchive, words, type ArchiveEntity, type ArchivePhoto } from "../src/archive/archive";
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

  it("adds an agent's finds to a known subject at once", async () => {
    await loadSeed(db, await seed([{ id: "kyoto", domain: "Travel", category: "City breaks", subcategory: "Japan", name: "Kyoto", kind: "place", priceModel: "trip", tier: 1 }]));
    const archive = pgArchive(db);
    expect(await archive.lookup("Kyoto", "place")).toBeNull();
    expect(await archive.contribute("Two weeks in Kyoto", "place", [photo(10), photo(11), photo(12, { license: "All rights reserved" })], "user-a")).toBe(2);
    expect((await archive.lookup("Kyoto in autumn", "place"))?.photos).toHaveLength(2);
  });

  it("keeps something new pending until a second person's agent finds it too", async () => {
    const archive = pgArchive(db);
    await archive.contribute("Faroe Islands", "place", [photo(20), photo(21)], "user-a");
    expect(await archive.lookup("Faroe Islands", "place")).toBeNull();
    await archive.contribute("Faroe Islands", "place", [photo(22)], "user-a");
    expect(await archive.lookup("Faroe Islands", "place")).toBeNull();
    await archive.contribute("Faroe Islands", "place", [photo(23)], "user-b");
    expect((await archive.lookup("Faroe Islands", "place"))?.photos.length).toBe(4);
  });
});
