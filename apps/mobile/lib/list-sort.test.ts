import { describe, expect, it, vi } from "vitest";
import { sortChip, sortWishes, tapSort, type ListSort } from "./list-sort";

const wish = (id: string, name: string, createdAt: string, cents: number, worth?: "money" | "priceless") => ({
  id,
  name,
  createdAt,
  item: { upfrontCents: cents },
  details: worth ? { worth } : {},
});

// The list's own order is a, b, c, d, e, f.
const list = [
  wish("a", "Rolex Submariner", "2026-11-01T10:00:00Z", 1_050_000),
  wish("b", "a week in Lisbon", "2026-11-03T09:00:00Z", 412_900),
  wish("c", "Love", "2026-11-02T12:00:00Z", 0, "priceless"),
  wish("d", "Leica Q3", "2026-10-30T08:00:00Z", 735_000),
  wish("e", "Maine Coon kitten", "2026-11-02T18:00:00Z", 0),
  wish("f", "Money for a house deposit", "2026-10-31T07:00:00Z", 15_000_000, "money"),
];
const ids = (s: ListSort, from = list) => sortWishes(from, s).map((w) => w.id).join("");

describe("sorting the list (owner, 2026-11-03: date, A-Z and price, up and down for all)", () => {
  it("shows the list's own order until a sort is chosen, and never changes the list it was given", () => {
    expect(ids(null)).toBe("abcdef");
    sortWishes(list, { key: "price", dir: "desc" });
    expect(list.map((w) => w.id).join("")).toBe("abcdef");
  });

  it("sorts by the day each wish was added, newest first or oldest first", () => {
    expect(ids({ key: "date", dir: "desc" })).toBe("becafd");
    expect(ids({ key: "date", dir: "asc" })).toBe("dfaceb");
  });

  it("sorts by name A to Z or Z to A, ignoring case", () => {
    expect(ids({ key: "name", dir: "asc" })).toBe("bdcefa");
    expect(ids({ key: "name", dir: "desc" })).toBe("afecdb");
  });

  it("sorts by price lowest or highest first, a money wish by its amount, and keeps the unpriced last either way", () => {
    // c is priceless and e has no price yet: they stay at the end, in the list's own order.
    expect(ids({ key: "price", dir: "asc" })).toBe("bdafce");
    expect(ids({ key: "price", dir: "desc" })).toBe("fadbce");
  });

  it("keeps the list's own order between equals, whichever way the sort runs", () => {
    const twins = [wish("x", "Leica Q3", "2026-11-01T10:00:00Z", 735_000), wish("y", "leica q3", "2026-11-01T10:00:00Z", 735_000)];
    for (const key of ["date", "name", "price"] as const) {
      expect(ids({ key, dir: "asc" }, twins)).toBe("xy");
      expect(ids({ key, dir: "desc" }, twins)).toBe("xy");
    }
  });

  it("starts each chip the useful way round, and a second tap turns it around", () => {
    expect(tapSort(null, "date")).toEqual({ key: "date", dir: "desc" });
    expect(tapSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(tapSort(null, "price")).toEqual({ key: "price", dir: "asc" });
    expect(tapSort({ key: "date", dir: "desc" }, "date")).toEqual({ key: "date", dir: "asc" });
    expect(tapSort({ key: "date", dir: "asc" }, "date")).toEqual({ key: "date", dir: "desc" });
    expect(tapSort({ key: "date", dir: "asc" }, "price")).toEqual({ key: "price", dir: "asc" });
  });

  it("shows an arrow on the chip that is on, and says in words which way it runs", () => {
    expect(sortChip("price", null)).toEqual({ label: "Price", spoken: "Sort by price, lowest first" });
    expect(sortChip("name", null)).toEqual({ label: "A-Z", spoken: "Sort by name, A to Z" });
    expect(sortChip("date", { key: "date", dir: "desc" })).toEqual({ label: "Date ↓", spoken: "Sorted newest first. Tap for oldest first" });
    expect(sortChip("price", { key: "price", dir: "asc" })).toEqual({ label: "Price ↑", spoken: "Sorted lowest first. Tap for highest first" });
    expect(sortChip("name", { key: "price", dir: "asc" }).label).toBe("A-Z");
  });

  // iOS Hermes builds Intl on NSFoundation, and an Intl gap crashed TestFlight 11 and 12 at launch.
  it("sorts names without Intl.Collator, as an engine without it would", async () => {
    vi.resetModules();
    const real = Intl.Collator;
    Object.defineProperty(Intl, "Collator", { configurable: true, writable: true, value: function NoCollator() { throw new Error("no Collator"); } });
    try {
      const fresh = await import("./list-sort");
      expect(fresh.sortWishes(list, { key: "name", dir: "asc" }).map((w) => w.id).join("")).toBe("bdcefa");
    } finally {
      Object.defineProperty(Intl, "Collator", { configurable: true, writable: true, value: real });
    }
  });
});
