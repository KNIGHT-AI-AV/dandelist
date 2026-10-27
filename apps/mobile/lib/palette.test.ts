import { describe, expect, it } from "vitest";
import { THEMES, THEME_ORDER, contrast, scaleType, type } from "./palette";

describe("contrast in every theme (UI audit P0-6)", () => {
  for (const id of THEME_ORDER) {
    const p = THEMES[id].palette;
    it(`${id}: text tokens clear 4.5:1 and borders 3:1`, () => {
      expect(contrast(p.ink, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink2, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink3, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accentText, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.danger, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.line, p.bg)).toBeGreaterThanOrEqual(3);
    });
    it(`${id}: accent italics stand apart from the ink`, () => {
      expect(contrast(p.accentText, p.ink)).toBeGreaterThanOrEqual(1.6);
    });
  }
});

describe("type roles (UI audit §3.2)", () => {
  it("never go under 11 px", () => {
    for (const r of Object.values(type)) expect(r.fontSize).toBeGreaterThanOrEqual(11);
  });
  it("keep the phone sizes at 390 wide and follow the web clamps", () => {
    expect(scaleType(390, false).hero.fontSize).toBe(56);
    expect(scaleType(320, false).hero.fontSize).toBe(Math.round(56 * 0.92));
    expect(scaleType(1280, true).hero.fontSize).toBe(80);
    expect(scaleType(1280, true).title1.fontSize).toBe(48);
    expect(scaleType(390, true).display.fontSize).toBe(Math.round(Math.max(44, 2.4 * 3.9 + 35)));
  });
});
