import { recurringBreakdown, type Period } from "@dandelist/cost";

/**
 * A new order for a person's list, from what they asked (owner, 2026-10-30: the agent should "change the list and manage
 * list for things like reorder"): a sort, the kinds or tiers to lead with, and wishes pinned to the top or the end.
 * Pure, so the agent's card, the MCP tool and the tests all agree. Ties keep the list's current order; a priceless wish
 * follows the priced ones in any price sort, since it has no amount to compare.
 */

export const SORTS = ["keep", "price_high", "price_low", "upkeep_high", "upkeep_low", "newest", "oldest", "name"] as const;
export type Sort = (typeof SORTS)[number];
export const GROUPS = ["buy", "own", "do", "visit", "must", "nice", "dream"] as const;
export type Group = (typeof GROUPS)[number];

export interface Arrangeable {
  id: string;
  name: string;
  kind: string;
  tier: string;
  upfrontCents: number;
  recurring: { amountCents: number; period: Period }[];
  createdAt: string;
  details?: { worth?: string } | Record<string, unknown> | null;
}

export interface Arrangement {
  sort?: Sort;
  first?: Group[];
  top?: string[];
  bottom?: string[];
}

const priceless = (w: Arrangeable) => (w.details as { worth?: string } | null | undefined)?.worth === "priceless";
const monthly = (w: Arrangeable) => recurringBreakdown([{ id: w.id, upfrontCents: 0, recurring: w.recurring }]).perMonth;

/** How two wishes compare under a sort, or 0 to keep their current order. */
function compare(sort: Sort, a: Arrangeable, b: Arrangeable): number {
  switch (sort) {
    case "price_high":
    case "price_low": {
      if (priceless(a) !== priceless(b)) return priceless(a) ? 1 : -1;
      return sort === "price_high" ? b.upfrontCents - a.upfrontCents : a.upfrontCents - b.upfrontCents;
    }
    case "upkeep_high":
      return monthly(b) - monthly(a);
    case "upkeep_low":
      return monthly(a) - monthly(b);
    case "newest":
      return b.createdAt.localeCompare(a.createdAt);
    case "oldest":
      return a.createdAt.localeCompare(b.createdAt);
    case "name":
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    default:
      return 0;
  }
}

/** The list's ids in the new order. Ids in `top` or `bottom` that aren't on the list are ignored. */
export function arrange(list: Arrangeable[], how: Arrangement): string[] {
  const place = new Map(list.map((w, i) => [w.id, i]));
  const top = (how.top ?? []).filter((id, i, all) => place.has(id) && all.indexOf(id) === i);
  const bottom = (how.bottom ?? []).filter((id, i, all) => place.has(id) && all.indexOf(id) === i && !top.includes(id));
  const pinned = new Set([...top, ...bottom]);
  const first = how.first ?? [];
  const group = (w: Arrangeable) => {
    const at = first.findIndex((g) => g === w.kind || g === w.tier);
    return at === -1 ? first.length : at;
  };
  const middle = list
    .filter((w) => !pinned.has(w.id))
    .sort((a, b) => group(a) - group(b) || compare(how.sort ?? "keep", a, b) || place.get(a.id)! - place.get(b.id)!)
    .map((w) => w.id);
  return [...top, ...middle, ...bottom];
}
