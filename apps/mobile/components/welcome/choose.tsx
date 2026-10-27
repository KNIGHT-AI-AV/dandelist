import type { Entry } from "@dandelist/catalogue";
import { recurringBreakdown } from "@dandelist/cost";
import { heroOf, toItem } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { ease, haptic, native, spring, usePress, useReducedMotion } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, layout, radius, shadow, type, usePalette, useType } from "../../lib/theme";
import { hostOf, monthYearLong, reachBy, shortDate } from "../../lib/welcome";
import { Eyebrow, Glass, Money, PrimaryButton, QuietButton, Shade } from "../lux";
import { dollars } from "../odometer";
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
  return <Text numberOfLines={1} style={[type.figure, { color: p.ink2 }]}>{`${hostOf(e.url)} · ${e.status === "verified" ? "checked" : "estimate"} ${shortDate(e.checkedAt)}`}</Text>;
}

function Price({ e }: { e: Entry }) {
  const p = usePalette();
  const m = monthly(e);
  return (
    <View style={{ gap: 2 }}>
      <Money cents={e.upfrontCents} size="card" />
      {m ? <Text style={[type.figure, { color: p.ink2 }]}>{`+ ${formatCents(Math.round(m))}/mo`}</Text> : null}
    </View>
  );
}

/** A photo card whose picture surfaces through a frosted pane as it loads (never bent: people judge these photos). */
function PhotoCard({ e, onPress, style, big = false }: { e: Entry; onPress(ref: View | null): void; style?: object; big?: boolean }) {
  const p = usePalette();
  const ref = useRef<View>(null);
  const press = usePress(0.985);
  return (
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`${e.name}, ${formatCents(e.upfrontCents)}`} onPressIn={press.onPressIn} onPressOut={press.onPressOut} onPress={() => onPress(ref.current)} style={style}>
      <Animated.View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", transform: [{ scale: press.scale }] }}>
        <GlassReveal uri={heroOf(e) ?? null} standby={standbyFor(e)} stage="clear" treatment="pane" style={StyleSheet.absoluteFill} />
        <Shade />
        <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: layout.cardPad, gap: 8 }}>
          <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
            {e.name}
          </Text>
          <Price e={e} />
          <Source e={e} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** Room the floating Life pill takes at the bottom of the step: its height and the air around it. */
const PILL_SPACE = 104;

/** Step 2: "Start with one you'd say yes to." Three cards: a snap carousel on phones, three across on wide screens. */
export function FirstPick({ entries, onPick }: { entries: Entry[]; onPick(e: Entry, from: View | null): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const gutter = layout.gutter(width);
  const ratio = wide ? 1.4 : 1.42;
  // The cards must end above the floating Life pill, so on a short screen they shrink, keeping their shape.
  const [room, setRoom] = useState<{ box: number; title: number } | null>(null);
  const fits = room ? Math.max(220, room.box - room.title - layout.stack.section - PILL_SPACE) : Infinity;
  const cardH = Math.min((wide ? Math.min(300, (Math.min(width, 1040) - 64 - 32) / 3) : Math.min(320, width * 0.76)) * ratio, fits);
  const cardW = cardH / ratio;
  const cards = entries.map((e, i) => (
    <Rise key={e.id} delay={60 * i}>
      <PhotoCard e={e} big onPress={(ref) => onPick(e, ref)} style={{ width: cardW, height: cardH }} />
    </Rise>
  ));
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: layout.stack.section }} onLayout={(ev) => { const box = ev.nativeEvent.layout.height; setRoom((r) => (r && Math.abs(r.box - box) < 1 ? r : { box, title: r?.title ?? 0 })); }}>
      <Rise
        onLayout={(ev) => { const title = ev.nativeEvent.layout.height; setRoom((r) => (r && Math.abs(r.title - title) < 1 ? r : { box: r?.box ?? 0, title })); }}
        style={{ paddingHorizontal: gutter, gap: layout.stack.tight, width: "100%", maxWidth: wide ? Math.max(cardW * 3 + 32, 0) + 2 * gutter : undefined, alignSelf: "center" }}
      >
        <Eyebrow>Your first pick</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
          Start with one you'd say <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>yes</Text> to.
        </Text>
      </Rise>
      {wide ? (
        // Three across: a row, not a scroller, so nothing stacks or gets cut (UI audit P0-4).
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}>{cards}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 12} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
          {cards}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Step 3: this or that. Two full-bleed halves; tapping one grows it a touch while the other dims and slides away.
 * "Both" and "Neither" are always there as outline pills, and on the web the arrow keys vote.
 */
