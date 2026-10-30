/**
 * Where a wish card in the chat stands, said plainly (owner, 2026-10-30: "make it clear that something is not added or
 * something is added, but we're still figuring it out in the chat what it is"):
 * - working: the Dandy is still finding out what it is and what it costs; nothing to put on the list yet, and the
 *   card never claims it's on the list, even when an older wish has the same name;
 * - ready: found and priced, with "Add to my list";
 * - added: on the list, with a line that takes them to it there;
 * - stuck: the hunt stopped without a price, with "Try again".
 */
export type CardState = "working" | "ready" | "added" | "stuck";

export function cardState(c: { landed: boolean; failed: boolean; listedId: string | null }): CardState {
  if (!c.landed) return c.failed ? "stuck" : "working";
  return c.listedId ? "added" : "ready";
}

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The wish this card put on the list, if it is still there: the one saved from this card, else (a conversation opened
 * again, which no longer knows what it saved) one with the same name. A wish taken off the list since counts as not
 * added, so the card offers "Add to my list" again rather than pointing at nothing.
 */
export function listedWish(wishes: readonly { id: string; name: string }[], savedId: string | null | undefined, names: readonly (string | null | undefined)[]): string | null {
  if (savedId && wishes.some((w) => w.id === savedId)) return savedId;
  const wanted = new Set(names.map(key).filter(Boolean));
  return wishes.find((w) => wanted.has(key(w.name)))?.id ?? null;
}
