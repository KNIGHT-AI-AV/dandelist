import { Animated, Pressable, Text } from "react-native";
import { usePress } from "../lib/motion";
import { layout, type, usePalette } from "../lib/theme";
import { Icon } from "./lux";

/**
 * A wish card's word once it is on the list (owner, 2026-10-30: "say added to the list with a little arrow ... a
 * little color themed arrow, whatever theme they're on ... no border around it ... if they click it, it takes them to
 * that screen where they see the actual list"). Plain words and the arrow in the theme's accent, with no border or
 * fill; a tap turns to the list with the card in view, and the chat stays as it was for when they come back.
 */
export function AddedLine({ onPress }: { onPress?(): void }) {
  const p = usePalette();
  const press = usePress(0.97);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Added to your list"
      accessibilityHint="Shows it on your list"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={6}
      style={{ alignSelf: "flex-start" }}
    >
      <Animated.View style={{ minHeight: layout.control.icon, flexDirection: "row", alignItems: "center", gap: 8, transform: [{ scale: press.scale }] }}>
        <Text style={[type.label, { color: p.ink }]}>Added to your list</Text>
        <Icon name="arrow" size={18} color={p.accentText} />
      </Animated.View>
    </Pressable>
  );
}
