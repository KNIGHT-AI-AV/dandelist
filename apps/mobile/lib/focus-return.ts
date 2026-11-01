import { useEffect, useRef, type RefObject } from "react";
import { Platform } from "react-native";

/** What focus return needs of an element: the DOM's own focus and listener methods. */
export interface Focusable {
  isConnected?: boolean;
  focus(opts?: { preventScroll?: boolean }): void;
}
interface Watchable {
  addEventListener?(type: "focusin", fn: (e: { target: unknown }) => void): void;
  removeEventListener?(type: "focusin", fn: (e: { target: unknown }) => void): void;
}

/** Keeps `store` on the last element focused inside `el`; returns the way to stop. */
export function rememberFocus(el: Watchable | null | undefined, store: { current: Focusable | null }): () => void {
  const onFocusIn = (e: { target: unknown }) => {
    store.current = e.target as Focusable;
  };
  el?.addEventListener?.("focusin", onFocusIn);
  return () => el?.removeEventListener?.("focusin", onFocusIn);
}

/**
 * Puts focus back on the remembered element when nothing else holds it (focus on the page body or nowhere) and the
 * element is still on the page. True when it did.
 */
export function restoreFocus(store: { current: Focusable | null }, doc: { activeElement: unknown; body: unknown }): boolean {
  const el = store.current;
  if (!el || el.isConnected === false) return false;
  if (doc.activeElement && doc.activeElement !== doc.body) return false;
  el.focus({ preventScroll: true });
  return true;
}

/**
 * On the web: a screen that goes inert under another (the list under an open wish) drops the keyboard's place, so when
 * it is `active` again, focus goes back to where it was inside `ref` (review of #199: after Back, Tab used to start
 * over from the bar instead of the card the wish was opened from). Phones keep their own screen reader focus.
 */
export function useFocusReturn(ref: RefObject<unknown>, active: boolean): void {
  const last = useRef<Focusable | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    return rememberFocus(ref.current as Watchable | null, last);
  }, [ref]);
  useEffect(() => {
    if (Platform.OS !== "web" || !active || typeof document === "undefined") return;
    // A frame later: the screen above has gone and this one is no longer inert.
    const frame = requestAnimationFrame(() => restoreFocus(last, document));
    return () => cancelAnimationFrame(frame);
  }, [active]);
}
