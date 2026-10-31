import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { layout, radius, shadow, space, type, usePalette } from "../../lib/theme";
import { Glass } from "../lux";
import { choreo } from "./choreo";
import { SCRIM } from "./metrics";
import { rgbOf } from "./swipe-remove";

/**
 * Asks before a wish is removed (owner, 2026-10-31): a sheet at the foot of the screen, in reach of the thumb, with
 * its own Remove button, so a swipe alone never removes anything. Keep it, a tap outside, Escape or Android's back
 * keep the wish. `name` is the wish being asked about, or null when nothing is.
 */
export function ConfirmRemove({ name, onRemove, onKeep }: { name: string | null; onRemove(): void; onKeep(): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // The name stays on the sheet while it leaves.
  const [shown, setShown] = useState<string | null>(name);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (name) {
      setShown(name);
      haptic.select();
      (reduced
        ? Animated.timing(v, { toValue: 1, duration: choreo.outMs, easing: ease.out, useNativeDriver: native })
        : Animated.spring(v, { toValue: 1, ...spring.snap, useNativeDriver: native })
      ).start();
      return;
    }
    Animated.timing(v, { toValue: 0, duration: choreo.outMs, easing: ease.out, useNativeDriver: native }).start(({ finished }) => finished && setShown(null));
  }, [name, reduced, v]);
  if (!shown) return null;

  const gutter = layout.gutter(width);
  const tint = `rgba(${rgbOf(p.danger)}, ${p.scheme === "dark" ? 0.18 : 0.12})`;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onKeep} accessibilityLabel={`Remove ${shown}?`}>
      <View style={StyleSheet.absoluteFill} onAccessibilityEscape={onKeep}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: v, backgroundColor: `rgba(${p.bgRgb}, ${SCRIM})` }]}>
          <Pressable aria-hidden focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onKeep} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            left: gutter,
            right: gutter,
            bottom: insets.bottom + space[16],
            alignItems: "center",
            opacity: v,
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : space[24], 0] }) }],
          }}
        >
          <Glass tint={p.sheet} style={{ width: "100%", maxWidth: layout.column, borderRadius: radius.lg, borderCurve: "continuous", padding: space[20], gap: space[16], boxShadow: shadow.card }}>
            <View style={{ gap: space[4] }}>
              <Text accessibilityRole="header" style={[type.title3, { color: p.ink }]}>{`Remove ${shown}?`}</Text>
              <Text style={[type.footnote, { color: p.ink2 }]}>For two minutes after this, removing won't ask again.</Text>
            </View>
            <View style={{ gap: space[8] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${shown}`}
                onPress={onRemove}
                style={({ pressed }) => ({ minHeight: layout.control.primary, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: tint, opacity: pressed ? 0.75 : 1 })}
              >
                <Text style={[type.label, { color: p.danger }]}>Remove</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keep it"
                onPress={onKeep}
                style={({ pressed }) => ({ minHeight: layout.control.chip, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? p.track : "transparent" })}
              >
                <Text style={[type.label, { color: p.ink }]}>Keep it</Text>
              </Pressable>
            </View>
          </Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}
