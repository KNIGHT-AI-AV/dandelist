import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, type TextStyle } from "react-native";
import { DEFAULT_THEME, THEMES, scaleType, type Palette, type ThemeId, type TypeRole } from "./palette";
import { getSecret, setSecret } from "./storage";
import { usePageSize } from "./page-size";

/**
 * The theme provider and hooks. The tokens themselves (palettes, type roles, spacing, radii, shadows) live in
 * `lib/palette.ts`, which has no React in it so tests can check contrast and sizes. Screens read only these.
 */

export { DEFAULT_THEME, THEMES, THEME_ORDER, serif, contrast, fonts, layout, radius, shadow, space, type } from "./palette";
export type { Palette, ThemeId, TypeRole } from "./palette";

const KEY = "dandelist.theme";
const ThemeContext = createContext<{
  id: ThemeId;
  palette: Palette;
  set(id: ThemeId): void;
  /** The person's own theme, which a ThemeScope's preview leaves as it is: what the waiting music follows. */
  chosen: ThemeId;
}>({ id: DEFAULT_THEME, palette: THEMES[DEFAULT_THEME].palette, set: () => {}, chosen: DEFAULT_THEME });

/** Holds the chosen theme for the whole app and remembers it on this device. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => {
    void getSecret(KEY).then((v) => v && v in THEMES && setId(v as ThemeId));
  }, []);
  const set = useCallback((next: ThemeId) => {
    setId(next);
    void setSecret(KEY, next);
  }, []);
  const value = useMemo(() => ({ id, palette: THEMES[id].palette, set, chosen: id }), [id, set]);
  return createElement(ThemeContext.Provider, { value }, children);
}

/** Shows a subtree in another theme without changing the user's choice (the theme chooser's live preview). */
export function ThemeScope({ id, children }: { id: ThemeId; children: ReactNode }) {
  const outer = useContext(ThemeContext);
  const value = useMemo(() => ({ ...outer, id, palette: THEMES[id].palette }), [outer, id]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function usePalette(): Palette {
  return useContext(ThemeContext).palette;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** The type roles at this screen's width (its own page's in a spread): hero, display, title1 and title2 scale; the rest stay fixed. */
export function useType(): Record<TypeRole, TextStyle> {
  const { width } = usePageSize();
  // Whole-pixel steps, so resizing a browser window doesn't re-render every frame of the drag.
  const w = Math.round(width / 8) * 8;
  return useMemo(() => scaleType(w, Platform.OS === "web") as Record<TypeRole, TextStyle>, [w]);
}
