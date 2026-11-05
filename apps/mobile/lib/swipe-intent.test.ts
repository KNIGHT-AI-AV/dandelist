import { describe, expect, it } from "vitest";
import { DELIBERATE_MS, FLICK_X, PAGE_QUIET_MS, RING_SLOP, pagesStill, ringTakes, swipeOutcome } from "./swipe-intent";

const W = 393;
const card = { width: W, removeAt: 0.4, pages: true };

describe("a swipe on a removable card (owner, 2026-10-31)", () => {
  it("removes it after a deliberate drag past the line", () => {
    expect(swipeOutcome({ ...card, dx: -0.5 * W, vx: -0.1, ms: 600 })).toBe("remove");
    // Held, then let go with a fling: still deliberate.
    expect(swipeOutcome({ ...card, dx: 0.45 * W, vx: 1.4, ms: DELIBERATE_MS + 50 })).toBe("remove");
  });

  it("turns the page on a quick flick, short or long, instead of removing it", () => {
    expect(swipeOutcome({ ...card, dx: -0.15 * W, vx: -FLICK_X - 0.2, ms: 120 })).toBe("page");
    expect(swipeOutcome({ ...card, dx: -0.55 * W, vx: -1.8, ms: 160 })).toBe("page");
  });

  it("springs back on a slow drag short of the line, or a flick back", () => {
    expect(swipeOutcome({ ...card, dx: 0.2 * W, vx: 0.1, ms: 500 })).toBe("home");
    expect(swipeOutcome({ ...card, dx: 0.5 * W, vx: -1.2, ms: 700 })).toBe("home");
  });

  it("keeps a flick removing outside the ring, once the card has moved", () => {
    const loose = { ...card, pages: false };
    expect(swipeOutcome({ ...loose, dx: -0.2 * W, vx: -1, ms: 120 })).toBe("remove");
    expect(swipeOutcome({ ...loose, dx: -0.05 * W, vx: -1, ms: 60 })).toBe("home");
  });

  it("leaves sideways drags to the pages for a moment after they move", () => {
    expect(pagesStill(1000, 1000 + PAGE_QUIET_MS - 1)).toBe(false);
    expect(pagesStill(1000, 1000 + PAGE_QUIET_MS)).toBe(true);
  });
});

describe("the ring of pages and the rows that scroll sideways (owner, 2026-11-05)", () => {
  it("turns on a clear sideways drag anywhere else", () => {
    expect(ringTakes(RING_SLOP + 8, 2, false)).toBe(true);
    expect(ringTakes(-(RING_SLOP + 8), 2, false)).toBe(true);
  });

  it("leaves a drag that started on a sideways row to the row", () => {
    expect(ringTakes(RING_SLOP + 80, 0, true)).toBe(false);
  });

  it("leaves short and mostly downward drags to the page", () => {
    expect(ringTakes(RING_SLOP, 0, false)).toBe(false);
    expect(ringTakes(30, 40, false)).toBe(false);
  });
});
