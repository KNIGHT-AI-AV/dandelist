import { describe, expect, it } from "vitest";
import type { Step } from "./agent";
import { blurFor, cardBlur, clarityOf, deckFor, foundImages, MAX_BLUR, MOOD_BLUR, moodFor, thoughtOf } from "./reveal";

const at = "2026-10-28T10:00:00Z";
const open = (url: string, imageUrl?: string, ok = true): Step => ({ type: "open", url, ok, imageUrl, at });
const thought = (text: string): Step => ({ type: "note", text, event: { kind: "thought", text }, at });

describe("the wish reveal", () => {
  it("dreams on catalogue photos of the same kind of wish until real finds arrive", () => {
    const travel = moodFor("visit", 1);
    const things = moodFor("buy", 1);
    expect(travel.length).toBeGreaterThan(0);
    expect(things.length).toBeGreaterThan(0);
    expect(travel.some((u) => things.includes(u))).toBe(false);
    expect(deckFor([], "buy", 1)).toEqual(things.slice(0, 8).map((uri) => ({ uri, real: false })));
  });

  it("puts real finds first, newest first, and drops design pictures once three are found", () => {
    const steps = [open("https://a.com/x", "https://a.com/1.jpg"), open("https://b.com/x", "https://b.com/2.jpg"), open("https://c.com/x", undefined, false)];
    expect(foundImages(steps)).toEqual(["https://b.com/2.jpg", "https://a.com/1.jpg"]);
    expect(deckFor(steps, "buy", 1).slice(0, 3)).toEqual([{ uri: "https://b.com/2.jpg", real: true }, { uri: "https://a.com/1.jpg", real: true }, expect.objectContaining({ real: false })]);
    const three = [...steps, open("https://d.com/x", "https://d.com/3.jpg"), open("https://d.com/y", "https://d.com/3.jpg")];
    expect(deckFor(three, "buy", 1).map((c) => c.uri)).toEqual(["https://d.com/3.jpg", "https://b.com/2.jpg", "https://a.com/1.jpg"]);
  });

  it("sharpens with each find but only clears fully when the agent is done", () => {
    const steps = [open("https://a.com/x", "https://a.com/1.jpg"), { type: "check", url: "https://a.com/x", verified: true, at } as Step];
    expect(clarityOf([], false)).toBeCloseTo(0.1);
    expect(clarityOf(steps, false)).toBeCloseTo(0.4);
    expect(clarityOf(Array(20).fill(steps).flat(), false)).toBe(0.8);
    expect(clarityOf([], true)).toBe(1);
    expect(blurFor(0)).toBe(MAX_BLUR);
    expect(blurFor(1)).toBe(0);
    expect(blurFor(0.35) % 4).toBe(0);
    // A design picture stays a wash of colour however far the search has come; a real find sharpens.
    expect(cardBlur({ uri: "x", real: false }, 0.8)).toBe(MOOD_BLUR);
    expect(cardBlur({ uri: "x", real: true }, 0.8)).toBeLessThan(MOOD_BLUR / 4);
  });

  it("shows the agent's own thought while it is fresh, then what the newest step is doing", () => {
    const steps: Step[] = [thought("Leica's own store sets the list price, so I'll read it there first."), open("https://leica-camera.com/q3", "https://x/1.jpg")];
    expect(thoughtOf(steps)).toEqual({ text: "Leica's own store sets the list price, so I'll read it there first.", mine: true });
    const later: Step[] = [...steps, { type: "check", url: "https://leica-camera.com/q3", verified: true, at }, { type: "price", label: "Leica Q3", upfrontCents: 599500, at }];
    expect(thoughtOf(later)).toEqual({ text: "Priced Leica Q3", mine: false });
    expect(thoughtOf([{ type: "search", query: "3 web searches", at }])).toEqual({ text: "Searching the web", mine: false });
    expect(thoughtOf([])).toBeNull();
  });
});
