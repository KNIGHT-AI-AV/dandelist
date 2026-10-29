import { upfrontCashCents, type Period } from "@dandelist/cost";
import type { Wish, WishTier } from "./wishes";

/**
 * The money page's figures (owner, recording 03: "a full money page about the costs of all items"), worked out from
 * the wishes alone. Amounts are US cents; the page shows them in the chosen currency. Pure, so it has tests.
 */

const PER_YEAR: Record<Period, number> = { week: 52, month: 12, year: 1 };
const TIERS: WishTier[] = ["must", "nice", "dream"];

export interface TierTotal {
  tier: WishTier;
  count: number;
  cents: number;
  /** Of the whole list, 0 to 1. */
  share: number;
}

export function tierTotals(wishes: readonly Wish[]): TierTotal[] {
  const all = upfrontCashCents(wishes.map((w) => w.item)) || 1;
  return TIERS.map((tier) => {
    const mine = wishes.filter((w) => w.tier === tier);
    const cents = upfrontCashCents(mine.map((w) => w.item));
    return { tier, count: mine.length, cents, share: cents / all };
  });
}

export interface Biggest {
  wish: Wish;
  share: number;
}

/** The `n` dearest wishes and their share of the total. */
export function biggest(wishes: readonly Wish[], n = 5): Biggest[] {
  const all = upfrontCashCents(wishes.map((w) => w.item)) || 1;
  return [...wishes]
    .sort((a, b) => b.item.upfrontCents - a.item.upfrontCents)
    .slice(0, n)
    .map((wish) => ({ wish, share: wish.item.upfrontCents / all }));
}

export interface KeepLine {
  /** "Insurance on the Porsche 911", or the wish's name when the cost has no label. */
  text: string;
  perYear: number;
}

/** Every running cost, a year at a time, dearest first. */
export function keepLines(wishes: readonly Wish[]): KeepLine[] {
  const lines: KeepLine[] = [];
  for (const w of wishes) {
    for (const r of w.item.recurring) {
      const perYear = r.amountCents * PER_YEAR[r.period];
      if (perYear <= 0) continue;
      const label = r.label?.trim();
      lines.push({ text: label ? `${label[0]!.toUpperCase()}${label.slice(1)}, ${w.name}` : w.name, perYear });
    }
  }
  return lines.sort((a, b) => b.perYear - a.perYear);
}
