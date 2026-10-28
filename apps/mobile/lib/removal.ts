/**
 * Undo for removals on the wish list. A removed wish leaves the screen at once; the real delete only runs when its
 * undo window closes. One removal is pending at a time: a newer removal commits the older one, the way a new toast
 * replaces the last, so Undo always means the thing the toast names.
 *
 * Pure (no React, no timers), so the timing is tested on its own; `components/list/use-removals.ts` runs the clock.
 * Every transition returns the next state and the ids to delete now.
 */

/** How long Undo stays offered (wish list brief: 5 seconds). */
export const UNDO_MS = 5000;

export interface Pending {
  id: string;
  name: string;
  /** When the delete runs, in ms since the epoch. Ignored while held. */
  due: number;
  /** Time left when the window was paused (pointer or focus on the toast); null while running. */
  held: number | null;
}

export type Removal = Pending | null;

export interface Step {
  state: Removal;
  /** Ids whose delete should run now. */
  commit: string[];
}

const stay = (state: Removal): Step => ({ state, commit: [] });

/** Starts a removal. A different pending removal commits; removing the same wish twice changes nothing. */
export function begin(state: Removal, wish: { id: string; name: string }, now: number, ms: number = UNDO_MS): Step {
  if (state?.id === wish.id) return stay(state);
  return { state: { id: wish.id, name: wish.name, due: now + ms, held: null }, commit: state ? [state.id] : [] };
}

/** Undo: the wish comes back and nothing is deleted. Undoing anything but the pending wish changes nothing. */
export function undo(state: Removal, id: string): Step {
  return state?.id === id ? stay(null) : stay(state);
}

/** The clock: once the window has closed, the pending wish is deleted. */
export function expire(state: Removal, now: number): Step {
  if (!state || state.held !== null || now < state.due) return stay(state);
  return { state: null, commit: [state.id] };
}

/** Leaving the screen (or the app going to the background) deletes what is pending straight away. */
export function flush(state: Removal): Step {
  return state ? { state: null, commit: [state.id] } : stay(null);
}

/** Pauses the window while someone is on the toast, keeping the time that was left. */
export function hold(state: Removal, now: number): Removal {
  if (!state || state.held !== null) return state;
  return { ...state, held: Math.max(0, state.due - now) };
}

/** Restarts the window with the time that was left when it was held. */
export function release(state: Removal, now: number): Removal {
  if (!state || state.held === null) return state;
  return { ...state, due: now + state.held, held: null };
}

/** Milliseconds until the delete, or null when nothing is running (none pending, or held). */
export function msLeft(state: Removal, now: number): number | null {
  if (!state || state.held !== null) return null;
  return Math.max(0, state.due - now);
}
