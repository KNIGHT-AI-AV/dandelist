import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { layout, space, type, usePalette } from "../../lib/theme";
import type { WishTier } from "../../lib/wishes";
import { TIER_LABEL } from "../../lib/words";
import { choreo } from "./choreo";
import { SHEET_INNER_RADIUS } from "./metrics";

const TIERS: WishTier[] = ["must", "nice", "dream"];
/** The ink thumb sits this far inside the track. */
const THUMB_INSET = space[4];
/** Nested radii: the thumb's corner is the track's corner less the inset. */
const THUMB_RADIUS = SHEET_INNER_RADIUS - THUMB_INSET;

/**
 * Must / Nice / Dream as one segmented control: the ink thumb springs to the chosen tier and the labels change
 * colour as it passes, with a selection tick. Under reduced motion the thumb cross-fades to its new place.
 */
export function TierControl({ value, onChange }: { value: WishTier; onChange(tier: WishTier): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = TIERS.indexOf(value);
  const pos = useRef(new Animated.Value(index)).current;
  const thumb = useRef(new Animated.Value(1)).current;
  const shown = useRef(index);

  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    if (!reduced) {
      Animated.spring(pos, { toValue: index, ...spring.snap, useNativeDriver: native }).start();
      return;
    }
    const half = choreo.outMs / 2;
    Animated.sequence([
      Animated.timing(thumb, { toValue: 0, duration: half, easing: ease.out, useNativeDriver: native }),
      Animated.timing(pos, { toValue: index, duration: 0, useNativeDriver: native }),
      Animated.timing(thumb, { toValue: 1, duration: half, easing: ease.out, useNativeDriver: native }),
    ]).start();
  }, [index, reduced, pos, thumb]);

  const segment = width ? (width - 2 * THUMB_INSET) / TIERS.length : 0;
  return (
    <View
      accessibilityRole="radiogroup"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: layout.control.chip, padding: THUMB_INSET, flexDirection: "row", borderRadius: SHEET_INNER_RADIUS, borderCurve: "continuous", backgroundColor: p.track }}
    >
      {segment ? (
        <Animated.View
          style={{
            position: "absolute",
            top: THUMB_INSET,
            bottom: THUMB_INSET,
            left: THUMB_INSET,
            width: segment,
            borderRadius: THUMB_RADIUS,
            borderCurve: "continuous",
            backgroundColor: p.ink,
            opacity: thumb,
            transform: [{ translateX: pos.interpolate({ inputRange: [0, TIERS.length - 1], outputRange: [0, segment * (TIERS.length - 1)] }) }],
          }}
        />
      ) : null}
      {TIERS.map((t, i) => {
        const on = pos.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: "clamp" });
        return (
          <Pressable
            key={t}
            accessibilityRole="radio"
            accessibilityLabel={TIER_LABEL[t]}
            accessibilityState={{ checked: t === value }}
            onPress={() => {
              if (t === value) return;
              haptic.select();
              onChange(t);
            }}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Animated.Text style={[type.label, { color: p.ink, opacity: on.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]} numberOfLines={1}>
              {TIER_LABEL[t]}
            </Animated.Text>
            <Animated.Text aria-hidden style={[type.label, { position: "absolute", color: p.onAccent, opacity: on }]} numberOfLines={1}>
              {TIER_LABEL[t]}
            </Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}
