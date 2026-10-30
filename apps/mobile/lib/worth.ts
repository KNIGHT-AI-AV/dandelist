import type { Media } from "./agent";
import { fractionOf, incomeAt, ladderSteps } from "./comfort";
import type { WishDetails } from "./wishes";

/**
 * Wishes no shop prices (owner, 2026-10-30, after "Money" came back as an empty card: "Make up clever values for things
 * that have no value. Or put infinity", "for money spawn a slider for people to say how much money!"). Money itself
 * is an amount the person picks on a slider, saved as the wish's upfront cost. Love, health or time with someone is
 * priceless: it shows infinity with a line the Dandy wrote, saves at zero, and every total leaves it out. Pure, so it
 * has tests.
 */
export type Worth = "money" | "priceless";

/** How a priceless wish's price reads. */
export const INFINITY = "∞";

type Worthy = { details?: Pick<WishDetails, "worth"> | null };

/** What a saved wish is worth, when it is one no shop prices. */
export const worthOf = (w: Worthy): Worth | undefined => (w.details?.worth === "money" || w.details?.worth === "priceless" ? w.details.worth : undefined);
export const isPriceless = (w: Worthy) => w.details?.worth === "priceless";

/** The wishes a total adds up: all but the priceless, whatever amount one was saved with. */
export const counted = <T extends Worthy>(wishes: readonly T[]): T[] => wishes.filter((w) => !isPriceless(w));

/** How a wish's price reads aloud: "priceless", or the amount in the shown currency. */
export const priceWords = (w: Worthy & { item: { upfrontCents: number } }, format: (cents: number) => string) => (isPriceless(w) ? "priceless" : format(w.item.upfrontCents));

/** "5 wishes", or "5 wishes · 1 priceless" when some are left out of the total beside it. */
export function countLine(wishes: readonly Worthy[]): string {
  const n = wishes.length;
  const priceless = wishes.filter(isPriceless).length;
  return `${n} ${n === 1 ? "wish" : "wishes"}${priceless ? ` · ${priceless} priceless` : ""}`;
}

/**
 * A money wish's photo, kept where a retake keeps the photo of a wish the agent never priced (WishProvider.setPhoto):
 * the agent details with only the picture in them.
 */
export function photoOnly(imageUrl: string, media?: Media): WishDetails["agent"] {
  const agent: Partial<NonNullable<WishDetails["agent"]>> = { imageUrl, ...(media ? { media } : {}) };
  return agent as WishDetails["agent"];
}

/** The money page's note under its total, or "" when nothing is left out of it. */
export function pricelessAside(wishes: readonly Worthy[]): string {
  const n = wishes.filter(isPriceless).length;
  if (!n) return "";
  return n === 1 ? "1 priceless wish isn't in the total." : `${n} priceless wishes aren't in the total.`;
}

/* ---------- the amount slider ---------- */

/** The slider runs from about 1,000 to 100 million of the shown currency (counted in its own cents). */
export const AMOUNT_LOW = 100_000;
export const AMOUNT_HIGH = 10_000_000_000;
/**
 * The furthest it ever reaches, in any currency: a billion dollars (US cents), the most a wish's preview takes. A wish
 * that names more sits at it.
 */
export const AMOUNT_CEILING = 100_000_000_000;

/**
 * The slider's notches in US cents: 1, 1.5, 2, 2.5, 3, 4, 5 and 7.5 in each decade of the shown currency (`rate` of it
 * to the dollar; yen and yuan count in hundreds and tens, `unit`), so every stop reads as a round number there. It
 * reaches further up when the wish names more ("a billion dollars"), but never past a billion dollars: there the top
 * stop is a billion dollars itself, whatever that comes to in the shown currency.
 */
export function amountSteps(rate = 1, unit = 1, namedCents?: number): number[] {
  const low = AMOUNT_LOW * unit;
  const ceiling = AMOUNT_CEILING * rate; // a billion dollars in the shown currency's cents
  let top = AMOUNT_HIGH * unit;
  const named = namedCents && namedCents > 0 ? Math.min(namedCents * rate, ceiling) : 0;
  while (top < named * 0.999) top *= 10;
  if (top <= ceiling * 1.0001) return ladderSteps(rate, low, top);
  return [...ladderSteps(rate, low, top).filter((s) => s * rate < ceiling * 0.999), AMOUNT_CEILING];
}

/** An amount as a wish keeps it: whole US cents (a stop in another currency falls between two). */
export const wholeCents = (cents: number) => Math.round(cents);

/**
 * What the slider shows for an amount: the stop it was rounded from, when it was one, so the figure reads exactly
 * round in the shown currency (a US cent is more than a yen, so whole cents can land a yen either side of it).
 */
export const shownAmount = (cents: number, steps: readonly number[]) => steps.find((s) => Math.abs(s - cents) <= 0.5) ?? cents;

const isPowerOfTen = (n: number) => n > 0 && 10 ** Math.round(Math.log10(n)) === n;

/** The stops marked under the slider: every power of ten between its ends (10K, 100K, 1M and 10M in dollars). */
export function amountMarks(steps: readonly number[], rate = 1): number[] {
  return steps.filter((s, i) => i > 0 && i < steps.length - 1 && isPowerOfTen(Math.round(s * rate)));
}

/**
 * Where the slider starts, in whole US cents: the amount the wish named, kept inside the slider's ends ("a million
 * dollars" sits at 1M); else a million of the shown currency (a hundred million yen), three fifths of the way along.
 */
export function startAmount(steps: readonly number[], namedCents?: number): number {
  const lo = steps[0]!;
  const hi = steps[steps.length - 1]!;
  if (namedCents && namedCents > 0) return wholeCents(Math.max(lo, Math.min(hi, namedCents)));
  return wholeCents(amountAt(fractionOf(lo * 1000, steps), steps));
}

/** The slider's position for an amount, 0 to 1, on a log scale so $5,000 and $50 million both get room. */
export const amountFraction = (cents: number, steps: readonly number[]) => fractionOf(cents, steps);

/** The notch nearest a position on the slider. */
export const amountAt = (fraction: number, steps: readonly number[]) => incomeAt(fraction, steps);
