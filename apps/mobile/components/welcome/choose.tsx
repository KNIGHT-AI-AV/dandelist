import { heroFor, heroImageFor, type MediaImage } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { ease, haptic, native, spring, usePress, useReducedMotion } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, layout, radius, type, usePalette, useType } from "../../lib/theme";
import { hostOf, monthlyOf, shortDate, type PoolItem, type When } from "../../lib/welcome";
import { Eyebrow, Glass, Money, PrimaryButton, QuietButton, Shade } from "../lux";
import { PhotoCredit } from "../photo-credit";
import { GlassReveal } from "../reveal";
import { Chip, Rise } from "./kit";

const STANDBY: Record<string, number> = {
  drive: require("../../assets/standby/drive.jpg"),
  travel: require("../../assets/standby/travel.jpg"),
  live: require("../../assets/standby/life.jpg"),
};
const standbyFor = (e: PoolItem) => STANDBY[e.category] ?? require("../../assets/standby/object.jpg");

/**
 * The source line every card carries: where the price was checked, and when; estimates say so. A typical price
 * from the archive says what it covers instead, and the photo on the card gets its credit ("Photo by ... on Unsplash").
 */
function Source({ e, image }: { e: PoolItem; image?: MediaImage }) {
  const p = usePalette();
  // A shopping-search link names Google, not the shop, so the seller's name stands in for it.
  const where = /(^|\.)google\./.test(hostOf(e.url)) ? e.seller : hostOf(e.url);
  return (
    <View style={{ gap: 2 }}>
      <Text numberOfLines={1} style={[type.figure, { color: p.ink2 }]}>{e.note ?? `${where} · ${e.status === "verified" ? "checked" : "estimate"} ${shortDate(e.checkedAt)}`}</Text>
      <PhotoCredit image={image} fallback={e.credit} />
    </View>
  );
}

function Price({ e }: { e: PoolItem }) {
  const p = usePalette();
  const m = monthlyOf(e);
  return (
    <View style={{ gap: 2 }}>
      <Money cents={e.upfrontCents} size="card" />
      {m ? <Text style={[type.figure, { color: p.ink2 }]}>{`+ ${formatCents(Math.round(m))}/mo`}</Text> : null}
    </View>
  );
}

