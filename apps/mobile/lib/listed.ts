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

/**
 * The photo a chat wish card shows and saves: a retake's, else the hunt's own, both checked; otherwise none, so the card
 * waits under frosted glass and a finished hunt asks for one by itself. Never a picture from a page the research
 * opened: no check has passed it (owner, 2026-10-29: "Not any photo will do!!"), and since the fast card goes out the
 * moment it is priced (#205), that picture would stand in for seconds and could be saved with the wish.
 */
export function cardPhoto(shot: { imageUrl?: string } | null | undefined, option: { imageUrl?: string } | null | undefined): string | null {
  return shot?.imageUrl ?? option?.imageUrl ?? null;
}

/**
 * Whether a finished chat card asks for a photo by itself: once, when it has an option and no photo of any kind. A
 * picture from a page the research opened is never shown or saved (cardPhoto), but it still counts here, as it did
 * before cardPhoto, so no card asks for more retakes than it used to: each is up to 28 model calls, of 30 retakes a
 * day per person (api/src/agent/routes.ts).
 */
export function asksForPhoto(c: { option: boolean; done: boolean; photo: string | null; opened: boolean; asked: boolean }): boolean {
  return c.option && c.done && !c.photo && !c.opened && !c.asked;
}
