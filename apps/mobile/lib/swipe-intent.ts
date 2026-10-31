/**
 * What a sideways swipe on a removable card means inside the ring of pages (owner, 2026-10-31: swiping between the
 * pages, people "may accidentally swipe it off"). Right after the pages move, a card leaves sideways drags to the pages,
 * so swipes that carry on from a page turn keep turning pages. Once a card has the drag, letting go removes it only
 * after a deliberate drag past its line; a quick flick turns the page instead, as it would anywhere else on the screen.
 * Pure, so the gesture maths has tests.
 */

/** After the pages move, cards leave sideways drags to the pages for this long. */
export const PAGE_QUIET_MS = 900;
/** A flick is this fast, in px per ms, in the direction the card travels. */
export const FLICK_X = 0.5;
/** A drag held at least this long before letting go reads as deliberate, however fast it ends. */
export const DELIBERATE_MS = 250;
/** Outside the ring a flick still removes, but only once the card has moved this share of its width. */
const FLICK_MIN = 0.12;

export type SwipeOutcome = "remove" | "page" | "home";

/** Whether the pages have been still long enough for a card to take a sideways drag. */
export const pagesStill = (movedAt: number, now: number): boolean => now - movedAt >= PAGE_QUIET_MS;

/**
 * Where a released card goes. `dx` and `vx` are the drag and its speed (px, px per ms), `removeAt` the share of the
 * width that is the card's line, `ms` how long the drag lasted, `pages` whether the card sits in the ring.
 */
export function swipeOutcome(g: { dx: number; vx: number; width: number; removeAt: number; ms: number; pages: boolean }): SwipeOutcome {
  const dir = Math.sign(g.dx);
  const fast = dir !== 0 && Math.abs(g.vx) >= FLICK_X;
  // Flicked back toward where it started: it goes home.
  if (fast && Math.sign(g.vx) === -dir) return "home";
  const flick = fast && Math.sign(g.vx) === dir;
  const past = g.width > 0 && Math.abs(g.dx) >= g.width * g.removeAt;
  if (past && (!flick || g.ms >= DELIBERATE_MS)) return "remove";
  if (flick) return g.pages ? "page" : g.width > 0 && Math.abs(g.dx) >= g.width * FLICK_MIN ? "remove" : "home";
  return "home";
}
