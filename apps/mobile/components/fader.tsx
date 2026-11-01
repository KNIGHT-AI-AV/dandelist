import { useRef } from "react";
import { Animated, PanResponder, Platform, Text, View } from "react-native";
import { fractionOf, incomeAt } from "../lib/comfort";
import { haptic, native, spring } from "../lib/motion";
import { layout, shadow, type, usePalette } from "../lib/theme";
import { tick } from "../lib/tick";
import { zoom } from "../lib/viewport";

const THUMB = 30;
/** Room for a figure under the track, centred on its notch. */
const LABEL_W = 64;

/** When a fader was last touched. */
let touchedAt = 0;
/**
 * A tap that lands just after a fader was dragged is a finger coming off the track, not a choice (owner's list,
 * 2026-10-29: an account ended up priced in yen, most likely from a currency chip tapped by accident under the fader).
 */
export const faderJustMoved = (ms = 700) => Date.now() - touchedAt < ms;

/** The index of the notch nearest `value`. */
export function nearestNotch(value: number, steps: readonly number[]): number {
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (Math.abs(steps[k]! - value) < Math.abs(steps[i]! - value)) i = k;
  return i;
}

const KEY_STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

/**
 * What a fader needs on the web, where react-native-web reads none of accessibilityValue: its place on the track for a
 * screen reader (axe: a slider must have aria-valuenow), a Tab stop, and the slider keys. The arrows move a notch, Home
 * and End go to the ends, as a screen reader's swipe does on a phone. While it has focus the arrows are its own: the page
 * doesn't scroll, and the pager, which listens on the window for arrows, doesn't turn.
 */
export function webSlider(at: number, notches: number, goTo: (i: number) => void) {
  return {
    "aria-valuemin": 0,
    "aria-valuemax": notches - 1,
    "aria-valuenow": at,
    focusable: true,
    onKeyDown: (e: { key: string; preventDefault(): void; stopPropagation(): void }) => {
      const to = e.key === "Home" ? 0 : e.key === "End" ? notches - 1 : e.key in KEY_STEP ? at + KEY_STEP[e.key]! : null;
      if (to === null) return;
      e.preventDefault();
      e.stopPropagation();
      goTo(to);
    },
  };
}

/**
 * The one fader: a 3 pt track lit in the accent up to a 30 pt ink thumb, on a log scale of round notches. It lands
 * only on `steps` (US cents), each with a tick (a haptic on phones); `firm` says which moves deserve the firmer one.
 * Positions come from the page, not the touched element, so the thumb follows the finger both ways from anywhere on
 * the track; it captures the drag, so a page swipe never starts on it. The income fader ("What would it take") and a
 * money wish's "How much?" both use it.
 */
export function Fader({
  value,
  steps,
  onChange,
  label,
  valueText,
  labels,
  firm,
}: {
  value: number;
  steps: readonly number[];
  onChange(cents: number): void;
  /** What it sets, for a screen reader: "Income a year". */
  label: string;
  /** The value as a screen reader says it. */
  valueText: string;
  /** Figures under the track, each under its own notch (the ends sit flush with the track's ends). */
  labels: { cents: number; text: string }[];
  /** A move from one notch to the next that should land with the firmer haptic (a new face, a round stop). */
  firm?: (from: number, to: number) => boolean;
}) {
  const p = usePalette();
  const track = useRef<View>(null);
  const box = useRef({ x: 0, w: 1 });
  const hold = useRef(new Animated.Value(0)).current;
  const last = useRef(value);
  const f = fractionOf(value, steps);

  const measure = () => track.current?.measureInWindow((x, _y, w) => (box.current = { x, w: Math.max(1, w) }));
  const land = (c: number) => {
    const from = last.current;
    last.current = c;
    tick();
    if (firm?.(from, c)) haptic.soft();
    else haptic.select();
    onChange(c);
  };
  // The responder is made once; it reaches the latest props through this ref.
  const act = useRef({ setFromPage: (_pageX: number) => {} });
  act.current.setFromPage = (pageX: number) => {
    const c = incomeAt((pageX - box.current.x) / box.current.w, steps);
    if (c !== last.current) land(c);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        touchedAt = Date.now();
        measure();
        Animated.spring(hold, { toValue: 1, ...spring.press, useNativeDriver: native }).start();
        // The pointer is in screen pixels and the track's measure in the page's (lib/viewport.ts).
        act.current.setFromPage(e.nativeEvent.pageX / zoom());
      },
      onPanResponderMove: (e) => {
        touchedAt = Date.now();
        act.current.setFromPage(e.nativeEvent.pageX / zoom());
      },
      onPanResponderRelease: () => {
        touchedAt = Date.now();
        Animated.spring(hold, { toValue: 0, ...spring.press, useNativeDriver: native }).start();
      },
      onPanResponderTerminate: () => {
        touchedAt = Date.now();
        Animated.spring(hold, { toValue: 0, ...spring.press, useNativeDriver: native }).start();
      },
    }),
  ).current;

  /** The notch nearest the value. */
  const at = nearestNotch(value, steps);
  /** To the notch at `i`, kept on the track (a screen reader's swipe up or down, or a key on the web). */
  const goTo = (i: number) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, i))]!;
    if (next !== value) land(next);
  };

  return (
    <View style={{ gap: layout.stack.tight }}>
      <View
        ref={track}
        onLayout={measure}
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        aria-valuetext={valueText}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => goTo(at + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
        {...(Platform.OS === "web" ? webSlider(at, steps.length, goTo) : null)}
        style={[{ height: 44, justifyContent: "center" }, Platform.OS === "web" ? ({ cursor: "grab", touchAction: "none", userSelect: "none" } as object) : null]}
      >
        <View style={{ height: 3, borderRadius: 1.5, backgroundColor: p.track }}>
          <View style={{ height: 3, borderRadius: 1.5, width: `${f * 100}%`, backgroundColor: p.accent }} />
        </View>
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: `${f * 100}%`, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.ink, boxShadow: shadow.thumb, transform: [{ scale: hold.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }} />
      </View>
      <View style={{ height: type.figure.lineHeight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {labels.map(({ cents, text }) => {
          const at = fractionOf(cents, steps);
          const edge = at <= 0.001 ? { left: 0 } : at >= 0.999 ? { right: 0 } : { left: `${at * 100}%` as const, width: LABEL_W, marginLeft: -LABEL_W / 2 };
          return (
            <Text key={`${cents}`} numberOfLines={1} style={[type.figure, { position: "absolute", top: 0, color: p.ink3, textAlign: at <= 0.001 ? "left" : at >= 0.999 ? "right" : "center" }, edge]}>
              {text}
            </Text>
          );
        })}
      </View>
    </View>
  );
}
