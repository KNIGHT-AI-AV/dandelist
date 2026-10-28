import { step } from "../../lib/motion";
import { space } from "../../lib/theme";

/**
 * The wish list's choreography (owner, 2026-10-28: "Reveal animation needs to be high end. All animations."). Built
 * on lib/motion: entrances take step.inMs and ease out or spring, exits are faster at step.outMs, related elements
 * arrive top to bottom step.staggerMs apart, and reduced motion gets a short cross-fade instead.
 */
export const choreo = {
  inMs: step.inMs,
  outMs: step.outMs,
  stagger: step.staggerMs,
  /** Items past the first screenful arrive with the last visible one instead of waiting their turn. */
  staggerCap: 6,
  /** How far an entering element rises into place. */
  rise: space[12],
  /** A leaving card sinks to this as it fades. */
  goneScale: 0.96,
  /** A card under a finger (usePress's default); the lifted preview grows from here to full size. */
  pressed: 0.97,
  /** A small round control sinks further, like lux's IconButton. */
  pressedSmall: 0.94,
  /** The action sheet grows out of the card's edge from this scale. */
  sheetFrom: 0.9,
};

/** Delay for the n-th element of a group, top to bottom. */
export function delayFor(order: number): number {
  return Math.min(order, choreo.staggerCap) * choreo.stagger;
}
