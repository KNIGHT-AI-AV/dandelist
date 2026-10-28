import { describe, expect, it } from "vitest";
import type { PriceOption } from "./agent";
import { elapsed, newPricePatch, pickOption, priceChange, sinceWhen, stepLine } from "./recheck";

// Local noon, so the calendar day is the same in every time zone the tests run in.
const day = (month: number, date: number) => new Date(2026, month - 1, date, 12).toISOString();
const NOW = new Date(2026, 10, 3, 12);

const option = (over: Partial<PriceOption> = {}): PriceOption => ({
  label: "Leica Q3",
  seller: "Leica Store",
  url: "https://leica-camera.com/q3",
  upfrontCents: 587_000,
  recurring: [],
  source: { currency: "USD", price: 5870, rate: 1, rateDate: "2026-11-03" },
  status: "verified",
  statusLabel: "Checked on leica-camera.com",
  evidence: "",
  confidence: "high",
  checkedAt: day(11, 3),
  totals: { monthlyCents: 0, horizonCents: 587_000, spreadMonthlyCents: 9_783 },
  ...over,
});

describe("priceChange", () => {
  it("words a drop against the saved date", () => {
    expect(priceChange(599_000, 587_000, day(10, 27), NOW)).toEqual({ direction: "down", deltaCents: -12_000, text: "Down $120 since Oct 27" });
  });

  it("words a rise", () => {
    expect(priceChange(599_000, 603_000, day(10, 27), NOW).text).toBe("Up $40 since Oct 27");
  });

  it("says when nothing moved", () => {
    expect(priceChange(599_000, 599_000, day(10, 27), NOW)).toEqual({ direction: "same", deltaCents: 0, text: "Same price as Oct 27" });
  });

  it("keeps cents when the change is under a dollar", () => {
    expect(priceChange(599_000, 598_950, day(10, 27), NOW).text).toBe("Down $0.50 since Oct 27");
  });

  it("reads naturally for today, yesterday and a few days back", () => {
    expect(priceChange(100_00, 90_00, day(11, 3), NOW).text).toBe("Down $10 since earlier today");
    expect(priceChange(100_00, 110_00, day(11, 2), NOW).text).toBe("Up $10 since yesterday");
    expect(priceChange(100_00, 100_00, day(10, 31), NOW).text).toBe("Same price as Oct 31");
  });

  it("drops the date when the saved one can't be read", () => {
    expect(priceChange(100_00, 90_00, "not a date", NOW).text).toBe("Down $10");
    expect(priceChange(100_00, 100_00, "", NOW).text).toBe("Same price");
    expect(sinceWhen("nope", NOW)).toBeNull();
  });
});

describe("pickOption", () => {
  const top = option({ seller: "Adorama", url: "https://www.adorama.com/q3" });
  const same = option();

  it("prefers the seller the wish was saved from", () => {
    expect(pickOption([top, same], "https://www.leica-camera.com/en-US/q3")).toBe(same);
  });

  it("falls back to the agent's top pick", () => {
    expect(pickOption([top, same], "https://bhphotovideo.com/q3")).toBe(top);
    expect(pickOption([top], undefined)).toBe(top);
    expect(pickOption([], "https://leica-camera.com")).toBeUndefined();
  });
});

describe("stepLine and elapsed", () => {
  it("words steps as the ledger does", () => {
    expect(stepLine({ type: "search", query: "leica q3 price", at: "" })).toEqual({ verb: "Searched", detail: "leica q3 price" });
    expect(stepLine({ type: "open", url: "https://www.leica-camera.com/q3", ok: true, at: "" })).toEqual({ verb: "Opened", detail: "leica-camera.com" });
    expect(stepLine({ type: "price", label: "Leica Q3", upfrontCents: 587_000, at: "" })).toEqual({ verb: "Priced", detail: "Leica Q3 · $5,870" });
    expect(stepLine({ type: "note", text: "Found 6 photos", at: "" })).toEqual({ verb: "", detail: "Found 6 photos" });
  });

  it("formats the clock", () => {
    expect(elapsed(0)).toBe("0:00");
    expect(elapsed(7_400)).toBe("0:07");
    expect(elapsed(102_000)).toBe("1:42");
    expect(elapsed(-50)).toBe("0:00");
  });
});

describe("newPricePatch", () => {
  const media = { kind: "product" as const, images: [{ url: "https://img.example.com/q3.jpg", source: "leica-camera.com" }] };
  const wish = {
    details: {
      agent: {
        runId: "old",
        seller: "Leica Store",
        url: "https://leica-camera.com/q3",
        status: "estimate" as const,
        checkedAt: day(10, 27),
        imageUrl: "https://img.example.com/q3.jpg",
        media,
        explanation: "The body alone.",
        source: { currency: "USD", price: 5990, rate: 1, rateDate: "2026-10-27" },
      },
    },
  };

  it("takes the new figure and source but keeps the saved photos", () => {
    const patch = newPricePatch(wish, { id: "run-2", result: { options: [], explanation: "Still the body alone.", note: "", horizonYears: 5 } }, option({ imageUrl: "https://other.example.com/x.jpg" }));
    expect(patch.upfrontCents).toBe(587_000);
    expect(patch.recurring).toBeUndefined();
    expect(patch.details.agent).toMatchObject({ runId: "run-2", seller: "Leica Store", status: "verified", checkedAt: day(11, 3), imageUrl: "https://img.example.com/q3.jpg", media, explanation: "Still the body alone." });
  });

  it("replaces running costs only when the agent itemised new ones, and drops non-web links", () => {
    const o = option({ url: "javascript:alert(1)", recurring: [{ label: "Insurance", amountCents: 2_000, period: "month" }] });
    const patch = newPricePatch({ details: {} }, { id: "run-3", result: null }, o);
    expect(patch.recurring).toEqual([{ amountCents: 2_000, period: "month", label: "Insurance" }]);
    expect(patch.details.agent?.url).toBe("");
    expect(patch.details.agent?.explanation).toBe("");
  });
});
