import { describe, expect, it } from "vitest";
import { aspectOf, containRect, pageAt, photoCredit, realPhotos, showsGallery, trimBottom } from "./gallery";

const photo = (url: string, extra: object = {}) => ({ url, source: "commons.wikimedia.org", ...extra });

describe("realPhotos and showsGallery", () => {
  it("keeps real web photos once each, in order", () => {
    const images = [photo("https://a.example/1.jpg"), photo("https://a.example/2.jpg", { generated: true }), photo("javascript:alert(1)"), photo("https://a.example/1.jpg"), photo("https://a.example/3.jpg")];
    expect(realPhotos({ images }).map((i) => i.url)).toEqual(["https://a.example/1.jpg", "https://a.example/3.jpg"]);
    expect(realPhotos(undefined)).toEqual([]);
  });

  it("pages only with two or more real photos and no 3D model", () => {
    const two = { kind: "place" as const, images: [photo("https://a.example/1.jpg"), photo("https://a.example/2.jpg")] };
    expect(showsGallery(two)).toBe(true);
    expect(showsGallery({ ...two, images: two.images.slice(0, 1) })).toBe(false);
    expect(showsGallery({ ...two, model3d: { provider: "sketchfab", uid: "x", name: "Car", author: "A", license: "CC BY", embedUrl: "https://sketchfab.com/x", thumbnail: "https://a.example/t.jpg" } })).toBe(false);
    expect(showsGallery(undefined)).toBe(false);
  });
});

describe("photoCredit", () => {
  it("credits author, licence and source, skipping blanks", () => {
    expect(photoCredit(photo("https://a.example/1.jpg", { credit: "Jane Doe", license: "CC BY-SA 4.0" }))).toBe("Jane Doe · CC BY-SA 4.0 · commons.wikimedia.org");
    expect(photoCredit({ url: "https://a.example/1.jpg", source: "leica-camera.com" })).toBe("leica-camera.com");
  });
});

describe("geometry", () => {
  const area = { x: 0, y: 100, width: 400, height: 600 };

  it("contains a landscape photo by width and a portrait one by height, centred", () => {
    expect(containRect(2, area)).toEqual({ x: 0, y: 300, width: 400, height: 200 });
    expect(containRect(0.5, area)).toEqual({ x: 50, y: 100, width: 300, height: 600 });
    expect(containRect(undefined, area)).toEqual(area);
  });

  it("reads aspect only from a full size", () => {
    expect(aspectOf({ width: 3000, height: 2000 })).toBe(1.5);
    expect(aspectOf({ width: 3000 })).toBeUndefined();
  });

  it("trims the bottom unless nothing would be left", () => {
    expect(trimBottom({ x: 0, y: -40, width: 390, height: 470 }, 150)).toEqual({ x: 0, y: -40, width: 390, height: 320 });
    expect(trimBottom({ x: 0, y: 0, width: 390, height: 100 }, 150)).toEqual({ x: 0, y: 0, width: 390, height: 100 });
  });

  it("finds the resting page, clamped", () => {
    expect(pageAt(0, 390, 4)).toBe(0);
    expect(pageAt(600, 390, 4)).toBe(2);
    expect(pageAt(5000, 390, 4)).toBe(3);
    expect(pageAt(-30, 390, 4)).toBe(0);
    expect(pageAt(100, 0, 4)).toBe(0);
  });
});
