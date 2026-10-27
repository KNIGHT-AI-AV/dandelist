import { describe, expect, it } from "vitest";
import { EXPO, REPEATS, REST, cellsOf, emWidth, lineAt, normalize, plan, target, wheelTables } from "./odometer-plan";

const keys = (s: string) => cellsOf(s).map((c) => c.key);

describe("cells keyed by place value (§2.1)", () => {
  it("keys digits from the units up and commas by the digits to their right", () => {
    expect(keys("$107,529")).toEqual(["prefix", "d5", "d4", "d3", "s3", "d2", "d1", "d0"]);
    expect(keys("$49.99")).toEqual(["prefix", "d1", "d0", "dot", "f1", "f2"]);
    expect(keys("$0")).toEqual(["prefix", "d0"]);
  });
  it("keeps the units wheel the units wheel when the figure grows", () => {
    const a = cellsOf("$9,999").find((c) => c.key === "d0")!;
    const b = cellsOf("$10,000").find((c) => c.key === "d0")!;
    expect(a.place).toBe(b.place);
  });
  it("measures $9,999 and $10,000 as the audit does", () => {
    const w = (s: string) => cellsOf(s).reduce((sum, c) => sum + emWidth(c, "bodoni"), 0);
    expect(w("$9,999")).toBeCloseTo(3.088, 3);
    expect(w("$10,000")).toBeCloseTo(3.668, 3);
  });
});

describe("travel (§2.2)", () => {
  it("rolls forward to the next occurrence, then adds turns", () => {
    expect(target(43, 7, 1, 0)).toBe(47);
    expect(target(47, 3, 1, 0)).toBe(53);
    expect(target(47, 3, 1, 2)).toBe(73);
    expect(target(47, 7, 1, 0)).toBe(47);
    expect(target(47, 7, 1, 1)).toBe(57);
    expect(target(47, 7, 1, 2)).toBe(67);
  });
  it("mirrors when the figure falls", () => {
    expect(target(43, 7, -1, 0)).toBe(37);
    expect(target(40, 9, -1, 0)).toBe(39);
    expect(target(47, 7, -1, 1)).toBe(37);
  });
  it("stays inside the column in every case, including a roll caught mid-way", () => {
    for (let cur = REST; cur < REST + 10; cur += 0.25) {
      for (let d = 0; d < 10; d++) {
        for (const turns of [0, 1, 2]) {
          for (const trend of [1, -1] as const) {
            const to = target(cur, d, trend, turns);
            expect(to - 0.06).toBeGreaterThanOrEqual(0);
            expect(to + 0.06).toBeLessThanOrEqual(REPEATS * 10 - 1);
          }
        }
      }
    }
  });
  it("renormalises into the rest window", () => {
    expect(normalize(73)).toBe(43);
    expect(normalize(37)).toBe(47);
  });
});

describe("plans (§2.2, §2.6, §2.11)", () => {
  it("QA 1: $0 to $107,529 in cinema, every wheel spins and they land left to right", () => {
    const p = plan(cellsOf("$0"), cellsOf("$107,529"), "cinema", 1);
    const order = ["d5", "d4", "d3", "d2", "d1", "d0"];
    expect(Object.keys(p.wheels).sort()).toEqual([...order].sort());
    const lands = order.map((k) => p.wheels[k]!.delay + p.wheels[k]!.duration);
    for (let i = 1; i < lands.length; i++) expect(lands[i]).toBeGreaterThan(lands[i - 1]!);
    expect(p.landsAt).toBe(1200);
    expect(p.wheels.d0!.turns).toBe(2);
    expect(p.wheels.d0!.detent).toBe(true);
    expect(p.wheels.d5!.enter).toBe(true);
    expect(p.fades.s3).toEqual({ from: 0, to: 1, delay: 320, duration: 200 });
  });
  it("QA 2: $9,999 to $10,000 in ui, d4 enters at rank 0 and the units land at 740 ms", () => {
    const p = plan(cellsOf("$9,999"), cellsOf("$10,000"), "ui", 1);
    expect(p.wheels.d4).toMatchObject({ enter: true, delay: 0, duration: 520, digit: 1 });
    expect(p.wheels.d0).toMatchObject({ turns: 1, delay: 100, duration: 640 });
    expect(p.landsAt).toBe(740);
    expect(p.widthMs).toBe(520);
  });
  it("QA 2 back: $10,000 to $9,999, d4 leaves", () => {
    const p = plan(cellsOf("$10,000"), cellsOf("$9,999"), "ui", -1);
    expect(p.wheels.d4).toMatchObject({ exit: true, digit: 0, delay: 0 });
    expect(p.wheels.d3!.trend).toBe(-1);
  });
  it("QA 3: $107,529 to $107,530 in ui, the higher digits stay still", () => {
    const p = plan(cellsOf("$107,529"), cellsOf("$107,530"), "ui", 1);
    expect(Object.keys(p.wheels).sort()).toEqual(["d0", "d1"]);
    expect(p.landsAt).toBe(25 + 520 + 30);
  });
  it("the reveal rolls in place: cinema from a figure to itself still spins every wheel", () => {
    const p = plan(cellsOf("$107,529"), cellsOf("$107,529"), "cinema", 1);
    expect(Object.keys(p.wheels)).toHaveLength(6);
    expect(p.wheels.d5!.turns).toBe(1);
    expect(p.wheels.d1!.turns).toBe(2);
  });
});

describe("one clock per wheel (§2.4)", () => {
  it("rests during the delay and lands exactly on the target", () => {
    const t = wheelTables(41, 53, 100, 640, false);
    expect(t.speed[0]).toBe(0);
    expect(t.speed[1]).toBe(0);
    expect(lineAt(t, 0.05)).toBe(41);
    expect(lineAt(t, 1)).toBeCloseTo(53, 6);
    expect(Math.max(...t.speed)).toBeGreaterThan(0.5);
  });
  it("the cinema detent overshoots by 0.06 of a line and settles", () => {
    const t = wheelTables(40, 70, 0, 800, true);
    expect(Math.max(...t.line)).toBeCloseTo(70.06, 2);
    expect(t.line[t.line.length - 1]).toBeCloseTo(70, 6);
  });
  it("uses expo-out", () => {
    expect(EXPO(0)).toBe(0);
    expect(EXPO(1)).toBe(1);
    expect(EXPO(0.25)).toBeGreaterThan(0.75);
  });
});
