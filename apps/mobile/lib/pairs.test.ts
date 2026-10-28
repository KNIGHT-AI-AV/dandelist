import { describe, expect, it } from "vitest";
import { ANSWERED_ROUNDS, MAX_ROUNDS, chosen, groupsFor, nextPair, votingDone } from "./pairs";
import type { PoolGroup, PoolItem } from "./welcome";

const item = (id: string, group: PoolGroup): PoolItem => ({ id, name: id, kind: group === "travel" ? "visit" : "buy", category: "travel", group, upfrontCents: 100_000, recurring: [], status: "estimate", seller: "Typical price", url: "", checkedAt: "2026-10-28" });
const pool = [item("kyoto", "travel"), item("lisbon", "travel"), item("dublin", "travel"), item("leica", "things"), item("rolex", "things"), item("villa", "home")];

/** A seeded generator, so each test sees the same "random" draw. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("this or that", () => {
  it("opens with a cover pair across two kinds of thing", () => {
    for (let s = 1; s < 40; s++) {
      const [a, b] = nextPair(pool, new Set(), null, seeded(s))!;
      expect(a.id).not.toBe(b.id);
      expect(a.group).not.toBe(b.group);
    }
  });

  it("leans toward what the first wish turned out to be", () => {
    for (let s = 1; s < 40; s++) {
      const [a, b] = nextPair(pool, new Set(["kyoto"]), groupsFor("visit"), seeded(s))!;
      expect([a.group, b.group]).toEqual(["travel", "travel"]);
      expect([a.id, b.id]).not.toContain("kyoto");
    }
    // Only one travel card left: the other side comes from anywhere.
    const [a, b] = nextPair(pool, new Set(["kyoto", "lisbon"]), ["travel"], seeded(3))!;
    expect(a.id).toBe("dublin");
    expect(b.group).not.toBe("travel");
  });

  it("never repeats a card and stops when the pool runs out", () => {
    expect(nextPair(pool, new Set(pool.slice(0, 5).map((p) => p.id)), null)).toBeNull();
  });

  it("maps a wish's kind to the groups worth showing", () => {
    expect(groupsFor("visit")).toEqual(["travel"]);
    expect(groupsFor("buy")).toEqual(["things"]);
    expect(groupsFor("own")).toEqual(["things", "home"]);
    expect(groupsFor(undefined)).toBeNull();
  });

  it("adds what was chosen and ends after three answered rounds or the limit", () => {
    const pair: [PoolItem, PoolItem] = [pool[0]!, pool[3]!];
    expect(chosen(pair, "a").map((p) => p.id)).toEqual(["kyoto"]);
    expect(chosen(pair, "both")).toHaveLength(2);
    expect(chosen(pair, "neither")).toEqual([]);
    expect(votingDone(ANSWERED_ROUNDS, 3, 10)).toBe(true);
    expect(votingDone(1, 3, 10)).toBe(false);
    expect(votingDone(1, MAX_ROUNDS, 10)).toBe(true);
    expect(votingDone(1, 2, 1)).toBe(true);
  });
});
