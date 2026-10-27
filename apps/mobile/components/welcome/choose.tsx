import type { Entry } from "@dandelist/catalogue";
import { recurringBreakdown } from "@dandelist/cost";
import { toItem } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, radius, usePalette } from "../../lib/theme";
import { hostOf, monthYearLong, reachBy, shortDate } from "../../lib/welcome";
import { Eyebrow, Shade } from "../lux";
import { GlassReveal } from "../reveal";
import { Chip, Rise } from "./kit";

const STANDBY: Record<string, number> = {
  drive: require("../../assets/standby/drive.jpg"),
  travel: require("../../assets/standby/travel.jpg"),
  live: require("../../assets/standby/life.jpg"),
};
const standbyFor = (e: Entry) => STANDBY[e.category] ?? require("../../assets/standby/object.jpg");
const monthly = (e: Entry) => recurringBreakdown([toItem(e)]).perMonth;

/** The source line every card carries: where the price was checked, and when; estimates say so. */
function Source({ e }: { e: Entry }) {
  const p = usePalette();
  return <Text numberOfLines={1} style={{ fontFamily: fonts.figure, fontSize: 10.5, color: p.ink2 }}>{`${hostOf(e.url)} · ${e.status === "verified" ? "checked" : "estimate"} ${shortDate(e.checkedAt)}`}</Text>;
}

function Price({ e, size = 18 }: { e: Entry; size?: number }) {
  const p = usePalette();
  const m = monthly(e);
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontFamily: fonts.figure, fontSize: size, color: p.ink }}>{formatCents(e.upfrontCents)}</Text>
      {m ? <Text style={{ fontFamily: fonts.figure, fontSize: 11, color: p.ink2 }}>{`+ ${formatCents(Math.round(m))}/mo`}</Text> : null}
    </View>
  );
}

/** A photo card whose picture surfaces through the glass as it loads. */
function PhotoCard({ e, onPress, style, big = false }: { e: Entry; onPress(ref: View | null): void; style?: object; big?: boolean }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const ref = useRef<View>(null);
  const press = useRef(new Animated.Value(1)).current;
  const to = (v: number, cfg: object) => Animated.spring(press, { toValue: v, ...cfg, useNativeDriver: native }).start();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`${e.name}, ${formatCents(e.upfrontCents)}`}
      onPressIn={() => !reduced && to(0.97, spring.press)}
      onPressOut={() => !reduced && to(1, spring.press)}
      onPress={() => onPress(ref.current)}
      style={style}
    >
      <Animated.View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", transform: [{ scale: press }] }}>
        <GlassReveal uri={e.imageUrl ?? null} standby={standbyFor(e)} stage="clear" treatment="swirl" style={StyleSheet.absoluteFill} />
        <Shade from={0.35} />
        <View style={{ position: "absolute", left: 16, right: 16, bottom: 16, gap: 8 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: big ? 30 : 24, lineHeight: big ? 33 : 27, color: p.ink }} numberOfLines={2}>
            {e.name}
          </Text>
          <Price e={e} />
          <Source e={e} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** Step 2: "Start with one you'd say yes to." Three cards: a snap carousel on phones, three across on wide screens. */
export function FirstPick({ entries, onPick }: { entries: Entry[]; onPick(e: Entry, from: View | null): void }) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const cardW = wide ? Math.min(300, (Math.min(width, 1000) - 80) / 3) : Math.min(320, width * 0.76);
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: 22 }}>
      <Rise style={{ paddingHorizontal: 28, gap: 8, alignSelf: wide ? "center" : "stretch" }}>
        <Eyebrow>Your first pick</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 39, color: p.ink }}>
          Start with one you'd say <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>yes</Text> to.
        </Text>
      </Rise>
      <ScrollView
        horizontal={!wide}
        scrollEnabled={!wide}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + 12}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: wide ? 0 : 28, gap: 12, flexGrow: 1, justifyContent: "center" }}
      >
        {entries.map((e, i) => (
          <Rise key={e.id} delay={60 * i}>
            <PhotoCard e={e} big onPress={(ref) => onPick(e, ref)} style={{ width: cardW, height: cardW * 1.45 }} />
          </Rise>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Step 3: this or that. Two full-bleed halves; tapping one grows it a touch while the other dims and slides away.
 * "Both" and "Neither" are always there, and on the web the arrow keys vote.
 */
export function VotePair({ a, b, round, rounds, onVote }: { a: Entry; b: Entry; round: number; rounds: number; onVote(chosen: Entry[], from: View | null): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const side = width >= 760;
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
    <View style={{ flex: 1, gap: 14 }}>
      <Rise style={{ paddingHorizontal: 28, gap: 6, alignSelf: side ? "center" : "stretch" }}>
        <Eyebrow>{`This or that · ${round} of ${rounds}`}</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 33, color: p.ink }}>
          Which one is more <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>you</Text>?
        </Text>
      </Rise>
      <View style={{ flex: 1, flexDirection: side ? "row" : "column", gap: 10, paddingHorizontal: 14, maxWidth: 1000, width: "100%", alignSelf: "center" }}>
        {[a, b].map((e, i) => (
          <Animated.View key={e.id} style={{ flex: 1, opacity: fade[i], transform: [{ scale: grow[i]! }] }}>
            <View ref={refs[i]} collapsable={false} style={{ flex: 1 }}>
              <PhotoCard e={e} onPress={() => pick(i as 0 | 1)} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 28, paddingBottom: 4 }}>
        <Pressable accessibilityRole="button" onPress={() => pick("both")} hitSlop={10}>
          <Text style={{ fontFamily: fonts.label, fontSize: 14, color: p.ink2 }}>Both</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => pick("neither")} hitSlop={10}>
          <Text style={{ fontFamily: fonts.label, fontSize: 14, color: p.ink2 }}>Neither</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Step 4: when should this life be yours? */
export function Horizon({ value, onPick }: { value: number | null | undefined; onPick(years: number | null): void }) {
  const p = usePalette();
  const options: [string, number | null][] = [["1 year", 1], ["3 years", 3], ["5 years", 5], ["10 years", 10], ["Not sure, show me", null]];
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 22, maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: 10 }}>
        <Eyebrow>Your horizon</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 39, color: p.ink }}>
          When should this life be <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>yours</Text>?
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: p.ink2 }}>We'll show what changes if it takes longer.</Text>
      </Rise>
      <Rise delay={80} style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {options.map(([label, years]) => (
          <Chip key={label} label={label} selected={value === years} onPress={() => { haptic.select(); onPick(years); }} />
        ))}
      </Rise>
    </View>
  );
}

