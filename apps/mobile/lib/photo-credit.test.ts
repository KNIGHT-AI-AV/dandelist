import { heroImageFor, type MediaImage } from "@dandelist/catalogue";
import { describe, expect, it } from "vitest";
import { cutoutSourceImage, photoCreditContent } from "./photo-credit";

const portrait: MediaImage = {
  url: "https://images.example/portrait.jpg",
  width: 2400,
  height: 3600,
  source: "commons.wikimedia.org",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Portrait_fixture.jpg",
  credit: "Portrait photographer",
  license: "CC BY-SA 4.0",
};
const landscape: MediaImage = {
  ...portrait,
  url: "https://images.example/landscape.jpg",
  width: 4000,
  height: 2000,
  sourcePage: "https://commons.wikimedia.org/wiki/File%3ALandscape_fixture.jpg",
  credit: "Landscape photographer",
};

describe("photo credit presentation", () => {
  it("links the Commons File page while retaining the exact photographer and licence text", () => {
    expect(photoCreditContent(portrait)).toEqual({
      kind: "commons",
      text: "Portrait photographer · CC BY-SA 4.0",
      url: portrait.sourcePage,
    });
    expect(photoCreditContent({ ...portrait, source: "commons" })).toEqual(photoCreditContent(portrait));
  });

  it("uses each displayed image's metadata instead of the card's original hero credit", () => {
    const entry = { media: { kind: "place" as const, images: [portrait, landscape] } };
    const tall = heroImageFor(entry, 2 / 3);
    const wide = heroImageFor(entry, 2);
    expect(tall).toBe(portrait);
    expect(wide).toBe(landscape);
    expect(photoCreditContent(tall, "An unrelated card credit")).toMatchObject({ kind: "commons", url: portrait.sourcePage, text: "Portrait photographer · CC BY-SA 4.0" });
    expect(photoCreditContent(wide, "An unrelated card credit")).toMatchObject({ kind: "commons", url: landscape.sourcePage, text: "Landscape photographer · CC BY-SA 4.0" });
    // Slideshow captions receive the current image by the same path, not the first frame.
    expect([portrait, landscape].map((image) => photoCreditContent(image))).toEqual([
      { kind: "commons", text: "Portrait photographer · CC BY-SA 4.0", url: portrait.sourcePage },
      { kind: "commons", text: "Landscape photographer · CC BY-SA 4.0", url: landscape.sourcePage },
    ]);
  });

  it("retains plain credit when the page is missing, invalid or belongs to a different provider", () => {
    for (const sourcePage of [undefined, "javascript:alert(1)", "https://evil.example/wiki/File:Photo.jpg"]) {
      expect(photoCreditContent({ ...portrait, sourcePage })).toEqual({ kind: "plain", text: "Portrait photographer · CC BY-SA 4.0 · commons.wikimedia.org" });
    }
    expect(photoCreditContent({ ...portrait, source: "pexels.com" })).toEqual({ kind: "plain", text: "Portrait photographer · CC BY-SA 4.0 · pexels.com" });
  });

  it("uses the existing card credit only when the selected image has no usable attribution", () => {
    expect(photoCreditContent(undefined, "Card credit")).toEqual({ kind: "plain", text: "Card credit" });
    expect(photoCreditContent({ source: "example.com" }, "Card credit")).toEqual({ kind: "plain", text: "Card credit" });
    expect(photoCreditContent({ source: "example.com", credit: "Shown photo" }, "Other photo")).toEqual({ kind: "plain", text: "Shown photo · example.com" });
    expect(photoCreditContent({ source: "example.com" })).toEqual({ kind: "plain", text: "example.com" });
  });

  it("keeps validated Unsplash authors and their exact tagged links ahead of all fallbacks", () => {
    const author = { name: " noir. ", url: "https://unsplash.com/@noirmedia?utm_source=dandelist&utm_medium=referral" };
    expect(photoCreditContent({ source: "unsplash.com", author, credit: "Legacy credit" }, "Card credit")).toEqual({ kind: "unsplash", author: { ...author, name: "noir." } });
    expect(photoCreditContent({ source: "unsplash.com", author: { ...author, url: "https://evil.example/author" }, credit: "Legacy credit" })).toEqual({ kind: "plain", text: "Legacy credit · unsplash.com" });
  });

  it("does not manufacture attribution for generated or absent images", () => {
    expect(photoCreditContent({ ...portrait, generated: true }, "Card credit")).toBeUndefined();
    expect(photoCreditContent(undefined)).toBeUndefined();
    expect(photoCreditContent({})).toBeUndefined();
  });
});

describe("cutout attribution", () => {
  it("follows cutout.from even when its source is not the first image", () => {
    const selected = cutoutSourceImage([portrait, landscape], landscape.url);
    expect(selected).toBe(landscape);
    expect(photoCreditContent(selected)).toMatchObject({ kind: "commons", url: landscape.sourcePage, text: "Landscape photographer · CC BY-SA 4.0" });
  });

  it("does not borrow the first image's credit when the recorded original is absent", () => {
    expect(cutoutSourceImage([portrait], landscape.url)).toBeUndefined();
    expect(cutoutSourceImage([portrait], undefined)).toBeUndefined();
    expect(photoCreditContent(cutoutSourceImage([portrait], landscape.url))).toBeUndefined();
  });
});
