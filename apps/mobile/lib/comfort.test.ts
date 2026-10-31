import { entry } from "@dandelist/catalogue";
import { describe, expect, it } from "vitest";
import { INCOME_MAX, INCOME_MIN, INCOME_STEPS, STAGES, comfortableIncome, fractionOf, fullRange, incomeAt, incomeSteps, needFor, needOf, poolEntry, stageOf, startIncome, unjudged, wishEntry, type PoolCard } from "./comfort";
import { formatIn } from "./fx";
import type { Wish, WishDetails } from "./wishes";

/** A saved wish, priced in whole dollars. */
function wish(name: string, kind: Wish["kind"], dollars: number, recurring: Wish["item"]["recurring"] = [], details: WishDetails = {}, tier: Wish["tier"] = "nice"): Wish {
  return { id: name, name, kind, tier, item: { id: name, upfrontCents: dollars * 100, recurring }, details, createdAt: "2026-10-30T00:00:00Z" };
}
const photos = (kind: "vehicle" | "place" | "product") => ({ agent: { runId: "r", seller: "", url: "", status: "estimate" as const, checkedAt: "", explanation: "", source: { currency: "USD", price: 0, rate: 1, rateDate: "" }, media: { kind, images: [] } } });
const yearly = (label: string, dollars: number) => ({ label, amountCents: dollars * 100, period: "year" as const });
const need = (...wishes: Wish[]) => needOf(wishes.map(wishEntry));
const categoryOf = (w: Wish) => wishEntry(w)!.category;
const card = (c: Partial<PoolCard> & Pick<PoolCard, "kind" | "upfrontCents">): PoolCard => ({ name: "card", recurring: [], ...c });

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

  it("counts round numbers in the shown currency", () => {
    const yen = incomeSteps(152, 100);
    expect(formatIn("JPY", 152, yen[0]!)).toBe("¥1,000,000");
    expect(formatIn("JPY", 152, yen.at(-1)!)).toBe("¥10,000,000,000");
    expect(yen.map((c) => formatIn("JPY", 152, c))).toContain("¥25,000,000");
    const euros = incomeSteps(0.92, 1);
    expect(euros.map((c) => formatIn("EUR", 0.92, c))).toContain("€250,000");
    for (const s of euros) expect(incomeAt(fractionOf(s, euros), euros)).toBe(s);
  });

  it("goes from devastated to monocled as a year's income outgrows what the list needs", () => {
    const needs = 16_000_000; // $160,000
    expect(stageOf(2_000_000, needs)).toEqual({ index: 0, line: "Out of reach for now" });
    expect(stageOf(4_000_000, needs)).toEqual({ index: 1, line: "A real stretch" });
    expect(stageOf(10_000_000, needs)).toEqual({ index: 2, line: "Doable, if you're careful" });
    expect(stageOf(16_000_000, needs)).toEqual({ index: 3, line: "You could comfortably afford this" });
    expect(stageOf(80_000_000, needs)).toEqual({ index: 4, line: "You could very much afford this" });
    expect(stageOf(200_000_000, needs)).toEqual({ index: 5, line: "You wouldn't notice the bill" });
  });

  it("starts where the list reads comfortable", () => {
    for (const needs of [16_000_000, 93_750_000, 2_041_666_667]) expect(stageOf(startIncome(needs), needs).index).toBe(3);
    expect(startIncome(0)).toBe(INCOME_MIN);
  });

  it("still runs from horrid at the far left to ritzy at the far right, through every face, whatever the list needs", () => {
    // Nothing yet, a Peloton and its membership, the owner's watches, and a yacht with its crew; in dollars, euros and yen.
    const lists = [[], [wish("Peloton", "buy", 2_695, [{ label: "All-Access Membership", amountCents: 4_999, period: "month" }])], [wish("Rolex", "buy", 40_000), wish("Patek", "buy", 35_000)], [wish("Yacht", "own", 5_000_000, [yearly("Crew", 1_200_000)], photos("vehicle"))]];
    for (const list of lists) {
      for (const [rate, unit] of [[1, 1], [0.92, 1], [152, 100]] as const) {
        const needs = need(...list);
        const steps = incomeSteps(rate, unit, fullRange(needs));
        const faces = steps.map((s) => stageOf(s, needs).index);
        expect(faces[0]).toBe(0);
        expect(faces.at(-1)).toBe(STAGES - 1);
        expect(new Set(faces).size).toBe(STAGES);
        expect([...faces].sort((a, b) => a - b)).toEqual(faces);
        expect(steps[0]!).toBeLessThanOrEqual((INCOME_MIN / rate) * unit + 1);
        expect(steps.at(-1)!).toBeGreaterThanOrEqual((INCOME_MAX / rate) * unit - 1);
        for (const s of steps) expect(incomeAt(fractionOf(s, steps), steps)).toBe(s);
      }
    }
  });
});

