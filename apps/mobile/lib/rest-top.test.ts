import { describe, expect, it } from "vitest";
import { placeAgain, restTop, rests } from "./rest-top";

// Owner, 2026-11-02: "Some things look awkwardly high on the front page instead of having like a perfect space".
describe("where a short screen's words rest", () => {
  it("sits two fifths of the way down the room to spare, not pinned to the top", () => {
    // A phone: 700 of scroll, 120 under the dock, 480 of words leaves 100 to spare.
    expect(restTop(700, 120, 480)).toBe(40);
    // A desktop window leaves more.
    expect(restTop(816, 128, 450)).toBe(95);
  });

  it("starts at the top when the words fill the screen or more", () => {
    expect(restTop(600, 120, 480)).toBe(0);
    expect(restTop(500, 120, 480)).toBe(0);
  });

  it("rests lower only on a wide web screen, never on a phone, where the keyboard covers the room below", () => {
    expect(rests(true, 1440)).toBe(true);
    expect(rests(true, 768)).toBe(true);
    expect(rests(true, 390)).toBe(false);
    expect(rests(false, 1024)).toBe(false);
    expect(rests(false, 390)).toBe(false);
  });

  it("is placed again for a new width or more height, never for less height (a keyboard)", () => {
    expect(placeAgain(null, { width: 390, height: 700 })).toBe(true);
    expect(placeAgain({ width: 390, height: 700 }, { width: 390, height: 700 })).toBe(false);
    expect(placeAgain({ width: 390, height: 700 }, { width: 390, height: 420 })).toBe(false);
    expect(placeAgain({ width: 390, height: 420 }, { width: 390, height: 700 })).toBe(true);
    expect(placeAgain({ width: 390, height: 700 }, { width: 844, height: 340 })).toBe(true);
  });
});
