import { describe, expect, it } from "vitest";
import { SPREAD_PAGE_MIN, spreadOf } from "./spread";

describe("two pages side by side (owner, 2026-10-31: the iPhone Duo)", () => {
  it("opens the Duo's inner screen into a spread, each side about the outer screen's width", () => {
    expect(spreadOf(951, 669, true)).toBe(2);
    expect(951 / 2).toBeGreaterThanOrEqual(SPREAD_PAGE_MIN);
    // A tablet turned sideways, and a big phone held sideways.
    expect(spreadOf(1180, 820, true)).toBe(2);
    expect(spreadOf(932, 430, true)).toBe(2);
  });

  it("keeps one page on the outer screen, in Split View, turned upright and on phones", () => {
    expect(spreadOf(466, 678, true)).toBe(1);
    expect(spreadOf(678, 466, true)).toBe(1);
    expect(spreadOf(385, 669, true)).toBe(1);
    expect(spreadOf(669, 951, true)).toBe(1);
    expect(spreadOf(393, 852, true)).toBe(1);
    expect(spreadOf(820, 1180, true)).toBe(1);
    // Held upright, even with room for two: a 13-inch iPad.
    expect(spreadOf(1032, 1376, true)).toBe(1);
  });

  it("keeps one page in a desktop browser, however wide", () => {
    expect(spreadOf(1440, 900, false)).toBe(1);
    expect(spreadOf(951, 669, false)).toBe(1);
  });

  it("needs room for two phone-width pages", () => {
    expect(spreadOf(2 * SPREAD_PAGE_MIN, 600, true)).toBe(2);
    expect(spreadOf(2 * SPREAD_PAGE_MIN - 1, 600, true)).toBe(1);
  });
});
