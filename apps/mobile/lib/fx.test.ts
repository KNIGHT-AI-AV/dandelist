import { describe, expect, it } from "vitest";
import { FALLBACK_RATES, formatCompact, formatIn, isCurrency, readRates, symbolOf, toLocal, toUsd } from "./fx";

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

  it("reads only sane rates", () => {
    expect(readRates({ rates: { EUR: 0.9, GBP: -1, JPY: "x" } })).toEqual({ ...FALLBACK_RATES, EUR: 0.9 });
    expect(readRates({ rates: {} })).toBeNull();
    expect(readRates(null)).toBeNull();
  });
});
