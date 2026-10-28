/**
 * "What would it take?" (owner, 2026-10-28: "this is not a savings app... it's a wish list"). A fader from $10,000 to
 * $100 million a year; for each income, a face and a line say how comfortably that income carries everything on
 * the list. Nothing here is a budget or a date: the ratio of a year's income to the list's total picks one of five
 * stages, from devastated to monocled.
 */
export const INCOME_MIN = 1_000_000; // $10,000
export const INCOME_MAX = 10_000_000_000; // $100,000,000

/** The notches the fader lands on: a 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 ladder in each decade, each one a tick. */
export const INCOME_STEPS: number[] = (() => {
  const ladder = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5];
  const out: number[] = [];
  for (let decade = 1_000_000; decade < INCOME_MAX; decade *= 10) for (const m of ladder) out.push(Math.round(decade * m));
  out.push(INCOME_MAX);
  return out;
})();

/** Position on the fader (0 to 1) for an income, on a log scale so $50k and $50M both get room. */
export const fractionOf = (cents: number) => Math.log(Math.max(INCOME_MIN, Math.min(INCOME_MAX, cents)) / INCOME_MIN) / Math.log(INCOME_MAX / INCOME_MIN);

/** The notch nearest a position. */
export function incomeAt(fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  let best = INCOME_STEPS[0]!;
  for (const s of INCOME_STEPS) if (Math.abs(fractionOf(s) - f) < Math.abs(fractionOf(best) - f)) best = s;
  return best;
}

export interface Stage {
  /** 0 to 4: devastated, uneasy, content, overjoyed, monocled. */
  index: number;
  line: string;
}

/** A year's income over the list's total: below these, the stage before. */
const BOUNDS = [0.15, 0.6, 2.5, 15];
const LINES = ["Out of reach for now", "A stretch, but you'd get there", "You could comfortably afford this", "You could very much afford this", "You wouldn't notice the bill"];

export function stageOf(incomeCents: number, totalCents: number): Stage {
  const ratio = incomeCents / Math.max(totalCents, 100_00);
  const index = BOUNDS.filter((b) => ratio >= b).length;
  return { index, line: LINES[index]! };
}

/** A sensible starting income for a list: where it reads "comfortably", so the first face is a smile. */
export function startIncome(totalCents: number): number {
  return incomeAt(fractionOf(Math.max(INCOME_MIN, totalCents)));
}
