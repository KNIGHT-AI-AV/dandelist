import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { entries as catalogue, type Entry } from "@dandelist/catalogue";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admissible, pgArchive, toMediaImage, type ArchivePhoto } from "../src/archive/archive";
import { providerDeliveryAllowed, selectDeliverablePhotos } from "../src/archive/photo-delivery";
import { loadSeed, type SeedEntity } from "../src/archive/seed";
import { migrate, type Db } from "../src/db";
import { ARCHIVE_PREFIX, fromCatalogue, poolSource, typicalOf, type ArchiveRow } from "../src/pool";

// Synthetic metadata only: these checks make no provider/model requests and establish neither rights nor visual approval.
const HOTLINK = "https://images.unsplash.com/photo-fixture?ixid=fixture-id&rect=12%2C34%2C4000%2C3000&w=3840&h=2560";
const SELF_HOSTED = "https://api.dandelist.knightaiav.com/media/fixture.jpg";
const now = () => new Date("2026-10-30T16:00:00.000Z");

const commons = (key: string, over: Partial<ArchivePhoto> = {}): ArchivePhoto => ({
  url: `https://upload.wikimedia.org/fixture/${key}.jpg`,
  width: 3840,
  height: 2560,
  source: "commons",
  sourcePage: `https://commons.wikimedia.org/wiki/File:Fixture_${key}.jpg`,
  photographer: "Fixture photographer",
  license: "CC BY-SA 4.0",
  hero: false,
  ...over,
});

const unsplash = (url = HOTLINK, over: Partial<ArchivePhoto> = {}): ArchivePhoto => ({
  ...commons("unsplash"),
  url,
  source: "unsplash",
  sourcePage: "https://unsplash.com/photos/fixture",
  license: "Unsplash License",
  ...over,
});

