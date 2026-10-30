import { describe, expect, it } from "vitest";
import { entry, heroFor, sizedFor, type Entry, type MediaImage } from "@dandelist/catalogue";

const photo: MediaImage = {
  url: "https://media.example/full.jpg",
  width: 1800,
  height: 2520,
  source: "unsplash.com",
  variants: [
    { width: 800, height: 1120, url: "https://media.example/800.jpg" },
    { width: 1200, height: 1680, url: "https://media.example/1200.jpg" },
    { width: 1600, height: 2240, url: "https://media.example/1600.jpg" },
  ],
};

describe("a photo sized for the screen (Lighthouse, 2026-10-30: the title photo was 924 KB on a phone)", () => {
  it("sends the smallest copy that is at least as wide as needed, else the widest", () => {
    expect(sizedFor(photo, 700)).toBe("https://media.example/800.jpg");
    expect(sizedFor(photo, 800)).toBe("https://media.example/800.jpg");
    expect(sizedFor(photo, 1029)).toBe("https://media.example/1200.jpg");
    expect(sizedFor(photo, 1700)).toBe("https://media.example/full.jpg");
    expect(sizedFor(photo, 4000)).toBe("https://media.example/full.jpg");
  });

  it("sends the photo itself when nothing is asked for or it has no copies", () => {
    expect(sizedFor(photo)).toBe("https://media.example/full.jpg");
    expect(sizedFor(photo, 0)).toBe("https://media.example/full.jpg");
    expect(sizedFor({ ...photo, variants: undefined }, 700)).toBe("https://media.example/full.jpg");
  });

  it("covers a tall phone with the portrait crop by its height", () => {
    const e = { media: { kind: "vehicle", images: [{ ...photo }] } } as Pick<Entry, "media">;
    // 412 x 823 points at 1.75 pixels a point: covering by height needs 823 x 1.75 x 1800 / 2520 = 1029 pixels across.
    expect(heroFor(e, 412 / 823, { width: 412 * 1.75, height: 823 * 1.75 })).toBe("https://media.example/1200.jpg");
    // An older caller that passes no frame keeps the full photo.
    expect(heroFor(e, 412 / 823)).toBe("https://media.example/full.jpg");
  });

  it("finds the copies the title photo now has in the catalogue", () => {
    const hero = entry("porsche-911") as Entry;
    const url = heroFor(hero, 390 / 844, { width: 390 * 2.5, height: 844 * 2.5 });
    const portrait = hero.media!.images.find((i) => i.height! > i.width!)!;
    expect(portrait.variants?.map((v) => v.width)).toEqual([800, 1200, 1600]);
    expect(url).toBe(portrait.variants!.find((v) => v.width === 1600)!.url);
  });
});
