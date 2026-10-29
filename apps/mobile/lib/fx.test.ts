import { describe, expect, it } from "vitest";
import { CURRENCIES, formatCompact, formatIn, isCurrency, symbolOf, toLocal, toUsd } from "./fx";

describe("currencies", () => {
  it("shows whole units in each currency", () => {
    expect(formatIn("USD", 1, 19_875_000)).toBe("$198,750");
    expect(formatIn("EUR", 0.92, 19_875_000)).toBe("€182,850");
    expect(formatIn("GBP", 0.78, 100_00)).toBe("£78");
    expect(formatIn("JPY", 150, 100_00)).toBe("¥15,000");
    expect(formatIn("CNY", 7.2, 100_00)).toBe("CN¥720");
  });

  it("shortens big figures", () => {
    expect(formatCompact("USD", 1, 720_000_000)).toBe("$7.2M");
    expect(formatCompact("EUR", 1, 94_000_000)).toBe("€940K");
  });

  it("converts both ways", () => {
    expect(toLocal(100_00, 152)).toBe(1_520_000);
    expect(toUsd(1_520_000, 152)).toBe(100_00);
  });

  it("names symbols and checks codes", () => {
    expect(symbolOf("USD")).toBe("$");
    expect(symbolOf("JPY")).toBe("¥");
    expect(isCurrency("GBP")).toBe(true);
    expect(isCurrency("AED")).toBe(false);
  });

  it("matches Intl's compact currency figures everywhere they're shown", () => {
    for (const { code, symbol } of CURRENCIES) {
      const intl = new Intl.NumberFormat("en-US", { style: "currency", currency: code, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });
      expect(intl.formatToParts(0).find((p) => p.type === "currency")?.value).toBe(symbol);
      for (const units of [0, 7, 949.5, 999, 1_000, 1_049, 3_233.56, 94_000, 999_949, 999_960, 1_500_000, 7_249_999, 120_000_000, 999_999_999, 4_100_000_000, 2_000_000_000_000]) {
        expect(formatCompact(code, 1, units * 100)).toBe(intl.format(units));
      }
    }
  });

  it("works where Intl has no formatToParts and no compact notation (Hermes on iOS)", () => {
    const parts = Intl.NumberFormat.prototype.formatToParts;
    // @ts-expect-error: the method iOS builds lack
    delete Intl.NumberFormat.prototype.formatToParts;
    try {
      expect(CURRENCIES.map((c) => symbolOf(c.code))).toEqual(["$", "€", "£", "¥", "CN¥"]);
      expect(formatCompact("EUR", 0.92, 351_000_00)).toBe("€322.9K");
      expect(formatIn("CNY", 7.2, 100_00)).toBe("CN¥720");
    } finally {
      Intl.NumberFormat.prototype.formatToParts = parts;
    }
  });

});
