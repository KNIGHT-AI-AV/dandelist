import { Asset } from "expo-asset";
import { BlurView } from "expo-blur";
import { Image, type ImageContentPosition } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image as RNImage, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { useMoney } from "../lib/currency";
import { ease, haptic, native, usePress, useReducedMotion } from "../lib/motion";
import { layout, radius, type, usePalette, useTheme, useType, type ThemeId } from "../lib/theme";
import { Odometer, type OdometerProps } from "./odometer";

/** The luxury kit: photographs, glass, Bodoni figures and the agent's champagne dot. Screens compose these. */

const grain = require("../assets/grain.png");

/** Uppercase tracked label. At most one per region. */
export function Eyebrow({ children, style, color }: { children: ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  const p = usePalette();
  return <Text style={[type.eyebrow, { color: color ?? p.ink2 }, style]}>{children}</Text>;
}

/** The agent's mark: a small glowing champagne dot. While the agent works it breathes (0.35 to 1 over 1.2 s). */
export function AgentDot({ size = 6, busy = false }: { size?: number; busy?: boolean }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy || reduced) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 600, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: 600, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reduced, v]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.accent, opacity: v, boxShadow: `0 0 6px ${p.accent}` }} />;
}

type MoneySize = "hero" | "title" | "card" | "ledger" | "ledger15";

/**
 * One money system (UI audit P1-12). Hero: Bodoni Display, tabular, the `$` at half size in ink2 with its top on
 * the digits, rolling as an odometer. Title: the statement's headline figure. Card: Bodoni Title, tabular, 22/24,
 * full-size `$`. Ledger: DM Mono 13/18 or 15/20. DM Mono never goes above 20 px.
 */
export function Money({ cents, size = "card", color, style, format: given, align, ...roll }: { cents: number; size?: MoneySize; color?: string; style?: StyleProp<TextStyle>; format?: (c: number) => string; align?: "left" | "right" } & Pick<OdometerProps, "mode" | "rollOnMount" | "onLand" | "pulse" | "announce" | "live">) {
  const p = usePalette();
  const t = useType();
  // Every figure follows the chosen currency unless a screen passes its own format.
  const money = useMoney();
  const format = given ?? money.format;
  if (size === "hero") {
    const s = t.hero.fontSize ?? 56;
    return <Odometer cents={cents} format={format} size={s} family="bodoni" smallPrefix tracking={-0.02 * s} color={color} align={align} style={style as StyleProp<ViewStyle>} {...roll} />;
  }
  const role = size === "title" ? { ...t.title1, fontVariant: ["tabular-nums", "lining-nums"] as TextStyle["fontVariant"], letterSpacing: 0 } : size === "card" ? type.cardPrice : size === "ledger15" ? type.figure15 : type.figure13;
  return <Text style={[role, { color: color ?? p.ink, textAlign: align }, style]}>{format(cents)}</Text>;
}

/** Frosted glass panel with a hairline border. Kept for floating controls: pills, sheets, back and close buttons. */
export function Glass({ children, style, intensity = 40, tint }: { children?: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number; tint?: string }) {
  const p = usePalette();
  return (
    // zIndex 0 makes the panel its own stack, so the blur (at -1) always sits behind the content, including on web,
    // where absolutely positioned layers otherwise paint over inputs and text.
    <View style={[{ borderRadius: radius.md, borderCurve: "continuous", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair, zIndex: 0 }, style]}>
      <BlurView intensity={intensity} tint={p.scheme} style={[StyleSheet.absoluteFill, { zIndex: -1 }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? p.glassTint, zIndex: -1 }]} />
      {children}
    </View>
  );
}

/**
 * Darkens a photograph toward the bottom so type sits on it (UI audit P1-22): the photo floor dissolves into the
 * page instead of ending on a hard edge. `title` is the title sequence's deeper fade.
 */
