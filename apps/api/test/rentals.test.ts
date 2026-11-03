import { describe, expect, it } from "vitest";
import { rentLike } from "../src/dream/hunt";

// Filming the demo (2026-11-03), a home deck for a three-bedroom house to buy in Austin dealt "15700 Sage Grouse Dr,
// $1,950", a rental: its monthly rent was read as the price, and picking it priced a house at $1,950.
describe("a home listing whose price is really a rent", () => {
  it("is a rent when the page shows that same price by the month", () => {
    expect(rentLike(1950, "USD", "15700 Sage Grouse Dr. $1,950/mo 3 bds 2 ba Available now")).toBe(true);
    expect(rentLike(2400, "GBP", "Two-bed flat, £2,400 pcm, unfurnished")).toBe(true);
    expect(rentLike(1800, "EUR", "Piso en alquiler 1.800 € per month")).toBe(true);
  });

  it("is a rent when a home to buy is priced under 10,000 in a major currency", () => {
    expect(rentLike(1950, "USD", "")).toBe(true);
    expect(rentLike(9_500, "EUR", "")).toBe(true);
  });

  it("is a sale when the only monthly figure is the mortgage estimate beside the price", () => {
    expect(rentLike(1_045_000, "USD", "Austin Luxury House $1,045,000 Est. payment $5,231/mo 4 bds")).toBe(false);
  });

  it("leaves other currencies' small numbers alone, where a home really can cost that many units", () => {
    expect(rentLike(3_500_000_000, "IDR", "Villa in Ubud IDR 3,500,000,000")).toBe(false);
    expect(rentLike(8_000, "AED", "")).toBe(false);
  });
});
