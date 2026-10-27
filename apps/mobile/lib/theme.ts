import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TextStyle } from "react-native";
import { getSecret, setSecret } from "./storage";

/**
 * Design tokens. Screens read only these. The look: a private bank at night, photography first, figures in Bodoni
 * Moda, the interface in Inter Tight, small figures in DM Mono, frosted glass with hairline borders.
 *
 * Six themes (owner, 2026-10-27). Emerald ships as the default: deep forest green with Rolex gold. Each theme is
 * one palette; photos fade into the theme's own background and text uses the theme's ink, so the light themes
 * (Ivory, Delina) read correctly without special cases.
 */

export type ThemeId = "emerald" | "bordeaux" | "noir" | "ivory" | "delina" | "sapphire";

interface Base {
  bg: string;
  /** `bg` as "r,g,b" for gradients that fade photos into the page. */
  bgRgb: string;
  surface: string;
  ink: string;
  /** `ink` as "r,g,b" for translucent tints. */
  inkRgb: string;
  accent: string;
  accent2: string;
  scheme: "dark" | "light";
  danger: string;
}

function palette(b: Base) {
  const dark = b.scheme === "dark";
  return {
    ...b,
    glass: dark ? `rgba(${b.bgRgb}, 0.58)` : "rgba(255, 255, 255, 0.55)",
    glassTint: dark ? `rgba(${b.bgRgb}, 0.35)` : "rgba(255, 255, 255, 0.4)",
    ink2: `rgba(${b.inkRgb}, 0.64)`,
    ink3: `rgba(${b.inkRgb}, 0.4)`,
    hair: `rgba(${b.inkRgb}, ${dark ? 0.13 : 0.16})`,
    track: `rgba(${b.inkRgb}, ${dark ? 0.14 : 0.12})`,
    muted: `rgba(${b.inkRgb}, 0.55)`,
    line: `rgba(${b.inkRgb}, 0.2)`,
    accentSoft: dark ? "rgba(203, 163, 92, 0.14)" : "rgba(168, 131, 60, 0.12)",
    ivory: "#EDE6D8",
    /** Text on an ink-filled button. */
    onAccent: b.bg,
  };
}

export const THEMES: Record<ThemeId, { name: string; mood: string; palette: ReturnType<typeof palette> }> = {
  emerald: {
    name: "Emerald",
    mood: "Deep forest green and Rolex gold.",
    palette: palette({ bg: "#03140D", bgRgb: "3, 20, 13", surface: "#0B2418", ink: "#F2EBDC", inkRgb: "242, 235, 220", accent: "#CBA35C", accent2: "#0E6B45", scheme: "dark", danger: "#F0A595" }),
  },
  bordeaux: {
    name: "Bordeaux",
    mood: "Burgundy, candlelight and gold.",
    palette: palette({ bg: "#14060A", bgRgb: "20, 6, 10", surface: "#261018", ink: "#F4E8E4", inkRgb: "244, 232, 228", accent: "#C9A15E", accent2: "#7B1E33", scheme: "dark", danger: "#F0A595" }),
  },
  noir: {
    name: "Noir",
    mood: "Night black and champagne.",
    palette: palette({ bg: "#0A0A0B", bgRgb: "10, 10, 11", surface: "#141416", ink: "#F3EEE4", inkRgb: "243, 238, 228", accent: "#D2B47C", accent2: "#3A3A3D", scheme: "dark", danger: "#F0A595" }),
  },
  ivory: {
    name: "Ivory",
    mood: "Linen white, ink and gold.",
    palette: palette({ bg: "#F5F0E6", bgRgb: "245, 240, 230", surface: "#FFFFFF", ink: "#17140F", inkRgb: "23, 20, 15", accent: "#A8833C", accent2: "#D9CDB5", scheme: "light", danger: "#B4402C" }),
  },
  delina: {
    name: "Delina",
    mood: "Perfume pink and gold.",
    palette: palette({ bg: "#F6E3E7", bgRgb: "246, 227, 231", surface: "#FFF6F7", ink: "#3B1E28", inkRgb: "59, 30, 40", accent: "#B48A4A", accent2: "#E7A3B5", scheme: "light", danger: "#B4402C" }),
  },
  sapphire: {
    name: "Sapphire",
    mood: "Midnight blue and platinum.",
    palette: palette({ bg: "#050A18", bgRgb: "5, 10, 24", surface: "#0D1530", ink: "#EDF0F7", inkRgb: "237, 240, 247", accent: "#C7D0E2", accent2: "#1C3F8F", scheme: "dark", danger: "#F0A595" }),
  },
};
export const THEME_ORDER: ThemeId[] = ["emerald", "bordeaux", "noir", "ivory", "delina", "sapphire"];
export const DEFAULT_THEME: ThemeId = "emerald";

export type Palette = ReturnType<typeof palette>;

export const fonts = {
  display: "BodoniModa_400Regular",
  displayItalic: "BodoniModa_400Regular_Italic",
  title: "BodoniModa_500Medium",
  body: "InterTight_400Regular",
  label: "InterTight_600SemiBold",
  figure: "DMMono_400Regular",
};

export const type: Record<"display" | "title" | "body" | "label" | "small" | "figure" | "eyebrow", TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 42, letterSpacing: -0.4 },
  title: { fontFamily: fonts.display, fontSize: 27, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.label, fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
  figure: { fontFamily: fonts.figure, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  // Small uppercase tracked labels: "THE LIFE YOU WANT", "VISIT · DREAM".
  eyebrow: { fontFamily: fonts.label, fontSize: 10.5, lineHeight: 14, letterSpacing: 1.7, textTransform: "uppercase" },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 12, md: 18, lg: 26, pill: 999 };

const KEY = "dandelist.theme";
const ThemeContext = createContext<{ id: ThemeId; palette: Palette; set(id: ThemeId): void }>({ id: DEFAULT_THEME, palette: THEMES[DEFAULT_THEME].palette, set: () => {} });

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
  const value = useMemo(() => ({ id, palette: THEMES[id].palette, set }), [id, set]);
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
