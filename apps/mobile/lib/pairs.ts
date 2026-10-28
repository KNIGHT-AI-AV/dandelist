import type { WishKind } from "./wishes";
import type { PoolGroup, PoolItem } from "./welcome";

/**
 * This or that, drawn from the pool (owner, 2026-10-28). The first pair is a cover: random, across two kinds of
 * thing, so the first wish has time to be read. Once the agent says what that wish is, later pairs lean toward the
 * same kind of thing. Three answered rounds make a starting list; "Neither" brings another pair instead, up to a
 * limit, so nobody is stuck.
 */
export const ANSWERED_ROUNDS = 3;
export const MAX_ROUNDS = 7;

export type Vote = "a" | "b" | "both" | "neither";

/** The groups a wish's kind points to: a trip leans to travel, a thing to things, owning to things and homes. */
export function groupsFor(kind?: WishKind | null): PoolGroup[] | null {
  if (!kind) return null;
  if (kind === "visit" || kind === "do") return ["travel"];
  if (kind === "buy") return ["things"];
  return ["things", "home"];
}

const pickOne = <T>(xs: T[], rand: () => number): T | undefined => xs[Math.floor(rand() * xs.length)];

/**
 * The next pair, never showing anything already shown. With a preference, the first card is from the preferred
 * groups and the second too when there's another, else anything; without one, two cards from different groups.
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

/** What a vote adds to the list. */
export const chosen = (pair: [PoolItem, PoolItem], vote: Vote): PoolItem[] => (vote === "a" ? [pair[0]] : vote === "b" ? [pair[1]] : vote === "both" ? [...pair] : []);

/** Whether this or that is done: three rounds answered, or the limit reached, or the pool used up. */
export const votingDone = (answered: number, rounds: number, poolLeft: number) => answered >= ANSWERED_ROUNDS || rounds >= MAX_ROUNDS || poolLeft < 2;
