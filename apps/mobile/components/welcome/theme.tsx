import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { THEMES, THEME_ORDER, ThemeScope, fonts, layout, radius, type, usePalette, useTheme, useType, type ThemeId } from "../../lib/theme";
import { useDandy } from "../../lib/dandy";
import { DandyAvatar } from "../dandy-avatar";
import { Eyebrow, Glass, Grain, PrimaryButton, Shade } from "../lux";
import { Odometer, dollars } from "../odometer";
import { GlassReveal } from "../reveal";
import { SongNote } from "../song-note";

const MOOD: Record<ThemeId, number> = {
  emerald: require("../../assets/themes/emerald.jpg"),
  bordeaux: require("../../assets/themes/bordeaux.jpg"),
  noir: require("../../assets/themes/noir.jpg"),
  ivory: require("../../assets/themes/ivory.jpg"),
  delina: require("../../assets/themes/delina.jpg"),
  sapphire: require("../../assets/themes/sapphire.jpg"),
  // Made for Dandelist with image generation (Desktop/Dandelist Design/themes-new), like the faces.
  cognac: require("../../assets/themes/cognac.jpg"),
  amethyst: require("../../assets/themes/amethyst.jpg"),
  riviera: require("../../assets/themes/riviera.jpg"),
};
/** A sideways swipe past this, or this fast, moves one look along. */
const SWIPE_PX = 40;
const SWIPE_V = 0.3;
const CYCLE_MS = 2600;

/**
 * "Make it yours": the themes play one after another over their own mood photographs, each re-skinning the whole
 * screen, the list's total and its Dandy included. The old look crossfades into the new one (no dip to black), the
 * autoplay runs one pass and stops at the first touch, and a sideways swipe anywhere moves one look along (owner,
 * 2026-10-28: "the whole app needs to be swipe friendly"). Choosing applies the theme before an account exists, so
 * the first thing they own is the look. Each look's song is named in small print at the bottom (components/song-note.tsx).
 */
export function ThemeChooser({ totalCents, onDone, cta = "Make it mine" }: { totalCents: number; onDone(id: ThemeId): void; cta?: string }) {
  const reduced = useReducedMotion();
  const theme = useTheme();
  const start = Math.max(0, THEME_ORDER.indexOf(theme.id));
  const [index, setIndex] = useState(start);
  const [prev, setPrev] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const steps = useRef(0);
  const fades = useRef(THEME_ORDER.map((_, i) => new Animated.Value(i === index ? 1 : 0))).current;
  const swap = useRef(new Animated.Value(1)).current;
  const id = THEME_ORDER[index]!;

  const show = (next: number) => {
    if (next === index) return;
    setPrev(index);
    setIndex(next);
    swap.setValue(0);
    Animated.timing(swap, { toValue: 1, duration: reduced ? 200 : 520, easing: ease.inOut, useNativeDriver: native }).start(({ finished }) => finished && setPrev(null));
    THEME_ORDER.forEach((_, i) => Animated.timing(fades[i]!, { toValue: i === next ? 1 : 0, duration: reduced ? 200 : 700, easing: ease.cinema, useNativeDriver: native }).start());
  };

  // One pass through the six looks, then it rests; any touch stops it sooner.
  useEffect(() => {
    if (held || reduced || steps.current >= THEME_ORDER.length - 1) return;
    const t = setTimeout(() => {
      steps.current += 1;
      show((index + 1) % THEME_ORDER.length);
    }, CYCLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, held, reduced]);

  const pick = (i: number) => {
    haptic.select();
    setHeld(true);
    show(i);
  };
  // The responder is made once and reads the current look through this ref.
  const at = useRef(index);
  at.current = index;
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        const n = THEME_ORDER.length;
        if (g.dx < -SWIPE_PX || g.vx < -SWIPE_V) pick((at.current + 1) % n);
        else if (g.dx > SWIPE_PX || g.vx > SWIPE_V) pick((at.current - 1 + n) % n);
      },
    }),
  ).current;

  return (
    // A swipe on the web must not select the words under the finger.
    <View style={[StyleSheet.absoluteFill, Platform.OS === "web" ? ({ userSelect: "none" } as object) : null]} {...swipe.panHandlers}>
      {THEME_ORDER.map((t, i) => (
        <Animated.View key={t} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fades[i], backgroundColor: THEMES[t].palette.bg }]}>
          <ThemeScope id={t}>
            {/* Generated mood images always sit under film, never bare. */}
            <GlassReveal uri={null} standby={MOOD[t]} stage="clear" treatment="film" finish style={StyleSheet.absoluteFill} />
            <Shade from={0.2} />
          </ThemeScope>
        </Animated.View>
      ))}
      {prev !== null ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          <ThemeScope id={THEME_ORDER[prev]!}>
            <Body id={THEME_ORDER[prev]!} totalCents={totalCents} held={held} onPick={pick} onChoose={() => {}} cta={cta} roll={false} />
          </ThemeScope>
        </Animated.View>
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: swap }]}>
        <ThemeScope id={id}>
          <Body id={id} totalCents={totalCents} held={held} onPick={pick} onChoose={() => onDone(id)} cta={cta} roll />
        </ThemeScope>
      </Animated.View>
      <Grain />
    </View>
  );
}

