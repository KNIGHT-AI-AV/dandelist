import { describe, expect, it } from "vitest";
import { MAX_OWN, addOwn } from "./own";

const features = [
  { id: "pool", label: "Pool" },
  { id: "sea-view", label: "Sea view" },
];

describe("a typed entry in a builder section (owner, 2026-10-29)", () => {
  it("joins the section, tidied and capped at 40 characters", () => {
    expect(addOwn("  wine   cellar ", features, [])).toEqual({ own: ["wine cellar"] });
    expect(addOwn("x".repeat(60), features, []).own[0]).toHaveLength(40);
  });

  it("picks the offered choice it names instead of adding a copy", () => {
    expect(addOwn("sea VIEW", features, [])).toEqual({ own: [], pick: "sea-view" });
    expect(addOwn("pool", features, ["wine cellar"])).toEqual({ own: ["wine cellar"], pick: "pool" });
  });

  it("ignores blanks, repeats and a full section", () => {
    expect(addOwn("   ", features, ["gym"])).toEqual({ own: ["gym"] });
    expect(addOwn("GYM", features, ["gym"])).toEqual({ own: ["gym"] });
    const full = Array.from({ length: MAX_OWN }, (_, i) => `thing ${i}`);
    expect(addOwn("one more", features, full)).toEqual({ own: full });
  });
});
