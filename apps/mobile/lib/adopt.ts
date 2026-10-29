import type { NewWish, Wish } from "./wishes";

/**
 * Turning the list someone kept before sign-in into their first wishes, without losing any (Codex R01). Each wish
 * comes off the saved list only once the server has it, so a dropped connection or a closed app loses nothing, and
 * what is left is tried again next time. A wish the account already has is not written twice.
 */

/** The saved list's shape, as far as adoption needs it. */
export interface Kept {
  wish: { option?: unknown } | null;
  items: { id: string }[];
}

/** Where each wish toWishes makes sits in the kept list: "wish" for a priced first wish, then each pick's id. */
export const adoptionKeys = (s: Kept): string[] => [...(s.wish?.option ? ["wish"] : []), ...s.items.map((e) => e.id)];

/** The saved list without one wish the server now has. */
export function withoutAdopted<S extends Kept>(s: S, key: string): S {
  return key === "wish" ? { ...s, wish: null } : { ...s, items: s.items.filter((e) => e.id !== key) };
}

/** Nothing is left to adopt: no picks, and no first wish, priced or not. */
export const adoptionDone = (s: Kept) => !s.items.length && !s.wish;

/**
 * The account already holds this wish: same name and the same source page. It catches a write that landed although
 * its answer never came back, so trying again never doubles it.
 */
export const alreadyHas = (have: Pick<Wish, "name" | "details">[], w: Pick<NewWish, "name" | "details">) =>
  have.some((x) => x.name === w.name && (x.details?.agent?.url ?? "") === (w.details?.agent?.url ?? ""));
