/**
 * Design tokens with no React in them, so tests can check them: the six palettes, the type roles and the layout
 * grid. `lib/theme.ts` adds the provider and hooks. The look: a private bank at night, photography first, figures
 * in Bodoni Moda, the interface in Inter, small figures in DM Mono, frosted glass with hairline borders.
 *
 * Six themes (owner, 2026-10-27). Emerald ships as the default: deep forest green with Rolex gold. Each theme is
 * one palette; photos fade into the theme's own background and text uses the theme's ink, so the light themes
 * (Ivory, Delina) read correctly without special cases.
 *
 * Contrast (UI audit 2026-10-27, P0-6): every text token clears 4.5:1 on its background and `line` clears 3:1, in
 * every theme; `palette.test.ts` checks it. `accent` stays the theme's hue for fills and rules; text in the accent
 * colour uses `accentText`, which is darkened on the light themes and shifted on Sapphire so italics still stand
 * apart from the ink.
 */

export type ThemeId = "emerald" | "bordeaux" | "noir" | "ivory" | "delina" | "sapphire" | "cognac" | "amethyst" | "riviera";

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
  /** The accent as text, when the accent itself is too faint on this background. */
  accentText?: string;
  /** Alpha of secondary text (default 0.76). */
  ink2?: number;
  /** Alpha of tertiary text (default 0.62 dark, 0.68 light). */
  ink3?: number;
  /** Alpha of field and chip borders (default 0.37 dark, 0.47 light). */
  line?: number;
}

function palette(b: Base) {
  const dark = b.scheme === "dark";
  const accentText = b.accentText ?? b.accent;
  return {
    ...b,
    accentText,
    glass: dark ? `rgba(${b.bgRgb}, 0.58)` : "rgba(255, 255, 255, 0.55)",
    glassTint: dark ? `rgba(${b.bgRgb}, 0.35)` : "rgba(255, 255, 255, 0.4)",
    /** The thick material for text-heavy floating layers such as the save sheet (HIG Materials). */
    sheet: dark ? `rgba(${b.bgRgb}, 0.86)` : "rgba(255, 255, 255, 0.88)",
    ink2: `rgba(${b.inkRgb}, ${b.ink2 ?? 0.76})`,
    ink3: `rgba(${b.inkRgb}, ${b.ink3 ?? (dark ? 0.62 : 0.68)})`,
    /** Non-text only: dividers, ticks, idle marks. */
    ink4: `rgba(${b.inkRgb}, 0.4)`,
    hair: `rgba(${b.inkRgb}, ${dark ? 0.13 : 0.16})`,
    track: `rgba(${b.inkRgb}, ${dark ? 0.14 : 0.12})`,
    /** Borders of fields, chips and ghost buttons: 3:1 against the background. */
    line: `rgba(${b.inkRgb}, ${b.line ?? (dark ? 0.37 : 0.47)})`,
    /** The champagne light that crosses the reveal figure. */
    shine: dark ? "#F6E7C1" : accentText,
    ivory: "#EDE6D8",
    /** Marks drawn over photographs (progress bars, counters): always light, whatever the theme. */
    onPhoto: "#EDE6D8",
    onPhotoTrack: "rgba(237, 230, 216, 0.28)",
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
    palette: palette({ bg: "#14060A", bgRgb: "20, 6, 10", surface: "#261018", ink: "#F4E8E4", inkRgb: "244, 232, 228", accent: "#C9A15E", accent2: "#7B1E33", scheme: "dark", danger: "#F0A595", line: 0.38 }),
  },
  noir: {
    name: "Noir",
    mood: "Night black and champagne.",
    palette: palette({ bg: "#0A0A0B", bgRgb: "10, 10, 11", surface: "#141416", ink: "#F3EEE4", inkRgb: "243, 238, 228", accent: "#D2B47C", accent2: "#3A3A3D", scheme: "dark", danger: "#F0A595" }),
  },
  ivory: {
    name: "Ivory",
    mood: "Linen white, ink and gold.",
    palette: palette({ bg: "#F5F0E6", bgRgb: "245, 240, 230", surface: "#FFFFFF", ink: "#17140F", inkRgb: "23, 20, 15", accent: "#A8833C", accentText: "#866930", accent2: "#D9CDB5", scheme: "light", danger: "#B4402C" }),
  },
  delina: {
    name: "Delina",
    mood: "Perfume pink and gold.",
    palette: palette({ bg: "#F6E3E7", bgRgb: "246, 227, 231", surface: "#FFF6F7", ink: "#3B1E28", inkRgb: "59, 30, 40", accent: "#B48A4A", accentText: "#826335", accent2: "#E7A3B5", scheme: "light", danger: "#B4402C", ink2: 0.8, ink3: 0.72, line: 0.52 }),
  },
  sapphire: {
    name: "Sapphire",
    mood: "Midnight blue and platinum.",
    palette: palette({ bg: "#050A18", bgRgb: "5, 10, 24", surface: "#0D1530", ink: "#EDF0F7", inkRgb: "237, 240, 247", accent: "#C7D0E2", accentText: "#8FA9E6", accent2: "#1C3F8F", scheme: "dark", danger: "#F0A595" }),
  },
  // Three more looks (owner, 2026-10-28: "two or three more themes... whichever colours flesh us out"): a warm
  // dark, a jewel dark and a cool light, so every temperature has a house.
  cognac: {
    name: "Cognac",
    mood: "Saddle leather, brass and firelight.",
    palette: palette({ bg: "#160C06", bgRgb: "22, 12, 6", surface: "#24150C", ink: "#F3E7D6", inkRgb: "243, 231, 214", accent: "#C8924A", accent2: "#7A3E1D", scheme: "dark", danger: "#F0A595" }),
  },
  amethyst: {
    name: "Amethyst",
    mood: "Plum velvet and rose gold.",
    palette: palette({ bg: "#120A17", bgRgb: "18, 10, 23", surface: "#1F1428", ink: "#F1E8F2", inkRgb: "241, 232, 242", accent: "#D7A08C", accent2: "#5E3A6E", scheme: "dark", danger: "#F0A595" }),
  },
  riviera: {
    name: "Riviera",
    mood: "Sea glass, salt air and sun-bleached gold.",
    palette: palette({ bg: "#EAF2F3", bgRgb: "234, 242, 243", surface: "#FFFFFF", ink: "#0D2B33", inkRgb: "13, 43, 51", accent: "#B98A3E", accentText: "#7E5C22", accent2: "#7FB7BE", scheme: "light", danger: "#B4402C", line: 0.56 }),
  },
};
export const THEME_ORDER: ThemeId[] = ["emerald", "bordeaux", "noir", "ivory", "delina", "sapphire", "cognac", "amethyst", "riviera"];
export const DEFAULT_THEME: ThemeId = "emerald";

