import { createContext, useContext } from "react";
import type { View } from "react-native";

/** What a focused field hands its scroll view: the view to keep in sight above the keyboard and any dock. */
export type RevealTarget = Pick<View, "measureInWindow">;

export interface Reveal {
  /** A field inside took focus: scroll it into view now and again whenever the keyboard moves. */
  reveal(target: RevealTarget | null): void;
  /** That field lost focus. */
  release(target: RevealTarget | null): void;
}

export const RevealContext = createContext<Reveal | null>(null);

/** The nearest KeyboardScroll's reveal, or null outside one. Fields call it on focus and blur. */
export function useReveal(): Reveal | null {
  return useContext(RevealContext);
}
