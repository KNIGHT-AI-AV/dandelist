/**
 * The list's photo cards (owner, recording 03: "full-bleed edge-to-edge photos; the card entering the center grows
 * taller, 100% smooth"). Every card rests at `rest` tall in a slot `rest + gap` apart; the card at the focus line
 * opens by `grow`, and the cards under it move down to make room. All of it is two interpolations of the scroll
 * position per card (transforms only), so it runs on the native driver and never re-lays out while scrolling.
 *
 * Why it never overlaps: with the focus between card k and k+1, k is open by (1 - x) and k+1 by x, which sum to 1.
 * A card is pushed down by the opening of every card above it, which is that same sum while the focus is above it
 * and falls to 0 as the focus passes its own centre. The gap between any two neighbours stays `gap` throughout.
 * Pure, so the tests can walk the scroll and check it.
 */

export interface CardGeometry {
  /** Resting height. */
  rest: number;
  /** Extra height at the focus line. */
  grow: number;
  /** Space between cards. */
  gap: number;
}

export const CARD_GAP = 3;

/** Card sizes for a column `width` wide: a little over half as tall as wide at rest, half again at the focus. */
export function geometry(width: number): CardGeometry {
  const rest = Math.round(Math.max(196, Math.min(300, width * 0.56)));
  return { rest, grow: Math.round(rest * 0.5), gap: CARD_GAP };
}

export interface Range {
  inputRange: number[];
  outputRange: number[];
}

/**
 * The two interpolations for card `index`, as functions of the scroll offset. `listTop` is where the first card's
 * slot starts in the scroll content; `focus` is the focus line's distance from the top of the visible scroll area.
 */
export function cardRanges(index: number, g: CardGeometry, listTop: number, focus: number): { open: Range; push: Range | null } {
  const pitch = g.rest + g.gap;
  const centre = (i: number) => i * pitch + g.rest / 2;
  // The scroll offset at which a point `c` of the list sits on the focus line.
  const at = (c: number) => listTop + c - focus;
  const open = { inputRange: [at(centre(index) - pitch), at(centre(index)), at(centre(index) + pitch)], outputRange: [0, 1, 0] };
  if (index === 0) return { open, push: null };
  const input = [at(centre(0) - pitch), at(centre(0)), at(centre(index - 1)), at(centre(index))];
  const output = [0, g.grow, g.grow, 0];
  // Card 1's middle points coincide; interpolation ranges must strictly rise.
  const keep = input.map((_, i) => i === 0 || input[i]! > input[i - 1]!);
  return { open, push: { inputRange: input.filter((_, i) => keep[i]), outputRange: output.filter((_, i) => keep[i]) } };
}

/** Linear interpolation clamped at both ends, the same as Animated's `extrapolate: "clamp"`. */
export function sample(r: Range, x: number): number {
  const { inputRange: xs, outputRange: ys } = r;
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
  }
  return ys[ys.length - 1]!;
}

/** The room the cards need: every slot, one card's growth, and enough below for the last card to reach the focus. */
export function listHeight(count: number, g: CardGeometry): number {
  return count ? count * (g.rest + g.gap) + g.grow : 0;
}

/**
 * The scroll offset that brings card `index` to the focus line, opened up: where the chat's "Added to your list"
 * lands. Never above the top of the list.
 */
export function revealAt(index: number, g: CardGeometry, listTop: number, focus: number): number {
  return Math.max(0, Math.round(listTop + index * (g.rest + g.gap) + g.rest / 2 - focus));
}

/** Space under the cards so the last one can scroll up to the focus line. */
export function tailRoom(viewport: number, focus: number, g: CardGeometry, dockRoom: number): number {
  return Math.max(dockRoom, Math.ceil(viewport - focus - g.rest / 2 - g.grow + g.gap));
}
