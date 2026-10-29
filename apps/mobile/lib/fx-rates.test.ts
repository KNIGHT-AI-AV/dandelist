import { describe, expect, it } from "vitest";
import { initialRateObservations, mergeRateObservations, rateDescription, readRateObservations, retainedRates, storeRateObservations } from "./fx-rates";

const observed = (rate: number, referenceDate = "2026-10-28", fetchedAt = referenceDate + "T16:00:00.000Z") => ({
  rate, source: "ecb" as const, referenceDate, fetchedAt, retained: false,
});
const response = (observations: Record<string, ReturnType<typeof observed>>) => ({
  base: "USD", date: "2026-10-28", rates: { USD: 1, ...Object.fromEntries(Object.entries(observations).map(([code, o]) => [code, o.rate])) }, observations,
});

describe("per-currency observations", () => {
  it("retains omitted currencies instead of replacing them with static estimates", () => {
    const first = mergeRateObservations(initialRateObservations(), readRateObservations(response({ EUR: observed(0.9), GBP: observed(0.75), JPY: observed(160) }), "network")!);
    const next = mergeRateObservations(first, readRateObservations(response({ EUR: observed(0.8, "2026-10-29") }), "network")!);
    expect(next.EUR).toEqual(observed(0.8, "2026-10-29"));
    expect(next.GBP).toEqual(first.GBP);
    expect(next.JPY).toEqual(first.JPY);
    expect(next.CNY.source).toBe("fallback");
  });

  it("preserves reference dates and successful fetch times through persistence", () => {
    const first = mergeRateObservations(initialRateObservations(), readRateObservations(response({ EUR: observed(0.9), GBP: observed(0.75, "2026-10-27") }), "network")!);
    const encoded = storeRateObservations(first);
    const restored = readRateObservations(JSON.parse(encoded), "cache")!;
    expect(restored.EUR).toEqual({ ...first.EUR, retained: true });
    expect(restored.GBP).toEqual({ ...first.GBP, retained: true });
    expect(JSON.parse(encoded).rates).toEqual({ USD: 1, EUR: 0.9, GBP: 0.75, JPY: 152, CNY: 7.2 });
    expect(restored.USD).toEqual(initialRateObservations().USD);
  });

  it("does not make a legacy cached number a dated provider observation", () => {
    const update = readRateObservations({ rates: { EUR: 0.85, GBP: -1, JPY: "x", USD: 2 } }, "cache")!;
    expect(update.EUR).toEqual({ rate: 0.85, source: "legacy", referenceDate: null, fetchedAt: null, retained: true });
    expect(update.GBP).toBeUndefined();
    expect(update.JPY).toBeUndefined();
    expect(update.USD?.rate).toBe(1);
    expect(rateDescription(update.EUR!)).toContain("Date unavailable");
  });

  it("accepts the older API without inventing a successful fetch time", () => {
    const update = readRateObservations({ base: "USD", date: "2026-10-28", rates: { EUR: 0.9 } }, "network")!;
    expect(update.EUR).toEqual({ ...observed(0.9), fetchedAt: null, retained: true });
    expect(rateDescription(update.EUR!)).toBe("ECB reference rate from 2026-10-28. Refresh time unavailable.");
  });

  it.each([
    null, {}, { rates: { EUR: 0.9 } }, { base: "EUR", date: "2026-10-28", rates: { EUR: 0.9 } },
    { base: "USD", date: "2026-02-30", rates: { EUR: 0.9 } },
    { base: "USD", date: "2026-10-28", rates: { USD: 1 } },
    { base: "USD", date: "2026-10-28", rates: { EUR: NaN, GBP: Infinity, JPY: -3 } },
    { ...response({ EUR: observed(0.9) }), rates: { EUR: 0.8 } },
    { ...response({ EUR: observed(0.9) }), observations: [] },
    response({ EUR: { ...observed(0.9), fetchedAt: "not a timestamp" } }),
  ])("rejects an invalid response without supplying fallback updates: %j", (body) => {
    expect(readRateObservations(body, "network")).toBeNull();
  });

  it("orders provider observations by reference date, then successful fetch time", () => {
    const latest = observed(0.8, "2026-10-29", "2026-10-29T18:00:00.000Z");
    const current = mergeRateObservations(initialRateObservations(), { EUR: latest });
    expect(mergeRateObservations(current, { EUR: observed(0.9, "2026-10-28", "2026-10-30T18:00:00.000Z") }).EUR).toEqual(latest);
    expect(mergeRateObservations(current, { EUR: observed(0.85, "2026-10-29", "2026-10-29T17:00:00.000Z") }).EUR).toEqual(latest);
    expect(mergeRateObservations(current, { EUR: observed(0.81, "2026-10-29", "2026-10-29T19:00:00.000Z") }).EUR.rate).toBe(0.81);
    expect(mergeRateObservations(current, { EUR: initialRateObservations().EUR }).EUR).toEqual(latest);
  });

  it("distinguishes late hydration from a server reporting retained rates", () => {
    const current = mergeRateObservations(initialRateObservations(), { EUR: observed(0.9) });
    const retained = { ...current.EUR, retained: true };
    expect(mergeRateObservations(current, { EUR: retained }, "cache").EUR.retained).toBe(false);
    expect(mergeRateObservations(current, { EUR: retained }, "network").EUR.retained).toBe(true);
    expect(retainedRates(current).EUR).toEqual(retained);
  });

  it("labels a weekend reference date without declaring an outage or changing the date", () => {
    const friday = observed(0.9, "2026-10-30");
    expect(rateDescription(friday)).toBe("ECB reference rate from 2026-10-30.");
    expect(rateDescription({ ...friday, retained: true })).toBe("Using the saved ECB rate from 2026-10-30.");
    expect(rateDescription(initialRateObservations().EUR)).toContain("Approximate conversion");
    expect(rateDescription(initialRateObservations().USD)).toBe("Prices are shown in US dollars.");
  });
});
