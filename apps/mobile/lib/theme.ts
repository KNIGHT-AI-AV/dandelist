import type { TextStyle } from "react-native";

/**
 * Design tokens. Screens read only these. The look (2026-10-27 UI round 1): a private bank at night. Photography
 * leads every wish, figures are set in Bodoni Moda, the interface is Inter Tight, small figures are DM Mono,
 * champagne is the only accent and panels are frosted glass with hairline borders.
 */
const cinema = {
  bg: "#0A0A0B",
  surface: "#141416",
  glass: "rgba(28, 28, 31, 0.58)",
  glassTint: "rgba(10, 10, 11, 0.35)",
  ink: "#F3EEE4",
  ink2: "rgba(243, 238, 228, 0.62)",
  ink3: "rgba(243, 238, 228, 0.38)",
  hair: "rgba(243, 238, 228, 0.12)",
  muted: "#9C978C",
  line: "#2E3035",
  accent: "#D2B47C",
  accentSoft: "rgba(210, 180, 124, 0.14)",
  ivory: "#EDE6D8",
  onAccent: "#0A0A0B",
  danger: "#F0A595",
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

export function usePalette(): Palette {
  return cinema;
}
