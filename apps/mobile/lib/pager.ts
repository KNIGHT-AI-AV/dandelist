/**
 * The signed-in app is one ring of pages (owner, recording 03: "swipe left/right across the whole screen cycles
 * pages, infinitely"). Position is a number of pages that never wraps; the page in front is that number modulo the
 * ring. Pure, so the gesture maths has tests.
 */
export const PAGES = ["list", "chat", "details", "money", "settings"] as const;
export type PageId = (typeof PAGES)[number];
export const PAGE_COUNT = PAGES.length;

/** A drag past this share of the width turns the page; less springs back. */
export const COMMIT = 0.22;
/** A flick this fast turns the page whatever the distance, in pages per millisecond (about 0.3 px/ms on a phone). */
export const FLICK_PAGES = 0.3 / 393;

export const mod = (n: number, m: number = PAGE_COUNT) => ((n % m) + m) % m;

export const pageAt = (pos: number): PageId => PAGES[mod(Math.round(pos))]!;

/** Where page `i` sits relative to position `pos`, in pages, wrapped into [-n/2, n/2): 0 in front, 1 to the right. */
export const offsetOf = (i: number, pos: number, n: number = PAGE_COUNT) => mod(i - pos + n / 2, n) - n / 2;

/** The nearest position that shows `page`, so going there never travels more than half the ring. */
export function nearest(pos: number, page: PageId): number {
  const base = Math.round(pos);
  return base + offsetOf(PAGES.indexOf(page), base);
}

/**
 * Where a released swipe lands. `drag` and `velocity` are in pages, positive toward the next page (the finger moving
 * left). One page per swipe at most, measured from where the gesture began.
 */
export function landing(start: number, drag: number, velocity: number): number {
  const from = Math.round(start);
  let target = Math.round(start + drag);
  const flicked = Math.abs(velocity) > FLICK_PAGES && Math.sign(velocity) === Math.sign(drag);
  if (target === from && drag !== 0 && (Math.abs(drag) > COMMIT || flicked)) target = from + Math.sign(drag);
  // A flick back against the drag returns to the start.
  if (Math.abs(velocity) > FLICK_PAGES && Math.sign(velocity) !== Math.sign(drag) && drag !== 0) target = from;
  return Math.max(from - 1, Math.min(from + 1, target));
}

/** How far the dock is from the pages it belongs to (the list and the chat): 0 on them, 1 a page away or more. */
export function dockDistance(pos: number): number {
  const x = mod(pos);
  if (x <= 1) return 0;
  if (x <= 2) return x - 1;
  if (x >= PAGE_COUNT - 1) return PAGE_COUNT - x;
  return 1;
}
