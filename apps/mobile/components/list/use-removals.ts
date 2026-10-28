import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Platform } from "react-native";
import * as removal from "../../lib/removal";

/**
 * Runs the undo window from lib/removal.ts on a real clock. `commit` is the real delete; it runs when the window
 * closes, when a newer removal replaces this one, when the screen unmounts, or when the app goes to the background
 * (a toast nobody can see shouldn't keep a delete waiting). A failed delete reports through `onError`.
 */
export function useRemovals(commit: (id: string) => Promise<void>, onError: (message: string) => void) {
  const [pending, setPending] = useState<removal.Removal>(null);
  const state = useRef<removal.Removal>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  // Android lets people ask for longer on-screen messages (Accessibility > Time to take action); honour it.
  const windowMs = useRef(removal.UNDO_MS);

  const apply = useCallback((step: removal.Step) => {
    state.current = step.state;
    setPending(step.state);
    for (const id of step.commit) {
      commitRef.current(id).catch((e: unknown) => errorRef.current(e instanceof Error ? e.message : "Couldn't remove the wish."));
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void AccessibilityInfo.getRecommendedTimeoutMillis(removal.UNDO_MS).then((ms) => {
      windowMs.current = Math.max(removal.UNDO_MS, ms);
    });
  }, []);

  // The clock. Timers can wake a hair early, so a wake-up that finds the window still open simply re-arms.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const left = removal.msLeft(state.current, Date.now());
      if (left === null) return;
      timer = setTimeout(() => {
        const step = removal.expire(state.current, Date.now());
        if (step.state === state.current) arm();
        else apply(step);
      }, left);
    };
    arm();
    return () => clearTimeout(timer);
  }, [pending, apply]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "background" && apply(removal.flush(state.current)));
    return () => {
      sub.remove();
      apply(removal.flush(state.current));
    };
  }, [apply]);

  const set = useCallback((next: removal.Removal) => {
    state.current = next;
    setPending(next);
  }, []);

  return {
    pending,
    remove: useCallback((w: { id: string; name: string }) => apply(removal.begin(state.current, w, Date.now(), windowMs.current)), [apply]),
    undo: useCallback((id: string) => apply(removal.undo(state.current, id)), [apply]),
    hold: useCallback(() => set(removal.hold(state.current, Date.now())), [set]),
    release: useCallback(() => set(removal.release(state.current, Date.now())), [set]),
  };
}
