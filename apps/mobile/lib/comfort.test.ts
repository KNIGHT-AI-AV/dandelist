import { describe, expect, it } from "vitest";
import { INCOME_MAX, INCOME_MIN, INCOME_STEPS, comfortableIncome, fractionOf, fullRange, incomeAt, incomeSteps, stageOf, startIncome } from "./comfort";
import { formatIn } from "./fx";

describe("the comfort fader", () => {
  it("runs from $10,000 to $100 million a year on round notches", () => {
    expect(INCOME_STEPS[0]).toBe(INCOME_MIN);
    expect(INCOME_STEPS.at(-1)).toBe(INCOME_MAX);
    expect(INCOME_STEPS).toContain(25_000_000); // $250,000
    expect(INCOME_STEPS).toContain(750_000_000); // $7.5M
    expect([...INCOME_STEPS].sort((a, b) => a - b)).toEqual(INCOME_STEPS);
  });

  it("maps position to the nearest notch and back", () => {
    expect(incomeAt(0)).toBe(INCOME_MIN);
    expect(incomeAt(1)).toBe(INCOME_MAX);
    for (const s of INCOME_STEPS) expect(incomeAt(fractionOf(s))).toBe(s);
    expect(fractionOf(INCOME_MIN / 2)).toBe(0);
  });

  it("goes from devastated to monocled as a year's income outgrows the list", () => {
    const list = 16_000_000; // $160,000
    expect(stageOf(1_000_000, list).index).toBe(0);
    expect(stageOf(3_000_000, list).index).toBe(1);
    expect(stageOf(6_000_000, list).index).toBe(2);
    expect(stageOf(25_000_000, list)).toEqual({ index: 3, line: "You could comfortably afford this" });
    expect(stageOf(100_000_000, list).index).toBe(4);
    expect(stageOf(1_000_000_000, list).index).toBe(5);
  });

  it("starts where the list reads comfortable", () => {
    const list = 16_000_000;
    expect(stageOf(startIncome(list), list).index).toBe(3);
    expect(startIncome(0)).toBe(INCOME_MIN);
  });

  it("counts round numbers in the shown currency", () => {
    const yen = incomeSteps(152, 100);
    expect(formatIn("JPY", 152, yen[0]!)).toBe("¥1,000,000");
    expect(formatIn("JPY", 152, yen.at(-1)!)).toBe("¥10,000,000,000");
    expect(yen.map((c) => formatIn("JPY", 152, c))).toContain("¥25,000,000");
    const euros = incomeSteps(0.92, 1);
    expect(euros.map((c) => formatIn("EUR", 0.92, c))).toContain("€250,000");
    for (const s of euros) expect(incomeAt(fractionOf(s, euros), euros)).toBe(s);
  });

  it("names the income that carries a list comfortably, running costs included", () => {
    const list = 123_456_700; // $1,234,567
    const income = comfortableIncome(list);
    expect(income).toBe(75_000_000); // $750,000
    expect(stageOf(income, list).index).toBe(3);
    // A boat whose crew costs $1.2M a year needs more than its price suggests.
    const keep = 120_000_000;
    expect(comfortableIncome(10_000_000, keep)).toBe(800_000_000);
    expect(stageOf(comfortableIncome(10_000_000, keep), 10_000_000, keep).index).toBe(3);
  });

  it("always runs from horrid at the far left to ritzy at the far right, whatever the list", () => {
    // A Peloton with its membership (the owner's money page), a $160,000 list, and an $80 million estate.
    for (const [total, keep, rate, unit] of [[260_000, 47_400, 0.9, 1], [16_000_000, 0, 1, 1], [8_000_000_000, 120_000_000, 152, 100]] as const) {
      const steps = incomeSteps(rate, unit, fullRange(total, keep));
      expect(stageOf(steps[0]!, total, keep).index).toBe(0);
      expect(stageOf(steps.at(-1)!, total, keep).index).toBe(5);
      expect(steps[0]!).toBeLessThanOrEqual(INCOME_MIN / rate * unit + 1);
      expect(steps.at(-1)!).toBeGreaterThanOrEqual(INCOME_MAX / rate * unit - 1);
      for (const s of steps) expect(incomeAt(fractionOf(s, steps), steps)).toBe(s);
    }
  });
});
