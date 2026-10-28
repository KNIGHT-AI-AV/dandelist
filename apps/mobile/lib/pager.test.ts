import { describe, expect, it } from "vitest";
import { COMMIT, FLICK_PAGES, dockDistance, landing, nearest, offsetOf, pageAt } from "./pager";

describe("the ring of pages", () => {
  it("names the page in front at any position, both ways round", () => {
    expect(pageAt(0)).toBe("list");
    expect(pageAt(1)).toBe("chat");
    expect(pageAt(5)).toBe("list");
    expect(pageAt(-1)).toBe("settings");
    expect(pageAt(-4)).toBe("chat");
    expect(pageAt(2.4)).toBe("details");
  });

  it("places every page within half a ring of the one in front", () => {
    expect(offsetOf(0, 0)).toBe(0);
    expect(offsetOf(1, 0)).toBe(1);
    expect(offsetOf(4, 0)).toBe(-1);
    expect(offsetOf(0, 4)).toBe(1);
    expect(offsetOf(2, 0.5)).toBe(1.5);
    for (let pos = -7; pos < 7; pos += 0.25) for (let i = 0; i < 5; i++) expect(Math.abs(offsetOf(i, pos))).toBeLessThanOrEqual(2.5);
  });

  it("goes to a page the short way round", () => {
    expect(nearest(0, "settings")).toBe(-1);
    expect(nearest(0, "money")).toBe(-2);
    expect(nearest(0, "details")).toBe(2);
    expect(nearest(10, "chat")).toBe(11);
    expect(nearest(-3, "list")).toBe(-5);
  });
});

describe("where a swipe lands", () => {
  it("springs back from a short, slow drag", () => {
    expect(landing(0, COMMIT / 2, 0)).toBe(0);
    expect(landing(3, -COMMIT / 2, 0)).toBe(3);
  });

  it("turns one page past the commit distance", () => {
    expect(landing(0, COMMIT + 0.01, 0)).toBe(1);
    expect(landing(0, -(COMMIT + 0.01), 0)).toBe(-1);
  });

  it("turns on a flick however short", () => {
    expect(landing(2, 0.05, FLICK_PAGES * 2)).toBe(3);
    expect(landing(2, -0.05, -FLICK_PAGES * 2)).toBe(1);
  });

  it("returns when flicked back against the drag", () => {
    expect(landing(0, 0.6, -FLICK_PAGES * 2)).toBe(0);
  });

  it("never turns more than one page", () => {
    expect(landing(0, 2.4, FLICK_PAGES * 10)).toBe(1);
    expect(landing(0, -3, 0)).toBe(-1);
  });
});

describe("the dock", () => {
  it("shows on the list and the chat, and hides a page away", () => {
    expect(dockDistance(0)).toBe(0);
    expect(dockDistance(1)).toBe(0);
    expect(dockDistance(0.5)).toBe(0);
    expect(dockDistance(1.5)).toBe(0.5);
    expect(dockDistance(2)).toBe(1);
    expect(dockDistance(3)).toBe(1);
    expect(dockDistance(4)).toBe(1);
    expect(dockDistance(4.5)).toBe(0.5);
    expect(dockDistance(-0.5)).toBe(0.5);
    expect(dockDistance(5)).toBe(0);
  });
});
