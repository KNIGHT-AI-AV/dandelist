import { describe, expect, it } from "vitest";
import { cardRanges, geometry, sample } from "./card-metrics";

const g = geometry(393);
const LIST_TOP = 420;
const FOCUS = 400;
const N = 8;

/** Where every card is drawn at a scroll offset: top and bottom, in list coordinates. */
function layout(scroll: number) {
  return Array.from({ length: N }, (_, i) => {
    const r = cardRanges(i, g, LIST_TOP, FOCUS);
    const top = i * (g.rest + g.gap) + (r.push ? sample(r.push, scroll) : 0);
    return { top, bottom: top + g.rest + g.grow * sample(r.open, scroll), open: sample(r.open, scroll) };
  });
}

describe("the growing cards", () => {
  it("sizes cards for a phone", () => {
    expect(g.rest).toBe(220);
    expect(g.grow).toBe(110);
  });

  it("keeps the same gap between neighbours at every scroll position", () => {
    for (let scroll = -200; scroll < 2600; scroll += 7) {
      const cards = layout(scroll);
      for (let i = 1; i < N; i++) expect(cards[i]!.top - cards[i - 1]!.bottom).toBeCloseTo(g.gap, 6);
    }
  });

  it("opens one card at a time, two while handing over, never more than one card's worth", () => {
    for (let scroll = 0; scroll < 2000; scroll += 11) {
      const opening = layout(scroll).map((c) => c.open);
      expect(opening.filter((o) => o > 0).length).toBeLessThanOrEqual(2);
      expect(opening.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("opens a card fully when its centre is on the focus line", () => {
    const pitch = g.rest + g.gap;
    const scroll = LIST_TOP + 3 * pitch + g.rest / 2 - FOCUS;
    const cards = layout(scroll);
    expect(cards[3]!.open).toBeCloseTo(1, 6);
    expect(cards[3]!.top).toBeCloseTo(3 * pitch, 6);
  });

  it("never moves the first card", () => {
    for (let scroll = -100; scroll < 2000; scroll += 13) expect(layout(scroll)[0]!.top).toBe(0);
  });
});
