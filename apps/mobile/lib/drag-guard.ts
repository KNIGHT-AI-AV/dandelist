import { Platform } from "react-native";

/**
 * On the web a button presses on the browser's `click`, which fires whenever the pointer goes down and up on the same
 * element, even after a long sideways drag. So a page swipe or a card swipe that starts on a button would also press
 * it. Every drag notes itself here, and a click that lands within a moment of one is swallowed before any button
 * sees it.
 */
const QUIET_MS = 400;
let lastDrag = 0;
let installed = false;

export function noteDrag(): void {
  lastDrag = Date.now();
  if (installed || Platform.OS !== "web" || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "click",
    (e) => {
      if (Date.now() - lastDrag > QUIET_MS) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
