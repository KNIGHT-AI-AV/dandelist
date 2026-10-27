import { useEffect, useRef, useState } from "react";
import { bezier } from "../lib/odometer-plan";

/**
 * Where an image is in the hunt. While the agent is still looking, a standby picture waits behind full glass;
 * a found image starts blurred and clears as it is checked, then sharpened or upscaled.
 */
export type Stage = "hunting" | "found" | "sharpening" | "clear";
/**
 * `swirl` is poured window glass, for the title sequence only. `pane` is the card treatment: a frosted pane that
 * clears in 450 ms with no bending, so the photos people judge are never warped (UI audit P0-2). `film` and
 * `frost` are the softer looks for prints and generated imagery.
 */
export type Treatment = "swirl" | "pane" | "film" | "frost";

export const CLARITY: Record<Stage, number> = { hunting: 0, found: 0.45, sharpening: 0.75, clear: 1 };
/** How clear a generated image may get: enough to read, never bare. */
export const FINISHED = 0.78;
/** A picture that hasn't arrived by now is treated as failed: the standby shows clear, never melted. */
export const LOAD_TIMEOUT_MS = 8000;

const CINEMA = bezier(0.25, 0.1, 0.25, 1);
const OUT = bezier(0.23, 1, 0.32, 1);

/** How long each treatment takes to clear, and on which curve: cinema for the title, UI speed for cards. */
export const CLEAR: Record<Treatment, { ms: number; curve: (t: number) => number }> = {
  swirl: { ms: 1200, curve: CINEMA },
  pane: { ms: 450, curve: OUT },
  film: { ms: 600, curve: OUT },
  frost: { ms: 700, curve: OUT },
};

/**
 * Drives the glass: `clarity` eases toward the target over the treatment's time (0.2 s with reduced motion), and
 * `time` keeps the glass drifting while it is not clear. The frame loop stops once the target is reached and the
 * picture is either fully clear or meant to keep its finish.
 */
export function useGlassClock(target: number, reduced: boolean, treatment: Treatment = "swirl"): { clarity: number; time: number } {
  const [state, setState] = useState({ clarity: target, time: 0 });
  const from = useRef(target);
  const current = useRef(target);
  const started = useRef(0);

  useEffect(() => {
    from.current = current.current;
    started.current = 0;
    let raf = 0;
    const { ms, curve } = CLEAR[treatment];
    const duration = reduced ? 200 : ms;
    const tick = (now: number) => {
      if (!started.current) started.current = now;
      const t = Math.min(1, (now - started.current) / duration);
      const clarity = from.current + (target - from.current) * curve(t);
      current.current = clarity;
      setState({ clarity, time: reduced ? 0 : now / 1000 });
      // Only the swirl keeps drifting while it waits; everything else holds still once it reaches its target.
      if (t < 1 || (target < 1 && !reduced && treatment === "swirl")) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, treatment]);

  return state;
}

/** Tracks whether a picture loaded, failed or timed out, so the glass can never stay melted (UI audit P0-2). */
export function usePictureState(uri: string | null | undefined) {
  const [state, setState] = useState<{ uri: string | null | undefined; loaded: boolean; failed: boolean }>({ uri, loaded: false, failed: false });
  const current = state.uri === uri ? state : { uri, loaded: false, failed: false };
  useEffect(() => {
    if (!uri) return;
    const t = setTimeout(() => setState((s) => (s.uri === uri && !s.loaded ? { uri, loaded: false, failed: true } : s)), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [uri]);
  return {
    loaded: current.loaded,
    failed: current.failed,
    onLoad: () => setState({ uri, loaded: true, failed: false }),
    onError: () => setState({ uri, loaded: false, failed: true }),
  };
}

/** The clarity a reveal should head for. A failed picture shows its standby clear (or finished, for generated). */
export function clarityTarget({ uri, ready, failed, stage, finish }: { uri?: string | null; ready: boolean; failed: boolean; stage: Stage; finish: boolean }): number {
  const cap = finish ? FINISHED : 1;
  if (failed) return cap;
  if (ready) return Math.min(CLARITY[stage], cap);
  return !uri && stage === "clear" ? FINISHED : 0;
}
