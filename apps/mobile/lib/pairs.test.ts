import { describe, expect, it } from "vitest";
import { ANSWERED_ROUNDS, MAX_ROUNDS, chosen, groupsFor, nextPair, nextWishPair, pickPair, unseenCount, usablePairs, votingDone, type WishPair } from "./pairs";
import type { PoolGroup, PoolItem } from "./welcome";

const item = (id: string, group: PoolGroup): PoolItem => ({ id, name: id, kind: group === "travel" ? "visit" : "buy", category: "travel", group, upfrontCents: 100_000, recurring: [], status: "estimate", seller: "Typical price", url: "", checkedAt: "2026-10-28" });
const pool = [item("kyoto", "travel"), item("lisbon", "travel"), item("dublin", "travel"), item("leica", "things"), item("rolex", "things"), item("villa", "home")];

/** A card made from the wish, with its photo, as the server sends it. */
const card = (id: string, photo = `https://upload.wikimedia.org/${id}.jpg`): PoolItem => ({
  ...item(`p:${id}`, "things"),
  name: id,
  kind: "own",
  category: "drive",
  upfrontCents: 31_000_000,
  ...(photo ? { media: { kind: "vehicle", images: [{ url: photo, width: 1920, height: 1248, source: "commons.wikimedia.org" }] } } : {}),
});
/** After "I want a Rolls Royce". */
const made: WishPair[] = [
  { a: card("bentley-mulsanne"), b: card("maybach-s-class"), why: "Which feels more like you" },
  { a: card("rolls-royce-ghost"), b: card("rolls-royce-spectre") },
  { a: card("riva-aquarama"), b: card("gulfstream-g700"), adjacent: true },
];

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

describe("this or that made from the first wish", () => {
  it("draws the wish's pairs first, in the order they came, and the pool never before they run out", () => {
    const seen = new Set<string>();
    const shown: string[][] = [];
    for (let round = 0; round < 3; round++) {
      const pair = pickPair(made, pool, seen, groupsFor("own"), seeded(round + 1))!;
      pair.forEach((e) => seen.add(e.id));
      shown.push(pair.map((e) => e.name));
    }
    expect(shown).toEqual([
      ["bentley-mulsanne", "maybach-s-class"],
      ["rolls-royce-ghost", "rolls-royce-spectre"],
      ["riva-aquarama", "gulfstream-g700"],
    ]);
    // Used up, after "Neither" or anything else: the pool takes over, never repeating a card.
    const after = pickPair(made, pool, seen, groupsFor("own"), seeded(7))!;
    expect(after.every((e) => pool.includes(e))).toBe(true);
  });

  it("falls back to the pool before the pairs arrive, or when none came", () => {
    const [a, b] = pickPair([], pool, new Set(), null, seeded(2))!;
    expect(pool).toContain(a);
    expect(pool).toContain(b);
    expect(a.group).not.toBe(b.group);
  });

  it("skips a pair with a side already shown, as when a cover pair from the pool came first", () => {
    const shared: WishPair[] = [{ a: pool[0]!, b: card("seychelles") }, ...made];
    expect(nextWishPair(shared, new Set(["kyoto"]))!.map((e) => e.name)).toEqual(["bentley-mulsanne", "maybach-s-class"]);
    expect(nextWishPair(made, new Set(made.flatMap((p) => [p.a.id, p.b.id])))).toBeNull();
  });

  it("counts what is left across the wish's pairs and the pool, so voting goes on while either has a pair", () => {
    expect(unseenCount(made, pool, new Set())).toBe(made.length * 2 + pool.length);
    const all = new Set([...made.flatMap((p) => [p.a.id, p.b.id]), ...pool.slice(0, 5).map((p) => p.id)]);
    expect(unseenCount(made, pool, all)).toBe(1);
    expect(votingDone(1, 2, unseenCount(made, pool, all))).toBe(true);
  });

  it("keeps only pairs it can show: two different cards, each priced, each with a real photo, none twice", () => {
    const raw = [
      made[0],
      { a: card("no-photo", ""), b: card("ferrari-roma") },
      { a: card("http-photo", "http://example.com/x.jpg"), b: card("bentayga") },
      { a: card("ghost"), b: card("ghost") },
      { a: { ...card("free"), upfrontCents: 0 }, b: card("cullinan") },
      { a: card("bentley-mulsanne"), b: card("phantom") },
      { a: card("riva-aquarama"), b: card("gulfstream-g700"), adjacent: true, why: 7 },
      "nonsense",
      null,
    ];
    const kept = usablePairs(raw);
    expect(kept.map((p) => [p.a.name, p.b.name])).toEqual([
      ["bentley-mulsanne", "maybach-s-class"],
      ["riva-aquarama", "gulfstream-g700"],
    ]);
    expect(kept[0]).toMatchObject({ why: "Which feels more like you" });
    expect(kept[1]).toMatchObject({ adjacent: true });
    expect(kept[1]).not.toHaveProperty("why");
    expect(usablePairs(undefined)).toEqual([]);
    expect(usablePairs({ pairs: made })).toEqual([]);
  });
});
