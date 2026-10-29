import { describe, expect, it } from "vitest";
import { COUNTRIES, citiesOf, cleanCity, countryName, fold, placeLabel, searchCities, searchCountries } from "./places";

describe("the place list", () => {
  it("has one entry per two-letter code, and cities only for listed countries", () => {
    const codes = COUNTRIES.map(([c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(codes.length).toBeGreaterThan(235);
    for (const [code] of COUNTRIES) for (const city of citiesOf(code)) expect(city.length).toBeLessThanOrEqual(60);
    // The countries people dream of most all have cities.
    for (const code of ["US", "GB", "FR", "IT", "ES", "PT", "MT", "AE", "JP", "ID", "MC", "CH", "AU", "MX", "BR", "ZA", "NG"]) expect(citiesOf(code).length).toBeGreaterThan(0);
  });

  it("names countries in English", () => {
    expect(countryName("mt")).toBe("Malta");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("search", () => {
  it("folds accents and the letters that don't decompose", () => {
    expect(fold("Łódź")).toBe("lodz");
    expect(fold("São Tomé and Príncipe")).toBe("sao tome and principe");
    expect(fold("  St. Julian's ")).toBe("st julian s");
  });

  it("finds countries by name, by another name, and by a city in them", () => {
    expect(searchCountries("")[0]!.name).toBe("Afghanistan");
    expect(searchCountries("mal").slice(0, 3).map((h) => h.code)).toEqual(expect.arrayContaining(["MW", "MY", "MV"]));
    expect(searchCountries("uk")[0]!.code).toBe("GB");
    expect(searchCountries("usa")[0]!.code).toBe("US");
    expect(searchCountries("turkey")[0]!.code).toBe("TR");
    expect(searchCountries("korea").map((h) => h.code)).toEqual(expect.arrayContaining(["KR", "KP"]));
    const dubai = searchCountries("dubai");
    expect(dubai[0]).toEqual({ code: "AE", name: "United Arab Emirates", city: "Dubai" });
    expect(searchCountries("cote")[0]!.code).toBe("CI");
    expect(searchCountries("qqqq")).toEqual([]);
  });

  it("finds a country's cities, starts-with first, and keeps the rest of the order", () => {
    expect(searchCities("PT", "")[0]).toBe("Lisbon");
    expect(searchCities("FR", "saint")).toEqual(["Saint-Tropez"]);
    expect(searchCities("IT", "po")).toEqual(["Positano", "Portofino"]);
    expect(searchCities("PL", "lodz")).toEqual(["Łódź"]);
    expect(searchCities("ZZ", "x")).toEqual([]);
  });

  it("labels a place within the API's 80 characters and tidies typed cities", () => {
    expect(placeLabel("PT", "Lisbon")).toBe("Lisbon, Portugal");
    expect(placeLabel("MT")).toBe("Malta");
    expect(placeLabel("VC", "x".repeat(60)).length).toBeLessThanOrEqual(80);
    expect(cleanCity("  Saint   Tropez ")).toBe("Saint Tropez");
    expect(cleanCity("   ")).toBeNull();
  });
});