describe("provider-specific archive delivery", () => {
  it.each([
    ["self-hosted copy", SELF_HOSTED],
    ["unrelated host", "https://example.com/photo.jpg"],
    ["hostname suffix", "https://images.unsplash.com.evil.example/photo.jpg"],
    ["host-looking username", "https://images.unsplash.com@evil.example/photo.jpg"],
    ["credentials on the right host", "https://user:password@images.unsplash.com/photo.jpg"],
    ["HTTP", "http://images.unsplash.com/photo.jpg"],
    ["nondefault port", "https://images.unsplash.com:444/photo.jpg"],
    ["malformed URL", "not a URL"],
  ])("refuses an Unsplash %s at both delivery and admission", (_reason, url) => {
    for (const source of ["unsplash", "unsplash.com"]) {
      expect(providerDeliveryAllowed({ source, url })).toBe(false);
    }
    expect(admissible(unsplash(url))).toBe(false);
  });

  it.each([HOTLINK, "https://images.unsplash.com:443/photo-fixture?ixid=retained"])("accepts an exact HTTPS Unsplash host: %s", (url) => {
    expect(providerDeliveryAllowed({ source: "unsplash", url })).toBe(true);
    expect(providerDeliveryAllowed({ source: "unsplash.com", url })).toBe(true);
    expect(admissible(unsplash(url))).toBe(true);
  });

  it("keeps Commons self-hosting and Pexels delivery outside the Unsplash restriction", () => {
    const otherProviders: ArchivePhoto[] = [
      commons("self-hosted", { url: SELF_HOSTED }),
      commons("pexels", { url: SELF_HOSTED, source: "pexels", sourcePage: "https://www.pexels.com/photo/fixture", license: "Pexels License" }),
    ];
    for (const photo of otherProviders) {
      expect(providerDeliveryAllowed(photo)).toBe(true);
      expect(admissible(photo)).toBe(true);
    }
  });

  it("retains the exact hero URL and metadata while removing only an unsafe gallery photo", () => {
    const hero = unsplash(HOTLINK, { hero: true });
    const safeGallery = commons("gallery");
    const photos = [unsplash(SELF_HOSTED), safeGallery, hero];
    const before = structuredClone(photos);
    const selected = selectDeliverablePhotos(photos);
    expect(selected).toEqual([hero, safeGallery]);
    expect(selected?.[0]).toBe(hero);
    expect(selected?.[0]?.url).toBe(HOTLINK);
    expect(photos).toEqual(before);
  });

  it("withholds an unsafe designated hero instead of promoting a safe gallery photo", () => {
    expect(selectDeliverablePhotos([unsplash(SELF_HOSTED, { hero: true }), commons("safe")])).toBeNull();
  });

  it("keeps the original multiple-hero ambiguity even if filtering could leave one safe hero", () => {
    expect(selectDeliverablePhotos([unsplash(SELF_HOSTED, { hero: true }), commons("safe-hero", { hero: true })])).toBeNull();
  });

  it("does not invent a hero when all remaining photos are safe", () => {
    expect(selectDeliverablePhotos([commons("unselected")])).toBeNull();
  });

  it("transports a valid catalogue Commons page and preserves Unsplash credit metadata", () => {
    const photo = commons("catalogue", { hero: true });
    const entry: Entry = { ...catalogue[0]!, media: { kind: "place", images: [toMediaImage(photo)] } };
    const image = fromCatalogue(entry).media!.images[0]!;
    expect(image).toMatchObject({ url: photo.url, sourcePage: photo.sourcePage, source: "commons.wikimedia.org", credit: photo.photographer, license: photo.license });
    expect(image).not.toHaveProperty("page");
    const invalid = { ...entry, media: { ...entry.media!, images: [{ ...entry.media!.images[0]!, sourcePage: "https://evil.example/wiki/File:Fixture.jpg" }] } };
    expect(fromCatalogue(invalid).media!.images[0]).not.toHaveProperty("sourcePage");
    expect(fromCatalogue(invalid).media!.images[0]!.url).toBe(photo.url);
    const unsplashEntry = catalogue.find((e) => e.media?.images.some((p) => p.source === "unsplash.com" && p.author))!;
    expect(unsplashEntry).toBeDefined();
    const input = unsplashEntry.media!.images[0]!;
    const output = fromCatalogue(unsplashEntry).media!.images[0]!;
    expect(output.url).toBe(input.url);
    expect(output.author).toEqual(input.author);
    expect(output).not.toHaveProperty("sourcePage");
  });
});

