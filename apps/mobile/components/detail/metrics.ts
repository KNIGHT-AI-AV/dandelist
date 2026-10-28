import { layout, space, type } from "../../lib/theme";

/** Shared measures for the wish page's pieces, built from the layout tokens. */

/** Floating controls sit this far under the status bar: the back button, the viewer's close and the page dots. */
export const CONTROL_TOP = space[4];

/** Where the hero's shade starts darkening the photo, as a fraction of its height. */
export const HERO_SHADE = 0.2;

/** The hero photo drifts down by this share of the scroll, so the page slides over it (transform only). */
export const PARALLAX = 0.3;

/** A page dot: the agent dot's size, so the two small marks read as one family. */
export const DOT = 6;

/** An idle dot's opacity: ink4's alpha, the palette's weight for idle marks. */
export const IDLE_DOT = 0.4;

/** Padding and spacing of the row of dots (and its glass pill over a photo). */
export const DOTS = { padV: space[8], padH: space[12], gap: space[8] } as const;

/** Height of the row of dots. */
export const DOTS_HEIGHT = DOT + 2 * DOTS.padV;

/** The dots' top edge, so their centre sits on the back button's centre line. */
export const dotsTop = (topInset: number) => topInset + CONTROL_TOP + (layout.control.chip - DOTS_HEIGHT) / 2;

/** The viewer's footer: the dots, then up to two lines of credit, inside the bottom safe area. */
export const VIEWER_FOOTER = layout.stack.base + DOTS_HEIGHT + layout.stack.tight + 2 * type.figure.lineHeight + layout.stack.base;

/** The viewer's photo starts under the close button's row. */
export const viewerTop = (topInset: number) => topInset + CONTROL_TOP + layout.control.chip + layout.stack.base;
