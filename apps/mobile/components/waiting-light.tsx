import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { ease, native, useReducedMotion } from "../lib/motion";
import { usePalette } from "../lib/theme";

/** The light's slow crossing, and the breath before the next one. */
const SWEEP_MS = 5200;
const SWEEP_REST_MS = 1400;
const SHOW_MS = 700;
const HIDE_MS = 500;

/**
 * The motes, placed by hand so they read as composed rather than scattered: where across the frame each rises, its
 * size and brightness, how far it sways, when it first appears and how long it takes to drift up.
 */
const MOTES = [
  { x: 0.14, size: 4, alpha: 0.6, sway: 6, delay: 0, ms: 7200 },
  { x: 0.29, size: 3, alpha: 0.5, sway: -5, delay: 2600, ms: 8800 },
  { x: 0.41, size: 5, alpha: 0.45, sway: 8, delay: 1200, ms: 9600 },
  { x: 0.55, size: 3, alpha: 0.55, sway: -6, delay: 4100, ms: 7600 },
  { x: 0.66, size: 4, alpha: 0.55, sway: 5, delay: 600, ms: 8200 },
  { x: 0.78, size: 3, alpha: 0.48, sway: -7, delay: 3300, ms: 9000 },
  { x: 0.88, size: 4, alpha: 0.52, sway: 6, delay: 1900, ms: 7800 },
  { x: 0.22, size: 3, alpha: 0.42, sway: 4, delay: 5200, ms: 10200 },
  { x: 0.5, size: 4, alpha: 0.48, sway: -4, delay: 6400, ms: 8600 },
] as const;

/** The palette's champagne light at an alpha (palette colours are hex). */
function tint(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * While a picture is being made (owner, 2026-10-30: "put some graphical stuff while they're waiting for pictures"): a
 * band of the palette's champagne light crosses the frame slowly, and a few motes drift up through it like dust in a
 * sunbeam. It sits in the photo frame under the picture, so the picture lands over it with its own reveal, and it fades
 * away as it does. Under reduced motion it is a still, soft glow.
 */
export function WaitingLight({ active, style }: { active: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [shown, setShown] = useState(active);
  const on = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const motes = useRef(MOTES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (active) setShown(true);
    const fade = Animated.timing(on, { toValue: active ? 1 : 0, duration: active ? SHOW_MS : HIDE_MS, easing: ease.out, useNativeDriver: native });
    fade.start(({ finished }) => {
      if (finished && !active) setShown(false);
    });
    return () => fade.stop();
  }, [active, on]);

  const moving = shown && !reduced && box.w > 0;
  useEffect(() => {
    if (!moving) return;
    sweep.setValue(0);
    const loops = [
      // A gentle sine, so the light spends its time crossing the picture rather than waiting at the edges.
      Animated.loop(Animated.sequence([Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: native }), Animated.delay(SWEEP_REST_MS)])),
      ...motes.map((v, i) => Animated.loop(Animated.sequence([Animated.delay(MOTES[i]!.delay), Animated.timing(v, { toValue: 1, duration: MOTES[i]!.ms, easing: Easing.linear, useNativeDriver: native })]))),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [moving, sweep, motes]);

  if (!shown) return null;
  const band = Math.max(box.w * 0.6, 120);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== box.w || height !== box.h) setBox({ w: width, h: height });
      }}
      style={[StyleSheet.absoluteFill, { overflow: "hidden", opacity: on }, style]}
    >
      {/* A quiet warmth from the top corner: all there is under reduced motion. */}
      <LinearGradient colors={[tint(p.shine, 0.1), tint(p.shine, 0.03), tint(p.shine, 0)]} locations={[0, 0.45, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      {moving ? (
        <>
          <Animated.View
            style={{
              position: "absolute",
              top: -box.h * 0.3,
              height: box.h * 1.6,
              width: band,
              transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-band * 1.3, box.w + band * 0.3] }) }, { rotate: "16deg" }],
            }}
          >
            <LinearGradient colors={[tint(p.shine, 0), tint(p.shine, 0.06), tint(p.shine, 0.15), tint(p.shine, 0.06), tint(p.shine, 0)]} locations={[0, 0.3, 0.5, 0.7, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          {MOTES.map((m, i) => {
            const v = motes[i]!;
            return (
              <Animated.View
                key={i}
                style={{
                  position: "absolute",
                  left: m.x * box.w - m.size / 2,
                  top: 0,
                  width: m.size,
                  height: m.size,
                  borderRadius: m.size / 2,
                  backgroundColor: p.shine,
                  boxShadow: `0 0 ${m.size * 3}px ${m.size / 2}px ${tint(p.shine, 0.45)}`,
                  opacity: v.interpolate({ inputRange: [0, 0.18, 0.7, 1], outputRange: [0, m.alpha, m.alpha * 0.7, 0] }),
                  transform: [
                    { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [box.h * 0.95, box.h * 0.15] }) },
                    { translateX: v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, m.sway, 0, -m.sway, 0] }) },
                  ],
                }}
              />
            );
          })}
        </>
      ) : null}
    </Animated.View>
  );
}
