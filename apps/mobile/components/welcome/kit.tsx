import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { ease, native, spring, useReducedMotion } from "../../lib/motion";
import { fonts, radius, usePalette } from "../../lib/theme";
import { meterFraction } from "../../lib/welcome";
import { Eyebrow, Glass } from "../lux";
import { Odometer } from "../odometer";

/** Money figures roll as an odometer everywhere; see components/odometer.tsx. */
export const RollingNumber = Odometer;


/** The Life meter: a frosted pill with the running total and a champagne fill on a log scale ($1k to $1M). */
export function LifePill({ cents, label = "Your life so far", style, onLayoutRef }: { cents: number; label?: string; style?: StyleProp<ViewStyle>; onLayoutRef?: (v: View | null) => void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(meterFraction(cents))).current;
  useEffect(() => {
    if (reduced) fill.setValue(meterFraction(cents));
    else Animated.spring(fill, { toValue: meterFraction(cents), ...spring.meter, useNativeDriver: false }).start();
  }, [cents, reduced, fill]);
  const dollars = `$${Math.round(cents / 100).toLocaleString("en-US")}`;
  return (
    <View ref={onLayoutRef} collapsable={false} style={style}>
      <Glass intensity={60} style={{ borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10, gap: 7 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>{label}</Eyebrow>
          <RollingNumber value={dollars} size={17} />
        </View>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: p.track, overflow: "hidden" }}>
          <Animated.View style={{ height: 3, backgroundColor: p.accent, width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
          {[1 / 3, 2 / 3].map((t) => (
            <View key={t} style={{ position: "absolute", left: `${t * 100}%`, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: `rgba(${p.inkRgb}, 0.35)` }} />
          ))}
        </View>
      </Glass>
    </View>
  );
}

/** Hairline progress segments; each fills with ease.out when its step is done. */
export function Segments({ count, done }: { count: number; done: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: count, now: done }}>
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

/** Content enters with a 12 px rise and a fade (300 ms, ease.out); `delay` staggers blocks. */
export function Rise({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 200 : 340, delay: reduced ? 0 : delay, easing: ease.out, useNativeDriver: native }).start();
  }, [v, delay, reduced]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 12, 0] }) }] }, style]}>{children}</Animated.View>;
}

/** A tap-to-answer chip. */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 18,
        justifyContent: "center",
        borderRadius: radius.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? p.ink : p.hair,
        backgroundColor: selected ? p.ink : pressed ? `rgba(${p.inkRgb}, 0.08)` : p.glassTint,
      })}
    >
      <Text style={{ fontFamily: fonts.label, fontSize: 14, color: selected ? p.onAccent : p.ink }}>{label}</Text>
    </Pressable>
  );
}
