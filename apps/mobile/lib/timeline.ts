/**
 * The wish page's timeline (owner, 2026-10-31): instead of a fixed five years, a bar sets over how long they'd pay for
 * it, and the statement shows what that takes each month. It counts in months up to three years, then in years. Pure,
 * so the steps and the words have tests.
 */

/** The bar's notches, in months: every month to a year, every quarter to three years, then every year to ten. */
export const TIMELINE_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21, 24, 27, 30, 33, 36, 48, 60, 72, 84, 96, 108, 120];

/** Where the bar starts: the five years the statement used to show. */
export const DEFAULT_TIMELINE_MONTHS = 60;

/** Past this many months the timeline is said in years. */
const MONTHS_UP_TO = 36;

/** "1 month", "18 months", "36 months", then "4 years". */
export function timelineWords(months: number): string {
  if (months <= MONTHS_UP_TO) return months === 1 ? "1 month" : `${months} months`;
  const years = months / 12;
  return `${Number.isInteger(years) ? years : years.toFixed(1)} years`;
}

/** Landmarks under the bar, each under its own notch. */
export const TIMELINE_LABELS = [
  { cents: 1, text: "1 month" },
  { cents: 12, text: "1 year" },
  { cents: 36, text: "3 years" },
  { cents: 120, text: "10 years" },
] as const;

/** Moves that land with the firmer haptic: a whole year, or crossing from months into years. */
export const firmTimelineStep = (from: number, to: number): boolean => to % 12 === 0 || from <= MONTHS_UP_TO !== to <= MONTHS_UP_TO;
