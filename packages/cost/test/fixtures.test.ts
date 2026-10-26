import { describe, expect, it } from "vitest";
import {
  equivalentMonthly,
  grossIncomeEquivalent,
  horizonCashOutlay,
  loanPaymentCents,
  loanWithin,
  monthsToSave,
  netWorth,
  ownershipCost,
  recurringBreakdown,
  roundCents,
  upfrontCashCents,
  upfrontPriceCents,
  workHours,
  type Item,
} from "../src/index";

// Synthetic fixture from the brief (Trello card LujiBndH), not anyone's real finances.
const camera: Item = { id: "camera", upfrontCents: 240_000, recurring: [] };
const trip: Item = { id: "trip", upfrontCents: 500_000, recurring: [] };
const running: Item = {
  id: "running",
  upfrontCents: 0,
  recurring: [
    { label: "membership", amountCents: 12_000, period: "month" },
    { label: "software", amountCents: 3_000, period: "month" },
    { label: "maintenance", amountCents: 60_000, period: "year" },
  ],
};
const life = [camera, trip, running];

describe("brief fixtures", () => {
  it("upfront is $7,400", () => {
    expect(upfrontCashCents(life)).toBe(740_000);
  });

  it("recurring is $2,400 a year = $200 a month = $46.15 a week", () => {
    const r = recurringBreakdown(life);
    expect(r.perYear).toBe(240_000);
    expect(r.perMonth).toBe(20_000);
    expect(roundCents(r.perWeek)).toBe(4_615);
  });

  it("five-year cash outlay is $19,400", () => {
    expect(horizonCashOutlay(life, 5)).toBe(1_940_000);
  });

  it("five-year equivalent monthly is $323.33, not the $200 actual bill", () => {
    expect(roundCents(equivalentMonthly(horizonCashOutlay(life, 5), 5))).toBe(32_333);
    expect(recurringBreakdown(life).perMonth).toBe(20_000);
  });

  it("upfront takes 246.7 work hours at $30 net per hour", () => {
    expect(Number(workHours(740_000, 3_000)!.toFixed(1))).toBe(246.7);
  });

  it("reaching the upfront takes 14.8 months at $500 a month", () => {
    expect(monthsToSave(740_000, 50_000)).toBe(14.8);
  });
});

describe("loans", () => {
  it("never counts a financed price twice", () => {
    const financed: Item = {
      id: "camera-loan",
      upfrontCents: 240_000,
      recurring: [],
      loan: { depositCents: 40_000, annualRate: 0, termMonths: 10 },
    };
    expect(upfrontCashCents([financed])).toBe(40_000);
    expect(upfrontPriceCents([financed])).toBe(240_000);
    expect(horizonCashOutlay([financed], 1)).toBe(240_000);
  });

  it("amortizes $2,400 at 12% over 12 months to $213.24 a month", () => {
    expect(roundCents(loanPaymentCents(240_000, 0.12, 12))).toBe(21_324);
    const w = loanWithin({ id: "x", upfrontCents: 240_000, recurring: [], loan: { depositCents: 0, annualRate: 0.12, termMonths: 12 } }, 12);
    expect(roundCents(w.interestPaid)).toBe(15_885);
    expect(roundCents(w.balanceLeft)).toBe(0);
  });

  it("counts only the payments that fall inside the horizon", () => {
    const item: Item = { id: "car", upfrontCents: 1_200_000, recurring: [], loan: { depositCents: 0, annualRate: 0, termMonths: 24 } };
    const w = loanWithin(item, 12);
    expect(w.paymentsMade).toBe(12);
    expect(w.balanceLeft).toBe(600_000);
    expect(horizonCashOutlay([item], 1)).toBe(600_000);
  });

  it("ownership view separates price, interest, fees, running costs and resale", () => {
    const item: Item = {
      id: "bike",
      upfrontCents: 240_000,
      recurring: [{ amountCents: 10_000, period: "year" }],
      resaleCents: 80_000,
      loan: { depositCents: 0, annualRate: 0.12, termMonths: 12, feesCents: 2_500 },
    };
    const o = ownershipCost(item, 2);
    expect(o.price).toBe(240_000);
    expect(roundCents(o.interest)).toBe(15_885);
    expect(o.fees).toBe(2_500);
    expect(o.running).toBe(20_000);
    expect(roundCents(o.net)).toBe(240_000 + 15_885 + 2_500 + 20_000 - 80_000);
  });
});

describe("money rules", () => {
  it("net worth is assets minus liabilities", () => {
    expect(netWorth([1_000_000, 250_000], [300_000])).toBe(950_000);
  });

  it("gross income equivalent uses an editable tax rate", () => {
    expect(grossIncomeEquivalent(7_000, 0.3)).toBe(10_000);
    expect(() => grossIncomeEquivalent(7_000, 1)).toThrow(RangeError);
  });

  it("months to save handles nothing saved and already enough", () => {
    expect(monthsToSave(100_000, 0)).toBeNull();
    expect(monthsToSave(100_000, 5_000, 120_000)).toBe(0);
  });

  it("work hours are unknown without an hourly rate", () => {
    expect(workHours(740_000, 0)).toBeNull();
  });
});
