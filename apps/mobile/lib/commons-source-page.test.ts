import { describe, expect, it } from "vitest";
import { safeCommonsSourcePage } from "@dandelist/catalogue";

describe("Commons file-description links", () => {
  it.each([
    "https://commons.wikimedia.org/wiki/File:Prague_castle.jpg",
    "https://commons.wikimedia.org/wiki/File%3APrague%20castle.jpg",
    "https://commons.wikimedia.org/wiki/File%3A%E6%9D%B1%E4%BA%AC_%28night%29.jpg",
    "https://commons.wikimedia.org:443/wiki/File:Harbour_%26_bridge.jpg",
  ])("retains an existing valid page exactly: %s", (sourcePage) => {
    for (const source of ["commons", "commons.wikimedia.org", " COMMONS "]) {
      expect(safeCommonsSourcePage({ source, sourcePage })).toBe(sourcePage);
    }
  });

  it.each([
    "http://commons.wikimedia.org/wiki/File:Photo.jpg",
    "javascript:alert(1)",
    "//commons.wikimedia.org/wiki/File:Photo.jpg",
    "https:/commons.wikimedia.org/wiki/File:Photo.jpg",
    "https:commons.wikimedia.org/wiki/File:Photo.jpg",
    "https://@commons.wikimedia.org/wiki/File:Photo.jpg",
    "https://commons.wikimedia.org.evil.example/wiki/File:Photo.jpg",
    "https://commons.wikimedia.org@evil.example/wiki/File:Photo.jpg",
    "https://user:password@commons.wikimedia.org/wiki/File:Photo.jpg",
    "https://commons.wikimedia.org:444/wiki/File:Photo.jpg",
    "https://commons.wikimedia.org/wiki/Special:Redirect/file/Photo.jpg",
    "https://commons.wikimedia.org/wiki/User:Photographer",
    "https://commons.wikimedia.org/wiki/File:",
    "https://commons.wikimedia.org/wiki/File:%20%20",
    "https://commons.wikimedia.org/wiki/File:Photo.jpg?redirect=https://evil.example",
    "https://commons.wikimedia.org/wiki/File:Photo.jpg?",
    "https://commons.wikimedia.org/wiki/File:Photo.jpg#other",
    "https://commons.wikimedia.org/wiki/File:Photo.jpg#",
    "https://commons.wikimedia.org/wiki/File:%GG.jpg",
    "https://commons.wikimedia.org/wiki/File:%E0%A4%A.jpg",
    "https://commons.wikimedia.org/wiki/File:Photo%00.jpg",
    "https://commons.wikimedia.org/wiki/File:Photo%0A.jpg",
    "https://commons.wikimedia.org/wiki/File:Photo%5C.jpg",
    "https://commons.wikimedia.org/wiki/File:Photo\\.jpg",
    "https://commons.wikimedia.org/wiki/File:Photo name.jpg",
    " https://commons.wikimedia.org/wiki/File:Photo.jpg",
    "https://commons.wikimedia.org/wiki/File:" + "a".repeat(2048),
  ])("does not expose an unsafe or unsupported destination: %s", (sourcePage) => {
    expect(safeCommonsSourcePage({ source: "commons", sourcePage })).toBeUndefined();
  });

  it("requires matching provider metadata and keeps missing legacy metadata optional", () => {
    const sourcePage = "https://commons.wikimedia.org/wiki/File:Photo.jpg";
    for (const source of ["unsplash", "unsplash.com", "pexels", "example.com", ""]) {
      expect(safeCommonsSourcePage({ source, sourcePage })).toBeUndefined();
    }
    expect(safeCommonsSourcePage({ source: "commons" })).toBeUndefined();
    expect(safeCommonsSourcePage({ source: "commons", sourcePage: null })).toBeUndefined();
    expect(safeCommonsSourcePage(null)).toBeUndefined();
    expect(safeCommonsSourcePage(undefined)).toBeUndefined();
  });
});
