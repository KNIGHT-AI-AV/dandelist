import { upfrontCashCents } from "@dandelist/cost";
import { describe, expect, it, vi } from "vitest";
import { comfortableIncome, faderIncome, INCOME_MIN, needOf, poolEntry, stageOf, wishEntry } from "./comfort";
import { formatIn } from "./fx";
import { emptyWelcome, listed, listTotal, toWishes, type FirstWish, type GuestOption, type PoolItem, type WelcomeState } from "./welcome";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({ getSecret: vi.fn(), setSecret: vi.fn() }));

function pick(id: string, upfrontCents: number, recurring: PoolItem["recurring"] = []): PoolItem {
  return { id, name: id, kind: "buy", category: "capture", group: "things", upfrontCents, recurring, status: "estimate", seller: "Synthetic seller", url: `https://seller.example/${id}`, checkedAt: "2026-10-29T23:00:00Z" };
}

/** An owned card as the pool or the first wish's this-or-that makes it: a car, or a home in the home group. */
function owned(id: string, upfrontCents: number, as: "vehicle" | "place", recurring: PoolItem["recurring"] = []): PoolItem {
  return { ...pick(id, upfrontCents, recurring), kind: "own", category: as === "vehicle" ? "drive" : "live", group: as === "vehicle" ? "things" : "home", media: { kind: as, images: [] } };
}

function first(upfrontCents: number, recurring: PoolItem["recurring"] = []): FirstWish {
  const option: GuestOption = { ...pick("first", upfrontCents, recurring), label: "First wish", statusLabel: "Estimate", source: { currency: "USD", price: upfrontCents / 100, rate: 1, rateDate: "2026-10-29" } };
  return { text: "first wish", title: "First wish", kind: "buy", option };
}

function state(items: PoolItem[], wish: FirstWish | null = null): WelcomeState {
  return { ...emptyWelcome(), items, wish };
}

/** Use the actual welcome projection and selector, rather than copying the cost formula. */
function welcomeFigure(s: WelcomeState) {
  const items = listed(s);
  const need = needOf(items.map(poolEntry));
  return { total: listTotal(s), need, income: faderIncome({ needCents: need, selectedIncomeCents: s.incomeCents, hasPricedItems: items.length > 0 }) };
}

/** The actual adoption mapping supplies the wishes the signed-in pages add up. */
function accountFigure(s: WelcomeState) {
  const wishes = toWishes(s).map((w, i) => ({ name: w.name, kind: w.kind, item: { id: `saved-${i}`, upfrontCents: w.upfrontCents, recurring: w.recurring! }, details: w.details ?? {} }));
  const need = needOf(wishes.map(wishEntry));
  return { total: upfrontCashCents(wishes.map((w) => w.item)), need, income: comfortableIncome(need) };
}

describe("the untouched welcome income matches the adopted list", () => {
  const cases = [
    // A thing takes about a month's pay: 8% of a year's income.
    { name: "purchase only", value: state([pick("camera collection", 16_000_000)]), total: 16_000_000, income: 200_000_000 },
    // $1M at 8% and $240,000 a year of care at 10%: $14.9 million, read as $15 million.
    { name: "recorded running costs add their own share", value: state([], first(100_000_000, [{ label: "Care", amountCents: 2_000_000, period: "month" }])), total: 100_000_000, income: 1_500_000_000 },
    { name: "recurring only, with zero upfront", value: state([pick("membership", 0, [{ label: "Membership", amountCents: 10_000, period: "month" }])]), total: 0, income: 1_200_000 },
    { name: "first wish and picks with weekly, monthly and yearly costs", value: state([pick("monthly", 200_000, [{ label: "Monthly", amountCents: 10_000, period: "month" }]), pick("yearly", 300_000, [{ label: "Yearly", amountCents: 40_000, period: "year" }])], first(100_000, [{ label: "Weekly", amountCents: 1_000, period: "week" }])), total: 600_000, income: 9_700_000 },
    { name: "a small priced list uses the same expanded fader range", value: state([pick("small", 100_000)]), total: 100_000, income: 1_300_000 },
    { name: "an explicitly priced zero item is not an empty list", value: state([pick("priced zero", 0)]), total: 0, income: 10_000 },
    { name: "an unresolved first wish remains outside the numeric item set", value: state([pick("priced", 16_000_000)], { text: "not priced", failed: "No price found" }), total: 16_000_000, income: 200_000_000 },
    // A $241,000 car on a four-year loan and a $1M home on a mortgage, each with its upkeep: $627,083 and $305,995.
    { name: "a car and a home on their own rules", value: state([owned("g-wagon", 24_100_000, "vehicle", [{ label: "Insurance", amountCents: 1_500_000, period: "year" }]), owned("villa", 100_000_000, "place", [{ label: "Property tax", amountCents: 2_500_000, period: "year" }])]), total: 124_100_000, income: 94_000_000 },
  ];

  it.each(cases)("$name", ({ value, total, income }) => {
    const welcome = welcomeFigure(value);
    const account = accountFigure(value);
    expect(welcome).toMatchObject({ total, income });
    expect(account).toEqual(welcome);
    expect(stageOf(welcome.income, welcome.need).index).toBe(3);
    expect(stageOf(account.income, account.need)).toEqual(stageOf(welcome.income, welcome.need));
  });

  it("follows changed recorded costs while the person has not selected an income", () => {
    const before = state([pick("same wish", 16_000_000)]);
    const after = state([pick("same wish", 16_000_000, [{ label: "Care", amountCents: 12_000_000, period: "year" }])]);
    expect(welcomeFigure(before).income).toBe(200_000_000);
    expect(welcomeFigure(after).income).toBe(320_000_000);
    expect(welcomeFigure(after)).toEqual(accountFigure(after));
  });

  it.each([0, 12_345_678, 60_000_000])("preserves an explicit %i-cent scenario when the list changes", (incomeCents) => {
    const before = { ...state([pick("first", 16_000_000)]), incomeCents };
    const after = { ...state([pick("second", 100_000_000, [{ label: "Care", amountCents: 2_000_000, period: "month" }])]), incomeCents };
    expect(welcomeFigure(before).income).toBe(incomeCents);
    expect(welcomeFigure(after).income).toBe(incomeCents);
  });

  it.each([
    { name: "empty", value: state([]) },
    { name: "unresolved only", value: state([], { text: "still unpriced", failed: "Try again" }) },
  ])("preserves the existing $name fallback rather than treating it as a priced zero item", ({ value }) => {
    expect(listed(value)).toEqual([]);
    expect(toWishes(value)).toEqual([]);
    expect(welcomeFigure(value)).toEqual({ total: 0, need: 0, income: INCOME_MIN });
    expect(welcomeFigure({ ...value, incomeCents: 0 }).income).toBe(0);
    expect(welcomeFigure({ ...value, incomeCents: 23_000_000 }).income).toBe(23_000_000);
  });

  it.each([
    { code: "USD" as const, rate: 1, expected: "$15,000,000" },
    { code: "EUR" as const, rate: 0.92, expected: "€13,800,000" },
    { code: "JPY" as const, rate: 152, expected: "¥2,280,000,000" },
  ])("formats the same derived income in $code without snapping it to a different ladder", ({ code, rate, expected }) => {
    const value = state([], first(100_000_000, [{ label: "Care", amountCents: 2_000_000, period: "month" }]));
    const welcome = welcomeFigure(value);
    const account = accountFigure(value);
    expect(formatIn(code, rate, welcome.income)).toBe(expected);
    expect(formatIn(code, rate, account.income)).toBe(expected);
  });
});
