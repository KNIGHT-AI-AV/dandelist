import { describe, expect, it } from "vitest";
import { adminDate, adminDay, adminMoney, adminNumber, adminWhen, byDay } from "./admin";

describe("the admin view's figures", () => {
  it("shows dollars to the cent, and model-call sizes under a dollar to a tenth of a cent", () => {
    expect(adminMoney(24.17)).toBe("$24.17");
    expect(adminMoney(0.0124)).toBe("$0.012");
    expect(adminMoney(0)).toBe("$0.00");
    expect(adminNumber(1234567.4)).toBe("1,234,567");
  });

  it("reads a UTC day as its own date, and an empty time as never", () => {
    expect(adminDay("2026-11-02")).toBe("Nov 2");
    expect(adminDay("2026-11-02T23:30:00.000Z")).toBe("Nov 2");
    expect(adminDay(null)).toBe("never");
    expect(adminWhen(null)).toBe("never");
    expect(adminDate(null)).toBe("never");
    expect(adminDate("2026-11-02T12:00:00.000Z")).toMatch(/^Nov [12]$/);
  });

  it("groups usage by day, newest first, each day with its total and its kinds by spend", () => {
    const row = (day: string, kind: string, usd: number, calls = 1) => ({ day, kind, usd, calls, inputTokens: 10, outputTokens: 2, searches: 0 });
    const days = byDay([row("2026-11-01", "research", 0.05), row("2026-11-02", "research", 0.1, 3), row("2026-11-02", "guest", 0.25, 2)]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-02", "2026-11-01"]);
    expect(days[0]).toMatchObject({ calls: 5 });
    expect(days[0]!.usd).toBeCloseTo(0.35);
    expect(days[0]!.kinds.map((k) => k.kind)).toEqual(["guest", "research"]);
  });
});
