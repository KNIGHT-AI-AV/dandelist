import { describe, expect, it } from "vitest";
import { nameOf, plausible, readingOf } from "../src/agent/agent";
import { subjectOf } from "../src/agent/photos";
import { widerBriefs } from "../src/dream/agent";
import { resultFor, titleFigure, withScheme } from "../src/agent/estimate";
import type { CarCriteria, HomeCriteria } from "../src/dream/types";

/** The owner, 2026-10-30: "if someone types in pink G-Wagon, we should know what the fuck they're talking about". */
describe("a wish understood as an expert would read it", () => {
  const read = { title: "Mercedes-AMG G 63 in pink", name: "Mercedes-AMG G 63", kind: "own" as const, summary: "", specifics: [], region: "US", currency: "USD", unknowns: [] };

  it("keeps the bare name shops and photos use, apart from the colour asked for", () => {
    const draft = readingOf({ ...read, sure: true, others: ["Mercedes-Benz G 550"] }) as typeof read & { sure: boolean; others: string[] };
    expect(nameOf(draft)).toBe("Mercedes-AMG G 63");
    expect(subjectOf(draft).title).toBe("Mercedes-AMG G 63");
    // Sure means no alternatives to offer.
    expect(draft.others).toEqual([]);
  });

  it("offers the alternatives when it had to work out what was meant", () => {
    const draft = readingOf({ ...read, title: "Maine Coon kitten", name: "Maine Coon kitten", sure: false, others: ["Norwegian Forest kitten", " Siberian kitten ", "", "Ragdoll", "Lykoi"] }) as { sure: boolean; others: string[] };
    expect(draft.sure).toBe(false);
    expect(draft.others).toEqual(["Norwegian Forest kitten", "Siberian kitten", "Ragdoll"]);
  });

  it("falls back to the title when an older or odd reading gives no name", () => {
    const draft = readingOf({ ...read, name: 7, sure: "yes" }) as { name?: string; sure: boolean; title: string };
    expect(draft.name).toBeUndefined();
    expect(draft.sure).toBe(true);
    expect(nameOf(draft)).toBe("Mercedes-AMG G 63 in pink");
  });
});

describe("a listings search that finds nothing looks wider instead of stopping", () => {
  const car: CarCriteria = { kind: "car", make: "Mercedes-AMG", model: "G 63", trim: "Grand Edition", colour: "pink", condition: "new", maxPrice: null, currency: "USD", notes: "" };

  it("drops a car's colour first, then its trim, two wider searches at most", () => {
    const wider = widerBriefs(car);
    expect(wider.map((w) => w.dropped)).toEqual(["colour", "trim"]);
    expect(wider[0]!.criteria).toMatchObject({ colour: "", trim: "Grand Edition" });
    expect(wider[1]!.criteria).toMatchObject({ colour: "", trim: "" });
  });

  it("drops a home's style and features, then its bedrooms", () => {
    const home = { kind: "home", place: null, away: false, styles: ["Modern"], features: ["Pool"], avoid: [], bedrooms: 4, maxPrice: 2_000_000, currency: "USD", notes: "" } as unknown as HomeCriteria;
    expect(widerBriefs(home).map((w) => w.dropped)).toEqual(["style", "bedrooms"]);
  });

  it("has nothing wider for a bare brief", () => {
    expect(widerBriefs({ ...car, colour: "", trim: "", condition: "any" })).toEqual([]);
  });
});

/** The owner, 2026-10-30: a pink G-Wagon came back as a $79 ride-on toy. */
describe("a price far from the real thing's typical price", () => {
  const gWagon = { typical: 150_000 };

  it("passes the thing's own price, used or built up, and refuses a toy, a monthly payment or a misread", () => {
    expect(plausible(gWagon, 7_900)).toBe(false);
    expect(plausible(gWagon, 250_000)).toBe(false);
    expect(plausible(gWagon, 3_000_000)).toBe(true);
    expect(plausible(gWagon, 15_000_000)).toBe(true);
    expect(plausible(gWagon, 90_000_000)).toBe(true);
    expect(plausible(gWagon, 2_000_000_000)).toBe(false);
  });

  it("judges nothing without a typical price, or with nothing to pay upfront", () => {
    expect(plausible({}, 7_900)).toBe(true);
    expect(plausible({ typical: 0 }, 7_900)).toBe(true);
    expect(plausible(gWagon, 0)).toBe(true);
  });

  it("reads the typical price as a plain amount, or none", () => {
    const typical = (v: unknown) => (readingOf({ title: "x", typical: v }) as { typical: number }).typical;
    expect(typical(150_000)).toBe(150_000);
    expect(typical(-5)).toBe(0);
    expect(typical("lots")).toBe(0);
    expect(typical(Number.NaN)).toBe(0);
    expect(typical(undefined)).toBe(0);
  });
});

describe("the last word's figure keeps its source (owner, 2026-10-30)", () => {
  const returned = [
    { url: "https://www.kbb.com/mercedes-benz/mercedes-amg-g-class/", title: "Mercedes-AMG G-Class Price" },
    { url: "https://www.kbb.com/", title: "Kelley Blue Book" },
    { url: "https://carbuzz.com/g-class-price/", title: "G-Class pricing" },
  ];

  it("reads a bare site the model wrote without its https://, and leaves full addresses alone", () => {
    expect(withScheme("I'll search for the price. europesays.com | $1,500 | USD")).toBe("I'll search for the price. https://europesays.com | $1,500 | USD");
    expect(withScheme("www.kbb.com/mercedes | $200,200 | USD")).toBe("https://www.kbb.com/mercedes | $200,200 | USD");
    expect(withScheme("https://carbuzz.com/g-class-price/ | $153,900 | USD")).toBe("https://carbuzz.com/g-class-price/ | $153,900 | USD");
    expect(withScheme("0")).toBe("0");
  });

  it("reads a price a result's own title states, when the title names the thing", () => {
    const results = [
      { url: "https://www.neowin.net/news/stadium/", title: "A sealed copy of rare NES game Stadium Events sells for $41,977" },
      { url: "https://example.com/other", title: "Some other game sells for $12" },
    ];
    expect(titleFigure(results, ["Stadium", "Events", "NES"])).toEqual({ amount: 41977, currency: "USD", page: "https://www.neowin.net/news/stadium/" });
    expect(titleFigure([{ url: "https://x.example/", title: "Stadium Events review" }], ["Stadium", "Events"])).toBeNull();
    expect(titleFigure([{ url: "https://x.example/", title: "Rolex Daytona for £185,000" }], ["Rolex", "Daytona"])).toMatchObject({ amount: 185000, currency: "GBP" });
  });

  it("maps a site's home page to that site's result naming the thing, and refuses a site the search never returned", () => {
    expect(resultFor("https://www.kbb.com", returned, ["Mercedes-AMG", "G-Class"])).toBe("https://www.kbb.com/mercedes-benz/mercedes-amg-g-class/");
    expect(resultFor("https://carbuzz.com/g-class-price/", returned, ["G-Class"])).toBe("https://carbuzz.com/g-class-price/");
    expect(resultFor("https://www.edmunds.com/", returned, ["G-Class"])).toBeNull();
  });
});
