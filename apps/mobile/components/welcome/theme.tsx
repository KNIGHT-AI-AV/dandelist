import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { THEMES, THEME_ORDER, ThemeScope, fonts, radius, usePalette, useTheme, type ThemeId } from "../../lib/theme";
import { Eyebrow, Glass, Grain, PrimaryButton, Shade } from "../lux";
import { Odometer } from "../odometer";
import { GlassReveal } from "../reveal";

const MOOD: Record<ThemeId, number> = {
  emerald: require("../../assets/themes/emerald.jpg"),
  bordeaux: require("../../assets/themes/bordeaux.jpg"),
  noir: require("../../assets/themes/noir.jpg"),
  ivory: require("../../assets/themes/ivory.jpg"),
  delina: require("../../assets/themes/delina.jpg"),
  sapphire: require("../../assets/themes/sapphire.jpg"),
};
const CYCLE_MS = 2600;

/**
 * "Make it yours": the themes play one after another over their own mood photographs, each re-skinning the whole
 * screen, the person's life total and date included. Tapping a swatch holds that theme; choosing it applies it to
 * the app before an account exists, so the first thing they own is the look.
 */
export function ThemeChooser({ total, by, onDone, cta = "Make it mine" }: { total: string; by: string; onDone(id: ThemeId): void; cta?: string }) {
  const reduced = useReducedMotion();
  const theme = useTheme();
  const [index, setIndex] = useState(Math.max(0, THEME_ORDER.indexOf(theme.id)));
  const [held, setHeld] = useState(false);
  const fades = useRef(THEME_ORDER.map((_, i) => new Animated.Value(i === index ? 1 : 0))).current;
  const content = useRef(new Animated.Value(1)).current;
  const id = THEME_ORDER[index]!;

  const show = (next: number) => {
    if (next === index) return;
    const swap = () => {
      setIndex(next);
      Animated.timing(content, { toValue: 1, duration: reduced ? 150 : 320, easing: ease.out, useNativeDriver: native }).start();
    };
    THEME_ORDER.forEach((_, i) => Animated.timing(fades[i]!, { toValue: i === next ? 1 : 0, duration: reduced ? 200 : 700, easing: ease.cinema, useNativeDriver: native }).start());
    Animated.timing(content, { toValue: 0, duration: reduced ? 100 : 180, easing: ease.out, useNativeDriver: native }).start(swap);
  };

  useEffect(() => {
    if (held || reduced) return;
    const t = setTimeout(() => show((index + 1) % THEME_ORDER.length), CYCLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, held, reduced]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {THEME_ORDER.map((t, i) => (
        <Animated.View key={t} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fades[i], backgroundColor: THEMES[t].palette.bg }]}>
          <ThemeScope id={t}>
            {/* Generated mood images always sit under film, never bare. */}
            <GlassReveal uri={null} standby={MOOD[t]} stage="clear" treatment="film" finish style={StyleSheet.absoluteFill} />
            <Shade from={0.2} />
          </ThemeScope>
        </Animated.View>
      ))}
      <ThemeScope id={id}>
        <Body id={id} total={total} by={by} content={content} held={held} onPick={(i) => { haptic.select(); setHeld(true); show(i); }} onChoose={() => { haptic.success(); onDone(id); }} cta={cta} />
      </ThemeScope>
      <Grain />
    </View>
  );
}

function Body({ id, total, by, content, held, onPick, onChoose, cta }: { id: ThemeId; total: string; by: string; content: Animated.Value; held: boolean; onPick(i: number): void; onChoose(): void; cta: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, paddingBottom: insets.bottom + 24, gap: 18, maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <Animated.View style={{ gap: 10, opacity: content, transform: [{ translateY: content.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
        <Eyebrow color={p.accent}>Make it yours</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: p.ink, letterSpacing: -0.6 }}>
          {THEMES[id].name}
        </Text>
        <Text style={{ fontFamily: fonts.displayItalic, fontSize: 20, lineHeight: 26, color: p.ink2 }}>{THEMES[id].mood}</Text>
        <Glass style={{ marginTop: 8, padding: 18, gap: 4, borderRadius: radius.md }}>
          <Eyebrow color={p.accent}>Your life</Eyebrow>
          <Odometer value={total} size={38} family={fonts.display} color={p.ink} />
          <Text style={{ fontFamily: fonts.figure, fontSize: 12.5, color: p.ink2 }}>{`yours by ${by}`}</Text>
        </Glass>
      </Animated.View>
      <View style={{ flexDirection: "row", gap: 12, justifyContent: "center", paddingVertical: 6 }} accessibilityRole="radiogroup">
        {THEME_ORDER.map((t, i) => {
          const tp = THEMES[t].palette;
          const on = t === id;
          return (
            <Pressable key={t} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={THEMES[t].name} onPress={() => onPick(i)} hitSlop={6}>
              <View style={{ width: 40, height: 40, borderRadius: 20, padding: 3, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth, borderColor: on ? p.accent : p.hair }}>
                <View style={{ flex: 1, borderRadius: 17, overflow: "hidden", flexDirection: "row", transform: [{ rotate: "-35deg" }] }}>
                  <View style={{ flex: 1, backgroundColor: tp.bg }} />
                  <View style={{ flex: 1, backgroundColor: tp.accent }} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton label={held ? `${cta}: ${THEMES[id].name}` : cta} onPress={onChoose} />
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.ink3, textAlign: "center" }}>You can change it any time.</Text>
    </View>
  );
}
