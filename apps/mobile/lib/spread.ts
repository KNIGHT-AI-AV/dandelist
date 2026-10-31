/**
 * Two pages of the ring side by side (owner, 2026-10-31: "Optimize for the iPhone duo ... make it a really unique
 * experience for them"). The iPhone Duo's inner screen, open, is 951 by 669 points with the fold down the middle, so
 * each page gets one side of it: 475 points, about the width of its outer screen. Unfolding it opens the page you were
 * on into a spread with the next one beside it, the list with the Dandy, and folding it closes back to one.
 *
 * Only on a touch screen held sideways with room for two phone-width pages: the inner screen open and a tablet turned
 * sideways. One page stays everywhere else: phones, the Duo's outer screen, its Split View (385 points a side), the
 * inner screen turned upright, and a desktop browser.
 */

/** The narrowest a page of a spread gets: a phone's width. */
export const SPREAD_PAGE_MIN = 420;

/** How many pages show side by side in a window this size. `touch`: the screen is worked with fingers. */
export function spreadOf(width: number, height: number, touch: boolean): 1 | 2 {
  return touch && width > height && width >= 2 * SPREAD_PAGE_MIN ? 2 : 1;
}
