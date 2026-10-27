import { useEffect, useRef, useState } from "react";

/**
 * Where an image is in the hunt. While the agent is still looking, a standby picture waits behind full glass;
 * a found image starts blurred and clears as it is checked, then sharpened or upscaled.
 */
export type Stage = "hunting" | "found" | "sharpening" | "clear";
export type Treatment = "swirl" | "film" | "frost";

export const CLARITY: Record<Stage, number> = { hunting: 0, found: 0.45, sharpening: 0.75, clear: 1 };
/** How clear a generated image may get: enough to read, never bare. */
export const FINISHED = 0.78;

// ease.cinema, cubic-bezier(0.25, 0.1, 0.25, 1), solved numerically so the clock needs no animation library.
function cinema(t: number): number {
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * 0.25 + 3 * (1 - u) * u * u * 0.25 + u * u * u;
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * 0.1 + 3 * (1 - u) * u * u * 1 + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < t) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/**
 * Drives the glass: `clarity` eases toward the target over 1.6 s (0.2 s with reduced motion), and `time` keeps the
 * glass drifting while it is not clear. The frame loop stops once the picture is fully clear.
 */
export function useGlassClock(target: number, reduced: boolean): { clarity: number; time: number } {
  const [state, setState] = useState({ clarity: target, time: 0 });
  const from = useRef(target);
  const current = useRef(target);
  const started = useRef(0);

  useEffect(() => {
    from.current = current.current;
    started.current = 0;
    let raf = 0;
    const duration = reduced ? 200 : 1600;
    const tick = (now: number) => {
      if (!started.current) started.current = now;
      const t = Math.min(1, (now - started.current) / duration);
      const clarity = from.current + (target - from.current) * cinema(t);
      current.current = clarity;
      setState({ clarity, time: reduced ? 0 : now / 1000 });
      if (t < 1 || (target < 1 && !reduced)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return state;
}
