import { isPriceless } from "./worth";
import type { WishDetails } from "./wishes";

/**
 * How the list is sorted on screen (owner, 2026-11-03: "Add list sorting and a tap filter for date and a-a and price
 * (up and down for all)"). A sort is a view: the list's own order, the one the person and their Dandy arrange, stays
 * as it is on the server, and "Your order" shows it again. Pure, so it has tests; the choice is kept on the device.
 */

export type SortKey = "date" | "name" | "price";
export type SortDir = "asc" | "desc";
/** null is the list's own order. */
export type ListSort = { key: SortKey; dir: SortDir } | null;

/** Where a first tap starts: the newest wish, A to Z, the lowest price. */
export const FIRST_DIR: Record<SortKey, SortDir> = { date: "desc", name: "asc", price: "asc" };

/** A tap on a key: a new key starts at its first direction, the key already on turns around. */
export function tapSort(current: ListSort, key: SortKey): ListSort {
  if (current?.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: FIRST_DIR[key] };
}

type Sortable = { name: string; createdAt: string; item: { upfrontCents: number }; details?: Pick<WishDetails, "worth"> | null };

/** A wish with no amount to compare: priceless, or not priced yet. Both go last, whichever way the price runs. */
const unpriced = (w: Sortable) => isPriceless(w) || !(w.item.upfrontCents > 0);

// Made on first use, never at module scope, with a plain fallback: iOS Hermes builds Intl on NSFoundation, and an Intl
// gap on the first frame is what crashed TestFlight 11 and 12 at launch (memory hermes-ios-intl-crash).
let collator: Intl.Collator | null = null;
function byName(a: string, b: string): number {
  try {
    collator ??= new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    return collator.compare(a, b);
  } catch {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
}

/** The list as the sort shows it. Ties keep the list's own order, whichever way the sort runs. */
export function sortWishes<T extends Sortable>(list: readonly T[], sort: ListSort): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  const compare = (a: T, b: T): number => {
    if (sort.key === "date") return sign * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (sort.key === "name") return sign * byName(a.name.trim(), b.name.trim());
    const ua = unpriced(a), ub = unpriced(b);
    if (ua || ub) return ua === ub ? 0 : ua ? 1 : -1;
    return sign * (a.item.upfrontCents - b.item.upfrontCents);
  };
  return list
    .map((w, i) => ({ w, i }))
    .sort((a, b) => compare(a.w, b.w) || a.i - b.i)
    .map((x) => x.w);
}

/** What a sort chip says, and what a screen reader hears for it. */
export const SORT_LABEL: Record<SortKey, string> = { date: "Date", name: "A-Z", price: "Price" };
const SPOKEN: Record<SortKey, Record<SortDir, string>> = {
  date: { desc: "newest first", asc: "oldest first" },
  name: { asc: "A to Z", desc: "Z to A" },
  price: { asc: "lowest first", desc: "highest first" },
};
export function sortChip(key: SortKey, sort: ListSort): { label: string; spoken: string } {
  if (sort?.key !== key) return { label: SORT_LABEL[key], spoken: `Sort by ${key === "name" ? "name" : SORT_LABEL[key].toLowerCase()}, ${SPOKEN[key][FIRST_DIR[key]]}` };
  const next = sort.dir === "asc" ? "desc" : "asc";
  return { label: `${SORT_LABEL[key]} ${sort.dir === "asc" ? "↑" : "↓"}`, spoken: `Sorted ${SPOKEN[key][sort.dir]}. Tap for ${SPOKEN[key][next]}` };
}

/* ---------- the choice on screen ---------- */

// The state lives here, with no device storage in this file, so the wish store can reset it and tests can load it;
// use-list-sort.ts reads and keeps it on the device.
let current: ListSort = null;
const listeners = new Set<(sort: ListSort) => void>();

export const getListSort = (): ListSort => current;

/** Sets the sort (null for the list's own order). */
export function setListSort(next: ListSort) {
  if (next === current || (next && current && next.key === current.key && next.dir === current.dir)) return;
  current = next;
  listeners.forEach((l) => l(next));
}

export function subscribeListSort(listener: (sort: ListSort) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A stored choice, if it is one. */
export const isListSort = (v: unknown): v is NonNullable<ListSort> =>
  !!v && typeof v === "object" && ["date", "name", "price"].includes((v as { key: string }).key) && ["asc", "desc"].includes((v as { dir: string }).dir);
