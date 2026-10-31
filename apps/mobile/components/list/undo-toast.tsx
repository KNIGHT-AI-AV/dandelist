import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, Text, View } from "react-native";
import { Glass } from "../lux";
import { ease, native, spring, usePress, useReducedMotion } from "../../lib/motion";
import { layout, radius, space, type, usePalette } from "../../lib/theme";
import { choreo } from "./choreo";
import { DOCK_END } from "./metrics";
import { Swap } from "./presence";

export interface Note {
  /** A new key is a new message: the text cross-fades. */
  key: string;
  text: string;
  action?: { label: string; onPress(): void };
}

/** Whether VoiceOver or TalkBack is running, kept live. */
function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setOn);
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setOn);
    return () => sub.remove();
  }, []);
  return on;
}

/** On the web: true when keyboard focus has nowhere sensible to be (the page, or something now hidden). */
function focusLost(): boolean {
  const doc = (globalThis as { document?: { activeElement: { closest?(s: string): unknown } | null; body: unknown } }).document;
  const el = doc?.activeElement;
  return !el || el === doc?.body || !!el.closest?.('[aria-hidden="true"]');
}

/**
 * A short message above the composer, glass like the composer and on the same column, with an optional action
 * (Undo). It rises in on spring.snap and sinks away in step.outMs; a new message cross-fades in place. While a
 * pointer rests on it or Undo has focus it holds (`onHold` / `onRelease`), so nobody loses it mid-read.
 *
 * `claim` moves focus to the action when it changes and focus would otherwise be lost (the removed card took it with
 * it), and on phones whenever a screen reader is on, so Undo is one double-tap away.
 */
/** `left` and `width`: the stretch of the window it centres in, the whole width unless given (one page of a spread). */
export function Toast({ note, bottom, side, left = 0, width, claim, onHold, onRelease }: { note: Note | null; bottom: number; side: number; left?: number; width?: number; claim: number; onHold(): void; onRelease(): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const screenReader = useScreenReader();
  const press = usePress();
  const v = useRef(new Animated.Value(note ? 1 : 0)).current;
  const [mounted, setMounted] = useState(!!note);
  const last = useRef(note);
  if (note) last.current = note;
  const shown = note ?? last.current;
  const action = useRef<View>(null);
  const visible = !!note;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      (reduced
        ? Animated.timing(v, { toValue: 1, duration: choreo.outMs, easing: ease.out, useNativeDriver: native })
        : Animated.spring(v, { toValue: 1, ...spring.snap, useNativeDriver: native })
      ).start();
      return;
    }
    Animated.timing(v, { toValue: 0, duration: choreo.outMs, easing: ease.out, useNativeDriver: native }).start(({ finished }) => finished && setMounted(false));
  }, [visible, reduced, v]);

  // A message with no action is read out on iOS (Android reads the live region).
  useEffect(() => {
    if (note && !note.action && screenReader && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(note.text);
  }, [note?.key, screenReader]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!claim || !note?.action) return;
    if (Platform.OS === "web") {
      if (focusLost()) (action.current as unknown as { focus?(): void } | null)?.focus?.();
      return;
    }
    if (!screenReader) return;
    // After the sheet's own exit, so the focus isn't handed straight back to where the card was.
    const t = setTimeout(() => action.current && AccessibilityInfo.sendAccessibilityEvent(action.current, "focus"), choreo.outMs);
    return () => clearTimeout(t);
  }, [claim]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      accessibilityLiveRegion="polite"
      aria-live="polite"
      style={{ position: "absolute", left, ...(width === undefined ? { right: 0 } : { width }), bottom, paddingHorizontal: side, alignItems: "center", pointerEvents: "box-none" }}
    >
      {mounted && shown ? (
        <Animated.View
          style={{
            width: "100%",
            maxWidth: layout.list,
            opacity: v,
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : choreo.rise, 0] }) }],
            pointerEvents: visible ? "auto" : "none",
          }}
        >
          <Pressable focusable={false} accessible={false} onHoverIn={onHold} onHoverOut={onRelease}>
            <Glass intensity={60} tint={p.sheet} style={{ minHeight: layout.control.field, borderRadius: radius.pill, justifyContent: "center", paddingLeft: layout.cardPad, paddingRight: DOCK_END }}>
              <Swap k={shown.key}>
                <View style={{ minHeight: layout.control.field, flexDirection: "row", alignItems: "center", gap: space[8] }}>
                  <Text style={[type.callout, { flex: 1, color: p.ink }]} numberOfLines={1}>
                    {shown.text}
                  </Text>
                  {shown.action ? (
                    <Pressable
                      ref={action}
                      accessibilityRole="button"
                      accessibilityLabel={shown.action.label}
                      accessibilityHint={shown.text}
                      onPress={shown.action.onPress}
                      onPressIn={press.onPressIn}
                      onPressOut={press.onPressOut}
                      onFocus={onHold}
                      onBlur={onRelease}
                      hitSlop={space[4]}
                    >
                      <Animated.View style={{ minHeight: layout.control.chip, paddingHorizontal: space[12], justifyContent: "center", transform: [{ scale: press.scale }] }}>
                        <Text style={[type.label, { color: p.accentText }]}>{shown.action.label}</Text>
                      </Animated.View>
                    </Pressable>
                  ) : null}
                </View>
              </Swap>
            </Glass>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
