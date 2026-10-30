import { useEffect, useState } from "react";
import faces from "./web-fonts.json";

/**
 * Web version of lib/fonts.ts: the same faces as WOFF2, each cut by script (scripts/web-fonts.py). The first frame waits
 * only for the Latin cuts, about 180 KB for all seven faces against 724 KB of TTF (Lighthouse, 2026-10-30); a Cyrillic,
 * Greek or other character downloads its cut the first time it shows, so nothing loses coverage.
 */

// expo-font gives up on a face after 6 s and the app renders in system fonts; this keeps that limit.
const TIMEOUT_MS = 6000;
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  if (loading) return loading;
  if (typeof document === "undefined" || !document.fonts) return (loading = Promise.reject(new Error("no FontFaceSet")));
  const rules = Object.entries(faces).flatMap(([family, cuts]) =>
    // The Latin cut is the one the first frame waits for; the others swap in when a character needs them.
    cuts.map((cut, i) => `@font-face{font-family:"${family}";src:url(${cut.url}) format("woff2");unicode-range:${cut.range};font-display:${i ? "swap" : "auto"}}`),
  );
  const style = document.createElement("style");
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
  // Text of one space asks only for the cut that covers U+0020: the Latin one.
  const all = Promise.all(Object.keys(faces).map((family) => document.fonts.load(`16px "${family}"`, " ")));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`fonts not loaded in ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
  });
  return (loading = Promise.race([all, late])
    .then(() => undefined)
    .finally(() => clearTimeout(timer)));
}

// Start the downloads as the bundle runs, before the first render asks.
if (typeof document !== "undefined") load().catch(() => {});

export function useAppFonts(): [boolean, Error | null] {
  const [state, setState] = useState<[boolean, Error | null]>([false, null]);
  useEffect(() => {
    let live = true;
    load().then(
      () => live && setState([true, null]),
      (e: unknown) => live && setState([false, e instanceof Error ? e : new Error(String(e))]),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
