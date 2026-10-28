import { describe, expect, it } from "vitest";
import { INCOME_MAX, INCOME_MIN, INCOME_STEPS, fractionOf, incomeAt, stageOf, startIncome } from "./comfort";

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
    expect(stageOf(5_000_000, list).index).toBe(1);
    expect(stageOf(25_000_000, list)).toEqual({ index: 2, line: "You could comfortably afford this" });
    expect(stageOf(100_000_000, list).index).toBe(3);
    expect(stageOf(1_000_000_000, list).index).toBe(4);
  });

  it("starts where the list reads comfortable", () => {
    const list = 16_000_000;
    expect(stageOf(startIncome(list), list).index).toBe(2);
    expect(startIncome(0)).toBe(INCOME_MIN);
  });
});