describe("the price matrix", () => {
  it("doesn't call $75,000 of watches comfortable on $80,000 a year (owner, 2026-10-30)", () => {
    const watches = need(wish("Rolex Daytona", "buy", 40_000), wish("Patek Philippe Calatrava", "buy", 35_000));
    expect(watches).toBe(93_750_000); // $937,500: things take about a month's pay, 8% of a year's income
    expect(comfortableIncome(watches)).toBe(94_000_000); // reads $940,000
    expect(stageOf(8_000_000, watches)).toEqual({ index: 0, line: "Out of reach for now" });
    expect(stageOf(comfortableIncome(watches), watches).index).toBe(3);
  });

  it("asks $125,000 for a $10,000 watch", () => {
    expect(need(wish("Omega Speedmaster", "buy", 10_000))).toBe(12_500_000);
    expect(comfortableIncome(12_500_000)).toBe(13_000_000);
  });

  it("puts a home on a mortgage and the 28% rule, its upkeep included", () => {
    const villa = wish("Villa in Malta", "own", 1_000_000, [yearly("Property tax", 10_000), yearly("Home insurance", 5_000), yearly("Maintenance", 10_000)]);
    expect(categoryOf(villa)).toBe("home");
    // 80% borrowed at 6.5% over 30 years is about $60,700 a year, plus $25,000 of upkeep, over 28%.
    expect(need(villa) / 100).toBeCloseTo(305_995, 0);
    expect(comfortableIncome(need(villa))).toBe(31_000_000); // about $310,000
    // With no upkeep recorded, it counts 1.5% of the price a year.
    expect(comfortableIncome(need(wish("Townhouse in Lisbon", "own", 1_000_000, [], photos("place"))))).toBe(28_000_000);
  });

  it("puts a car on a four-year loan and the 12% rule, its running costs included", () => {
    const car = wish("Mercedes-AMG G 63", "own", 241_000, [yearly("Insurance", 6_000), yearly("Fuel", 5_000), yearly("Maintenance", 4_000)], photos("vehicle"));
    expect(categoryOf(car)).toBe("vehicle");
    expect(need(car) / 100).toBeCloseTo(627_083.33, 1);
    expect(comfortableIncome(need(car))).toBe(63_000_000); // about $630,000
  });

  it("gives trips, experiences, staff and memberships a tenth of a year's income", () => {
    expect(need(wish("Two weeks in Kyoto", "visit", 20_000))).toBe(20_000_000);
    expect(categoryOf(wish("Private chef", "do", 0, [yearly("Chef", 100_000)]))).toBe("service");
    expect(need(wish("Private chef", "do", 0, [yearly("Chef", 100_000)]))).toBe(100_000_000);
    // A thing's own running costs take a tenth too: a Peloton is 8% of its price and 10% of its membership.
    expect(need(wish("Peloton", "buy", 2_695, [yearly("All-Access Membership", 600)]))).toBeCloseTo(269_500 / 0.08 + 60_000 / 0.1, 6);
  });

  it("adds up a mixed list", () => {
    const list = [wish("Omega Speedmaster", "buy", 10_000), wish("Two weeks in Kyoto", "visit", 20_000), wish("Private chef", "do", 0, [yearly("Chef", 100_000)]), wish("Yacht", "own", 5_000_000, [yearly("Crew", 1_200_000)], photos("vehicle"))];
    const parts = list.map((w) => needFor(wishEntry(w)!));
    expect(parts.map((p) => Math.round(p / 100))).toEqual([125_000, 200_000, 1_000_000, 20_416_667]);
    expect(need(...list)).toBeCloseTo(parts.reduce((a, b) => a + b, 0), 6);
    expect(comfortableIncome(need(...list))).toBe(2_200_000_000); // $21,741,667 reads $22 million
  });

  it("leaves priceless wishes out and counts money as a thing", () => {
    const love = wish("Time with my mother", "do", 0, [], { worth: "priceless", line: "No price." });
    expect(wishEntry(love)).toBeNull();
    expect(need(wish("Omega Speedmaster", "buy", 10_000), love)).toBe(12_500_000);
    expect(need(love)).toBe(0);
    expect(categoryOf(wish("A million dollars", "buy", 1_000_000, [], { worth: "money" }))).toBe("money");
    expect(need(wish("A million dollars", "buy", 1_000_000, [], { worth: "money" }))).toBe(1_250_000_000);
    expect(poolEntry(card({ kind: "do", upfrontCents: 0, worth: "priceless" }))).toBeNull();
  });

  it("tells a vehicle from a home by its photos, the pool, its running costs and its name", () => {
    expect(categoryOf(wish("Porsche 911", "own", 150_000, [], photos("vehicle")))).toBe("vehicle");
    expect(categoryOf(wish("Penthouse", "own", 900_000, [], photos("place")))).toBe("home");
    // The dream builder's keep lines, with no photos saved.
    expect(categoryOf(wish("Flat in Valletta", "own", 600_000, [yearly("Property tax", 1_000), yearly("Maintenance", 9_000)]))).toBe("home");
    expect(categoryOf(wish("Range Rover", "own", 3_000_000, [yearly("Insurance", 5_000), yearly("Fuel", 4_000)]))).toBe("vehicle");
    // Only maintenance known: the name says villa.
    expect(categoryOf(wish("Sea-view villa in Sliema", "own", 900_000, [yearly("Maintenance", 13_500)]))).toBe("home");
    // Truly unknown: a vehicle under $2 million, a home from there.
    expect(categoryOf(wish("Something to own", "own", 1_500_000))).toBe("vehicle");
    expect(categoryOf(wish("Something to own", "own", 2_500_000))).toBe("home");
    // A car the catalogue lists as bought is still a car; a chair isn't a home.
    expect(categoryOf(wish("Porsche 911 Carrera", "buy", 135_500, [], photos("vehicle")))).toBe("vehicle");
    expect(categoryOf(wish("Eames Lounge Chair", "buy", 8_036, [], photos("product")))).toBe("thing");
  });

  it("reads the welcome's cards the same way, the pool's own word included", () => {
    const of = (c: PoolCard) => poolEntry(c)!.category;
    // The archive's cars are "drive" with product photos; its homes and land are "live" in the home group.
    expect(of(card({ kind: "own", category: "drive", group: "things", upfrontCents: 300_000_000, media: { kind: "product" } }))).toBe("vehicle");
    expect(of(card({ kind: "own", category: "live", group: "home", upfrontCents: 50_000_000, media: { kind: "place" } }))).toBe("home");
    expect(of(card({ kind: "own", category: "live", group: "home", upfrontCents: 50_000_000 }))).toBe("home");
    // The first wish's card says "live" for anything owned: its photos decide.
    expect(of(card({ kind: "own", category: "live", group: "things", upfrontCents: 24_100_000, media: { kind: "vehicle" } }))).toBe("vehicle");
    expect(of(card({ kind: "buy", category: "live", group: "home", upfrontCents: 803_600, media: { kind: "product" } }))).toBe("thing");
    expect(of(card({ kind: "visit", category: "travel", group: "travel", upfrontCents: 360_800 }))).toBe("trip");
    expect(of(card({ kind: "do", category: "travel", group: "travel", upfrontCents: 0, recurring: [yearly("Membership", 1_200)] }))).toBe("service");
    expect(of(card({ kind: "buy", category: "capture", upfrontCents: 1_000_000_00, worth: "money" }))).toBe("money");
  });

  it("prices the title's Porsche 911 as a car, not a month's pay", () => {
    const porsche = entry("porsche-911")!;
    expect(poolEntry(porsche)!.category).toBe("vehicle");
    // $135,500 on a four-year loan is $33,875 a year, over 12%: about $282,000, not the $1.7 million a watch would ask.
    expect(needOf([poolEntry(porsche)])).toBeCloseTo(porsche.upfrontCents / 4 / 0.12, 6);
    expect(comfortableIncome(needOf([poolEntry(porsche)]))).toBeLessThan(porsche.upfrontCents / 0.08 / 5);
  });
});

