import { describe, expect, it } from "vitest";
import { biggest, keepLines, tierTotals } from "./money-summary";
import type { Wish } from "./wishes";

const wish = (id: string, name: string, tier: Wish["tier"], cents: number, recurring: Wish["item"]["recurring"] = []): Wish => ({
  id,
  name,
  kind: "buy",
  tier,
  item: { id, upfrontCents: cents, recurring },
  details: {},
  createdAt: "2026-10-28T00:00:00Z",
});

const list = [
  wish("a", "Porsche 911", "must", 15_000_000, [{ amountCents: 30_000, period: "month", label: "insurance" }]),
  wish("b", "Week in Kyoto", "nice", 1_000_000),
  wish("c", "Villa in Mallorca", "dream", 84_000_000, [{ amountCents: 1_200_000, period: "year", label: "property tax" }, { amountCents: 500_00, period: "week" }]),
];

describe("the money page", () => {
  it("totals each tier and its share", () => {
    const t = tierTotals(list);
    expect(t.map((x) => x.tier)).toEqual(["must", "nice", "dream"]);
    expect(t[0]).toMatchObject({ count: 1, cents: 15_000_000 });
    expect(t.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
  });

  it("ranks the dearest wishes", () => {
    expect(biggest(list, 2).map((b) => b.wish.id)).toEqual(["c", "a"]);
    expect(biggest(list)[0]!.share).toBeCloseTo(0.84, 9);
  });

  it("lists running costs a year at a time, dearest first", () => {
    expect(keepLines(list)).toEqual([
      { text: "Villa in Mallorca", perYear: 2_600_000 },
      { text: "Property tax, Villa in Mallorca", perYear: 1_200_000 },
      { text: "Insurance, Porsche 911", perYear: 360_000 },
    ]);
  });

  it("copes with an empty list", () => {
    expect(tierTotals([]).every((t) => t.cents === 0 && t.share === 0)).toBe(true);
    expect(biggest([])).toEqual([]);
  });
});