describe("legacy approval is checked again by archive and pool readers", () => {
  let lite: PGlite | undefined;
  let db: Db;
  let seedDir: string | undefined;
  const seedFiles: string[] = [];
  const dbFailures: unknown[] = [];
  const networkAttempts: string[] = [];

  beforeAll(async () => {
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
    seedDir = await mkdtemp(join(tmpdir(), "dandelist-provider-delivery-"));
  }, 30_000);

  beforeEach(async () => {
    dbFailures.length = 0;
    networkAttempts.length = 0;
    vi.stubGlobal("fetch", async () => {
      networkAttempts.push("fetch");
      throw new Error("Network is forbidden in the provider-delivery fixture");
    });
    // Only this file's in-memory fixtures exist here. Foreign-key cascades clear their photo associations.
    await db.exec("delete from archive_entities; delete from archive_seed_runs");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // A failed archive query must not make poolSource's catalogue-only fallback look like a correct exclusion.
    expect(dbFailures).toEqual([]);
    expect(networkAttempts).toEqual([]);
  });

  afterAll(async () => {
    try {
      await lite?.close();
    } finally {
      // Remove only files this fixture wrote, then the now-empty directory; no recursive deletion.
      await Promise.all(seedFiles.map((path) => rm(path, { force: true })));
      if (seedDir) await rmdir(seedDir);
    }
  });

  async function writeSeed(entities: SeedEntity[]) {
    const raw = JSON.stringify({ entities });
    const path = join(seedDir!, `seed-${seedFiles.length}.json`);
    seedFiles.push(path);
    await writeFile(path, raw);
    return { path, raw };
  }

  function fixtureEntity(id: string, photos: ArchivePhoto[]): SeedEntity {
    return {
      id: `provider-fixture-${id}`,
      name: `Delivery Harbor ${id}`,
      domain: "Travel",
      category: "Fixture",
      subcategory: "Fixture",
      kind: "place",
      priceModel: "trip",
      typical: { low: 2500, high: 3500, currency: "USD", unit: "Fixture trip for two" },
      tier: 1,
      photos,
    };
  }

  async function storedPhotos(id: string) {
    return (await db.query(
      "select url, source, source_page, photographer, license, width, height, hero, status from archive_photos where entity_id = $1 order by url",
      [id],
    )).rows;
  }

  async function legacySeed(id: string, photos: ArchivePhoto[]) {
    const entity = fixtureEntity(id, photos);
    const seed = await writeSeed([entity]);
    // Reproduce a pre-policy approved database plus its already-loaded seed hash, without using today's admission guard.
    await db.query(
      `insert into archive_entities (id, domain, category, subcategory, name, kind, price_model, typical, tier, origin, status)
       values ($1, 'Travel', 'Fixture', 'Fixture', $2, 'place', 'trip', $3::jsonb, 1, 'seed', 'live')`,
      [entity.id, entity.name, JSON.stringify(entity.typical)],
    );
    for (const p of photos) {
      await db.query(
        `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, hero, status, contributed_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', 'seed')`,
        [entity.id, p.url, p.width, p.height, p.source, p.sourcePage, p.photographer, p.license, p.hero],
      );
    }
    const version = createHash("sha256").update(seed.raw).digest("hex").slice(0, 16);
    await db.query("insert into archive_seed_runs (version, entities, photos) values ($1, 1, $2)", [version, photos.length]);
    expect(await loadSeed(db, seed.path)).toBeNull();
    expect(await storedPhotos(entity.id)).toHaveLength(photos.length);
    return entity;
  }

  async function observe(entity: SeedEntity) {
    // Fresh readers test publication policy, not immediate invalidation of a previously populated TTL cache.
    const hit = await pgArchive(db, now).lookup(entity.name, "place");
    const items = await poolSource(db, now)();
    return { hit, card: items.find((item) => item.id === `${ARCHIVE_PREFIX}${entity.id}`) };
  }

  it("withholds a legacy unsafe hero even when unchanged seed bytes skip re-admission", async () => {
    const entity = await legacySeed("unsafe", [unsplash(SELF_HOSTED, { hero: true }), commons("safe-gallery")]);
    const before = await storedPhotos(entity.id);
    const result = await observe(entity);
    expect(result.hit).toBeNull();
    expect(result.card).toBeUndefined();
    expect(await storedPhotos(entity.id)).toEqual(before);
  });

  it("serves the exact valid hero and safe gallery but leaves an unsafe legacy gallery stored and unpublished", async () => {
    const hero = unsplash(HOTLINK, { hero: true });
    const gallery = commons("legacy-gallery");
    const entity = await legacySeed("gallery", [hero, unsplash(SELF_HOSTED), gallery]);
    const before = await storedPhotos(entity.id);
    const result = await observe(entity);
    expect(result.hit?.photos).toEqual([hero, gallery]);
    expect(result.card?.media?.images.map((p) => p.url)).toEqual([HOTLINK, gallery.url]);
    expect(await storedPhotos(entity.id)).toEqual(before);
  });

  it("withholds originally ambiguous legacy heroes in both readers rather than silently resolving them", async () => {
    const entity = await legacySeed("ambiguous", [unsplash(SELF_HOSTED, { hero: true }), commons("second-hero", { hero: true })]);
    const before = await storedPhotos(entity.id);
    const result = await observe(entity);
    expect(result.hit).toBeNull();
    expect(result.card).toBeUndefined();
    expect(await storedPhotos(entity.id)).toEqual(before);
  });

  it("carries each Commons File page through real archive and pool reads without repairing legacy rows", async () => {
    const hero = commons("source-page", { hero: true, url: SELF_HOSTED, sourcePage: "https://commons.wikimedia.org/wiki/File%3AFixture_%28Harbor%29.jpg" });
    const badPage = commons("bad-page", { sourcePage: "https://evil.example/wiki/File:Fixture.jpg" });
    const wrongProvider = unsplash(HOTLINK, { sourcePage: hero.sourcePage });
    const entity = await legacySeed("provenance", [hero, badPage, wrongProvider]);
    const before = await storedPhotos(entity.id);
    const result = await observe(entity);
    expect(result.hit?.photos[0]).toMatchObject({ url: SELF_HOSTED, hero: true, sourcePage: hero.sourcePage });
    const archiveImages = result.hit!.photos.map(toMediaImage);
    expect(archiveImages[0]).toMatchObject({ sourcePage: hero.sourcePage, source: "commons.wikimedia.org", credit: hero.photographer, license: hero.license });
    expect(result.card!.media!.images[0]).toMatchObject({ url: SELF_HOSTED, sourcePage: hero.sourcePage, credit: hero.photographer, license: hero.license });
    for (const images of [archiveImages, result.card!.media!.images]) {
      expect(images).toHaveLength(3);
      expect(images.find((p) => p.url === badPage.url)).not.toHaveProperty("sourcePage");
      expect(images.find((p) => p.url === HOTLINK)).not.toHaveProperty("sourcePage");
      expect(images.every((p) => !("page" in p))).toBe(true);
    }
    // Invalid links are omitted from transport, not rewritten in stored provenance or photo approvals.
    expect(await storedPhotos(entity.id)).toEqual(before);
  });

  it("applies the provider rule to a fresh seed load as well as to legacy reads", async () => {
    const hero = unsplash(HOTLINK, { hero: true });
    const entity = fixtureEntity("fresh", [hero, unsplash(SELF_HOSTED)]);
    const seed = await writeSeed([entity]);
    expect(await loadSeed(db, seed.path)).toMatchObject({ entities: 1, photos: 1 });
    expect((await storedPhotos(entity.id)).map((p) => p.url)).toEqual([HOTLINK]);
    const result = await observe(entity);
    expect(result.hit?.photos).toEqual([hero]);
    expect(result.card?.media?.images.map((p) => p.url)).toEqual([HOTLINK]);
  });

  it("keeps current Commons seed photos eligible and an actual seed hero available through both consumers", async () => {
    const seed = JSON.parse(await readFile(new URL("../data/archive-seed.json", import.meta.url), "utf8")) as { entities: SeedEntity[] };
    const commonsSets = seed.entities.filter((e) => e.photos?.length && e.photos.every((p) => p.source === "commons"));
    expect(commonsSets.length).toBeGreaterThan(0);
    for (const entity of commonsSets) {
      const photos = entity.photos!;
      for (const p of photos) expect(admissible(p)).toBe(true);
      expect(selectDeliverablePhotos(photos)).toHaveLength(photos.length);
    }
    // One real fixture traverses migrations, seed loading, archive lookup and the pool query; the loop above covers every current Commons set.
    const entity = commonsSets.find((e) => e.kind === "place" && e.priceModel === "trip" && !/[()]/.test(e.name)
      && typicalOf({ kind: e.kind, price_model: e.priceModel, domain: e.domain, typical: e.typical as ArchiveRow["typical"] }))!;
    expect(entity).toBeDefined();
    const file = await writeSeed([entity]);
    expect(await loadSeed(db, file.path)).toMatchObject({ entities: 1, photos: entity.photos!.length });
    const result = await observe(entity);
    const hero = entity.photos!.find((p) => p.hero)!;
    expect(result.hit?.entity.id).toBe(entity.id);
    expect(result.hit?.photos[0]).toMatchObject({ url: hero.url, hero: true, photographer: hero.photographer, license: hero.license, sourcePage: hero.sourcePage });
    expect(result.card?.media?.images[0]?.url).toBe(hero.url);
    expect((await storedPhotos(entity.id)).every((p) => p.status === "approved")).toBe(true);
  });
});

