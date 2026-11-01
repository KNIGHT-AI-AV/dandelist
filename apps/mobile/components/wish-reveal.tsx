import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { cardBlur, type Card } from "../lib/reveal";
import { ease, native, step, useReducedMotion } from "../lib/motion";
import { fonts, layout, radius, type, usePalette } from "../lib/theme";
import { AgentDot, Eyebrow, Glass } from "./lux";
import { WaitingLight } from "./waiting-light";

/** One picture every 1.6 s: long enough to register, short enough to feel alive. */
const SHUFFLE_MS = 1600;
/** The cross-dissolve between shuffled pictures. */
const DISSOLVE_MS = 700;
/**
 * The focus pull when the real picture lands, one 1.1 s timeline: the real photo takes over the shuffle still out of
 * focus, then pulls sharp while it settles from slightly large and the exposure lifts, like a lens finding focus.
 */
const LAND_MS = 1100;
const LAND_SCALE = 1.06;
/** The out-of-focus copy the pull starts from, and the shade it lifts out of. */
const LAND_BLUR = 14;
const LAND_SHADE = 0.16;
/** A slow breath on the waiting picture so it never sits still; a full cycle every 12 s. */
const DRIFT_MS = 6000;
const DRIFT_SCALE = 1.05;

/**
 * The hero while the agent works: pictures shuffle behind a blur that clears as it finds the real thing, then the
 * real picture lands sharp. `deck` and `clarity` come from lib/reveal; `final` is the chosen option's photo, set once
 * the answer is in. With no real photo at the end, it settles on the plain surface rather than a stand-in.
 */
export function RevealPhoto({ deck, final, clarity, done }: { deck: Card[]; final?: string | null; clarity: number; done: boolean }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const drift = useRef(new Animated.Value(0)).current;
  const land = useRef(new Animated.Value(0)).current;

  // The run is polled every 1.5 s, so the deck arrives as a new array each time; fetch only when its contents change.
  const deckKey = deck.map((c) => c.uri).join("|");
  useEffect(() => {
    if (deckKey) void Image.prefetch(deckKey.split("|"));
  }, [deckKey]);

  useEffect(() => {
    if (done || reduced || deck.length < 2) return;
    const t = setInterval(() => setI((n) => n + 1), SHUFFLE_MS);
    return () => clearInterval(t);
  }, [done, reduced, deck.length]);

  useEffect(() => {
    if (done || reduced) return drift.stopAnimation();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: DRIFT_MS, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(drift, { toValue: 0, duration: DRIFT_MS, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [done, reduced, drift]);

  useEffect(() => {
    if (!done || !final) return;
    land.setValue(0);
    // In-out, not front-loaded: the soft copy holds a beat, focus glides in mid-sequence, then the scale settles.
    Animated.timing(land, { toValue: 1, duration: reduced ? step.inMs : LAND_MS, easing: reduced ? ease.out : ease.inOut, useNativeDriver: native }).start();
  }, [done, final, reduced, land]);
  // Phases of the one timeline: the blurred copy arrives in the first fifth, focus comes in from 12% to 85%.
  const soft = land.interpolate({ inputRange: [0, 0.2], outputRange: [0, 1], extrapolate: "clamp" });
  const sharp = land.interpolate({ inputRange: reduced ? [0, 1] : [0.12, 0.85], outputRange: [0, 1], extrapolate: "clamp" });
  const settle = land.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 1 : LAND_SCALE, 1] });
  const shade = land.interpolate({ inputRange: [0, 0.2, 0.85], outputRange: [0, reduced ? 0 : LAND_SHADE, 0], extrapolate: "clamp" });

  const waiting = deck.length ? deck[i % deck.length] : undefined;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <LinearGradient colors={[p.surface, p.bg]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      {waiting && !(done && !final) ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, DRIFT_SCALE] }) }] }]}>
          <Image
            source={{ uri: waiting.uri }}
            accessibilityLabel=""
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={cardBlur(waiting, done ? 0.8 : clarity)}
            transition={{ duration: DISSOLVE_MS, effect: "cross-dissolve" }}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
      ) : null}
      {/* While the picture is being made: light crossing it, motes drifting up. The real one lands over it. */}
      <WaitingLight active={!done} />
      {done && final ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: settle }] }]}>
          {reduced ? null : (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: soft }]}>
              <Image source={{ uri: final }} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={LAND_BLUR} accessibilityIgnoresInvertColors />
            </Animated.View>
          )}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: sharp }]}>
            <Image source={{ uri: final }} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: shade }]} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** How long the light takes to cross a carved slot. */
const SWEEP_MS = 1400;

/** A carved slot where content will land: a recessed tile the shape of what replaces it, with a slow light sweep. */
export function Carve({ width, height, style }: { width: DimensionValue; height: number; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || !w) return;
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: ease.inOut, useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [reduced, w, sweep]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: radius.xs, borderCurve: "continuous", backgroundColor: `rgba(${p.inkRgb}, 0.07)`, overflow: "hidden" }, style]}
    >
      {w ? (
        <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: w, transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-w, w] }) }] }}>
          <LinearGradient colors={[`rgba(${p.inkRgb}, 0)`, `rgba(${p.inkRgb}, 0.07)`, `rgba(${p.inkRgb}, 0)`]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * What the agent is thinking or doing, one line at a time. A new line replaces the old with the app's step motion
 * (out fast, in a little slower); the card keeps two lines of height so the page never jumps.
 */
export function ThoughtLine({ thought, tally }: { thought: { text: string; mine: boolean } | null; tally: string }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(thought);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (thought?.text === shown?.text) return;
    if (reduced) return setShown(thought);
    Animated.timing(v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native }).start(() => {
      setShown(thought);
      Animated.timing(v, { toValue: 1, duration: step.inMs, easing: ease.out, useNativeDriver: native }).start();
    });
  }, [thought, shown, reduced, v]);
  const lineHeight = (shown?.mine ? type.title3.lineHeight : type.callout.lineHeight) ?? 0;
  return (
    <Glass style={{ padding: layout.cardPad, gap: layout.stack.tight }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: layout.stack.tight }}>
        <AgentDot busy />
        <Eyebrow>{shown?.mine ? "Thinking" : "Working"}</Eyebrow>
        <Text style={[type.footnote, { color: p.ink3, marginLeft: "auto" }]}>{tally}</Text>
      </View>
      <Animated.View style={{ minHeight: 2 * lineHeight, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [step.inX / 3, 0] }) }] }}>
        <Text accessibilityLiveRegion="polite" style={shown?.mine ? [type.title3, { fontFamily: fonts.titleItalic, color: p.ink }] : [type.callout, { color: p.ink }]}>
          {shown?.text ?? "Starting the search"}
        </Text>
      </Animated.View>
    </Glass>
  );
}