export function VotePair({ a, b, round, rounds, onVote }: { a: Entry; b: Entry; round: number; rounds: number; onVote(chosen: Entry[], from: View | null): void }) {
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
    <View style={{ flex: 1, gap: 16 }}>
      <Rise style={{ paddingHorizontal: gutter, gap: layout.stack.tight, width: "100%", maxWidth: side ? 932 + 2 * gutter : undefined, alignSelf: "center" }}>
        <Eyebrow>{`This or that · ${round} of ${rounds}`}</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
          Which one is more <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>you</Text>?
        </Text>
      </Rise>
      <View style={{ flex: 1, flexDirection: side ? "row" : "column", gap: 12, paddingHorizontal: side ? gutter : 16, maxWidth: 932 + 2 * gutter, width: "100%", alignSelf: "center" }}>
        {[a, b].map((e, i) => (
          <Animated.View key={e.id} style={{ flex: 1, opacity: fade[i], transform: [{ scale: grow[i]! }] }}>
            <View ref={refs[i]} collapsable={false} style={{ flex: 1 }}>
              <PhotoCard e={e} onPress={() => pick(i as 0 | 1)} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
        <Chip ghost label="Both" onPress={() => pick("both")} />
        <Chip ghost label="Neither" onPress={() => pick("neither")} />
      </View>
    </View>
  );
}

/** Step 4: when should this life be yours? */
export function Horizon({ value, onPick }: { value: number | null | undefined; onPick(years: number | null): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const options: [string, number | null][] = [["1 year", 1], ["3 years", 3], ["5 years", 5], ["10 years", 10], ["Not sure, show me", null]];
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: layout.column + 2 * layout.gutter(width), width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: layout.stack.tight }}>
        <Eyebrow>Your horizon</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
          When should this life be <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>yours</Text>?
        </Text>
        <Text style={[type.callout, { color: p.ink2, marginTop: 8 }]}>We'll show what changes if it takes longer.</Text>
      </Rise>
      <Rise delay={50} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map(([label, years]) => (
          <Chip key={label} label={label} selected={value === years} onPress={() => onPick(years)} />
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
const THUMB = 28;

/** "Yours by" and the month, which crossfades with a 4 px rise only when the month changes. */
function YoursBy({ by }: { by: string }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(by);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (by === shown) return;
    if (reduced) return setShown(by);
    Animated.timing(v, { toValue: 0, duration: 75, easing: ease.out, useNativeDriver: native }).start(() => {
      setShown(by);
      Animated.timing(v, { toValue: 1, duration: 150, easing: ease.out, useNativeDriver: native }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [by]);
  return (
    <Text style={[type.title2, { color: p.ink }]} accessibilityLiveRegion="polite">
      {"Yours by "}
      <Animated.Text style={{ fontFamily: fonts.titleItalic, color: p.accentText, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{shown}</Animated.Text>
    </Text>
  );
}

/**
 * Step 5: what could you set aside each month? A log slider from $50 to $10,000. The amount follows the thumb
 * instantly and rolls on detents; the date it buys is the payoff, set large (UI audit P1-19). While the thumb is
 * held it grows and a glass lens above it shows the amount.
 */
export function Aside({ value, totalCents, onChange, onDone }: { value: number; totalCents: number; onChange(c: number): void; onDone(): void }) {
  const p = usePalette();
  const t = useType();
  const { width: winW } = useWindowDimensions();
  const [w, setW] = useState(0);
  const [held, setHeld] = useState(false);
  const [snap, setSnap] = useState(false);
  const last = useRef(value);
  const startX = useRef(0);
  const hold = useRef(new Animated.Value(0)).current;
  const set = (x: number) => {
    const f = Math.max(0, Math.min(1, x / (w || 1)));
    let c = toCents(f);
    const near = DETENTS.find((d) => Math.abs(toFraction(d) - f) < 0.012);
    if (near) c = near;
    const detent = DETENTS.includes(c) && c !== last.current;
    if (detent) haptic.select();
    setSnap(detent);
    last.current = c;
    onChange(c);
  };
  const grab = (on: boolean) => {
    setHeld(on);
    Animated.spring(hold, { toValue: on ? 1 : 0, ...spring.press, useNativeDriver: native }).start();
  };
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      grab(true);
      startX.current = e.nativeEvent.locationX;
      set(startX.current);
    },
    onPanResponderMove: (_e, g) => set(startX.current + g.dx),
    onPanResponderRelease: () => grab(false),
    onPanResponderTerminate: () => grab(false),
  });
  const f = toFraction(value);
  const by = monthYearLong(reachBy(totalCents, value));
  const gutter = layout.gutter(winW);
  const lens = `${dollars(value)}/mo`;
  const lensW = Math.max(72, Math.ceil(lens.length * 7.4) + 20);
  const lensX = Math.max(0, Math.min(w - lensW, f * w - lensW / 2));
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: gutter, gap: layout.stack.section, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: layout.stack.tight }}>
        <Eyebrow>Each month</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
          {"What could you set aside each month?"}
        </Text>
        <Text style={[type.callout, { color: p.ink2, marginTop: 8 }]}>It turns the price into a date. It stays on this device until you save.</Text>
      </Rise>
      <Rise delay={50} style={{ gap: 20 }}>
        <Money cents={value} size="hero" format={dollars} mode={held && !snap ? "instant" : "ui"} />
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
          <View style={{ height: 3, borderRadius: 1.5, backgroundColor: p.track }}>
            <View style={{ height: 3, borderRadius: 1.5, width: `${f * 100}%`, backgroundColor: p.accent }} />
          </View>
          {DETENTS.map((d) => (
            <View key={d} pointerEvents="none" style={{ position: "absolute", left: `${toFraction(d) * 100}%`, width: 1, height: 9, backgroundColor: p.ink4 }} />
          ))}
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: `${f * 100}%`, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.ink, boxShadow: shadow.thumb, transform: [{ scale: hold.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }} />
          {/* The lens: glass above the thumb that shows the amount while it's held. */}
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: lensX, bottom: 44, opacity: hold, transform: [{ translateY: hold.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
            <Glass intensity={50} style={{ width: lensW, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" }}>
              <Text style={[type.figure, { color: p.ink }]}>{lens}</Text>
            </Glass>
          </Animated.View>
        </View>
        <YoursBy by={by} />
      </Rise>
      <Rise delay={100} style={{ gap: 4 }}>
        <PrimaryButton label="Show me my life" onPress={onDone} />
        <QuietButton label="Use $500 for now" onPress={() => { onChange(50_000); onDone(); }} />
      </Rise>
    </View>
  );
}
