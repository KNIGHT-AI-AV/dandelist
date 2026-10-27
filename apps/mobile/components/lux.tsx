import { BlurView } from "expo-blur";
import { Image, type ImageContentPosition } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { ActivityIndicator, Image as RNImage, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { fonts, radius, space, type, usePalette } from "../lib/theme";

/** The luxury kit: photographs, glass, Bodoni figures and the agent's champagne dot. Screens compose these. */

const grain = require("../assets/grain.png");

/** Uppercase tracked label. */
export function Eyebrow({ children, style, color }: { children: ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  const p = usePalette();
  return <Text style={[type.eyebrow, { color: color ?? p.ink2 }, style]}>{children}</Text>;
}

/** The agent's mark: a small glowing champagne dot. */
export function AgentDot({ size = 6 }: { size?: number }) {
  const p = usePalette();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.accent, shadowColor: p.accent, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />;
}

/** A money figure in Bodoni. `cents` is formatted by the caller so every figure comes from the cost engine. */
export function Figure({ value, size = 22, style, dollarSmall = false }: { value: string; size?: number; style?: StyleProp<TextStyle>; dollarSmall?: boolean }) {
  const p = usePalette();
  const base: TextStyle = { fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.08, color: p.ink, letterSpacing: -0.2, fontVariant: ["lining-nums"] };
  if (dollarSmall && value.startsWith("$")) {
    return (
      <Text style={[base, style]}>
        <Text style={{ fontSize: size * 0.45, color: p.ink2 }}>$</Text>
        {value.slice(1)}
      </Text>
    );
  }
  return <Text style={[base, style]}>{value}</Text>;
}

/** Frosted glass panel with a hairline border. */
export function Glass({ children, style, intensity = 40 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number }) {
  const p = usePalette();
  return (
    // zIndex 0 makes the panel its own stack, so the blur (at -1) always sits behind the content, including on web,
    // where absolutely positioned layers otherwise paint over inputs and text.
    <View style={[{ borderRadius: radius.md, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair, zIndex: 0 }, style]}>
      <BlurView intensity={intensity} tint="dark" style={[StyleSheet.absoluteFill, { zIndex: -1 }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.glassTint, zIndex: -1 }]} />
      {children}
    </View>
  );
}

/** Darkens a photograph toward the bottom so type sits on it. */
export function Shade({ from = 0.3, style }: { from?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(10,10,11,0)", "rgba(10,10,11,0.55)", "rgba(10,10,11,0.96)"]}
      locations={[from, 0.7, 1]}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

/** Fine film grain over a screen; purely visual. */
export function Grain() {
  // Web can't tile the texture cleanly, so the grain is a phone-only finish.
  if (Platform.OS === "web") return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <RNImage source={grain} resizeMode="repeat" style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} />
    </View>
  );
}

const KIND_ART: Record<string, [string, string]> = {
  buy: ["#2A2520", "#0A0A0B"],
  own: ["#1F2329", "#0A0A0B"],
  do: ["#26221B", "#0A0A0B"],
  visit: ["#1E2622", "#0A0A0B"],
};

/** A wish photograph, or a quiet gradient when the agent found none. */
export function Photo({ uri, kind = "buy", style, contentPosition }: { uri?: string | null; kind?: string; style?: StyleProp<ViewStyle>; contentPosition?: ImageContentPosition }) {
  const [a, b] = KIND_ART[kind] ?? KIND_ART.buy!;
  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient colors={[a, b]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={contentPosition ?? "center"} transition={350} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}

/** Pill-shaped primary action in ivory. */
export function PrimaryButton({ label, onPress, busy = false, disabled = false, style }: { label: string; onPress(): void; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={disabled || busy ? undefined : onPress}
      style={({ pressed }) => [{ height: 56, borderRadius: radius.pill, backgroundColor: p.ink, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={p.onAccent} /> : <Text style={{ fontFamily: fonts.label, fontSize: 15.5, color: p.onAccent }}>{label}</Text>}
    </Pressable>
  );
}

/** Quiet text action. */
export function QuietButton({ label, onPress, style }: { label: string; onPress(): void; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={({ pressed }) => [{ minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 }, style]}>
      <Text style={{ fontFamily: fonts.label, fontSize: 14.5, color: p.ink2 }}>{label}</Text>
    </Pressable>
  );
}

/** Tap-to-answer choice. */
export function Choice({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ minHeight: 38, paddingHorizontal: 14, justifyContent: "center", borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: selected ? p.ink : p.hair, backgroundColor: selected ? p.ink : "transparent" }}
    >
      <Text style={{ fontFamily: fonts.body, fontSize: 14, color: selected ? p.onAccent : p.ink }}>{label}</Text>
    </Pressable>
  );
}

/** One line of a price statement: label with an optional hint, figure on the right. */
export function StatementRow({ label, hint, value, big = false }: { label: string; hint?: string; value: string; big?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
      <View style={{ flexShrink: 1 }}>
        {big ? <Eyebrow>{label}</Eyebrow> : <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink }}>{label}</Text>}
        {hint ? <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: p.ink3, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Figure value={value} size={big ? 42 : 20} />
    </View>
  );
}

/** Text input on glass, with its label above. */
export function GlassField({ label, style, inputStyle, ...props }: TextInputProps & { label: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return (
    <View style={[{ gap: 6 }, style]}>
      <Eyebrow>{label}</Eyebrow>
      <Glass style={{ borderRadius: radius.sm }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={p.ink3}
          style={[{ minHeight: 52, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 16, color: p.ink }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null, inputStyle]}
          {...props}
        />
      </Glass>
    </View>
  );
}

/** A bundled photograph that fills its parent. */
export function Backdrop({ source, blur = 0, dim = 0 }: { source: number; blur?: number; dim?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={blur} accessibilityIgnoresInvertColors />
      {dim ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(10,10,11,${dim})` }]} /> : null}
    </View>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  const p = usePalette();
  if (!children) return null;
  return <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.body, fontSize: 13, color: p.danger }}>{children}</Text>;
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: p.hair }, style]} />;
}
