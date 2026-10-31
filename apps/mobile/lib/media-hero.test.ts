import type { Model3d } from "../components/media";
import { describe, expect, it } from "vitest";
import { realPhotos, showsGallery } from "./gallery";
import { selectMediaHero } from "./media-hero";
import { photoCreditContent } from "./photo-credit";

const original = {
  url: "https://images.example/original.jpg",
  source: "commons.wikimedia.org",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Original_fixture.jpg",
  credit: "Original photographer",
  license: "CC BY-SA 4.0",
};
const decoy = { ...original, url: "https://images.example/generated.jpg", credit: "Unrelated decoy", generated: true };
const cutout = { url: "https://images.example/cutout.png", from: original.url, width: 800, height: 600, model: "sam-3.1" as const };
const model: Model3d = { provider: "sketchfab", uid: "fixture", name: "Model", author: "Model maker", license: "CC BY", embedUrl: "https://sketchfab.com/models/fixture/embed", thumbnail: original.url };

describe("the rendered media and its original", () => {
  it("keeps a model ahead of a place's slideshow and cutout metadata", () => {
    expect(selectMediaHero({ kind: "place", images: [decoy, original], cutout, model3d: model })).toEqual({ kind: "model", model });
  });

  it.each(["place", "experience"] as const)("keeps the %s slideshow ahead of cutout metadata even with only one real photo", (kind) => {
    const media = { kind, images: [decoy, original], cutout };
    expect(realPhotos(media)).toEqual([original]);
    expect(showsGallery(media)).toBe(false);
    expect(selectMediaHero(media)).toEqual({ kind: "slideshow", images: media.images });
  });

  it("uses the exact cutout original instead of a generated first image, retaining its source and licence", () => {
    const media = { kind: "product" as const, images: [decoy, original], cutout };
    expect(showsGallery(media)).toBe(false);
    const selected = selectMediaHero(media);
    expect(selected.kind).toBe("cutout");
    if (selected.kind !== "cutout") throw new Error("Expected the product cutout");
    expect(selected.cutout).toBe(cutout);
    expect(selected.original).toBe(original);
    expect(photoCreditContent(selected.original)).toEqual({ kind: "commons", text: "Original photographer · CC BY-SA 4.0", url: original.sourcePage });
  });

  it("preserves the detail gallery override when there are two real photos, even with a cutout", () => {
    const second = { ...original, url: "https://images.example/second.jpg" };
    const media = { kind: "product" as const, images: [original, second], cutout };
    expect(showsGallery(media)).toBe(true);
    expect(realPhotos(media)).toEqual([original, second]);
    // MediaHero would choose the cutout; detail must keep its existing gallery branch ahead of MediaHero.
    expect(selectMediaHero(media).kind).toBe("cutout");
  });

  it.each(["", "https://images.example/missing.jpg"])("never borrows the first photo's credit for an unmatched original (%s)", (from) => {
    const selected = selectMediaHero({ kind: "product", images: [original], cutout: { ...cutout, from } });
    expect(selected.kind).toBe("cutout");
    if (selected.kind !== "cutout") throw new Error("Expected the product cutout");
    expect(selected.original).toBeUndefined();
    expect(photoCreditContent(selected.original)).toBeUndefined();
  });

  it("retains the generated marker on a matched original without manufacturing photo attribution", () => {
    const selected = selectMediaHero({ kind: "product", images: [original, decoy], cutout: { ...cutout, from: decoy.url } });
    expect(selected.kind).toBe("cutout");
    if (selected.kind !== "cutout") throw new Error("Expected the product cutout");
    expect(selected.original).toBe(decoy);
    expect(photoCreditContent(selected.original)).toBeUndefined();
  });

  it("retains the first single photo and the empty fallback path", () => {
    expect(selectMediaHero({ kind: "place", images: [original] })).toEqual({ kind: "photo", image: original });
    expect(selectMediaHero(undefined)).toEqual({ kind: "photo", image: undefined });
  });
});
