/**
 * "What would it take?" (owner, 2026-10-28: "this is not a savings app... it's a wish list"). A fader of incomes a
 * year; for each, a face and a line say how comfortably that income carries everything on the list. Nothing here is a
 * budget or a date: the ratio of a year's income to the list's total picks one of six stages (owner, 2026-10-29:
 * "horrid, upset, normal, smile, big smile, ritzy rich"). The fader runs from $10,000 to $100 million, and further
 * either way when a list needs it, so the far left is always horrid and the far right always ritzy.
 */
export const INCOME_MIN = 1_000_000; // $10,000
export const INCOME_MAX = 10_000_000_000; // $100,000,000

const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5];

/**
 * The notches the fader lands on, in US cents: a 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 ladder in each decade of the shown
 * currency, so the notches read as round numbers there (€250,000; ¥25,000,000 with a unit of 100). `rate` is units
 * of that currency per dollar. Away from dollars the cents are fractional on purpose: converting back lands exactly
 * on the round figure.
 */
export function incomeSteps(rate = 1, unit = 1, range?: { low: number; high: number }): number[] {
  const out: number[] = [];
  // Whole decades of the shown currency, wide enough for the range (in US cents) when one is given.
  const low = Math.min(INCOME_MIN * unit, range ? 10 ** Math.floor(Math.log10(range.low * rate)) : Infinity);
  const top = Math.max(INCOME_MAX * unit, range ? 10 ** Math.ceil(Math.log10(range.high * rate)) : 0);
  for (let decade = low; decade < top; decade *= 10) for (const m of LADDER) out.push(Math.round(decade * m) / rate);
  out.push(top / rate);
  return rate === 1 ? out.map(Math.round) : out;
}

/** The dollar notches. */
export const INCOME_STEPS: number[] = incomeSteps();

/** Position on the fader (0 to 1) for an income, on a log scale so $50k and $50M both get room. */
export function fractionOf(cents: number, steps: readonly number[] = INCOME_STEPS): number {
  const lo = steps[0]!;
  const hi = steps[steps.length - 1]!;
  return Math.log(Math.max(lo, Math.min(hi, cents)) / lo) / Math.log(hi / lo);
}

/** The notch nearest a position. */
export function incomeAt(fraction: number, steps: readonly number[] = INCOME_STEPS): number {
  const f = Math.max(0, Math.min(1, fraction));
  let best = steps[0]!;
  for (const s of steps) if (Math.abs(fractionOf(s, steps) - f) < Math.abs(fractionOf(best, steps) - f)) best = s;
  return best;
}

export interface Stage {
  /** 0 to 5: horrid, upset, normal, smile, big smile, ritzy rich. */
  index: number;
  line: string;
}

/** A year's income over the list's total: below these, the stage before. */
const BOUNDS = [0.1, 0.3, 0.6, 2.5, 15];
const LINES = [
  "Out of reach for now",
  "A real stretch",
  "Doable, if you're careful",
  "You could comfortably afford this",
  "You could very much afford this",
  "You wouldn't notice the bill",
];
export const STAGES = LINES.length;
/** The stage that reads "comfortably". */
export const COMFORTABLE = 3;
/** Keeping it all is comfortable when it takes no more than this share of a year's income. */
export const KEEP_SHARE = 0.15;

/**
 * What the income has to carry: the list's total, or its running costs when those are the heavier load (a yacht's
 * crew can outweigh its price over time). Scaled so a keep cost of 15% of income lands exactly on "comfortably".
 */
export function loadOf(totalCents: number, keepPerYearCents = 0): number {
  return Math.max(totalCents, keepPerYearCents / (KEEP_SHARE * BOUNDS[COMFORTABLE - 1]!), 100_00);
}

export function stageOf(incomeCents: number, totalCents: number, keepPerYearCents = 0): Stage {
  const ratio = incomeCents / loadOf(totalCents, keepPerYearCents);
  // A hair of tolerance so an income computed for a stage (comfortableIncome) lands in it despite rounding.
  const index = BOUNDS.filter((b) => ratio >= b - 1e-9).length;
  return { index, line: LINES[index]! };
}

/**
 * The income a year that carries everything on the list comfortably (owner, recording 03: "the estimated annual
 * income needed to comfortably afford everything"), rounded up to two significant figures so it reads as an
 * estimate: $1,234,567 needs $750,000.
 */
export function comfortableIncome(totalCents: number, keepPerYearCents = 0): number {
  const exact = loadOf(totalCents, keepPerYearCents) * BOUNDS[COMFORTABLE - 1]!;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(exact)) - 1);
  return Math.ceil(exact / magnitude - 1e-9) * magnitude;
}

/** Match the list's estimate until someone chooses an income; an unpriced list keeps its existing fallback. */
export function faderIncome({ totalCents, keepPerYearCents, selectedIncomeCents, hasPricedItems }: { totalCents: number; keepPerYearCents: number; selectedIncomeCents?: number; hasPricedItems: boolean }): number {
  return selectedIncomeCents ?? (hasPricedItems ? comfortableIncome(totalCents, keepPerYearCents) : startIncome(totalCents));
}

/**
 * The incomes the fader must reach for a list (US cents): low enough that the far left reads horrid, high enough that
 * the far right reads ritzy, never narrower than $10,000 to $100 million.
 */
export function fullRange(totalCents: number, keepPerYearCents = 0): { low: number; high: number } {
  const load = loadOf(totalCents, keepPerYearCents);
  return { low: Math.min(INCOME_MIN, load * BOUNDS[0]! * 0.5), high: Math.max(INCOME_MAX, load * BOUNDS[BOUNDS.length - 1]! * 1.5) };
}

/** A sensible starting income for a list: where it reads "comfortably", so the first face is a smile. */
export function startIncome(totalCents: number, steps: readonly number[] = INCOME_STEPS): number {
  return incomeAt(fractionOf(Math.max(steps[0]!, totalCents), steps), steps);
}
