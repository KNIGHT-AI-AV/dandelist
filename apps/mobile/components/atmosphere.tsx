import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { native, useReducedMotion } from "../lib/motion";
import { usePalette } from "../lib/theme";

const GUILLOCHE = require("../assets/atmosphere/guilloche.png");
const SHEEN = require("../assets/atmosphere/sheen.png");

/**
 * The page behind every screen (owner, 2026-10-27: backgrounds should be "textured, intricate, premium, with slight
 * movements"). The theme colour, then a guilloché engraving in the theme's ink at a few percent (tone on tone, the
 * way a watch dial is engine-turned) drifting a few points on a slow ellipse, and a soft light that crosses the page
 * and back about twice a minute. Still under reduced motion. Textures: scripts/make-atmosphere.py.
 */
export function Atmosphere() {
  const p = usePalette();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loops = [
      Animated.loop(Animated.timing(drift, { toValue: 1, duration: 36_000, easing: Easing.linear, useNativeDriver: native })),
      Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 28_000, easing: Easing.linear, useNativeDriver: native })),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, drift, sweep]);
  const dark = p.scheme === "dark";
  const quarters = [0, 0.25, 0.5, 0.75, 1];
  const dx = drift.interpolate({ inputRange: quarters, outputRange: [0, 14, 0, -14, 0] });
  const dy = drift.interpolate({ inputRange: quarters, outputRange: [10, 0, -10, 0, 10] });
  const size = Math.max(width, height) * 0.9;
  const along = (from: number, to: number) => sweep.interpolate({ inputRange: [0, 0.5, 1], outputRange: [from, to, from], easing: Easing.inOut(Easing.sin) });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, overflow: "hidden" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.Image
        source={GUILLOCHE}
        resizeMode="cover"
        style={{ position: "absolute", left: -20, top: -20, width: width + 40, height: height + 40, tintColor: p.ink, opacity: dark ? 0.09 : 0.075, transform: [{ translateX: dx }, { translateY: dy }] }}
      />
      <Animated.Image
        source={SHEEN}
        style={{ position: "absolute", left: 0, top: 0, width: size, height: size, tintColor: dark ? p.ink : "#FFFFFF", opacity: dark ? 0.055 : 0.35, transform: [{ translateX: along(-size * 0.55, width - size * 0.45) }, { translateY: along(-size * 0.35, height * 0.45 - size * 0.5) }] }}
      />
    </View>
  );
}

/** A screen's page: the atmosphere behind `children`, so a push slides the whole page with its texture. */
export function Page({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1 }, style]}>
      <Atmosphere />
      {children}
    </View>
  );
}
