import type { WishKind } from "./wishes";
import type { PoolGroup, PoolItem } from "./welcome";

/**
 * This or that. The pairs come first from what the person asked for (owner, 2026-10-30: "the second that they type in
 * something, we need to come up with the stages of the which one is more you that directly tie into what they had put
 * in"): the server makes them from the first wish while it is priced, and sends them on the same stream (wishPairs).
 * Until they arrive, or once they run out, pairs come from the pool (owner, 2026-10-28): a random cover pair first,
 * across two kinds of thing, then pairs leaning toward what the wish turned out to be. Three answered rounds make a
 * starting list; "Neither" brings another pair instead, up to a limit, so nobody is stuck.
 */
export const ANSWERED_ROUNDS = 3;
export const MAX_ROUNDS = 7;

export type Vote = "a" | "b" | "both" | "neither";

/** A pair made from the first wish: two cards shaped like the pool's, each with a real photo. */
export interface WishPair {
  a: PoolItem;
  b: PoolItem;
  /** What choosing between them shows, in the agent's words; not shown. */
  why?: string;
  /** A pair that steps next door to the wish (a boat after a car); these come last. */
  adjacent?: boolean;
}

/** The photo a card leads with, as the card shows it. */
const photoOf = (e: PoolItem) => e.media?.images.find((i) => !i.generated && i.url)?.url ?? e.imageUrl;

/** A card the app can show and add up: a name, a price and a real photo. */
const showable = (e: unknown): e is PoolItem => {
  const c = e as Partial<PoolItem> | null;
  return !!c && typeof c.id === "string" && !!c.id && typeof c.name === "string" && !!c.name && Number.isFinite(c.upfrontCents) && (c.upfrontCents ?? 0) > 0 && Array.isArray(c.recurring) && /^https:\/\//.test(photoOf(c as PoolItem) ?? "");
};

/**
 * The pairs from the stream that can be shown: two different cards, each with a real photo, so a card never shows an
 * empty photo box, and no card twice.
 */
export function usablePairs(raw: unknown): WishPair[] {
  const out: WishPair[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw) ? raw : []) {
    const { a, b } = (p ?? {}) as Partial<WishPair>;
    if (!showable(a) || !showable(b) || a.id === b.id || seen.has(a.id) || seen.has(b.id)) continue;
    seen.add(a.id);
    seen.add(b.id);
    out.push({ a, b, ...(typeof p.why === "string" ? { why: p.why } : {}), ...(p.adjacent === true ? { adjacent: true } : {}) });
  }
  return out;
}

/** The groups a wish's kind points to: a trip leans to travel, a thing to things, owning to things and homes. */
export function groupsFor(kind?: WishKind | null): PoolGroup[] | null {
  if (!kind) return null;
  if (kind === "visit" || kind === "do") return ["travel"];
  if (kind === "buy") return ["things"];
  return ["things", "home"];
}

const pickOne = <T>(xs: T[], rand: () => number): T | undefined => xs[Math.floor(rand() * xs.length)];

/**
 * The next pair from the pool, never showing anything already shown. With a preference, the first card is from the
 * preferred groups and the second too when there's another, else anything; without one, two cards from different groups.
 */
export function nextPair(pool: PoolItem[], seen: ReadonlySet<string>, prefer: PoolGroup[] | null, rand: () => number = Math.random): [PoolItem, PoolItem] | null {
  const fresh = pool.filter((p) => !seen.has(p.id));
  if (fresh.length < 2) return null;
  if (prefer?.length) {
    const near = fresh.filter((p) => prefer.includes(p.group));
    const a = pickOne(near, rand) ?? pickOne(fresh, rand)!;
    const rest = fresh.filter((p) => p.id !== a.id);
    const b = pickOne(rest.filter((p) => prefer.includes(p.group)), rand) ?? pickOne(rest, rand)!;
    return [a, b];
  }
  const a = pickOne(fresh, rand)!;
  const rest = fresh.filter((p) => p.id !== a.id);
  const b = pickOne(rest.filter((p) => p.group !== a.group), rand) ?? pickOne(rest, rand)!;
  return [a, b];
}

/** The next pair made from the wish, in the order it came, whose two cards are both still unseen. */
export function nextWishPair(pairs: WishPair[], seen: ReadonlySet<string>): [PoolItem, PoolItem] | null {
  const p = pairs.find((x) => !seen.has(x.a.id) && !seen.has(x.b.id));
  return p ? [p.a, p.b] : null;
}

/**
 * The next pair to show: one made from the wish while there is one (after "Neither" too), else the pool's. The pool is
 * only the fallback: before the wish's pairs arrive, when they failed, or once they are used up.
 */
export function pickPair(pairs: WishPair[], pool: PoolItem[], seen: ReadonlySet<string>, prefer: PoolGroup[] | null, rand: () => number = Math.random): [PoolItem, PoolItem] | null {
  return nextWishPair(pairs, seen) ?? nextPair(pool, seen, prefer, rand);
}

/** How many cards are still unseen across the wish's pairs and the pool; under two, there is no pair left. */
export function unseenCount(pairs: WishPair[], pool: PoolItem[], seen: ReadonlySet<string>): number {
  const ids = new Set([...pairs.flatMap((p) => [p.a.id, p.b.id]), ...pool.map((p) => p.id)]);
  return [...ids].filter((id) => !seen.has(id)).length;
}

/** What a vote adds to the list. */
export const chosen = (pair: [PoolItem, PoolItem], vote: Vote): PoolItem[] => (vote === "a" ? [pair[0]] : vote === "b" ? [pair[1]] : vote === "both" ? [...pair] : []);

/** Whether this or that is done: three rounds answered, or the limit reached, or nothing left to pair. */
export const votingDone = (answered: number, rounds: number, poolLeft: number) => answered >= ANSWERED_ROUNDS || rounds >= MAX_ROUNDS || poolLeft < 2;
