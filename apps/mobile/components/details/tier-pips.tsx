import { View, type StyleProp, type ViewStyle } from "react-native";
import { usePalette } from "../../lib/theme";
import type { WishTier } from "../../lib/wishes";
import { TIER_LABEL, TIER_RANK } from "../../lib/words";

/** Filled pips per tier: Must have ●●●, Would love ●●○, Someday ●○○. */
export const TIER_PIPS: Record<WishTier, 1 | 2 | 3> = { must: 3, nice: 2, dream: 1 };

/**
 * How much a wish is wanted, as a small three-pip scale that reads in order (owner, recording 03: a "clear scale").
 * Filled pips take `color` (the ink by default); empty ones are an outline of the same colour, so the mark reads in
 * every theme, light ones included. It is decoration beside the tier's name, so screen readers skip it unless
 * `label` is true, when it says the tier and its place on the scale.
 */
export function TierPips({ tier, size = 6, gap = 3, color, label = false, style }: { tier: WishTier; size?: number; gap?: number; color?: string; label?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const ink = color ?? p.ink;
  const filled = TIER_PIPS[tier];
  return (
    <View
      accessible={label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label ? `${TIER_LABEL[tier]}, ${4 - TIER_RANK[tier]} of 3` : undefined}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      accessibilityElementsHidden={!label}
      style={[{ flexDirection: "row", alignItems: "center", gap }, style]}
    >
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: n <= filled ? 0 : Math.max(1, size / 6),
            borderColor: ink,
            backgroundColor: n <= filled ? ink : "transparent",
            opacity: n <= filled ? 1 : 0.55,
          }}
        />
      ))}
    </View>
  );
}
