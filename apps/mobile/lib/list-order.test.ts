import { describe, expect, it } from "vitest";
import { changeApplied, changeSession, ordered, runChange, undoOf, type ChangeOps } from "./list-order";

const list = [
  { id: "a", tier: "nice" },
  { id: "b", tier: "must" },
  { id: "c", tier: "nice" },
  { id: "d", tier: "dream" },
];

describe("a list change the Dandy suggests (owner, 2026-10-30: the agent can reorder the list)", () => {
  it("puts the named wishes first, the rest in place, as the server does", () => {
    expect(ordered(list, ["c", "a"]).map((w) => w.id)).toEqual(["c", "a", "b", "d"]);
    expect(ordered(list, ["x", "d", "d"]).map((w) => w.id)).toEqual(["d", "a", "b", "c"]);
    expect(ordered(list, []).map((w) => w.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("knows when the list already looks like the change, so a reopened chat doesn't offer Apply again", () => {
    const change = { order: ["c", "a", "b"], tiers: [{ id: "a", tier: "must" as const }], remove: ["d"] };
    expect(changeApplied(change, list)).toBe(false);
    const after = [
      { id: "c", tier: "nice" },
      { id: "a", tier: "must" },
      { id: "b", tier: "must" },
    ];
    expect(changeApplied(change, after)).toBe(true);
    expect(changeApplied(change, [...after, { id: "d", tier: "dream" }])).toBe(false);
    expect(changeApplied({ ...change, tiers: [{ id: "a", tier: "dream" }] }, after)).toBe(false);
    // A wish deleted since the card was made doesn't keep it from counting as done.
    expect(changeApplied({ order: ["c", "gone", "a"], tiers: [], remove: [] }, after)).toBe(true);
  });

  it("puts the order and the moved tiers back, and leaves removals to the toast's own Undo", () => {
    const change = { order: ["c", "a"], tiers: [{ id: "a", tier: "must" as const }, { id: "d", tier: "nice" as const }], remove: ["b"] };
    expect(undoOf(change, list)).toEqual({ order: ["a", "c", "d"], tiers: [{ id: "a", tier: "nice" }, { id: "d", tier: "dream" }], remove: [] });
  });

  it("keeps the list as it was before the first try: a partial apply, a retry, then Undo puts it all back (#114 review)", async () => {
    let wishes = list.map((w) => ({ ...w }));
    let failTier = true;
    const removed: string[] = [];
    const ops: ChangeOps = {
      reorder: async (ids) => void (wishes = ordered(wishes, ids)),
      setTier: async (id, tier) => {
        if (failTier) {
          failTier = false;
          throw new Error("Couldn't save the wish.");
        }
        wishes = wishes.map((w) => (w.id === id ? { ...w, tier } : w));
      },
      remove: (id) => void removed.push(id),
    };
    const session = changeSession({ order: ["c", "a"], tiers: [{ id: "a", tier: "must" }], remove: [] });
    await expect(session.apply(wishes, ops)).rejects.toThrow("Couldn't save");
    // The order went through, the tier didn't; Undo is already offered.
    expect(wishes.map((w) => w.id)).toEqual(["c", "a", "b", "d"]);
    expect(session.canUndo).toBe(true);
    await session.apply(wishes, ops);
    expect(wishes.find((w) => w.id === "a")?.tier).toBe("must");
    await session.undo(ops);
    expect(wishes.map((w) => `${w.id}:${w.tier}`)).toEqual(["a:nice", "b:must", "c:nice", "d:dream"]);
    expect(session.canUndo).toBe(false);
    expect(removed).toEqual([]);
  });

  it("starts at most one removal per change, since its toast can undo only one", async () => {
    const removed: string[] = [];
    await runChange({ order: [], tiers: [], remove: ["b", "c"] }, { reorder: async () => {}, setTier: async () => {}, remove: (id) => void removed.push(id) });
    expect(removed).toEqual(["b"]);
  });
});
