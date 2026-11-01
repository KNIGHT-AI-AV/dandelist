import { recurringBreakdown } from "@dandelist/cost";
import { Image } from "expo-image";
import { useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from "react-native";
import { AgentDot, Money, Photo, Shade } from "../lux";
import { savedGlyph } from "../worth";
import { useMoney } from "../../lib/currency";
import { formatCents } from "../../lib/money";
import { usePress } from "../../lib/motion";
import { usePhotoLoad } from "../../lib/photo-load";
import { layout, radius, space, type, usePalette } from "../../lib/theme";
import type { Wish } from "../../lib/wishes";
import { TIER_LABEL, agentLine } from "../../lib/words";
import { isPriceless, priceWords } from "../../lib/worth";
import type { Rect } from "../../lib/zoom";
import { Swap } from "./presence";

/** What a screen reader says for a card, and for its lifted copy in the action sheet. */
export function cardLabel(w: Wish): string {
  return `${w.name}, ${priceWords(w, formatCents)}`;
}

/**
 * The photograph shown without the list's cross-dissolve. The action sheet lays a copy of the card exactly over the
 * card itself; a fade from the empty gradient there would flash. With no photo it is the same quiet gradient, or the
 * same glyph panel as the card.
 */
function StillPhoto({ uri, glyph }: { uri?: string; glyph?: string }) {
  const load = usePhotoLoad(uri);
  if (!uri || !load.show) return <Photo glyph={glyph} />;
  return <Image key={load.tries} source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" onError={load.onError} accessibilityIgnoresInvertColors />;
}

/** The inside of a wish card: photo, shade, name, the agent's line, tier and price. Fills its parent. */
export function WishFace({ w, still = false }: { w: Wish; still?: boolean }) {
  const p = usePalette();
  const money = useMoney();
  const monthly = recurringBreakdown([w.item]).perMonth;
  const uri = w.details.agent?.imageUrl;
  const glyph = savedGlyph(w, money.symbol);
  return (
    <>
      {still ? <StillPhoto uri={uri} glyph={glyph} /> : <Photo uri={uri} glyph={glyph} />}
      <Shade from={0.25} />
      <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: layout.cardPad, gap: layout.stack.tight }}>
        <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
          {w.name}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[12] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[8], flexShrink: 1 }}>
            {w.details.agent ? <AgentDot /> : null}
            <Text style={[type.footnote, { color: p.ink2, flexShrink: 1 }]} numberOfLines={1}>
              {monthly ? `${agentLine(w)} · + ${formatCents(monthly)}/mo` : agentLine(w)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[8] }}>
            <Swap k={w.tier}>
              <Text style={[type.figure, { color: p.ink2, textTransform: "uppercase" }]}>{TIER_LABEL[w.tier]}</Text>
            </Swap>
            <Money cents={w.item.upfrontCents} priceless={isPriceless(w)} size="card" />
          </View>
        </View>
      </View>
    </>
  );
}

/** Screen-reader actions on a card: Remove straight from the rotor, and long press on Android's actions menu. */
const ACTIONS = [{ name: "remove", label: "Remove" }, ...(Platform.OS === "android" ? [{ name: "longpress" }] : [])];

/**
 * A wish on the list. Tap opens it (the detail zooms out of the card); a long press, right-click or the keyboard's
 * context-menu key opens its quick actions, anchored to where the card sits.
 */
export function WishCard({ w, hidden, onOpen, onQuick, onRemove }: { w: Wish; hidden: boolean; onOpen(w: Wish, at?: Rect): void; onQuick(w: Wish, at: Rect): void; onRemove(w: Wish): void }) {
  const press = usePress();
  const ref = useRef<View>(null);
  const measure = (then: (at?: Rect) => void) => {
    if (!ref.current) return then();
    ref.current.measureInWindow((x, y, width, height) => then({ x, y, width, height }));
  };
  const quick = () => measure((at) => at && onQuick(w, at));
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "remove") onRemove(w);
    else if (e.nativeEvent.actionName === "longpress") quick();
  };
  // The web's context menu (right-click, Shift+F10, the menu key) opens the same sheet a long press does.
  const web = Platform.OS === "web" ? { onContextMenu: (e: { preventDefault(): void }) => (e.preventDefault(), quick()) } : null;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={cardLabel(w)}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAction}
      focusable={!hidden}
      onPress={() => measure((at) => onOpen(w, at))}
      onLongPress={quick}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      collapsable={false}
      style={{ flex: 1 }}
      {...web}
    >
      <Animated.View style={{ flex: 1, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", transform: [{ scale: press.scale }] }}>
        <WishFace w={w} />
      </Animated.View>
    </Pressable>
  );
}
