import type { TextStyle } from "react-native";

/**
 * Design tokens. Screens read only these. The look is locked from the review board (2026-10-26):
 * dark "cinema" by default, champagne as the only accent, Bodoni Moda headlines, Inter Tight for the
 * interface and DM Mono for every price. Ivory is kept for a later light mode.
 */
const cinema = {
  bg: "#0E0F11",
  surface: "#17181B",
  glass: "rgba(243, 238, 228, 0.06)",
  ink: "#F3EEE4",
  muted: "#9C978C",
  line: "#2E3035",
  accent: "#D2B47C",
  accentSoft: "rgba(210, 180, 124, 0.14)",
  onAccent: "#0E0F11",
  danger: "#F0A595",
};

export const ivory: Palette = {
  bg: "#F7F2E8",
  surface: "#FFFDF8",
  glass: "rgba(21, 23, 28, 0.04)",
  ink: "#15171C",
  muted: "#6B6457",
  line: "#E2D9C6",
  accent: "#A8823F",
  accentSoft: "rgba(168, 130, 63, 0.14)",
  onAccent: "#F7F2E8",
  danger: "#9B2C1F",
};

export type Palette = typeof cinema;

export const fonts = {
  display: "BodoniModa_400Regular",
  displayItalic: "BodoniModa_400Regular_Italic",
  title: "BodoniModa_500Medium",
  body: "InterTight_400Regular",
  label: "InterTight_600SemiBold",
  figure: "DMMono_400Regular",
};

export const type: Record<"display" | "title" | "body" | "label" | "small" | "figure", TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 38, lineHeight: 42, letterSpacing: -0.4 },
  title: { fontFamily: fonts.title, fontSize: 24, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.label, fontSize: 13, lineHeight: 18, letterSpacing: 0.3 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  figure: { fontFamily: fonts.figure, fontSize: 16, lineHeight: 22, fontVariant: ["tabular-nums"] },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 20 };

/** The cinema palette everywhere for now; the ivory light mode becomes a setting later. */
export function usePalette(): Palette {
  return cinema;
}
