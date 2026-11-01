import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Text, View, useWindowDimensions } from "react-native";
import { fullRange, incomeSteps, stageOf } from "../../lib/comfort";
import { CURRENCIES, useMoney } from "../../lib/currency";
import { symbolOf } from "../../lib/fx";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { fonts, layout, type, usePalette, useType } from "../../lib/theme";
import { Fader, faderJustMoved } from "../fader";
import { Chip, Eyebrow, PrimaryButton } from "../lux";
import { Odometer } from "../odometer";
import { ComfortLine } from "./comfort-line";
import { Rise } from "./kit";

/**
 * Six white line drawings (Desktop\Dandelist Design\faces, made with image_gen), tinted to the theme's ink, in the
 * owner's order: horrid, upset, normal, smile, big smile, ritzy rich.
 */
const FACES = [
  require("../../assets/faces/1-devastated.png"),
  require("../../assets/faces/2-uneasy.png"),
  require("../../assets/faces/2b-normal.png"),
  require("../../assets/faces/3-content.png"),
  require("../../assets/faces/4-overjoyed.png"),
  require("../../assets/faces/5-pompous.png"),
];
/** The face change: the old one sinks back and softens while the new one settles in from a touch larger. */
const SWAP_MS = 520;

/**
 * The face, with a luxury change between stages (owner: "not fade... a luxury transition"): the outgoing drawing
 * shrinks a little and blurs away while the incoming one settles from slightly larger on a spring, and a thin
 * champagne ring opens behind them and dissolves, like a lens focusing on the new expression.
 */
function Face({ index, size: FACE = 112 }: { index: number; size?: number }) {
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
          <Image source={FACES[shown.was]} accessibilityLabel="" style={{ width: FACE, height: FACE }} tintColor={p.ink} contentFit="contain" />
        </Animated.View>
      ) : null}
      <Animated.View style={{ width: FACE, height: FACE, opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.2, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.1, 1] }) }] }}>
        <Image source={FACES[shown.now]} accessibilityLabel="" style={{ width: FACE, height: FACE }} tintColor={p.ink} contentFit="contain" />
      </Animated.View>
    </View>
  );
}

/**
 * The five currencies as a quiet row of chips (owner, recording 03: "selectable in the onboarding money fader and in
 * settings"). Choosing one re-prices every figure in the app, so a tap that lands just after the fader above was
 * dragged doesn't count, and the row sits a little apart from the fader's figures.
 */
export function CurrencyChips() {
  const money = useMoney();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Currency" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: layout.stack.base }}>
      {CURRENCIES.map((c) => (
        <Chip key={c.code} label={`${symbolOf(c.code)} ${c.code}`} selected={money.code === c.code} onPress={() => !faderJustMoved() && money.choose(c.code)} />
      ))}
    </View>
  );
}

/**
 * The income fader: a face, the income rolling on the odometer, the line saying how comfortably it carries the list,
 * and the track. Notches are round numbers in the chosen currency; each one ticks (a haptic on phones, a soft click
 * on the web). The welcome's "What would it take?" and the money page both use it. `needCents` is the income the
 * list needs to be comfortable (lib/comfort.ts needOf).
 */
export function IncomeFader({ incomeCents, needCents, onChange, size = 52, compact = false }: { incomeCents: number; needCents: number; onChange(cents: number): void; size?: number; compact?: boolean }) {
  const p = usePalette();
  const money = useMoney();
  const reduced = useReducedMotion();
  // The far left always reads horrid and the far right ritzy, however small or large the list.
  const steps = useMemo(() => incomeSteps(money.rate, money.unit, fullRange(needCents)), [money.rate, money.unit, needCents]);
  const stage = stageOf(incomeCents, needCents);
  // A new face lands with the firmer haptic.
  const newFace = (from: number, to: number) => stageOf(from, needCents).index !== stageOf(to, needCents).index;

  const figure = <Odometer cents={incomeCents} format={money.format} size={size} family="bodoni" smallPrefix tracking={-0.02 * size} mode={reduced ? "instant" : "ui"} />;
  const line = <ComfortLine line={stage.line} compact={compact} />;
  return (
    <View style={{ gap: compact ? layout.stack.tight : layout.stack.base + layout.stack.tight }}>
      {compact ? (
        // The intro card's form: the face beside the figure and its line, so it fits the card's foot.
        <View style={{ flexDirection: "row", alignItems: "center", gap: layout.stack.base }}>
          <Face index={stage.index} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              {figure}
              <Text style={[type.figure, { color: p.ink3 }]}>a year</Text>
            </View>
            {line}
          </View>
        </View>
      ) : (
        <View style={{ alignItems: "center", gap: layout.stack.tight }}>
          <Face index={stage.index} />
          <View style={{ alignItems: "center", gap: 2 }}>
            {figure}
            <Text style={[type.figure, { color: p.ink3 }]}>a year</Text>
          </View>
          {line}
        </View>
      )}
      <Fader
        value={incomeCents}
        steps={steps}
        onChange={onChange}
        label="Income a year"
        // The line under the figure speaks for itself where a live region does (Android, the web); iOS has none, so
        // there the slider says it too. Said once either way.
        valueText={Platform.OS === "ios" ? `${money.format(incomeCents)} a year. ${stage.line}` : `${money.format(incomeCents)} a year`}
        labels={[steps[0]!, steps[steps.length - 1]!].map((c) => ({ cents: c, text: money.compact(c) }))}
        firm={newFace}
      />
      {compact ? null : <CurrencyChips />}
    </View>
  );
}

/**
 * "What would it take?" No dates and no budgets: this is a wish list, not a savings plan. The fader runs from 10,000
 * to 100 million a year in the chosen currency, and the face and the line say how comfortably that income carries
 * the whole list. `note` says what the list leaves out of its total (a priceless wish).
 */
export function Comfort({ incomeCents, needCents, note, onChange, onDone }: { incomeCents: number; needCents: number; note?: string; onChange(cents: number): void; onDone(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: gutter, paddingBottom: layout.stack.base, gap: layout.stack.base + layout.stack.tight, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: layout.stack.tight, alignItems: "center" }}>
        <Eyebrow>What it would take</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]}>
          How would all this <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>feel</Text>?
        </Text>
        <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>Slide to a year's income and see how comfortably it carries everything on your list.</Text>
      </Rise>
      <Rise delay={60} style={{ gap: layout.stack.tight }}>
        <IncomeFader incomeCents={incomeCents} needCents={needCents} onChange={onChange} />
        {note ? <Text style={[type.footnote, { color: p.ink3, textAlign: "center" }]}>{note}</Text> : null}
      </Rise>
      <Rise delay={160}>
        <PrimaryButton label="Show me my list" onPress={onDone} />
      </Rise>
    </View>
  );
}