const MIN = 5_000;
const MAX = 1_000_000;
const DETENTS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
const toCents = (f: number) => Math.round((MIN * Math.pow(MAX / MIN, f)) / 1000) * 1000;
const toFraction = (c: number) => Math.log(c / MIN) / Math.log(MAX / MIN);

/** Step 5: what could you set aside each month? A log slider from $50 to $10,000 with the date updating live. */
export function Aside({ value, totalCents, onChange, onDone }: { value: number; totalCents: number; onChange(c: number): void; onDone(): void }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const last = useRef(value);
  const startX = useRef(0);
  const set = (x: number) => {
    const f = Math.max(0, Math.min(1, x / (w || 1)));
    let c = toCents(f);
    const near = DETENTS.find((d) => Math.abs(toFraction(d) - f) < 0.012);
    if (near) c = near;
    if (DETENTS.includes(c) && c !== last.current) haptic.select();
    last.current = c;
    onChange(c);
  };
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      startX.current = e.nativeEvent.locationX;
      set(startX.current);
    },
    onPanResponderMove: (_e, g) => set(startX.current + g.dx),
  });
  const f = toFraction(value);
  const by = monthYearLong(reachBy(totalCents, value));
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 26, maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: 10 }}>
        <Eyebrow>Each month</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 39, color: p.ink }}>
          What could you set aside each month?
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: p.ink2 }}>It turns the price into a date. It stays on this device until you save.</Text>
      </Rise>
      <Rise delay={80} style={{ gap: 18 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 64, lineHeight: 68, color: p.ink }}>
          <Text style={{ fontSize: 30, color: p.ink2 }}>$</Text>
          {Math.round(value / 100).toLocaleString("en-US")}
        </Text>
        <View
          onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Monthly amount"
          accessibilityValue={{ text: formatCents(value) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => onChange(toCents(Math.max(0, Math.min(1, f + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05)))))}
          style={{ height: 44, justifyContent: "center" }}
        >
          <View style={{ height: 2, borderRadius: 1, backgroundColor: p.track }}>
            <View style={{ height: 2, width: `${f * 100}%`, backgroundColor: p.accent }} />
          </View>
          {DETENTS.map((d) => (
            <View key={d} pointerEvents="none" style={{ position: "absolute", left: `${toFraction(d) * 100}%`, width: 1, height: 8, backgroundColor: `rgba(${p.inkRgb}, 0.3)` }} />
          ))}
          <View pointerEvents="none" style={{ position: "absolute", left: `${f * 100}%`, marginLeft: -13, width: 26, height: 26, borderRadius: 13, backgroundColor: p.ink, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 8 }} />
        </View>
        <Text style={{ fontFamily: fonts.figure, fontSize: 13, color: p.ink2 }}>{`everything you picked: yours by ${by}`}</Text>
      </Rise>
      <Rise delay={140} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => ({ height: 54, paddingHorizontal: 28, borderRadius: radius.pill, backgroundColor: p.ink, justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ fontFamily: fonts.label, fontSize: 15, color: p.onAccent }}>Show me my life</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { onChange(50_000); onDone(); }} hitSlop={8}>
          <Text style={{ fontFamily: fonts.label, fontSize: 13.5, color: p.ink2 }}>Use $500 for now</Text>
        </Pressable>
      </Rise>
    </View>
  );
}