export function Shade({ from, style, look = "photo" }: { from?: number; style?: StyleProp<ViewStyle>; look?: "photo" | "title" }) {
  const p = usePalette();
  // The title fade reaches the page colour exactly at its bottom edge, so a framed hero has no seam.
  const stops = look === "title" ? { a: [0, 0.55, 0.96, 1], at: [0.25, 0.6, 0.9, 1] } : { a: [0, 0.6, 0.94, 0.94], at: [from ?? 0.3, 0.62, 0.9, 1] };
  return (
    <LinearGradient
      pointerEvents="none"
      colors={stops.a.map((a) => `rgba(${p.bgRgb}, ${a})`) as [string, string, string, string]}
      locations={[Math.min(stops.at[0]!, 0.55), stops.at[1]!, stops.at[2]!, stops.at[3]!] as [number, number, number, number]}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

/**
 * The fade under floating controls (UI audit P0-7, HIG scroll-edge effect): content scrolling beneath a CTA or the
 * composer dissolves into the page instead of showing through.
 */
export function EdgeFade({ height }: { height: number }) {
  const p = usePalette();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[`rgba(${p.bgRgb}, 0)`, `rgba(${p.bgRgb}, 0.88)`, `rgba(${p.bgRgb}, 1)`]}
      locations={[0, 0.55, 1]}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}
    />
  );
}

/**
 * Text protection over a photograph (UI audit P1-22, HIG's dimming layer): a soft 35% wash behind a title block
 * that rises from nothing, so the type reads without a visible box.
 */
export function Protect() {
  const p = usePalette();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[`rgba(${p.bgRgb}, 0)`, `rgba(${p.bgRgb}, 0.35)`, `rgba(${p.bgRgb}, 0.35)`]}
      locations={[0, 0.45, 1]}
      style={{ position: "absolute", left: -400, right: -400, top: -56, bottom: -16 }}
    />
  );
}

const GRAIN_URI =Platform.OS === "web" ? Asset.fromModule(grain).uri : "";

/** Fine film grain over a screen; purely visual. The web tiles it with CSS. */
export function Grain() {
  if (Platform.OS === "web") {
    return <View pointerEvents="none" aria-hidden style={[StyleSheet.absoluteFill, { backgroundImage: `url(${GRAIN_URI})`, backgroundRepeat: "repeat", opacity: 0.35, mixBlendMode: "overlay" } as object]} />;
  }
  return <GrainTiles />;
}

const TILE = 256;

/**
 * Phones lay the grain tile out by hand. `resizeMode="repeat"` drew it once in the top-left corner on iOS (owner,
 * 2026-10-27: "a weird cutout block on the top left corner of the background").
 */
function GrainTiles() {
  const { width, height } = useWindowDimensions();
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.4, overflow: "hidden" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rows * cols }, (_, i) => (
        <RNImage key={i} source={grain} fadeDuration={0} style={{ position: "absolute", left: (i % cols) * TILE, top: Math.floor(i / cols) * TILE, width: TILE, height: TILE }} />
      ))}
    </View>
  );
}

