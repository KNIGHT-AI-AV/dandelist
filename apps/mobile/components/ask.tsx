import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Platform, Pressable, Text, View } from "react-native";
import { AskClock } from "../lib/ask";
import { haptic, native, useReducedMotion } from "../lib/motion";
import { layout, type, usePalette } from "../lib/theme";
import { usePageShown } from "./home/pager";

/**
 * The clock behind one run of questions (lib/ask.ts). It waits on `open` while `run` is true and calls `onDue` with
 * the question whose time is up. It holds while the chat is turned away, the app is in the background, a screen
 * reader is on (on phones; WCAG 2.2.1: nobody who needs longer is hurried) or a field has focus, and every pick it
 * makes stays one tap from changed.
 */
export function useAskClock(open: string | null, run: boolean, onDue: (key: string) => void) {
  const due = useRef(onDue);
  due.current = onDue;
  const [windowMs, setWindowMs] = useState<number | null>(null);
  // Counts every wait that starts, so the bar runs again from full after a touch.
  const [round, setRound] = useState(0);
  const clock = useMemo(
    () =>
      new AskClock(
        (k) => due.current(k),
        (ms) => {
          setWindowMs(ms);
          if (ms !== null) setRound((n) => n + 1);
        },
      ),
    [],
  );
  useEffect(() => () => clock.stop(), [clock]);
  useEffect(() => clock.wait(run ? open : null), [clock, run, open]);
  // A field belongs to the question it sits in; when that one closes, so does its hold.
  useEffect(() => clock.hold("typing", false), [clock, open]);

  // Held while the chat is out of view on the home ring (in a spread it can sit beside the list); never off the ring.
  const chatShown = usePageShown("chat");
  useEffect(() => clock.hold("page", chatShown === false), [clock, chatShown]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => clock.hold("away", s !== "active"));
    return () => sub?.remove();
  }, [clock]);
  useEffect(() => {
    // The web can't tell: react-native-web answers "on" for every browser, which would stop the clock for everyone.
    if (Platform.OS === "web") return;
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => alive && clock.hold("reader", on));
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", (on: boolean) => clock.hold("reader", on));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [clock]);

  return {
    /** A scroll, or a field opened: the long wait starts again. */
    touch: useCallback(() => clock.touch(false), [clock]),
    /** A pick on a question that takes several: the short wait. */
    picked: useCallback(() => clock.touch(true), [clock]),
    /** Holds while a field has focus. */
    typing: useCallback((on: boolean) => clock.hold("typing", on), [clock]),
    windowMs,
    round,
  };
}

/**
 * How long until the Dandy picks: a hairline in the theme's accent that runs out. Nothing shows while no wait runs,
 * or with reduced motion.
 */
export function AskBar({ windowMs, round }: { windowMs: number | null; round: number }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (windowMs === null || reduced) return;
    v.setValue(1);
    const run = Animated.timing(v, { toValue: 0, duration: windowMs, easing: Easing.linear, useNativeDriver: native });
    run.start();
    return () => run.stop();
  }, [windowMs, round, reduced, v]);
  if (windowMs === null || reduced) return null;
  return (
    <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 2, borderRadius: 1, overflow: "hidden" }}>
      <Animated.View style={{ flex: 1, backgroundColor: p.accent, opacity: 0.7, transformOrigin: "left", transform: [{ scaleX: v }] }} />
    </View>
  );
}

/** A closed question on one line: what it asked and the answer it holds. A tap opens it again to change. */
export function AskRow({ title, answer, onPress }: { title: string; answer: string; onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${answer}`}
      accessibilityHint="Opens it to change your answer"
      onPress={() => {
        haptic.select();
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => ({ minHeight: layout.control.icon, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[type.footnote, { color: p.ink2, flexShrink: 0, maxWidth: "45%" }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[type.label, { flex: 1, color: p.ink, textAlign: "right" }]} numberOfLines={1}>
        {answer}
      </Text>
    </Pressable>
  );
}

/** The Dandy's one line after it chose for them: "I went with Base and Obsidian Black." */
export function AskNote({ text }: { text: string | null }) {
  const p = usePalette();
  if (!text) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink2 }]}>
      {text}
    </Text>
  );
}