export type Palette = ReturnType<typeof palette>;

/** WCAG 2 contrast of `fg` (hex or rgba) composited over the opaque `bg` hex. */
export function contrast(fg: string, bg: string): number {
  const parse = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a = "1"] = m[1]!.split(",").map((s) => s.trim());
      return [Number(r), Number(g), Number(b), Number(a)];
    }
    const h = c.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  };
  const [br, bgG, bb] = parse(bg);
  const [r, g, b, a] = parse(fg);
  const mix = (f: number, k: number) => f * a + k * (1 - a);
  const lum = (rr: number, gg: number, bl: number) => {
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(rr) + 0.7152 * ch(gg) + 0.0722 * ch(bl);
  };
  const l1 = lum(mix(r, br), mix(g, bgG), mix(b, bb));
  const l2 = lum(br, bgG, bb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Font families as registered in app/_layout.tsx. Readability pass (owner, 2026-10-27: Bodoni was "dainty... hard to
 * read"): Instrument Serif, the logo's face, sets every serif role. It is sturdier than Bodoni's hairlines and has a
 * taller x-height, so headlines and prices read at phone size. Inter sets all UI text; small text is never serif.
 */
export const fonts = {
  display: "InstrumentSerif_400Regular",
  displayItalic: "InstrumentSerif_400Regular_Italic",
  title: "InstrumentSerif_400Regular",
  titleItalic: "InstrumentSerif_400Regular_Italic",
  text: "InstrumentSerif_400Regular",
  textItalic: "InstrumentSerif_400Regular_Italic",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  label: "Inter_600SemiBold",
  sansDisplay: "InterTight_400Regular",
  figure: "DMMono_400Regular",
};

/** The serif for a size (one cut now; kept as a function so callers don't care). */
export function serif(_size: number, italic = false): string {
  return italic ? fonts.displayItalic : fonts.display;
}

/** Text style shape without importing react-native (kept structural so tests can load this file). */
export interface Role {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: "uppercase";
  fontVariant?: ("tabular-nums" | "lining-nums")[];
}

const tab: Role["fontVariant"] = ["tabular-nums", "lining-nums"];

/**
 * Eleven type roles (UI audit §3.2) replace the 36 sizes the screens used to set by hand. Sizes are for a 390 pt
 * phone; `scaleType` grows `hero`, `display`, `title1` and `title2` with the window. No role goes under 11 px.
 */
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 60, lineHeight: 60, letterSpacing: -0.6, fontVariant: tab },
  display: { fontFamily: fonts.display, fontSize: 46, lineHeight: 48, letterSpacing: -0.4 },
  title1: { fontFamily: fonts.display, fontSize: 38, lineHeight: 40, letterSpacing: -0.2 },
  title2: { fontFamily: fonts.title, fontSize: 30, lineHeight: 32 },
  title3: { fontFamily: fonts.title, fontSize: 23, lineHeight: 28 },
  headline: { fontFamily: fonts.label, fontSize: 17, lineHeight: 22 },
  button: { fontFamily: fonts.label, fontSize: 16, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  /** Callout weight for chips and quiet actions. */
  label: { fontFamily: fonts.label, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
  eyebrow: { fontFamily: fonts.label, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: "uppercase" },
  /** Source lines and small figures: Inter Medium, tabular, so they read at a glance (mono read as code). */
  figure: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.1, fontVariant: tab },
  // Ledger amounts and list numbers, the same Inter Medium tabular: Taste Engine flagged the mono on all five
  // signed-in pages (2026-10-29), against the brand's own price style.
  figure13: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.1, fontVariant: tab },
  figure15: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, fontVariant: tab },
  /** Card prices: the serif with tabular figures. */
  cardPrice: { fontFamily: fonts.title, fontSize: 26, lineHeight: 28, fontVariant: tab },
  /** The title-sequence wordmark, the one brand exception to the scale. */
  wordmark: { fontFamily: fonts.display, fontSize: 54, lineHeight: 60 },
  /** The title sequence's two-line "Yours by / Month Year". */
  dateline: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46 },
  /** The header wordmark beside the avatar or the account link. */
  brand: { fontFamily: fonts.title, fontSize: 21, lineHeight: 26 },
} satisfies Record<string, Role>;

