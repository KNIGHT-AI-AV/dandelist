import { useColorScheme } from "react-native";

/**
 * Design tokens. Screens read only these, so the look chosen on the review board swaps in here without
 * touching a screen. Values are the brief's ivory, ink and champagne until then.
 */
const light = {
  bg: "#F7F2E8",
  surface: "#FFFDF8",
  ink: "#15171C",
  muted: "#6B6457",
  line: "#E2D9C6",
  accent: "#A8823F",
  accentSoft: "#EFE3C8",
  danger: "#9B2C1F",
};

const dark: typeof light = {
  bg: "#0E0F11",
  surface: "#17181B",
  ink: "#F3EEE4",
  muted: "#A39D90",
  line: "#2C2E33",
  accent: "#D2B47C",
  accentSoft: "#2E2718",
  danger: "#F0A595",
};

export type Palette = typeof light;

export const type = {
  display: { fontSize: 34, lineHeight: 38, fontWeight: "500" as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  figure: { fontSize: 17, lineHeight: 22, fontVariant: ["tabular-nums" as const] },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18 };

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
