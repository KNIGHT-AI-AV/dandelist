/**
 * The welcome's steps and its Back (owner, 2026-10-30: going back "needs to work every single time").
 *
 * Every step change is a slow crossfade: the old step fades out, the next one is put on screen, and it fades up.
 * People act at any moment of that, often at once after Back, when the step they return to is already filled in.
 * Nothing they do is dropped:
 *  - a change asked for while the old step fades out only changes where the fade lands;
 *  - a change asked for while the new step fades up turns the fade round from where it is;
 *  - each Back goes exactly one step back, however quickly the taps come.
 * An action starts on the step it came from (`leave`), and that is when what Back will put back is taken: before the
 * action changes anything, even when the move itself comes later (a vote moves on once its price has flown into the
 * meter). An action from a step the person has already left (a tap on a step that is still fading out, a vote whose
 * price lands after Back, a timer) changes nothing, so it can never add picks or move the flow twice.
 */

/** Runs the stage to 0 (out) or 1 (up), and calls `done` only if that run finished; starting another one stops it. */
export type Fade = (to: 0 | 1, done: () => void) => void;

/** A step left behind, and what Back puts back on it. */
export interface Visit<S, Snap> {
  step: S;
  snap: Snap;
}

/** An action under way on one step. */
export interface Leave<S> {
  /** Whether that step is still the one the person is on. */
  still(): boolean;
  /** Moves on to `next`. False, and nothing changes, if the person has left the step meanwhile. */
  to(next: S): boolean;
}

export interface Steps<S, Snap> {
  /** The step the person is on: the one on screen, or the one the stage is fading to. */
  readonly at: S | null;
  /** Whether `step` is still the step the person is on. */
  is(step: S): boolean;
  /** Whether Back has a step to go to. */
  canGoBack(): boolean;
  /** Puts the first step on screen, with no fade and no history. */
  start(step: S): void;
  /** Starts an action on `from`, taking what Back will put back; null, and nothing happens, if `from` is not current. */
  leave(from: S): Leave<S> | null;
  /** One step back: the visit to restore, or null when Back has nowhere to go. */
  back(): Visit<S, Snap> | null;
  /** From `from` to `next` with the history cleared (start over). False if `from` is not current. */
  reset(from: S, next: S): boolean;
}

/**
 * The welcome's step machine. `show` puts a step on screen when the old one has faded out; `capture` reads what Back
 * puts back (the list and the counts as they are now); `keepsHistory` says which steps Back returns to and leaves from
 * (not the title, which has played, nor the theme, which is past the list).
 */
export function welcomeSteps<S, Snap>({ fade, show, capture, keepsHistory }: { fade: Fade; show(step: S): void; capture(): Snap; keepsHistory(step: S): boolean }): Steps<S, Snap> {
  let at: S | null = null;
  /** The old step is fading out; when it has, whatever `at` is by then goes up. */
  let leaving = false;
  const history: Visit<S, Snap>[] = [];

  const draw = () => {
    if (leaving) return;
    leaving = true;
    fade(0, () => {
      leaving = false;
      show(at as S);
      fade(1, () => {});
    });
  };

  return {
    get at() {
      return at;
    },
    is: (step) => at === step,
    canGoBack: () => at !== null && keepsHistory(at) && history.length > 0,
    start(step) {
      at = step;
      history.length = 0;
      show(step);
    },
    leave(from) {
      if (at !== from) return null;
      const snap = capture();
      return {
        still: () => at === from,
        to(next) {
          if (at !== from) return false;
          if (keepsHistory(from)) history.push({ step: from, snap });
          at = next;
          draw();
          return true;
        },
      };
    },
    back() {
      if (at === null || !keepsHistory(at)) return null;
      const prev = history.pop();
      if (!prev) return null;
      at = prev.step;
      draw();
      return prev;
    },
    reset(from, next) {
      if (at !== from) return false;
      history.length = 0;
      at = next;
      draw();
      return true;
    },
  };
}
