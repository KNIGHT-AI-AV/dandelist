import { describe, expect, it } from "vitest";
import { SCALE, offScale } from "./check-space.mjs";

describe("the spacing guard", () => {
  it("passes every step of the scale and catches anything between", () => {
    expect(offScale("{ padding: 20, gap: 12, marginTop: -8, paddingHorizontal: 0 }")).toEqual([]);
    expect(offScale("{ gap: 10 }")).toHaveLength(1);
    expect(offScale("{ padding: 18, marginLeft: 29 }")).toHaveLength(1);
    expect(offScale("<View style={{ paddingVertical: 14 }} />\n<View style={{ columnGap: 22 }} />")).toEqual([
      "1: <View style={{ paddingVertical: 14 }} />",
      "2: <View style={{ columnGap: 22 }} />",
    ]);
  });

  it("leaves values computed from tokens or measurements alone", () => {
    expect(offScale("{ padding: layout.cardPad, gap: space[12], marginTop: -TITLE_OVER, paddingBottom: insets.bottom + 40 }")).toEqual([]);
    expect(offScale("{ marginLeft: 17 + 12 }")).toEqual([]);
  });

  it("is the scale lib/palette.ts sets", () => {
    expect([...SCALE]).toEqual([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80]);
  });
});
