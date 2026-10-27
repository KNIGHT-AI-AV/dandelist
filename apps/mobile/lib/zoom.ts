/**
 * Card-to-detail zoom (UI audit P1-17, after WWDC24's zoom transitions): a card records where it sits on screen,
 * keyed by the wish's id rather than by a view, just before the detail opens; the detail grows its photograph out
 * of that rectangle and shrinks back into it on the way out.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const cards = new Map<string, Rect>();

export function rememberCard(id: string, rect: Rect) {
  cards.set(id, rect);
}

/** The card's last known rectangle, if the detail was opened from the list in this session. */
export function cardRect(id: string): Rect | undefined {
  return cards.get(id);
}
