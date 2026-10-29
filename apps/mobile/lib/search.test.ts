import { describe, expect, it } from "vitest";
import { STRONG, localSearch, mergeResults, normalize, queryTerms, related, stem, wantsRemote, type Searchable } from "./search";

const LIST: Searchable[] = [
  { id: "lisbon", name: "A month in Lisbon", kind: "visit" },
  { id: "japan", name: "Trip to Japan", kind: "visit" },
  { id: "gwagon", name: "Mercedes G-Wagon", kind: "buy" },
  { id: "security", name: "Private security", kind: "do" },
  { id: "rolex", name: "Rolex Submariner", kind: "buy" },
  { id: "villa", name: "Villa in Malta", kind: "own" },
  { id: "jet", name: "Private jet card", kind: "buy" },
  { id: "chef", name: "Dinner by a private chef", kind: "do", about: "A chef cooks a tasting menu at home for friends.", tags: ["food", "dining", "friends"] },
];
const ids = (q: string) => localSearch(LIST, q).map((h) => h.id);

describe("reading a query", () => {
  it("drops accents, case, punctuation and filler", () => {
    expect(normalize("  Café  G-Wagon! ")).toBe("cafe g wagon");
    expect(queryTerms("I want a new car")).toEqual(["car"]);
    expect(queryTerms("the")).toEqual(["the"]);
  });

  it("meets plurals halfway", () => {
    expect(stem("trips")).toBe("trip");
    expect(stem("watches")).toBe("watch");
    expect(stem("parties")).toBe("party");
    expect(stem("glass")).toBe("glass");
    expect(queryTerms("Holidays")).toEqual(["holiday"]);
  });

  it("finds related words, and only from the right group", () => {
    expect(related("travel")).toContain("trip");
    expect(related("car")).toContain("g wagon");
    expect(related("car")).not.toContain("rolex");
    expect(related("family")).toContain("security");
    expect(related("fam")).toContain("security");
    expect(related("zz")).toEqual([]);
  });
});

describe("searching on the phone", () => {
  it("finds by meaning through the related words", () => {
    expect(ids("travel")).toEqual(expect.arrayContaining(["lisbon", "japan"]));
    expect(ids("travel")).not.toContain("rolex");
    expect(ids("car")).toEqual(["gwagon"]);
    expect(ids("family")[0]).toBe("security");
    expect(ids("watches")).toEqual(["rolex"]);
    expect(ids("house")[0]).toBe("villa");
    expect(ids("house")).not.toContain("lisbon");
  });

  it("ranks a name match above a related word, and a direct match as strong", () => {
    const hits = localSearch(LIST, "trip");
    expect(hits[0]!.id).toBe("japan");
    expect(hits[0]!.score).toBeGreaterThanOrEqual(STRONG);
    expect(hits.find((h) => h.id === "lisbon")!.score).toBeLessThan(STRONG);
  });

  it("follows typing: the last word is matched as a prefix", () => {
    expect(ids("lis")).toEqual(["lisbon"]);
    expect(ids("merc")).toEqual(["gwagon"]);
    expect(ids("private s")[0]).toBe("security");
    // A whole word the map knows means that word: "car" is not the start of "card".
    expect(ids("car")).not.toContain("jet");
    expect(ids("card")).toEqual(["jet"]);
  });

  it("reads the description and tags", () => {
    expect(ids("tasting")).toEqual(["chef"]);
    expect(ids("dining")).toEqual(["chef"]);
    expect(localSearch(LIST, "food")[0]).toEqual({ id: "chef", score: 0.95 });
  });

  it("ranks the whole phrase first and drops wishes that miss most of the words", () => {
    expect(ids("private jet")[0]).toBe("jet");
    expect(ids("private jet")).toContain("security");
    expect(ids("private jet malta")).not.toContain("lisbon");
    expect(ids("")).toEqual([]);
    expect(ids("zebra")).toEqual([]);
  });

  it("keeps the list's order between equal matches", () => {
    expect(ids("private")).toEqual(["security", "jet", "chef"]);
  });
});

describe("asking for help with meaning", () => {
  it("asks only when a real query has no direct match here", () => {
    expect(wantsRemote("lis", localSearch(LIST, "lis"))).toBe(false);
    expect(wantsRemote("travel", localSearch(LIST, "travel"))).toBe(true);
    expect(wantsRemote("something cosy", localSearch(LIST, "something cosy"))).toBe(true);
    expect(wantsRemote("ab", [])).toBe(false);
  });

  it("merges direct matches, then the ranking by meaning, then the rest, once each", () => {
    const local = [
      { id: "japan", score: 1 },
      { id: "lisbon", score: 0.7 },
    ];
    const known = new Set(LIST.map((w) => w.id));
    expect(mergeResults(local, ["villa", "lisbon", "gone", "japan"], known)).toEqual(["japan", "villa", "lisbon"]);
    expect(mergeResults(local, null, known)).toEqual(["japan", "lisbon"]);
    expect(mergeResults([], [], known)).toEqual([]);
  });
});
