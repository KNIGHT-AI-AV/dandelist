import { describe, expect, it } from "vitest";
import { moneyIn, webOnly, wishFrom } from "./dream";

const base = { name: "Sea-view villa", kind: "own" as const, status: "verified" as const, images: [{ url: "https://example.com/v.jpg" }], url: "https://example.com/villa", checkedAt: "2026-10-27T10:00:00Z" };

describe("dream wishes", () => {
  it("stores a euro find in dollars at the rate sent with it", () => {
    const w = wishFrom({ ...base, upfrontCents: 372_000_000, currency: "EUR", toUsd: { rate: 1.08, date: "2026-10-27" }, keep: [{ label: "Maintenance", amountCents: 5_580_000, period: "year", basis: "1.5%", estimate: true }] });
    expect(w.upfrontCents).toBe(401_760_000);
    expect(w.recurring[0]).toMatchObject({ amountCents: 6_026_400, period: "year" });
    expect(w.details?.agent?.source).toEqual({ currency: "EUR", price: 3_720_000, rate: 1.08, rateDate: "2026-10-27" });
  });

  it("refuses a foreign find with no rate rather than storing euros as dollars", () => {
    expect(() => wishFrom({ ...base, upfrontCents: 100, currency: "EUR", keep: [] })).toThrow(/exchange rate/);
  });

  it("formats in the find's own currency and keeps only web links", () => {
    expect(moneyIn("EUR")(372_000_000)).toBe("€3,720,000");
    expect(webOnly("javascript:alert(1)")).toBe("");
  });
});
