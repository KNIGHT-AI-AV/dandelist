import type { PageId } from "./pager";

/**
 * Removing a wish asks first (owner, 2026-10-31: "Deleting items has to prompt an are you sure", answered with its own
 * deliberate tap). Once they say yes, the next removals go through without asking for a while, so clearing several
 * wishes isn't a chore; the window closes early when they leave the app or move on to something else. Pure, so the
 * timing has tests.
 */

/** After a confirmed removal, more removals go through without asking for this long. */
export const GRACE_MS = 2 * 60_000;

/** Whether a removal at `now` has to ask, given when the free window ends (0: no window). */
export const needsConfirm = (graceUntil: number, now: number): boolean => now >= graceUntil;

/** When the free window ends, after a removal confirmed at `now`. Later removals in the window don't extend it. */
export const graceAfter = (now: number): number => now + GRACE_MS;

/** The pages where removing goes on: moving to any other page is doing something else, and the window closes. */
export const keepsGrace = (page: PageId): boolean => page === "list" || page === "details";
