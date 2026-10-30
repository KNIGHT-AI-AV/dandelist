import { Animated, Pressable, Text, View } from "react-native";
import { useMoney } from "../../lib/currency";
import { usePress } from "../../lib/motion";
import { radius, space, type, usePalette, useType } from "../../lib/theme";
import type { Wish } from "../../lib/wishes";
import { TIER_LABEL } from "../../lib/words";
import { isPriceless, priceWords } from "../../lib/worth";
import { Money, Photo } from "../lux";
import { savedGlyph } from "../worth";
import { SwipeToRemove } from "../list/swipe-remove";
import { TierPips } from "./tier-pips";

/** The picture's side, in px. */
export const THUMB = 48;

/**
 * One wish in the condensed list: a small picture, the name, the tier on its scale, and the price. Tap opens the
 * wish; swipe either way removes it (the page runs the undo).
 */
export function DetailRow({ w, onOpen, onRemove }: { w: Wish; onOpen(w: Wish): void; onRemove(w: Wish): void }) {
  const p = usePalette();
  const t = useType();
  const money = useMoney();
  const press = usePress(0.985);
  return (
    <SwipeToRemove onRemove={() => onRemove(w)} style={{ borderRadius: radius.sm, borderCurve: "continuous" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${w.name}, ${TIER_LABEL[w.tier]}, ${priceWords(w, money.format)}`}
        accessibilityHint="Opens the wish"
        onPress={() => onOpen(w)}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      >
        <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: space[12], paddingVertical: space[12], transform: [{ scale: press.scale }] }}>
          <View style={{ width: THUMB, height: THUMB, borderRadius: radius.sm, borderCurve: "continuous", overflow: "hidden", backgroundColor: p.track }}>
            <Photo uri={w.details.agent?.imageUrl} glyph={savedGlyph(w, money.symbol)} />
          </View>
          <View style={{ flex: 1, gap: space[4] }}>
            <Text style={[t.title3, { color: p.ink }]} numberOfLines={1}>
              {w.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
              <TierPips tier={w.tier} size={5} color={p.ink3} />
              <Text style={[type.figure, { color: p.ink3 }]} numberOfLines={1}>
                {TIER_LABEL[w.tier]}
              </Text>
            </View>
          </View>
          <Money cents={w.item.upfrontCents} priceless={isPriceless(w)} size="ledger15" color={p.ink} align="right" />
        </Animated.View>
      </Pressable>
    </SwipeToRemove>
  );
}
