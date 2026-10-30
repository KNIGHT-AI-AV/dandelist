import { describe, expect, it } from "vitest";
import { arrange, type Arrangeable } from "../src/arrange";

const w = (id: string, over: Partial<Arrangeable> = {}): Arrangeable => ({
  id,
  name: id,
  kind: "buy",
  tier: "nice",
  upfrontCents: 0,
  recurring: [],
  createdAt: "2026-10-30T12:00:00.000Z",
  ...over,
});

const LIST = [
  w("rolex", { name: "Rolex Submariner", upfrontCents: 1_000_000, tier: "must", createdAt: "2026-10-28T00:00:00.000Z" }),
  w("bali", { name: "Two weeks in Bali", kind: "visit", upfrontCents: 420_000, createdAt: "2026-10-30T00:00:00.000Z" }),
  w("gym", { name: "gym membership", kind: "do", upfrontCents: 5_000, recurring: [{ amountCents: 4_000, period: "month" }], tier: "dream", createdAt: "2026-10-29T00:00:00.000Z" }),
  w("love", { name: "Love", kind: "do", upfrontCents: 0, details: { worth: "priceless" }, createdAt: "2026-10-27T00:00:00.000Z" }),
  w("car", { name: "Range Rover Sport", kind: "own", upfrontCents: 8_000_000, recurring: [{ amountCents: 120_000, period: "year" }, { amountCents: 2_000, period: "week" }], createdAt: "2026-10-26T00:00:00.000Z" }),
];

describe("arranging a list (owner, 2026-10-30: the agent can reorder it 'based on' what the person asks)", () => {
  it("keeps the order when asked for nothing", () => {
    expect(arrange(LIST, {})).toEqual(["rolex", "bali", "gym", "love", "car"]);
  });

  it("sorts by price either way, a priceless wish after every priced one", () => {
    expect(arrange(LIST, { sort: "price_high" })).toEqual(["car", "rolex", "bali", "gym", "love"]);
    expect(arrange(LIST, { sort: "price_low" })).toEqual(["gym", "bali", "rolex", "car", "love"]);
  });

  it("sorts by what it costs a month to keep, counting weekly and yearly costs, ties in their current order", () => {
    // Range Rover: 1,200/yr + 20/wk = 186.67/mo; gym 40/mo; the rest 0, kept in place.
    expect(arrange(LIST, { sort: "upkeep_high" })).toEqual(["car", "gym", "rolex", "bali", "love"]);
    expect(arrange(LIST, { sort: "upkeep_low" })).toEqual(["rolex", "bali", "love", "gym", "car"]);
  });

  it("sorts by when they were added and by name, ignoring case", () => {
    expect(arrange(LIST, { sort: "newest" })).toEqual(["bali", "gym", "rolex", "love", "car"]);
    expect(arrange(LIST, { sort: "oldest" })).toEqual(["car", "love", "rolex", "gym", "bali"]);
    expect(arrange(LIST, { sort: "name" })).toEqual(["gym", "love", "car", "rolex", "bali"]);
  });

  it("leads with the kinds or tiers asked for, in that order, each group keeping the sort", () => {
    expect(arrange(LIST, { first: ["visit"] })).toEqual(["bali", "rolex", "gym", "love", "car"]);
    expect(arrange(LIST, { first: ["do", "must"], sort: "price_high" })).toEqual(["gym", "love", "rolex", "car", "bali"]);
  });

  it("pins wishes to the top and the end, in order, ignoring ids not on the list and repeats", () => {
    expect(arrange(LIST, { top: ["love", "car", "love", "nope"], bottom: ["rolex", "car"] })).toEqual(["love", "car", "bali", "gym", "rolex"]);
    expect(arrange(LIST, { top: ["gym"], sort: "price_high" })).toEqual(["gym", "car", "rolex", "bali", "love"]);
  });

  it("returns every wish exactly once", () => {
    for (const how of [{ sort: "price_high" as const, first: ["own" as const], top: ["bali"], bottom: ["love"] }, {}]) {
      const out = arrange(LIST, how);
      expect([...out].sort()).toEqual(LIST.map((x) => x.id).sort());
    }
  });
});
