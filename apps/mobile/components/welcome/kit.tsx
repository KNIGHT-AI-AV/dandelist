import { useEffect, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle, type LayoutChangeEvent } from "react-native";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { radius, usePalette } from "../../lib/theme";
import { meterFraction } from "../../lib/welcome";
import { Chip, Eyebrow, Glass } from "../lux";
import { Odometer, dollars } from "../odometer";

export { Chip };

/**
 * The Life meter: a frosted pill with the running total and a champagne fill on a log scale ($1k to $1M). The total
 * rolls in `ui` mode, warms to the accent on an increase, ticks once when it lands after a vote, and is announced
 * to screen readers.
 */
export function LifePill({ cents, label = "Your life so far", style, onLayoutRef }: { cents: number; label?: string; style?: StyleProp<ViewStyle>; onLayoutRef?: (v: View | null) => void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(meterFraction(cents))).current;
  useEffect(() => {
    if (reduced) fill.setValue(meterFraction(cents));
    else Animated.spring(fill, { toValue: meterFraction(cents), ...spring.meter, useNativeDriver: false }).start();
  }, [cents, reduced, fill]);
  return (
    <View ref={onLayoutRef} collapsable={false} style={style}>
      <Glass intensity={60} style={{ borderRadius: radius.pill, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 24 }}>
          <Eyebrow>{label}</Eyebrow>
          <Odometer cents={cents} format={dollars} size={20} family="bodoni" align="right" pulse live onLand={haptic.quietSelect} announce={(v) => `${label}, ${v}`} />
        </View>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: p.track, overflow: "hidden" }}>
          <Animated.View style={{ height: 3, backgroundColor: p.accent, width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
          {[1 / 3, 2 / 3].map((t) => (
            <View key={t} style={{ position: "absolute", left: `${t * 100}%`, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: p.ink4 }} />
          ))}
        </View>
      </Glass>
    </View>
  );
}

/** Hairline progress segments; each fills with ease.out when its step is done. */
export function Segments({ count, done, style }: { count: number; done: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", gap: 4 }, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: count, now: done }}>
      {Array.from({ length: count }, (_, i) => (
        <Segment key={i} on={i < done} />
      ))}
    </View>
  );
}

function Segment({ on }: { on: boolean }) {
  const p = usePalette();
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: 400, easing: ease.out, useNativeDriver: false }).start();
  }, [on, v]);
  return (
    <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: p.track, overflow: "hidden" }}>
      <Animated.View style={{ height: 2, backgroundColor: p.ink, width: v.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
}

/** Content enters with an 8 px rise and a fade (320 ms, ease.out); `delay` staggers blocks 50 ms apart. */
export function Rise({ children, delay = 0, style, onLayout }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 200 : 320, delay: reduced ? 0 : delay, easing: ease.out, useNativeDriver: native }).start();
  }, [v, delay, reduced]);
  return <Animated.View onLayout={onLayout} style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 8, 0] }) }] }, style]}>{children}</Animated.View>;
}
