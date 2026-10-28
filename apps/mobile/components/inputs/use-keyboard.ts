import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Animated, Dimensions, Keyboard, Platform, type EmitterSubscription, type KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { native } from "../../lib/motion";
import { ANDROID_IME, KEYBOARD_CURVE } from "./tokens";

/**
 * One keyboard tracker for the whole app. Every screen reads the same animated value, so a dock, a sheet and a
 * scroll view all move together on the keyboard's own timing. Nothing moves on the web: browsers lay out around
 * their own keyboards.
 *
 * Android: Expo SDK 54+ draws edge to edge, which turns `adjustResize` into `adjustNothing` (the window no longer
 * shrinks), so Android is handled here the same way as iOS instead of by the window.
 */

export interface KeyboardState {
  /** The keyboard's overlap with the bottom of the window, in pt, animated on its own duration and curve. Native-driven: use it in transforms. */
  height: Animated.Value;
  /** Where `height` is heading: set the moment the keyboard starts to move. */
  end: number;
  /** The overlap for layout (scroll padding): grows as the keyboard starts to show and shrinks once it has gone, so content never jumps. */
  inset: number;
}

type Snapshot = { end: number; inset: number };

const height = new Animated.Value(0);
let snap: Snapshot = { end: 0, inset: 0 };
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;
/** The bottom safe-area inset; Android reports the keyboard's height above the navigation bar, not its overlap. */
let safeBottom = 0;

function publish(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

function move(to: number, duration: number, easing: (t: number) => number) {
  if (to === snap.end) return;
  publish({ end: to, inset: Math.max(snap.inset, to) });
  const settle = () => {
    if (snap.end === to && snap.inset !== to) publish({ inset: to });
  };
  if (duration <= 0) {
    height.setValue(to);
    return settle();
  }
  // Starting a new timing on the same value picks up from wherever the last one is, so moves interrupt cleanly.
  Animated.timing(height, { toValue: to, duration, easing, useNativeDriver: native }).start(({ finished }) => finished && settle());
}

/** iOS: the overlap from the keyboard's top edge; a zero frame (hidden, or the cross-fade transition) is none. */
function overlapIOS(e: KeyboardEvent): number {
  const { screenY, height: h } = e.endCoordinates;
  if (!h || !screenY) return 0;
  return Math.max(0, Dimensions.get("window").height - screenY);
}

function attach(): () => void {
  if (Platform.OS === "web") return () => {};
  // A screen can mount while the keyboard is already up (a sheet's second step); start from where it is.
  const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
  const now = !metrics ? 0 : Platform.OS === "ios" ? Math.max(0, Dimensions.get("window").height - metrics.screenY) : metrics.height + safeBottom;
  height.setValue(now);
  snap = { end: now, inset: now };
  const subs: EmitterSubscription[] =
    Platform.OS === "ios"
      ? [
          Keyboard.addListener("keyboardWillChangeFrame", (e) => move(overlapIOS(e), e.duration, KEYBOARD_CURVE)),
          Keyboard.addListener("keyboardWillHide", (e) => move(0, e.duration, KEYBOARD_CURVE)),
        ]
      : [
          Keyboard.addListener("keyboardDidShow", (e) => move(e.endCoordinates.height + safeBottom, ANDROID_IME.ms, ANDROID_IME.curve)),
          Keyboard.addListener("keyboardDidHide", () => move(0, ANDROID_IME.ms, ANDROID_IME.curve)),
        ];
  return () => subs.forEach((s) => s.remove());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) detach = attach();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      detach?.();
      detach = null;
    }
  };
}

const read = () => snap;

/** The keyboard's animated height and where it is heading. Zero on the web. */
export function useKeyboard(): KeyboardState {
  const { bottom } = useSafeAreaInsets();
  useEffect(() => {
    safeBottom = bottom;
  }, [bottom]);
  const s = useSyncExternalStore(subscribe, read, read);
  return { height, end: s.end, inset: s.inset };
}

/**
 * A translateY that lifts something resting `rest` pt above the bottom of the window so it sits `gap` pt above the
 * keyboard, riding the keyboard's own duration and curve. Zero while the keyboard is down or lower than that.
 */
export function useKeyboardLift(rest: number, gap: number): Animated.AnimatedInterpolation<number> {
  const { height: h } = useKeyboard();
  return useMemo(() => {
    const t = Math.max(0, rest - gap);
    return h.interpolate(t > 0 ? { inputRange: [0, t, t + 1], outputRange: [0, 0, -1], extrapolateLeft: "clamp", extrapolateRight: "extend" } : { inputRange: [0, 1], outputRange: [0, -1], extrapolateLeft: "clamp", extrapolateRight: "extend" });
  }, [h, rest, gap]);
}
