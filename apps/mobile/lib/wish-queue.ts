/**
 * Wishes added while another is being priced (owner, 2026-10-30: "While users are waiting for their items to pop up
 * with the pricing and pictures, we should prompt them if they want to add more onto the queue"). The queue is the
 * chat's own (#53: a message sent while the Dandy answers or hunts shows at once and runs next), so a wish added on
 * the New wish screen goes there and is priced in turn with everything else. One the chat isn't open to take yet
 * waits here, in order.
 */

/** Longest wish handed on, the same as a wish handed to the New wish screen. */
export const QUEUED_MAX = 300;

type Take = (text: string) => void;

let waiting: string[] = [];
let taker: Take | null = null;

/** Hands a wish to the chat's queue. False for a blank one. */
export function queueWish(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim().slice(0, QUEUED_MAX).trim();
  if (!t) return false;
  if (taker) taker(t);
  else waiting.push(t);
  return true;
}

/** The chat takes queued wishes as they come, the waiting ones first, in order. Returns the way to stop. */
export function takeQueuedWishes(take: Take): () => void {
  taker = take;
  const now = waiting;
  waiting = [];
  for (const t of now) take(t);
  return () => {
    if (taker === take) taker = null;
  };
}

/** For tests: what waits for the chat. */
export const queuedWishes = (): readonly string[] => waiting;
