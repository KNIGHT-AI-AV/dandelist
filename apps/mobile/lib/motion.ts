import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Motion tokens (onboarding research, 2026-10-27, §7; UI audit §2 and §5). Two speeds, never mixed: UI moves fast
 * with `out`; only the title sequence and the reveal move slowly with `cinema`. Springs have no bounce unless the
 * bounce means something (the meter, the reveal). Nothing eases in.
 */
export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
  cinema: Easing.bezier(0.25, 0.1, 0.25, 1),
  effects: Easing.bezier(0.34, 0.8, 0.34, 1),
  /** The odometer's travel and the row width: front-loaded, so digits arrive slow and readable. */
  expo: Easing.bezier(0.16, 1, 0.3, 1),
};

export const spring = {
  press: { mass: 1, stiffness: 439, damping: 41.9 },
  snap: { mass: 1, stiffness: 247, damping: 28.3 },
  settle: { mass: 1, stiffness: 158, damping: 25.1 },
  meter: { mass: 1, stiffness: 110, damping: 17.8 },
  reveal: { mass: 1, stiffness: 62, damping: 12.6 },
};

/** Step changes (UI audit P1-16): the old step leaves fast, the new one arrives a little slower. */
export const step = { outMs: 150, inMs: 320, outX: -16, inX: 24, staggerMs: 50 };

/** A flick that dismisses a sheet or a detail, in px per ms (Emil Kowalski's drawer). */
export const FLICK = 0.11;

/** Animated's native driver exists on phones only; the web runs the same animations in JS. */
export const native = Platform.OS !== "web";

/** Follows the system "reduce motion" setting live, on phones and on the web. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

let lastHaptic = 0;
const tick = (minGap: number) => {
  const now = Date.now();
  if (now - lastHaptic < minGap) return false;
  lastHaptic = now;
  return true;
};

/** Haptics (research §7.3): sparing, causal, paired with something visible. No-ops on the web. */
export const haptic = {
  select() {
    if (Platform.OS === "web" || !tick(80)) return;
    void Haptics.selectionAsync();
  },
  /** A tick that never lands within 300 ms of another haptic (the Life pill after a vote). */
  quietSelect() {
    if (Platform.OS === "web" || !tick(300)) return;
    void Haptics.selectionAsync();
  },
  success() {
    lastHaptic = Date.now();
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error() {
    lastHaptic = Date.now();
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  soft() {
    lastHaptic = Date.now();
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  },
};

/**
 * Press feedback (UI audit P1-15): the control sinks to `to` on press-in and comes back on the same critically
 * damped spring. Buttons and chips use 0.97, cards 180 px and taller use 0.985. Keyboard presses don't animate.
 */
export function usePress(to = 0.97) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(scale, { toValue: v, ...spring.press, useNativeDriver: native }).start();
  return {
    scale,
    onPressIn: (e?: { nativeEvent?: object }) => {
      // A keyboard "press" on the web has no pointer coordinates.
      if (reduced || (e?.nativeEvent && !("pageX" in e.nativeEvent) && Platform.OS === "web")) return;
      go(to);
    },
    onPressOut: () => go(1),
  };
}
