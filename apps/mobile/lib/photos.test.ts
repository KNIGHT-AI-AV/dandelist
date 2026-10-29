import { describe, expect, it } from "vitest";
import { shownPhotos, withNewPhoto } from "./photos";

const img = (url: string) => ({ url, source: "example.com" });

describe("a retake's photo on a wish (owner, 2026-10-29)", () => {
  it("puts the new photo first, keeps the others once, and drops what was made from the old photo", () => {
    const old = { kind: "product" as const, images: [img("a.jpg"), img("b.jpg")], cutout: { url: "cut.png", width: 1, height: 1, from: "a.jpg", model: "sam-3.1" as const } };
    const media = withNewPhoto(old as never, { imageUrl: "n.jpg", media: { kind: "product", images: [img("n.jpg")] } });
    expect(media.images.map((i) => i.url)).toEqual(["n.jpg", "a.jpg", "b.jpg"]);
    expect("cutout" in media).toBe(false);
    expect(withNewPhoto(undefined, { imageUrl: "n.jpg", media: { kind: "place", images: [img("n.jpg")] } })).toEqual({ kind: "place", images: [img("n.jpg")] });
  });

  it("lists every photo a wish has shown, once", () => {
    expect(shownPhotos({ imageUrl: "a.jpg", media: { kind: "product", images: [img("a.jpg"), img("b.jpg")] } })).toEqual(["a.jpg", "b.jpg"]);
    expect(shownPhotos(undefined)).toEqual([]);
  });
});
