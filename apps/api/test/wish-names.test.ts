import { describe, expect, it } from "vitest";
import { buildExtras, buildWishName, listingWishName } from "../src/dream/names";
import type { CarBuildState } from "../src/dream/types";

const build = (model: string, trim: string, rest: Record<string, string[]> = {}, make = "Porsche"): CarBuildState => ({
  id: "b1",
  make,
  model: "911",
  sourceUrl: "https://www.porsche.com/usa/models/911/",
  sourceCurrency: "USD",
  rate: 1,
  checkedAt: "2026-11-03T00:00:00Z",
  steps: [
    { id: "model", title: "Model", multi: false, choices: [{ id: "m", label: model, verified: true }], selected: ["m"] },
    { id: "trim", title: "Trim", multi: false, choices: trim ? [{ id: "t", label: trim, verified: true }] : [], selected: trim ? ["t"] : [] },
    ...["colour", "interior", "options"].map((id) => ({
      id,
      title: id,
      multi: id === "options",
      choices: (rest[id] ?? []).map((label, i) => ({ id: `${id}${i}`, label, verified: true })),
      selected: (rest[id] ?? []).map((_, i) => `${id}${i}`),
    })),
  ],
});

describe("wish names from a listing (demo film, 2026-11-03: 'Austin Luxury House for Sale | $1,045,000')", () => {
  it("drops the site's suffix, the price and the 'for sale' a listing title carries", () => {
    expect(listingWishName("Austin Luxury House for Sale | $1,045,000")).toBe("Austin Luxury House");
    expect(listingWishName("House for sale in Austin, TX - $849,000")).toBe("House in Austin, TX");
    expect(listingWishName("Villa Sliema")).toBe("Villa Sliema");
  });

  it("drops a trailing listing number and site name after a dash (demo film take 2)", () => {
    expect(listingWishName("Luxury 4 bedroom Detached House for sale in Austin, United States - 13248191 LuxuryEstate.com")).toBe(
      "Luxury 4 bedroom Detached House in Austin, United States",
    );
    expect(listingWishName("Lake house - Zillow")).toBe("Lake house - Zillow");
    expect(listingWishName("Villa Mare - Ref 48213 - idealista.com")).toBe("Villa Mare");
    // A dash inside the name stays: only whole trailing parts that are a number or a site go.
    expect(listingWishName("Rolls-Royce Cullinan - 2024")).toBe("Rolls-Royce Cullinan - 2024");
  });

  it("keeps a place, a ZIP code or a size that follows a dash (review of b054672)", () => {
    expect(listingWishName("Hill Country Retreat - Wimberley, TX 78676")).toBe("Hill Country Retreat - Wimberley, TX 78676");
    expect(listingWishName("Unit 5 - 12345 Oak Street")).toBe("Unit 5 - 12345 Oak Street");
    expect(listingWishName("Penthouse - 2,500 Sq.Ft.")).toBe("Penthouse - 2,500 Sq.Ft.");
    expect(listingWishName("Villa Mare - MLS 4821377")).toBe("Villa Mare");
  });

  it("leaves no debris where 'for sale' was, and drops a price written the European way", () => {
    expect(listingWishName("Villa - For Sale - Marbella")).toBe("Villa - Marbella");
    expect(listingWishName("Charming Cottage (For Sale)")).toBe("Charming Cottage");
    expect(listingWishName("Cozy Bungalow For Sale By Owner")).toBe("Cozy Bungalow");
    expect(listingWishName("Villa en venta - 1.045.000 €")).toBe("Villa en venta");
    expect(listingWishName("House - £1,045,000 GBP")).toBe("House");
  });

  it("names the wish from the rest of the title when its first part is only 'For Sale'", () => {
    expect(listingWishName("For Sale • 3 bed house in Austin")).toBe("3 bed house in Austin");
  });

  it("ends a long name on a whole word, with nothing dangling", () => {
    const name = listingWishName(`${"Grand ".repeat(30)}Estate - 13248191 LuxuryEstate.com`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/Grand$/);
  });

  it("keeps a title that is nothing but the words it drops, rather than naming the wish nothing", () => {
    expect(listingWishName("For Sale | Zillow")).toBe("For Sale");
    expect(listingWishName("  ")).toBe("");
  });
});

describe("wish names from a car build (demo film, 2026-11-03: 'Porsche 911 Carrera, 911 Carrera, Contrasts, ...')", () => {
  it("names the model, and the trim only when it adds words the model doesn't have", () => {
    expect(buildWishName(build("Porsche 911 Carrera", "911 Carrera", { colour: ["Contrasts"], options: ["Ventilated Seats (Front)"] }))).toBe("Porsche 911 Carrera");
    expect(buildWishName(build("Porsche 911", "Carrera GTS"))).toBe("Porsche 911 Carrera GTS");
    expect(buildWishName(build("Mercedes-AMG G 63", "G 63", { colour: ["Obsidian Black metallic"] }, "Mercedes-Benz"))).toBe("Mercedes-AMG G 63");
    expect(buildWishName(build("Mercedes-Benz G-Class", "G 550 SUV", {}, "Mercedes-Benz"))).toBe("Mercedes-Benz G-Class G 550 SUV");
  });

  it("adds only the trim's new words when the trim repeats the model's last words (review of b054672)", () => {
    expect(buildWishName(build("Porsche 911 Carrera", "911 Carrera S"))).toBe("Porsche 911 Carrera S");
    expect(buildWishName(build("Porsche 911 Carrera", "Carrera S"))).toBe("Porsche 911 Carrera S");
    expect(buildWishName(build("Mercedes-AMG G 63", "G 63 4MATIC", {}, "Mercedes-Benz"))).toBe("Mercedes-AMG G 63 4MATIC");
    expect(buildWishName(build("Porsche 911 Carrera", "Carrera 911"))).toBe("Porsche 911 Carrera");
  });

  it("matches the maker's name with or without its accents", () => {
    expect(buildWishName(build("ŠKODA Octavia", "vRS", {}, "Skoda"))).toBe("ŠKODA Octavia vRS");
    expect(buildWishName(build("Citroën C5 X", "", {}, "Citroen"))).toBe("Citroën C5 X");
  });

  it("puts the maker in front of a model label that leaves it out", () => {
    expect(buildWishName(build("911 Carrera", ""))).toBe("Porsche 911 Carrera");
  });

  it("falls back to the maker and model when the build has no model label", () => {
    expect(buildWishName(build("", ""))).toBe("Porsche 911");
  });

  it("lists the colour, interior and options it leaves out of the name, in the order they were chosen", () => {
    expect(buildExtras(build("Porsche 911 Carrera", "911 Carrera", { colour: ["Contrasts"], interior: ["Black leather"], options: ["Ventilated Seats (Front)", "Sport Chrono"] }))).toEqual([
      "Contrasts",
      "Black leather",
      "Ventilated Seats (Front)",
      "Sport Chrono",
    ]);
    expect(buildExtras(build("Porsche 911", "Carrera"))).toEqual([]);
  });
});
