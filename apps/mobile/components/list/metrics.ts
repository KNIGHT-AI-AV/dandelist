import { space } from "../../lib/palette";

/**
 * The few sizes the wish list owns (owner rule: every box has architecture). Spacing, radii and type come from
 * lib/palette; each value here is named with its reason. Pure, so tests can check the rhythm.
 */

/** Photo cards come in two heights, two tall then one short, so the column has a rhythm. */
export const CARD_TALL = 232;
export const CARD_SHORT = 184;
/** Space after each card; it closes with the card when the card leaves. */
export const CARD_GAP = space[12];
/** The empty state fills exactly the first two card slots, so the first wish lands where it stood. */
export const EMPTY_HEIGHT = 2 * CARD_TALL + CARD_GAP;

/** The account initial's disc, centred in its 44 pt target: big enough for the letter, small enough to sit quiet. */
export const AVATAR = 34;

/** The composer pill at the bottom of the screen, lifted off the home indicator. */
export const DOCK_PILL = 58;
export const DOCK_LIFT = space[16];
/** Inner padding of the pill's ends: the text starts here and the send disc sits this far in. */
export const DOCK_END = space[8];
/** The send disc is concentric with the pill's end (nested radii: inner = outer − padding). */
export const DOCK_SEND = DOCK_PILL - 2 * DOCK_END;
/** The undo toast floats this far above the composer, so it never covers it. */
export const TOAST_GAP = space[12];

/** Card height for a slot: the n-th card still on screen, counting from the top. */
export function cardHeight(slot: number): number {
  return slot % 3 === 2 ? CARD_SHORT : CARD_TALL;
}

/**
 * Each wish's height. A wish waiting on undo keeps no slot, so the cards below re-flow the moment it leaves (not five
 * seconds later when the delete runs); it is measured for the slot it returns to if the removal is undone.
 */
export function cardHeights(ids: readonly string[], hidden: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  let slot = 0;
  for (const id of ids) {
    out.set(id, cardHeight(slot));
    if (!hidden.has(id)) slot += 1;
  }
  return out;
}

/** Bottom offset of the undo toast: above the composer pill, its lift and the home indicator. */
export function toastBottom(bottomInset: number): number {
  return bottomInset + DOCK_LIFT + DOCK_PILL + TOAST_GAP;
}
