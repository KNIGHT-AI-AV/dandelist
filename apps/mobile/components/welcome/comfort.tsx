import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Text, View, useWindowDimensions } from "react-native";
import { INCOME_STEPS, fractionOf, incomeAt, stageOf } from "../../lib/comfort";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { fonts, layout, shadow, type, usePalette, useType } from "../../lib/theme";
import { tick } from "../../lib/tick";
import { formatCents } from "../../lib/money";
import { Eyebrow, PrimaryButton } from "../lux";
import { Odometer, dollars } from "../odometer";
import { Rise } from "./kit";

/** Five white line drawings (Desktop\Dandelist Design\faces, made with image_gen), tinted to the theme's ink. */
const FACES = [
  require("../../assets/faces/1-devastated.png"),
  require("../../assets/faces/2-uneasy.png"),
  require("../../assets/faces/3-content.png"),
  require("../../assets/faces/4-overjoyed.png"),
  require("../../assets/faces/5-pompous.png"),
];
const FACE = 112;
const THUMB = 30;
/** The face change: the old one sinks back and softens while the new one settles in from a touch larger. */
const SWAP_MS = 520;

/**
 * The face, with a luxury change between stages (owner: "not fade... a luxury transition"): the outgoing drawing
 * shrinks a little and blurs away while the incoming one settles from slightly larger on a spring, and a thin
 * champagne ring opens behind them and dissolves, like a lens focusing on the new expression.
 */
function Face({ index }: { index: number }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState({ now: index, was: index });
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (index === shown.now) return;
    setShown({ now: index, was: shown.now });
    v.setValue(0);
    if (reduced) return v.setValue(1);
    Animated.timing(v, { toValue: 1, duration: SWAP_MS, easing: ease.inOut, useNativeDriver: native }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const blurOut = Platform.OS === "web" ? ({ filter: v.interpolate({ inputRange: [0, 1], outputRange: ["blur(0px)", "blur(6px)"] }) } as object) : null;
  return (
    <View style={{ width: FACE, height: FACE, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", width: FACE, height: FACE, borderRadius: FACE / 2, borderWidth: 1, borderColor: p.accent, opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.35] }) }] }}
      />
      {shown.was !== shown.now ? (
        <Animated.View style={[{ position: "absolute", width: FACE, height: FACE, opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) }] }, blurOut]}>
          <Image source={FACES[shown.was]} style={{ width: FACE, height: FACE }} tintColor={p.ink} contentFit="contain" />
        </Animated.View>
      ) : null}
      <Animated.View style={{ width: FACE, height: FACE, opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.2, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.1, 1] }) }] }}>
        <Image source={FACES[shown.now]} style={{ width: FACE, height: FACE }} tintColor={p.ink} contentFit="contain" />
      </Animated.View>
    </View>
  );
}

/**
 * "What would it take?" The fader runs from $10,000 to $100 million a year on round notches; each notch ticks (a
 * haptic on phones, a soft click on the web) and the figure rolls up to it and slows, like a counter catching up. The
 * face and the line beneath say how comfortably that income carries the whole list. No dates and no budgets: this is
 * a wish list, not a savings plan.
 */
export function Comfort({ incomeCents, totalCents, onChange, onDone }: { incomeCents: number; totalCents: number; onChange(cents: number): void; onDone(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = layout.gutter(width);
  const track = useRef<View>(null);
  const box = useRef({ x: 0, w: 1 });
  const hold = useRef(new Animated.Value(0)).current;
  const last = useRef(incomeCents);
  const stage = stageOf(incomeCents, totalCents);
  const lastStage = useRef(stage.index);
  const f = fractionOf(incomeCents);

  const measure = () => track.current?.measureInWindow((x, _y, w) => (box.current = { x, w: Math.max(1, w) }));
  // The responder is made once; it reaches the latest props through this ref.
  const act = useRef({ setFromPage: (_pageX: number) => {} });
  act.current.setFromPage = (pageX: number) => {
    const c = incomeAt((pageX - box.current.x) / box.current.w);
    if (c === last.current) return;
    last.current = c;
    tick();
    const s = stageOf(c, totalCents).index;
    if (s !== lastStage.current) {
      lastStage.current = s;
      haptic.soft();
    } else haptic.select();
    onChange(c);
  };
  // Positions come from the page, not the touched element, so the thumb follows the finger both ways from anywhere
  // on the track (the old slider read the child under the finger and stuck).
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        measure();
        Animated.spring(hold, { toValue: 1, ...spring.press, useNativeDriver: native }).start();
        act.current.setFromPage(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => act.current.setFromPage(e.nativeEvent.pageX),
      onPanResponderRelease: () => Animated.spring(hold, { toValue: 0, ...spring.press, useNativeDriver: native }).start(),
      onPanResponderTerminate: () => Animated.spring(hold, { toValue: 0, ...spring.press, useNativeDriver: native }).start(),
    }),
  ).current;

  const step = (dir: 1 | -1) => {
    const i = INCOME_STEPS.indexOf(incomeCents);
    const next = INCOME_STEPS[Math.max(0, Math.min(INCOME_STEPS.length - 1, (i < 0 ? 0 : i) + dir))]!;
    last.current = next;
    tick();
    haptic.select();
    onChange(next);
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: gutter, paddingBottom: layout.stack.base, gap: layout.stack.base + layout.stack.tight, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: layout.stack.tight, alignItems: "center" }}>
        <Eyebrow>What it would take</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]}>
          How would all this <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>feel</Text>?
        </Text>
        <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>Slide to a year's income and see how comfortably it carries everything on your list.</Text>
      </Rise>
      <Rise delay={60} style={{ alignItems: "center", gap: layout.stack.tight }}>
        <Face index={stage.index} />
        <View style={{ alignItems: "center", gap: 2 }}>
          <Odometer cents={incomeCents} format={dollars} size={52} family="bodoni" smallPrefix tracking={-1.04} mode={reduced ? "instant" : "ui"} />
          <Text style={[type.figure, { color: p.ink3 }]}>a year</Text>
        </View>
        <Text accessibilityLiveRegion="polite" style={[type.title3, { fontFamily: fonts.titleItalic, color: p.accentText, textAlign: "center" }]}>{stage.line}</Text>
      </Rise>
      <Rise delay={120} style={{ gap: layout.stack.tight }}>
        <View
          ref={track}
          onLayout={measure}
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Income a year"
          accessibilityValue={{ text: `${formatCents(incomeCents)} a year. ${stage.line}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
          style={[{ height: 44, justifyContent: "center" }, Platform.OS === "web" ? ({ cursor: "grab", touchAction: "none", userSelect: "none" } as object) : null]}
        >
          <View style={{ height: 3, borderRadius: 1.5, backgroundColor: p.track }}>
            <View style={{ height: 3, borderRadius: 1.5, width: `${f * 100}%`, backgroundColor: p.accent }} />
          </View>
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: `${f * 100}%`, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.ink, boxShadow: shadow.thumb, transform: [{ scale: hold.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[type.figure, { color: p.ink3 }]}>$10K</Text>
          <Text style={[type.figure, { color: p.ink3 }]}>$100M</Text>
        </View>
      </Rise>
      <Rise delay={160}>
        <PrimaryButton label="Show me my list" onPress={onDone} />
      </Rise>
    </View>
  );
}
