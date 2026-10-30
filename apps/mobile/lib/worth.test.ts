import { describe, expect, it } from "vitest";
import { formatIn } from "./fx";
import { biggest, tierTotals } from "./money-summary";
import type { Wish } from "./wishes";
import { AMOUNT_CEILING, INFINITY, amountAt, amountFraction, amountMarks, amountSteps, countLine, counted, isPriceless, priceWords, pricelessAside, startAmount, worthOf } from "./worth";

const MILLION = 100_000_000; // $1,000,000 in US cents

describe("the money slider", () => {
  it("runs from $1,000 to $100 million on round stops, with 10K, 100K, 1M and 10M marked", () => {
    const steps = amountSteps();
    expect(steps[0]).toBe(100_000);
    expect(steps.at(-1)).toBe(10_000_000_000);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(steps).toContain(250_000_000); // $2.5M
    expect(amountMarks(steps)).toEqual([1_000_000, 10_000_000, MILLION, 1_000_000_000]);
  });

  it("maps a position to the nearest stop and back, on a log scale", () => {
    const steps = amountSteps();
    for (const s of steps) expect(amountAt(amountFraction(s, steps), steps)).toBe(s);
    expect(amountAt(0, steps)).toBe(steps[0]);
    expect(amountAt(1, steps)).toBe(steps.at(-1));
    // Five decades: a million sits three fifths along, ten thousand a fifth.
    expect(amountFraction(MILLION, steps)).toBeCloseTo(0.6, 9);
    expect(amountFraction(1_000_000, steps)).toBeCloseTo(0.2, 9);
    expect(amountAt(0.61, steps)).toBe(MILLION);
  });

  it("starts at the amount the wish named, exactly, else at a million", () => {
    expect(startAmount(amountSteps())).toBe(MILLION);
    expect(startAmount(amountSteps(1, 1, MILLION), MILLION)).toBe(MILLION);
    expect(startAmount(amountSteps(1, 1, 5_000_000), 5_000_000)).toBe(5_000_000); // $50k
    expect(startAmount(amountSteps(1, 1, 123_456_700), 123_456_700)).toBe(123_456_700); // not snapped until it moves
    // Below the slider it starts at its foot.
    expect(startAmount(amountSteps(1, 1, 50_000), 50_000)).toBe(100_000);
  });

  it("reaches further for a wish that names more, up to a billion dollars", () => {
    const quarterBillion = amountSteps(1, 1, 25_000_000_000);
    expect(quarterBillion.at(-1)).toBe(100_000_000_000);
    expect(startAmount(quarterBillion, 25_000_000_000)).toBe(25_000_000_000);
    const tooMuch = amountSteps(1, 1, 500_000_000_000);
    expect(tooMuch.at(-1)).toBe(AMOUNT_CEILING);
    expect(startAmount(tooMuch, 500_000_000_000)).toBe(AMOUNT_CEILING);
  });

  it("counts round numbers in the shown currency", () => {
    const yen = amountSteps(152, 100);
    expect(formatIn("JPY", 152, yen[0]!)).toBe("¥100,000");
    expect(amountMarks(yen, 152).map((c) => formatIn("JPY", 152, c))).toEqual(["¥1,000,000", "¥10,000,000", "¥100,000,000", "¥1,000,000,000"]);
    expect(formatIn("JPY", 152, startAmount(yen))).toBe("¥100,000,000");
    const euros = amountSteps(0.92, 1);
    expect(amountMarks(euros, 0.92).map((c) => formatIn("EUR", 0.92, c))).toEqual(["€10,000", "€100,000", "€1,000,000", "€10,000,000"]);
    expect(formatIn("EUR", 0.92, startAmount(euros))).toBe("€1,000,000");
    for (const s of euros) expect(amountAt(amountFraction(s, euros), euros)).toBe(s);
  });
});

const wish = (id: string, cents: number, details: Wish["details"] = {}, tier: Wish["tier"] = "nice"): Wish => ({
  id,
  name: id,
  kind: "buy",
  tier,
  item: { id, upfrontCents: cents, recurring: [] },
  details,
  createdAt: "2026-10-30T00:00:00Z",
});

describe("infinity in the totals", () => {
  const love = wish("Love", 0, { worth: "priceless", line: "Free to give, impossible to buy." }, "must");
  const money = wish("Money", MILLION, { worth: "money" }, "dream");
  const watch = wish("Rolex", 1_500_000, {}, "must");
  const list = [love, money, watch];

  it("knows a priceless wish and leaves it out of every sum", () => {
    expect(worthOf(love)).toBe("priceless");
    expect(worthOf(money)).toBe("money");
    expect(worthOf(watch)).toBeUndefined();
    expect(isPriceless(love)).toBe(true);
    expect(counted(list)).toEqual([money, watch]);
    // Even one saved with an amount by mistake adds nothing.
    expect(counted([{ ...love, item: { ...love.item, upfrontCents: 999 } }])).toEqual([]);
  });

  it("says infinity where a price would be, and priceless aloud", () => {
    expect(INFINITY).toBe("∞");
    expect(priceWords(love, (c) => `$${c / 100}`)).toBe("priceless");
    expect(priceWords(watch, (c) => `$${c / 100}`)).toBe("$15000");
  });

  it("notes beside a total how many wishes it leaves out", () => {
    expect(countLine(list)).toBe("3 wishes · 1 priceless");
    expect(countLine([watch])).toBe("1 wish");
    expect(pricelessAside(list)).toBe("1 priceless wish isn't in the total.");
    expect(pricelessAside([love, { ...love, id: "Health", name: "Health" }])).toBe("2 priceless wishes aren't in the total.");
    expect(pricelessAside([watch])).toBe("");
  });

  it("keeps the money page's tiers and rankings to priced wishes", () => {
    const tiers = tierTotals(list);
    expect(tiers.find((t) => t.tier === "must")).toMatchObject({ count: 2, cents: 1_500_000 });
    expect(tiers.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1, 9);
    expect(biggest(list).map((b) => b.wish.id)).toEqual(["Money", "Rolex"]);
    expect(biggest([love])).toEqual([]);
  });
});
