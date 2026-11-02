/**
 * Where a short screen's words rest when the screen has room to spare (owner, 2026-11-02: "Some things look awkwardly
 * high on the front page instead of having like a perfect space"): two fifths of the way down the free space between
 * the header and the docked button, the optical centre, instead of pinned under the header over a band of nothing.
 * With no room to spare they start at the top and scroll, as before.
 */
export const OPTICAL = 0.4;

export function restTop(viewport: number, below: number, block: number): number {
  return Math.max(0, Math.round((viewport - below - block) * OPTICAL));
}

/**
 * Only a wide screen on the web rests its words lower. A phone types on a keyboard that rises over the room below (the
 * app opens it with the screen), so resting the words lower there pushed the field into the button's fade (review of
 * #217); phones keep their words under the header, where the keyboard leaves them in sight.
 */
export const REST_MIN_WIDTH = 744;

export function rests(web: boolean, width: number): boolean {
  return web && width >= REST_MIN_WIDTH;
}

export type Frame = { width: number; height: number };

/**
 * The words are placed once and stay put while someone types or the keyboard opens. They are placed again for a new
 * width (a turned phone, a resized window) or more height; less height is a keyboard (a phone's browser shrinks the
 * page for one), so it never moves them.
 */
export function placeAgain(prev: Frame | null, next: Frame): boolean {
  return !prev || next.width !== prev.width || next.height > prev.height;
}