export type TypeRole = keyof typeof type;

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Fluid sizes for the big roles. Phones scale by k = clamp(width / 390, 0.92, 1.2); the web follows the audit's
 * CSS clamp() formulas, worked out here from the window width so line heights scale with them.
 */
export function scaleType(width: number, web: boolean): typeof type {
  const k = clamp(0.92, width / 390, 1.2);
  const vw = width / 100;
  const size = (role: "hero" | "display" | "title1" | "title2", min: number, a: number, b: number, max: number) =>
    web ? clamp(min, a * vw + b, max) : role === "title2" ? min : min * k;
  const fit = (r: Role, s: number): Role => ({ ...r, fontSize: Math.round(s), lineHeight: Math.round((s * r.lineHeight) / r.fontSize), letterSpacing: r.letterSpacing === undefined ? undefined : +((r.letterSpacing * s) / r.fontSize).toFixed(2) });
  return {
    ...type,
    hero: fit(type.hero, size("hero", 60, 3.2, 48, 84)),
    display: fit(type.display, size("display", 46, 2.4, 37, 66)),
    title1: fit(type.title1, size("title1", 38, 1.6, 32, 52)),
    title2: fit(type.title2, size("title2", 30, 0.8, 27, 36)),
  } as typeof type;
}

/** Spacing on a 4 pt base with an 8 pt rhythm (UI audit §3.1). */
export const space = { 0: 0, 2: 2, 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64, 80: 80 } as const;

/** Control heights: chips, fields, the primary button, the Life meter, and round icon buttons (all at least 44). */
const CONTROL = { chip: 50, field: 52, primary: 56, meter: 52, icon: 44 } as const;
/** Vertical rhythm: eyebrow to title is tight, title to body is base, header to content is section. */
const STACK = { tight: 8, base: 16, section: 32, sectionLg: 48 } as const;
const DOCK_GAP = 20;

export const layout = {
  /** One side gutter for every screen. */
  gutter: (w: number) => (w < 400 ? 20 : w < 744 ? 24 : 32),
  /** Welcome steps and the sheet. */
  column: 560,
  /** Life list, plan and detail text. */
  list: 520,
  /** Header bar height, from the top inset. */
  headerBar: 44,
  /** Progress segments, from the top inset: 2 px tall, 4 apart. */
  segmentsTop: 50,
  /** Where step content starts, from the top inset (32 below the segments). */
  contentTop: 84,
  control: CONTROL,
  /** From the bottom inset to a docked button or pill. */
  dockGap: DOCK_GAP,
  /** Height of a floating CTA plus the fade beneath it. */
  dockHeight: (bottomInset: number) => bottomInset + CONTROL.primary + DOCK_GAP + STACK.sectionLg,
  stack: STACK,
  cardPad: 20,
};

/** Nested radii: inner = outer − padding, never below 6. */
/** `control` is the one corner for every button, chip and field. */
export const radius = { xs: 6, sm: 12, control: 16, md: 18, lg: 26, sheet: 28, pill: 999 } as const;

/** Two-layer shadows (RN New Architecture `boxShadow`, which the web build passes straight to CSS). */
export const shadow = {
  card: "0 1px 1px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.25)",
  lift: "0 1px 2px rgba(0,0,0,0.40), 0 14px 28px rgba(0,0,0,0.45)",
  print: "0 1px 1px rgba(0,0,0,0.35), 0 14px 28px rgba(0,0,0,0.45)",
  thumb: "0 1px 2px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.35)",
};
