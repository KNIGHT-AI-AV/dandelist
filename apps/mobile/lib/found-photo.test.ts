import { describe, expect, it } from "vitest";
import { foundPhoto } from "./found-photo";

// Owner, 2026-11-02: "revisions should have a picture. Amendments should have a picture".
describe("the picture beside a look's result", () => {
  const saved = "https://x/saved.jpg";

  it("shows an amendment's own checked photo, never the old one", () => {
    expect(foundPhoto({ kind: "amended", option: { imageUrl: "https://x/new.jpg" } }, saved)).toBe("https://x/new.jpg");
    expect(foundPhoto({ kind: "amended", option: {} }, saved)).toBeNull();
  });

  it("shows a new or unchanged price with its find's photo, or else the saved one", () => {
    expect(foundPhoto({ kind: "changed", option: { imageUrl: "https://x/new.jpg" } }, saved)).toBe("https://x/new.jpg");
    expect(foundPhoto({ kind: "changed", option: {} }, saved)).toBe(saved);
    expect(foundPhoto({ kind: "same", option: {} }, saved)).toBe(saved);
    expect(foundPhoto({ kind: "same", option: {} }, null)).toBeNull();
  });

  it("shows nothing while looking or after a failed look", () => {
    expect(foundPhoto({ kind: "running" }, saved)).toBeNull();
    expect(foundPhoto({ kind: "failed" }, saved)).toBeNull();
  });
});
