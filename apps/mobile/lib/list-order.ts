/**
 * A list change the Dandy suggests (owner, 2026-10-30: "help the agent change the list and manage list for things like
 * reorder"): how the list looks after it, whether it has already been applied, and how to put it back. Pure, so the
 * card, the store and the tests agree with the server's PUT /wishes/order (named wishes first, the rest in place).
 */

export interface ListChange {
  order: string[];
  tiers: { id: string; tier: "must" | "nice" | "dream" }[];
  remove: string[];
}

interface Listed {
  id: string;
  tier: string;
}

/** The list with these wishes first, in this order, and every other wish after them as it was. */
export function ordered<T extends Listed>(list: T[], ids: string[]): T[] {
  const at = new Map(list.map((w) => [w.id, w]));
  const first = ids.filter((id, i) => at.has(id) && ids.indexOf(id) === i).map((id) => at.get(id)!);
  const named = new Set(first.map((w) => w.id));
  return [...first, ...list.filter((w) => !named.has(w.id))];
}

/** True once the list already looks like the change: its order, its tiers, and the removed wishes gone. */
export function changeApplied(change: ListChange, list: Listed[]): boolean {
  const ids = list.map((w) => w.id);
  if (change.remove.some((id) => ids.includes(id))) return false;
  const tier = new Map(list.map((w) => [w.id, w.tier]));
  if (change.tiers.some((t) => tier.has(t.id) && tier.get(t.id) !== t.tier)) return false;
  const want = change.order.filter((id) => tier.has(id));
  return want.every((id, i) => ids[i] === id);
}

/** What puts the list back as it was before the change: its old order and the old tier of every wish it moved. */
export function undoOf(change: ListChange, before: Listed[]): ListChange {
  const tier = new Map(before.map((w) => [w.id, w.tier]));
  return {
    order: before.map((w) => w.id).filter((id) => !change.remove.includes(id)),
    tiers: change.tiers.flatMap((t) => {
      const was = tier.get(t.id);
      return was === "must" || was === "nice" || was === "dream" ? [{ id: t.id, tier: was }] : [];
    }),
    remove: [],
  };
}