/** A wish photograph, or a quiet gradient when the agent found none. */
export function Photo({ uri, style, contentPosition }: { uri?: string | null; kind?: string; style?: StyleProp<ViewStyle>; contentPosition?: ImageContentPosition }) {
  const p = usePalette();
  const [failed, setFailed] = useState(false);
  return (
    // Photographs never take the pointer: on the web a drag over an <img> starts the browser's own image drag, which
    // cancels whatever swipe was under way (a card removal, a page turn). Presses go to the parent control.
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient colors={[p.surface, p.bg]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      {uri && !failed ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={contentPosition ?? "center"} transition={{ duration: 300, effect: "cross-dissolve" }} onError={() => setFailed(true)} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}

/** Drawn icons (no text glyphs): 1.5 px strokes, 17 px. */
export function Icon({ name, color, size = 17 }: { name: "back" | "close" | "plus" | "check" | "palette"; color?: string; size?: number }) {
  const p = usePalette();
  const c = color ?? p.ink;
  const s = size;
  const bar = (len: number, rot: string, extra: ViewStyle = {}) => <View style={[{ position: "absolute", width: len, height: 1.5, borderRadius: 1, backgroundColor: c, transform: [{ rotate: rot }] }, extra]} />;
  // A ring or a filled dot of diameter d with its centre at (x, y), as fractions of the box.
  const ring = (d: number, x: number, y: number) => <View style={{ position: "absolute", width: d * s, height: d * s, borderRadius: (d * s) / 2, borderWidth: 1.5, borderColor: c, left: x * s - (d * s) / 2, top: y * s - (d * s) / 2 }} />;
  const dot = (d: number, x: number, y: number) => <View style={{ position: "absolute", width: d * s, height: d * s, borderRadius: (d * s) / 2, backgroundColor: c, left: x * s - (d * s) / 2, top: y * s - (d * s) / 2 }} />;
  return (
    <View style={{ width: s, height: s, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "palette" ? (
        // A painter's palette in the same strokes: the round board, its thumb hole and three wells of paint.
        <>
          {ring(1, 0.5, 0.5)}
          {ring(0.26, 0.66, 0.66)}
          {dot(0.14, 0.3, 0.42)}
          {dot(0.14, 0.42, 0.26)}
          {dot(0.14, 0.62, 0.3)}
        </>
      ) : name === "back" ? (
        // Each stroke's midpoint on the box's centre line, so the chevron sits centred in its circle.
        <>
          {bar(s * 0.5, "-45deg", { top: s * 0.33, left: s * 0.25 })}
          {bar(s * 0.5, "45deg", { top: s * 0.62, left: s * 0.25 })}
        </>
      ) : name === "close" ? (
        <>
          {bar(s * 0.8, "45deg")}
          {bar(s * 0.8, "-45deg")}
        </>
      ) : name === "plus" ? (
        <>
          {bar(s * 0.8, "0deg")}
          {bar(s * 0.8, "90deg")}
        </>
      ) : (
        <>
          {bar(s * 0.32, "45deg", { left: s * 0.14, top: s * 0.58 })}
          {bar(s * 0.62, "-50deg", { left: s * 0.3, top: s * 0.45 })}
        </>
      )}
    </View>
  );
}

/** A 44 pt glass circle holding one icon: back, close. */
export function IconButton({ icon, label, onPress, style }: { icon: "back" | "close"; label: string; onPress(): void; style?: StyleProp<ViewStyle> }) {
  const press = usePress(0.94);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={style}>
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Glass style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} />
        </Glass>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The one primary button (UI audit P1-14): 56 tall, the control radius, full width up to 400, centred. Disabled is a quiet
 * outline whose fill fades in when it becomes available; busy crossfades the label (to `busyLabel` when given) at
 * a fixed width. `commit` adds the soft haptic for actions that keep something.
 */
export function PrimaryButton({ label, busyLabel, onPress, busy = false, disabled = false, commit = false, style }: { label: string; busyLabel?: string; onPress(): void; busy?: boolean; disabled?: boolean; commit?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const press = usePress(0.97);
  const fill = useRef(new Animated.Value(disabled ? 0 : 1)).current;
  const swap = useRef(new Animated.Value(busy ? 1 : 0)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: disabled ? 0 : 1, duration: reduced ? 0 : 200, easing: ease.effects, useNativeDriver: false }).start();
  }, [disabled, fill, reduced]);
  useEffect(() => {
    Animated.timing(swap, { toValue: busy ? 1 : 0, duration: 150, easing: ease.out, useNativeDriver: false }).start();
    if (!busy || busyLabel || reduced) return breathe.setValue(1);
    const loop = Animated.loop(Animated.sequence([Animated.timing(breathe, { toValue: 0.5, duration: 600, easing: ease.inOut, useNativeDriver: false }), Animated.timing(breathe, { toValue: 1, duration: 600, easing: ease.inOut, useNativeDriver: false })]));
    loop.start();
    return () => loop.stop();
  }, [busy, busyLabel, reduced, swap, breathe]);
  const inactive = disabled || busy;
  const labelColor = fill.interpolate({ inputRange: [0, 1], outputRange: [`rgba(${p.inkRgb}, 0.5)`, p.onAccent] });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy && busyLabel ? busyLabel : label}
      accessibilityState={{ disabled: inactive, busy }}
      onPress={inactive ? undefined : () => {
        if (commit) haptic.soft();
        onPress();
      }}
      onPressIn={inactive ? undefined : press.onPressIn}
      onPressOut={press.onPressOut}
      style={[{ width: "100%", maxWidth: 400, alignSelf: "center" }, style]}
    >
      {/* The press scale runs on the native driver and the colours in JS, so they live on separate views. */}
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Animated.View
          style={{
            minHeight: layout.control.primary,
            borderRadius: radius.control,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: fill.interpolate({ inputRange: [0, 1], outputRange: [`rgba(${p.inkRgb}, 0.28)`, p.ink] }),
            backgroundColor: fill.interpolate({ inputRange: [0, 1], outputRange: [`rgba(${p.inkRgb}, 0)`, p.ink] }),
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Animated.Text style={[type.button, { color: labelColor, opacity: busyLabel ? swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) : breathe }]} numberOfLines={1}>
            {label}
          </Animated.Text>
          {busyLabel ? (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", opacity: swap }]}>
              <Animated.Text style={[type.button, { color: labelColor }]} numberOfLines={1}>
                {busyLabel}
              </Animated.Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** Quiet text action with a 44 pt target. */
export function QuietButton({ label, onPress, style, color }: { label: string; onPress(): void; style?: StyleProp<ViewStyle>; color?: string }) {
  const p = usePalette();
  const press = usePress(0.97);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={6} style={style}>
      <Animated.View style={{ minHeight: 44, alignItems: "center", justifyContent: "center", transform: [{ scale: press.scale }] }}>
        <Text style={[type.label, { color: color ?? p.ink2 }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The one choice button (readability pass, 2026-10-27, replacing thin outline pills the owner called janky): 50 tall,
 * a filled tonal surface with a faint hairline, continuous corners, Inter 600 15; ink-filled when selected. Parents
 * give it `flex: 1` to set choices in equal columns.
 */
export function Chip({ label, selected = false, onPress, style }: { label: string; selected?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const press = usePress(0.97);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !onPress }}
      onPress={onPress ? () => {
        haptic.select();
        onPress();
      } : undefined}
      onPressIn={onPress ? press.onPressIn : undefined}
      onPressOut={press.onPressOut}
      style={style}
    >
      <Animated.View
        style={{
          minHeight: layout.control.chip,
          paddingHorizontal: layout.stack.base,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.control,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: selected ? p.ink : `rgba(${p.inkRgb}, ${p.scheme === "dark" ? 0.16 : 0.2})`,
          backgroundColor: selected ? p.ink : `rgba(${p.inkRgb}, ${p.scheme === "dark" ? 0.07 : 0.05})`,
          transform: [{ scale: press.scale }],
        }}
      >
        <Text style={[type.label, { color: selected ? p.onAccent : p.ink }]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** One line of a price statement: label with an optional hint, figure on the right; tabular so decimals align. */
export function StatementRow({ label, hint, cents, big = false }: { label: string; hint?: string; cents: number; big?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <View style={{ flexShrink: 1 }}>
        {big ? <Eyebrow>{label}</Eyebrow> : <Text style={[type.callout, { color: p.ink }]}>{label}</Text>}
        {hint ? <Text style={[type.footnote, { color: p.ink3, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <Money cents={cents} size={big ? "title" : "card"} align="right" />
    </View>
  );
}

/** Text input on glass, with its label above. */
export function GlassField({ label, style, inputStyle, ...props }: TextInputProps & { label: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: layout.stack.tight }, style]}>
      <Eyebrow>{label}</Eyebrow>
      <Glass style={{ borderRadius: radius.control, borderWidth: 1, borderColor: focused ? p.ink2 : p.line }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={p.ink3}
          style={[type.body, { minHeight: layout.control.field, paddingHorizontal: layout.stack.base, color: p.ink }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null, inputStyle]}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
        />
      </Glass>
    </View>
  );
}

/** A bundled photograph that fills its parent. */
export function Backdrop({ source, blur = 0, dim = 0 }: { source: number; blur?: number; dim?: number }) {
  const p = usePalette();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={blur} accessibilityIgnoresInvertColors />
      {dim ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, ${dim})` }]} /> : null}
    </View>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  const p = usePalette();
  if (!children) return null;
  return <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.danger }]}>{children}</Text>;
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: p.hair }, style]} />;
}

/**
 * The logo, Wish Dot (owner, 2026-10-27): Instrument Serif with a solid gold dot for the i. Drawn per
 * theme as two layers on one canvas, the word in the theme's ink and the dot in its accent, so the title sequence
 * can set the word and then land the dot. Source: Desktop\Dandelist Design\logo-final\_build\wordmark2.py.
 */
const WORDMARK: Partial<Record<ThemeId, readonly [number, number]>> = {
  emerald: [require("../assets/brand/wordmark-emerald-letters.png"), require("../assets/brand/wordmark-emerald-dot.png")],
  bordeaux: [require("../assets/brand/wordmark-bordeaux-letters.png"), require("../assets/brand/wordmark-bordeaux-dot.png")],
  noir: [require("../assets/brand/wordmark-noir-letters.png"), require("../assets/brand/wordmark-noir-dot.png")],
  ivory: [require("../assets/brand/wordmark-ivory-letters.png"), require("../assets/brand/wordmark-ivory-dot.png")],
  delina: [require("../assets/brand/wordmark-delina-letters.png"), require("../assets/brand/wordmark-delina-dot.png")],
  sapphire: [require("../assets/brand/wordmark-sapphire-letters.png"), require("../assets/brand/wordmark-sapphire-dot.png")],
};
/** Width over height of the wordmark canvas, from the dot's top to the baseline. */
export const WORDMARK_ASPECT = 4.095;

type AnimatedViewStyle = Animated.WithAnimatedValue<StyleProp<ViewStyle>>;

/** The wordmark at `height` (24 in headers). `word` and `dot` animate the two layers. */
export function Wordmark({ height = 24, word, dot, style }: { height?: number; word?: AnimatedViewStyle; dot?: AnimatedViewStyle; style?: StyleProp<ViewStyle> }) {
  const { id } = useTheme();
  // Themes added after the logo pass (Cognac, Amethyst, Riviera) tint the emerald artwork to their ink and accent.
  const art = WORDMARK[id];
  const [letters, clock] = art ?? WORDMARK.emerald!;
  const p = usePalette();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Dandelist" style={[{ width: Math.round(height * WORDMARK_ASPECT), height }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, word]}>
        {/* Decorative inside the labelled wordmark, so a screen reader hears "Dandelist" once. expo-image's web build
            writes the img's alt from accessibilityLabel only (its `alt` prop reaches the placeholder alone). */}
        <Image source={letters} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="contain" tintColor={art ? undefined : p.ink} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, dot]}>
        <Image source={clock} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="contain" tintColor={art ? undefined : p.accent} />
      </Animated.View>
    </View>
  );
}

/** A soft breathing placeholder while something loads; static under reduced motion (UI audit P2-26). */
export function Breathing({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: native }), Animated.timing(v, { toValue: 0.6, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: native })]));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return <Animated.View style={[{ backgroundColor: p.surface, borderRadius: radius.lg, borderCurve: "continuous", opacity: v }, style]} />;
}
