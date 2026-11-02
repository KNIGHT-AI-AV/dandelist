import { describe, expect, it } from "vitest";
import { space } from "../lib/palette";
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
    expect(offScale("{ padding: 1.5 * size, margin: 3.5 * size, gap: size / 2 }")).toEqual([]);
    expect(offScale("{ paddingBottom: Math.max(insets.bottom, 10) }")).toEqual([]);
  });

  it("reads each branch of a choice and a fallback, but not what a choice compares", () => {
    expect(offScale("{ padding: compact ? 10 : 16 }")).toHaveLength(1);
    expect(offScale("{ padding: compact ? 12 : 14 }")).toHaveLength(1);
    expect(offScale("{ gap: x ?? 10 }")).toHaveLength(1);
    expect(offScale("{ gap: i > 3 ? 8 : 12, marginTop: n === 1 ? 0 : 4 }")).toEqual([]);
  });

  it("reads a value before a comment, and the comment as a comment", () => {
    expect(offScale("  gap: 10 // why")).toHaveLength(1);
    expect(offScale("  gap: 12 // twice 6, see /docs")).toEqual([]);
    expect(offScale("  gap: 12 /* 10 was too tight */")).toEqual([]);
  });

  it("reads defaults, props and the logical sides too", () => {
    expect(offScale("function Pips({ size = 6, gap = 3 }) {")).toHaveLength(1);
    expect(offScale("<Row gap={10} />")).toHaveLength(1);
    expect(offScale("<Row gap={12} padding={space[16]} />")).toEqual([]);
    expect(offScale("if (gap === 3) return;")).toEqual([]);
    expect(offScale("{ paddingBlock: 10 }")).toHaveLength(1);
    expect(offScale("{ marginInlineStart: 6, paddingInline: 16 }")).toHaveLength(1);
  });

  it("is the scale lib/palette.ts sets", () => {
    expect([...SCALE]).toEqual(Object.values(space));
  });
});