/** A photo card whose picture surfaces through a frosted pane as it loads (never bent: people judge these photos). */
export function PhotoCard({ e, onPress, style, big = false }: { e: PoolItem; onPress(ref: View | null): void; style?: object; big?: boolean }) {
  const p = usePalette();
  const ref = useRef<View>(null);
  const press = usePress(0.985);
  // The card's own shape picks the photo composed for it (tall first picks, wide vote cards).
  const [aspect, setAspect] = useState(big ? 0.7 : 2.6);
  return (
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`${e.name}, ${formatCents(e.upfrontCents)}`} onPressIn={press.onPressIn} onPressOut={press.onPressOut} onPress={() => onPress(ref.current)} style={style}>
      <Animated.View onLayout={(ev) => { const { width: w, height: h } = ev.nativeEvent.layout; if (w > 0 && h > 0 && Math.abs(w / h - aspect) > 0.1) setAspect(w / h); }} style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", transform: [{ scale: press.scale }] }}>
        <GlassReveal uri={heroFor(e, aspect) ?? null} standby={standbyFor(e)} stage="clear" treatment="pane" style={StyleSheet.absoluteFill} />
        <Shade />
        {/* Wide cards keep their words in a left column over a scrim, so a name never runs into the photo. */}
        {big ? null : <LinearGradient pointerEvents="none" colors={[`rgba(${p.bgRgb}, 0.9)`, `rgba(${p.bgRgb}, 0.7)`, `rgba(${p.bgRgb}, 0)`]} locations={[0, 0.38, 0.72]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />}
        <View style={{ position: "absolute", left: layout.cardPad, right: big ? layout.cardPad : "30%", bottom: layout.cardPad, gap: 6 }}>
          <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
            {e.name}
          </Text>
          <Price e={e} />
          <Source e={e} image={heroImageFor(e, aspect)} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * This or that. Two full-bleed halves; tapping one grows it a touch while the other dims and slides away. "Both"
 * and "Neither" are always there as two equal buttons, and on the web the arrow keys vote. The pair is made from the
 * first wish, or comes from the pool until those arrive (lib/pairs); every card has a real photo. A "Neither" brings
 * another pair rather than counting as an answer.
 */
export function VotePair({ a, b, label, onVote }: { a: PoolItem; b: PoolItem; label: string; onVote(chosen: PoolItem[], from: View | null): void }) {
  const p = usePalette();
  const t = useType();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const side = width >= 760;
  const gutter = layout.gutter(width);
  const grow = useRef([new Animated.Value(1), new Animated.Value(1)]).current;
  const fade = useRef([new Animated.Value(1), new Animated.Value(1)]).current;
  const refs = [useRef<View>(null), useRef<View>(null)];
  const locked = useRef(false);

  useEffect(() => {
    locked.current = false;
    grow.forEach((g) => g.setValue(1));
    fade.forEach((f) => f.setValue(1));
  }, [a.id, b.id, grow, fade]);

  const pick = (which: 0 | 1 | "both" | "neither") => {
    if (locked.current) return;
    locked.current = true;
    haptic.select();
    if (which === "both" || which === "neither") return onVote(which === "both" ? [a, b] : [], refs[0]!.current);
    const other = which === 0 ? 1 : 0;
    const done = () => onVote([which === 0 ? a : b], refs[which]!.current);
    if (reduced) {
      fade[other]!.setValue(0.4);
      return setTimeout(done, 200);
    }
    Animated.parallel([
      Animated.spring(grow[which]!, { toValue: 1.04, ...spring.settle, useNativeDriver: native }),
      Animated.timing(fade[other]!, { toValue: 0.4, duration: 250, easing: ease.out, useNativeDriver: native }),
    ]).start();
    setTimeout(done, 360);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") pick(0);
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") pick(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <View style={{ flex: 1, gap: layout.stack.section }}>
      <Rise style={{ paddingHorizontal: gutter, gap: layout.stack.tight, width: "100%", maxWidth: side ? 932 + 2 * gutter : undefined, alignSelf: "center" }}>
        <Eyebrow>{label}</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
          Which one is more <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>you</Text>?
        </Text>
      </Rise>
      <View style={{ flex: 1, flexDirection: side ? "row" : "column", gap: 12, paddingHorizontal: gutter, maxWidth: 932 + 2 * gutter, width: "100%", alignSelf: "center" }}>
        {[a, b].map((e, i) => (
          <Animated.View key={e.id} style={{ flex: 1, opacity: fade[i], transform: [{ scale: grow[i]! }] }}>
            <View ref={refs[i]} collapsable={false} style={{ flex: 1 }}>
              <PhotoCard e={e} onPress={() => pick(i as 0 | 1)} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: gutter, maxWidth: 560 + 2 * gutter, width: "100%", alignSelf: "center" }}>
        <Chip label="Both" onPress={() => pick("both")} style={{ flex: 1 }} />
        <Chip label="Neither" onPress={() => pick("neither")} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** When they'd most want all of it, in words rather than years (owner, 2026-10-28). */
const WHEN_OPTIONS: { id: When; label: string; hint: string }[] = [
  { id: "now", label: "As soon as I can", hint: "Within the year" },
  { id: "soon", label: "Soon", hint: "In the next few years" },
  { id: "time", label: "In good time", hint: "No rush, done right" },
  { id: "unsure", label: "Show me", hint: "Let the numbers decide" },
];

/** A choice that reads like a sentence: the answer large, a quiet line under it. */
function WhenOption({ label, hint, selected, onPress }: { label: string; hint: string; selected: boolean; onPress(): void }) {
  const p = usePalette();
  const press = usePress(0.97);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${label}. ${hint}`} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Glass intensity={selected ? 70 : 40} style={{ minHeight: 84, borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 16, paddingVertical: 14, gap: 4, justifyContent: "center", borderColor: selected ? p.accent : p.line }}>
          <Text style={[type.title3, { color: p.ink }]}>{label}</Text>
          <Text style={[type.footnote, { color: p.ink2 }]}>{hint}</Text>
        </Glass>
      </Animated.View>
    </Pressable>
  );
}

/** "When would you most want all this?" */
export function WhenStep({ value, onPick }: { value: When | null | undefined; onPick(when: When): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: layout.column + 2 * layout.gutter(width), width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: layout.stack.tight }}>
        <Eyebrow>Your timing</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, maxWidth: width >= 760 ? undefined : 320 }]}>
          When would you most want <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>all this</Text>?
        </Text>
        <Text style={[type.callout, { color: p.ink2, marginTop: 8 }]}>We'll show what changes if it takes longer.</Text>
      </Rise>
      <Rise delay={50}>
        {/* Two by two, so all four fit above the list meter on a phone. */}
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {WHEN_OPTIONS.map((o) => (
            <View key={o.id} style={{ flexBasis: "47%", flexGrow: 1 }}>
              <WhenOption label={o.label} hint={o.hint} selected={value === o.id} onPress={() => { haptic.select(); onPick(o.id); }} />
            </View>
          ))}
        </View>
      </Rise>
    </View>
  );
}
