import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing, Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Motion tokens (onboarding research, 2026-10-27, §7). Two speeds, never mixed: UI moves fast with `out`;
 * only the title sequence and the reveal move slowly with `cinema`. Springs have no bounce unless the bounce means
 * something (the meter, the reveal).
 */
export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
  cinema: Easing.bezier(0.25, 0.1, 0.25, 1),
  effects: Easing.bezier(0.34, 0.8, 0.34, 1),
};

export const spring = {
  press: { mass: 1, stiffness: 439, damping: 41.9 },
  snap: { mass: 1, stiffness: 247, damping: 28.3 },
  settle: { mass: 1, stiffness: 158, damping: 25.1 },
  meter: { mass: 1, stiffness: 110, damping: 17.8 },
  reveal: { mass: 1, stiffness: 62, damping: 12.6 },
};

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

let lastTick = 0;
/** Haptics (research §7.3): sparing, causal, paired with something visible. No-ops on the web. */
export const haptic = {
  select() {
    if (Platform.OS === "web") return;
    const now = Date.now();
    if (now - lastTick < 80) return;
    lastTick = now;
    void Haptics.selectionAsync();
  },
  success() {
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error() {
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  soft() {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  },
};
