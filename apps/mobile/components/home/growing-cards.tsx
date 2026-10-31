import { recurringBreakdown } from "@dandelist/cost";
import { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, View, type AccessibilityActionEvent } from "react-native";
import { useMoney } from "../../lib/currency";
import { noteDrag } from "../../lib/drag-guard";
import { ease, haptic, native, spring, usePress, useReducedMotion } from "../../lib/motion";
import { layout, space, type, usePalette } from "../../lib/theme";
import type { Wish } from "../../lib/wishes";
import { TIER_LABEL, agentLine } from "../../lib/words";
import { isPriceless, priceWords } from "../../lib/worth";
import { swipeOutcome } from "../../lib/swipe-intent";
import type { Rect } from "../../lib/zoom";
import { AgentDot, Money, Photo, Shade } from "../lux";
import { savedGlyph } from "../worth";
import { cardRanges, listHeight, type CardGeometry } from "./card-metrics";
import { usePageSwipe } from "./pager";

/** A deliberate swipe past this share of the width removes the card (lib/swipe-intent.ts). */
const REMOVE_AT = 0.35;
const NO_SELECT = Platform.OS === "web" ? ({ userSelect: "none" } as object) : null;
/** The words over the photograph sit in this much of the card's foot. */
const FOOT = 150;

export interface CardHandlers {
  onOpen(w: Wish, at?: Rect): void;
  onQuick(w: Wish, at: Rect): void;
  onRemove(w: Wish): void;
}

interface CardProps extends CardHandlers {
  w: Wish;
  index: number;
  g: CardGeometry;
  scrollY: Animated.Value;
  listTop: number;
  focus: number;
  width: number;
  /** Arrived after the list first showed (a new wish, an undone removal): it fades in. */
  fresh: boolean;
}

/** What a screen reader says for a card. */
export function useCardLabel() {
  const money = useMoney();
  return (w: Wish) => `${w.name}, ${priceWords(w, money.format)}, ${TIER_LABEL[w.tier]}`;
}