function Body({ id, totalCents, held, onPick, onChoose, cta, roll }: { id: ThemeId; totalCents: number; held: boolean; onPick(i: number): void; onChoose(): void; cta: string; roll: boolean }) {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const dandy = useDandy();
  // The figure spins on every wheel the first time the card shows; later swaps leave it still.
  const first = useRef(roll);
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: gutter, paddingBottom: insets.bottom + 24, gap: 20, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: layout.stack.base }}>
        <View style={{ gap: layout.stack.tight }}>
          <Eyebrow color={p.accentText}>Make it yours</Eyebrow>
          <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>
            {THEMES[id].name}
          </Text>
        </View>
        <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink2 }]}>{THEMES[id].mood}</Text>
        <Glass style={{ padding: layout.cardPad, gap: 4, borderRadius: radius.lg }}>
          <Eyebrow color={p.accentText}>Your Dandelist</Eyebrow>
          <Odometer cents={totalCents} format={dollars} size={t.title1.fontSize ?? 34} family="bodoni" smallPrefix tracking={-0.34} color={p.ink} rollOnMount={first.current ? "cinema" : false} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            <DandyAvatar dandy={dandy} size={22} />
            <Text style={[type.figure, { color: p.ink2 }]}>{`Curated by ${dandy.name}`}</Text>
          </View>
        </Glass>
      </View>
      {/* Nine looks across one row: 34 pt swatches with 44 pt reach. Swiping anywhere does the same. */}
      <View style={{ flexDirection: "row", gap: 5, justifyContent: "center" }} accessibilityRole="radiogroup" accessibilityLabel="Theme">
        {THEME_ORDER.map((tid, i) => {
          const tp = THEMES[tid].palette;
          const on = tid === id;
          return (
            <Pressable key={tid} accessibilityRole="radio" aria-checked={on} accessibilityState={{ checked: on }} accessibilityLabel={THEMES[tid].name} onPress={() => onPick(i)} hitSlop={5} style={{ width: 34, height: 44, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, padding: 3, borderWidth: on ? 1.5 : 1, borderColor: on ? p.accentText : p.line }}>
                <View style={{ flex: 1, borderRadius: 14, overflow: "hidden", flexDirection: "row", transform: [{ rotate: "-35deg" }] }}>
                  <View style={{ flex: 1, backgroundColor: tp.bg }} />
                  <View style={{ flex: 1, backgroundColor: tp.accent }} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton label={held ? `${cta}: ${THEMES[id].name}` : cta} commit onPress={onChoose} />
      {/* Under the small print, the look's own song: a hint, never explained (lib/theme-songs.ts). */}
      <View style={{ gap: 6 }}>
        <Text style={[type.footnote, { color: p.ink3, textAlign: "center" }]}>Swipe to try another. You can change it any time.</Text>
        <SongNote id={id} />
      </View>
    </View>
  );
}