describe("the describe call's judgment", () => {
  const judged = (comfort: unknown, tier: Wish["tier"] = "nice") => wish("Rolex Daytona", "buy", 40_000, [], { comfort } as WishDetails, tier);

  it("takes the judged kind, way to pay and share when a wish has one", () => {
    expect(need(judged({ category: "thing", financing: "cash", share: 0.05, why: "A dream, so a small share.", tier: "nice", at: "2026-10-30T00:00:00Z" }))).toBe(80_000_000);
    // A share past the bounds is held to them.
    expect(need(judged({ category: "thing", financing: "cash", share: 0.9, why: "", tier: "nice", at: "" }))).toBeCloseTo(4_000_000 / 0.35, 6);
    expect(need(judged({ category: "thing", financing: "cash", share: 0.001, why: "", tier: "nice", at: "" }))).toBe(200_000_000);
    // Its running costs take the same share, and a loan spreads the price over four years.
    const car = wish("Mercedes-AMG G 63", "own", 241_000, [yearly("Insurance", 15_000)], { comfort: { category: "vehicle", financing: "loan", share: 0.15, why: "", tier: "must", at: "" } }, "must");
    expect(need(car)).toBeCloseTo(((24_100_000 / 4 + 1_500_000) / 0.15), 6);
  });

  it("falls back to the matrix when the judgment can't be used", () => {
    for (const junk of [null, "thing", { category: "spaceship", financing: "cash", share: 0.08 }, { category: "thing", financing: "lease", share: 0.08 }, { category: "thing", financing: "cash", share: "lots" }, { category: "thing", financing: "cash", share: 0 }, { category: "thing", financing: "cash", share: Number.NaN }]) {
      expect(need(judged(junk))).toBe(50_000_000);
    }
  });

  it("asks for a judgment until a wish has one for its tier", () => {
    const judgment = { category: "thing", financing: "cash", share: 0.06, why: "", tier: "nice", at: "" };
    expect(unjudged(judged(undefined))).toBe(true);
    expect(unjudged(judged(judgment))).toBe(false);
    expect(unjudged(judged(judgment, "dream"))).toBe(true);
    expect(unjudged(judged({ ...judgment, share: "lots" }))).toBe(true);
    expect(unjudged(wish("Time with my mother", "do", 0, [], { worth: "priceless" }))).toBe(false);
  });
});
