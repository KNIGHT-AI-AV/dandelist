import { describe, expect, it } from "vitest";
import { entries, heroFor, heroImageFor, UNSPLASH_HOME } from "@dandelist/catalogue";

const fromUnsplash = entries.flatMap((e) => (e.media?.images ?? []).filter((i) => /unsplash/i.test(i.source)).map((i) => ({ e, i })));
const UTM = "utm_source=dandelist&utm_medium=referral";

describe("Unsplash photos come from Unsplash (owner, 2026-10-30: 'Keep the hotlink rule')", () => {
  it("covers every Unsplash photo in the catalogue", () => {
    expect(fromUnsplash).toHaveLength(31);
  });

  it("serves each one, and every smaller copy, from Unsplash's API links, never our own host", () => {
    for (const { e, i } of fromUnsplash) {
      for (const url of [i.url, ...(i.variants ?? []).map((v) => v.url)]) {
        expect(url, e.id).toMatch(/^https:\/\/images\.unsplash\.com\//);
        expect(new URL(url).searchParams.get("ixid"), e.id).toBeTruthy();
      }
    }
  });

  it("never points an entry's imageUrl at our own copy of an Unsplash photo", () => {
    for (const e of entries) {
      if (!e.imageUrl?.includes("/media/")) continue;
      const own = (e.media?.images ?? []).find((i) => i.url === e.imageUrl);
      expect(own && !/unsplash/i.test(own.source), e.id).toBe(true);
    }
  });

  it("credits the photographer with a tagged link, and records the download Unsplash asks for", () => {
    for (const { e, i } of fromUnsplash) {
      expect(i.author?.name, e.id).toBeTruthy();
      expect(i.author?.url, e.id).toMatch(/^https:\/\/unsplash\.com\/@/);
      expect(i.author?.url, e.id).toContain(UTM);
      expect(i.page, e.id).toContain(UTM);
      expect(i.unsplash?.tracked, e.id).toBeTruthy();
    }
    expect(UNSPLASH_HOME).toContain(UTM);
  });

  it("credits the very photo a frame shows", () => {
    for (const e of entries) {
      for (const aspect of [0.46, 0.7, 1, 2.6]) {
        const shown = heroImageFor(e, aspect);
        if (shown) expect(heroFor(e, aspect), `${e.id} at ${aspect}`).toBe(shown.url);
      }
    }
  });
});