function Card({ w, index, g, scrollY, listTop, focus, width, fresh, onOpen, onQuick, onRemove }: CardProps) {
  const p = usePalette();
  const money = useMoney();
  const label = useCardLabel();
  const reduced = useReducedMotion();
  const press = usePress(0.985);
  const tall = g.rest + g.grow;
  const pitch = g.rest + g.gap;
  const foot = Math.min(FOOT, g.rest);

  const ranges = useMemo(() => cardRanges(index, g, listTop, focus), [index, g, listTop, focus]);
  const open = useMemo(() => (reduced ? new Animated.Value(0) : scrollY.interpolate({ ...ranges.open, extrapolate: "clamp" })), [scrollY, ranges, reduced]);
  const push = useMemo(() => (reduced || !ranges.push ? 0 : scrollY.interpolate({ ...ranges.push, extrapolate: "clamp" })), [scrollY, ranges, reduced]);
  // The window: the full-height photograph squeezed by scaleY to the card's current height, the photograph inside
  // stretched back by the inverse, so it is cropped, never distorted. Its top edge stays put; it opens downward.
  const shape = useMemo(() => {
    const s = Animated.add(g.rest / tall, Animated.multiply(open, g.grow / tall));
    return { s, inverse: Animated.divide(1, s), top: Animated.multiply(Animated.add(open, -1), g.grow / 2), foot: Animated.add(g.rest - foot, Animated.multiply(open, g.grow)), middle: Animated.multiply(open, g.grow / 2) };
  }, [open, g, tall, foot]);

  // When cards above leave or come back, this one glides to its new slot from where it was.
  const shift = useRef(new Animated.Value(0)).current;
  const was = useRef(index);
  useEffect(() => {
    if (was.current === index) return;
    shift.setValue((was.current - index) * pitch);
    was.current = index;
    Animated.spring(shift, { toValue: 0, ...spring.settle, useNativeDriver: native }).start();
  }, [index, pitch, shift]);
  const enter = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  useEffect(() => {
    if (fresh) Animated.timing(enter, { toValue: 1, duration: 360, easing: ease.out, useNativeDriver: native }).start();
  }, [fresh, enter]);

  // Swipe either way to remove (owner, recording 03). The card follows the finger; let go past a third of the width
  // after a deliberate drag and it leaves, otherwise it springs home. A quick flick turns the page instead, and right
  // after the pages move the card leaves sideways drags to them (owner, 10-31: swiping between pages could throw a
  // wish away). Only clearly sideways drags are taken, so scrolling still works.
  const x = useRef(new Animated.Value(0)).current;
  const crossed = useRef(false);
  const startedAt = useRef(0);
  // A card still here a moment after it left was kept (removing asks first) or the removal failed: it comes back.
  const comeBack = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(comeBack.current), []);
  const pages = usePageSwipe();
  const latest = useRef({ w, onRemove, pages });
  latest.current = { w, onRemove, pages };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.6 && (latest.current.pages?.still() ?? true),
        onPanResponderGrant: () => {
          crossed.current = false;
          startedAt.current = Date.now();
          noteDrag();
        },
        onPanResponderMove: (_e, gs) => {
          noteDrag();
          x.setValue(gs.dx);
          const past = Math.abs(gs.dx) > width * REMOVE_AT;
          if (past !== crossed.current) {
            crossed.current = past;
            haptic.select();
          }
        },
        onPanResponderRelease: (_e, gs) => {
          noteDrag();
          const { pages: ring } = latest.current;
          const outcome = swipeOutcome({ dx: gs.dx, vx: gs.vx, width, removeAt: REMOVE_AT, ms: Date.now() - startedAt.current, pages: !!ring });
          if (outcome === "remove") {
            Animated.timing(x, { toValue: Math.sign(gs.dx || gs.vx) * width * 1.1, duration: 200, easing: ease.out, useNativeDriver: native }).start(() => {
              latest.current.onRemove(latest.current.w);
              comeBack.current = setTimeout(() => Animated.spring(x, { toValue: 0, ...spring.snap, useNativeDriver: native }).start(), 700);
            });
            return;
          }
          Animated.spring(x, { toValue: 0, ...spring.snap, useNativeDriver: native }).start();
          if (outcome === "page") ring?.turn(gs.dx > 0 ? 1 : -1);
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, ...spring.snap, useNativeDriver: native }).start(),
        onPanResponderTerminationRequest: () => false,
      }),
    [width, x],
  );

  const windowRef = useRef<View>(null);
  const measure = (then: (at?: Rect) => void) => {
    if (!windowRef.current) return then();
    windowRef.current.measureInWindow((mx, my, mw, mh) => then({ x: mx, y: my, width: mw, height: mh }));
  };
  const quick = () => measure((at) => at && onQuick(w, at));
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "remove") onRemove(w);
    else if (e.nativeEvent.actionName === "longpress") quick();
  };
  const web = Platform.OS === "web" ? { onContextMenu: (e: { preventDefault(): void }) => (e.preventDefault(), quick()) } : null;
  const monthly = recurringBreakdown([w.item]).perMonth;
  const reveal = (side: 1 | -1) => x.interpolate({ inputRange: side > 0 ? [0, 60] : [-60, 0], outputRange: side > 0 ? [0, 1] : [1, 0], extrapolate: "clamp" });

  return (
    // On the web a slow drag would start selecting the card's words, and a selection ends the gesture; cards don't select.
    <Animated.View style={[{ position: "absolute", top: index * pitch, left: 0, right: 0, height: tall, opacity: enter, transform: [{ translateY: shift }, { translateY: push }] }, NO_SELECT]}>
      {/* Under the card: the word that says what letting go will do, on the side the card is leaving. */}
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: tall, backgroundColor: p.surface, transform: [{ translateY: shape.top }, { scaleY: shape.s }] }} />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: g.rest, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: layout.cardPad, transform: [{ translateY: shape.middle }] }}>
        <Animated.Text style={[type.label, { color: p.danger, opacity: reveal(1) }]}>Remove</Animated.Text>
        <Animated.Text style={[type.label, { color: p.danger, opacity: reveal(-1) }]}>Remove</Animated.Text>
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ flex: 1, transform: [{ translateX: x }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label(w)}
          accessibilityActions={[{ name: "remove", label: "Remove" }, ...(Platform.OS === "android" ? [{ name: "longpress" }] : [])]}
          onAccessibilityAction={onAction}
          onPress={() => measure((at) => onOpen(w, at))}
          onLongPress={quick}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          style={{ flex: 1 }}
          {...web}
        >
          <Animated.View style={{ flex: 1, transform: [{ scale: press.scale }] }}>
            <Animated.View ref={windowRef} collapsable={false} style={{ height: tall, overflow: "hidden", transform: [{ translateY: shape.top }, { scaleY: shape.s }] }}>
              <Animated.View style={{ flex: 1, transform: [{ scaleY: shape.inverse }] }}>
                <Photo uri={w.details.agent?.imageUrl} glyph={savedGlyph(w, money.symbol)} />
              </Animated.View>
            </Animated.View>
            <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: foot, transform: [{ translateY: shape.foot }] }}>
              <Shade from={0.05} />
              <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: layout.cardPad, gap: layout.stack.tight }}>
                <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
                  {w.name}
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[12] }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[8], flexShrink: 1 }}>
                    {w.details.agent ? <AgentDot /> : null}
                    <Text style={[type.footnote, { color: p.ink2, flexShrink: 1 }]} numberOfLines={1}>
                      {monthly ? `${agentLine(w)} · + ${money.format(monthly)}/mo` : agentLine(w)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[type.figure, { color: p.ink3, textTransform: "uppercase" }]}>{TIER_LABEL[w.tier]}</Text>
                    <Money cents={w.item.upfrontCents} priceless={isPriceless(w)} size="card" />
                  </View>
                </View>
              </View>
            </Animated.View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The wishes as full-width photographs, edge to edge, the one at the focus line opened up (owner, recording 03).
 * `scrollY` is the list's scroll offset on the native driver; `listTop` where the cards start in the scroll content;
 * `focus` the focus line's distance from the top of the visible area.
 */
export function GrowingCards({ wishes, g, scrollY, listTop, focus, width, ...handlers }: { wishes: Wish[]; g: CardGeometry; scrollY: Animated.Value; listTop: number; focus: number; width: number } & CardHandlers) {
  // Cards on screen when the list first showed don't fade in; any that arrive later do.
  const first = useRef<Set<string> | null>(null);
  if (first.current === null && wishes.length) first.current = new Set(wishes.map((w) => w.id));
  return (
    <View style={{ height: listHeight(wishes.length, g), width: "100%" }}>
      {wishes.map((w, i) => (
        <Card key={w.id} w={w} index={i} g={g} scrollY={scrollY} listTop={listTop} focus={focus} width={width} fresh={!first.current?.has(w.id)} {...handlers} />
      ))}
    </View>
  );
}

