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

/** What a change does to the list, as the store does it. */
export interface ChangeOps {
  reorder(ids: string[]): Promise<void>;
  setTier(id: string, tier: "must" | "nice" | "dream"): Promise<void>;
  /** Starts a removal with its own undo window (one at a time). */
  remove(id: string): void;
}

/**
 * Applies a change: the order, then each tier, then its one removal. Stops at the first failure and leaves what is
 * done in place; running it again finishes it (a reorder is idempotent and a tier already set is skipped).
 */
export async function runChange(change: ListChange, ops: ChangeOps): Promise<void> {
  if (change.order.length) await ops.reorder(change.order);
  for (const t of change.tiers) await ops.setTier(t.id, t.tier);
  for (const id of change.remove.slice(0, 1)) ops.remove(id);
}

/**
 * One card's apply and undo (Codex, #114 review): the list as it was is kept from the first attempt, so a partial
 * apply, a retry and then Undo still put back the original order and tiers. A removal keeps its own toast Undo.
 */
export function changeSession(change: ListChange) {
  let original: ListChange | null = null;
  return {
    get canUndo() {
      return original !== null;
    },
    async apply(current: Listed[], ops: ChangeOps) {
      original ??= undoOf(change, current);
      await runChange(change, ops);
    },
    async undo(ops: ChangeOps) {
      if (!original) return;
      await runChange(original, ops);
      original = null;
    },
  };
}

/**
 * What puts the list back as it was before the change: its whole old order and the old tier of every wish it moved.
 * A wish the change removes keeps its place in that order (Codex, #114 review): if a failure stopped the card before
 * its removal, or the toast undid the removal, it goes back where it was; once it is gone, the reorder skips it.
 */
export function undoOf(change: ListChange, before: Listed[]): ListChange {
  const tier = new Map(before.map((w) => [w.id, w.tier]));
  return {
    order: before.map((w) => w.id),
    tiers: change.tiers.flatMap((t) => {
      const was = tier.get(t.id);
      return was === "must" || was === "nice" || was === "dream" ? [{ id: t.id, tier: was }] : [];
    }),
    remove: [],
  };
}
