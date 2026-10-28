import { entry, heroFor } from "@dandelist/catalogue";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, layout, radius, shadow, type, usePalette, useType } from "../../lib/theme";
import { hostOf, monthYearLong, monthlyOf, reachBy, shortDate, type PoolItem } from "../../lib/welcome";
import { AgentDot, Eyebrow, Glass, Icon, PrimaryButton, QuietButton } from "../lux";
import { Odometer, dollars } from "../odometer";
import { Rise } from "./kit";

/**
 * What Dandelist is, before anything is asked (owner, 2026-10-28: "tell the user what this app is, extremely
 * interactive, with the same design and the same card"). Four photo cards in a deck that swipes and snaps, each with
 * one thing to touch: the things people want (tap through them), the agent checking a real price, what it costs to
 * keep (month, year, five years), and the date it becomes (drag). Every number on these cards is the catalogue's
 * real, checked figure. Log in sits underneath; there is no register, because the list itself is the sign-up.
 */

const CARDS = 4;
const GAP = 12;
const CYCLE_MS = 2800;
/** The deck's demo items, all checked on their sellers' own pages. */
const PORSCHE = entry("porsche-911")!;
const PELOTON = entry("peloton-bike-plus")!;

/** One card: the photo full-bleed under a shade, a counter, the words at the foot, and its own interactive part. */
function Card({ uri, index, title, body, width, height, scrollX, children, onPress }: { uri?: string | null; index: number; title: ReactNode; body: string; width: number; height: number; scrollX: Animated.Value; children?: ReactNode; onPress?(): void }) {
  const p = usePalette();
  const t = useType();
  const reduced = useReducedMotion();
  const step = width + GAP;
  const range = [(index - 1) * step, index * step, (index + 1) * step];
  // Off-centre cards sit back a little and their photos drift, so the deck reads as depth, not a strip.
  const scale = reduced ? 1 : scrollX.interpolate({ inputRange: range, outputRange: [0.94, 1, 0.94], extrapolate: "clamp" });
  const drift = reduced ? 0 : scrollX.interpolate({ inputRange: range, outputRange: [-28, 0, 28], extrapolate: "clamp" });
  return (
    <Animated.View style={{ width, height, transform: [{ scale }] }}>
      <Pressable accessibilityRole={onPress ? "button" : undefined} onPress={onPress} disabled={!onPress} style={{ flex: 1, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", backgroundColor: p.surface, boxShadow: shadow.print } as object}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: drift }, { scale: 1.12 }] }]}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={700} accessible={false} /> : null}
        </Animated.View>
        {/* The words sit on the lower two thirds; the page colour rises behind them so any photo stays legible. */}
        <LinearGradient pointerEvents="none" colors={[`rgba(${p.bgRgb}, 0)`, `rgba(${p.bgRgb}, 0.55)`, `rgba(${p.bgRgb}, 0.86)`, `rgba(${p.bgRgb}, 0.94)`]} locations={[0.05, 0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ position: "absolute", top: layout.cardPad, left: layout.cardPad }}>
          <Glass intensity={40} style={{ borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={[type.figure, { color: p.ink }]}>{`${index + 1} of ${CARDS}`}</Text>
          </Glass>
        </View>
        <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: layout.cardPad, gap: layout.stack.tight }}>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>{title}</Text>
          <Text style={[type.callout, { color: p.ink2 }]}>{body}</Text>
          {children ? <View style={{ marginTop: layout.stack.tight }}>{children}</View> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const em = (word: string, color: string) => <Text style={{ fontFamily: fonts.displayItalic, color }}>{word}</Text>;

/** Card 1's label: the thing in the photo and its price, swapping with the photo. */
function NowShowing({ item }: { item: PoolItem }) {
  const p = usePalette();
  return (
    <Glass intensity={50} style={{ borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Text numberOfLines={1} style={[type.callout, { color: p.ink, flex: 1 }]}>{item.name}</Text>
      <Text style={[type.figure, { color: p.ink }]}>{dollars(item.upfrontCents)}</Text>
    </Glass>
  );
}

type CheckRow = { id: string; done: boolean; text: string };

/** Card 2: the agent's check on porsche.com, played row by row when the card comes into view. */
function PriceCheck({ active }: { active: boolean }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [run, setRun] = useState(0);
  const host = hostOf(PORSCHE.url);
  useEffect(() => {
    if (!active) return;
    const all: CheckRow[][] = [
      [{ id: "open", done: false, text: `Opening ${host}` }],
      [{ id: "open", done: true, text: `Opened ${host}` }, { id: "read", done: false, text: "Reading the price on the page" }],
      [{ id: "open", done: true, text: `Opened ${host}` }, { id: "read", done: true, text: `${formatCents(PORSCHE.upfrontCents)}, printed on ${host}` }],
    ];
    if (reduced) return setRows(all[2]!);
    setRows([]);
    const timers = all.map((r, i) => setTimeout(() => setRows(r), 350 + i * 900));
    return () => timers.forEach(clearTimeout);
  }, [active, run, host, reduced]);
  const done = rows.length === 2 && rows[1]!.done;
  return (
    <Glass intensity={50} style={{ borderRadius: radius.control, borderCurve: "continuous", padding: 14, gap: 10 }}>
      {rows.map((r) => (
        <Rise key={`${r.id}-${r.done}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 15, alignItems: "center" }}>{r.done ? <Icon name="check" color={p.accentText} size={13} /> : <AgentDot busy />}</View>
          <Text style={[type.footnote, { color: r.done ? p.ink : p.ink2, flex: 1 }]}>{r.text}</Text>
        </Rise>
      ))}
      {done ? (
        <Rise style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[type.figure, { color: p.ink2 }]}>{`Checked ${shortDate(PORSCHE.checkedAt)}`}</Text>
          <Pressable accessibilityRole="button" onPress={() => { haptic.select(); setRun((n) => n + 1); }} hitSlop={10}>
            <Text style={[type.label, { color: p.accentText }]}>Check again</Text>
          </Pressable>
        </Rise>
      ) : null}
    </Glass>
  );
}

const SPANS = [["A month", 1], ["A year", 12], ["5 years", 60]] as const;

/** Card 3: what the Bike+ costs to have, over a month, a year or five, with the membership itemised. */
function KeepCost() {
  const p = usePalette();
  const [months, setMonths] = useState(12);
  const monthly = Math.round(monthlyOf(PELOTON));
  const total = PELOTON.upfrontCents + monthly * months;
  return (
    <Glass intensity={50} style={{ borderRadius: radius.control, borderCurve: "continuous", padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[type.footnote, { color: p.ink2 }]}>{PELOTON.name}</Text>
        <Text style={[type.figure, { color: p.ink }]}>{formatCents(PELOTON.upfrontCents)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[type.footnote, { color: p.ink2 }]}>{PELOTON.recurring[0]?.label ?? "Membership"}</Text>
        <Text style={[type.figure, { color: p.ink }]}>{`${formatCents(monthly)}/mo`}</Text>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.hair }} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {SPANS.map(([label, m]) => (
            <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: months === m }} onPress={() => { haptic.select(); setMonths(m); }} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: months === m ? p.ink : "transparent", borderWidth: 1, borderColor: months === m ? p.ink : p.line }}>
              <Text style={[type.figure, { color: months === m ? p.onAccent : p.ink2 }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Odometer cents={total} format={dollars} size={20} family="bodoni" align="right" />
      </View>
    </Glass>
  );
}

const MIN = 25_000;
const MAX = 2_000_000;
const toCents = (f: number) => Math.round((MIN * Math.pow(MAX / MIN, f)) / 5000) * 5000;
const toFraction = (c: number) => Math.log(c / MIN) / Math.log(MAX / MIN);

/** Card 4: drag what you'd put aside each month; the date moves with the thumb. */
function WhenItsYours({ item }: { item: Pick<PoolItem, "name" | "upfrontCents"> }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const [cents, setCents] = useState(300_000);
  const start = useRef(0);
  const hold = useRef(new Animated.Value(0)).current;
  const set = (x: number) => {
    const c = toCents(Math.max(0, Math.min(1, x / (w || 1))));
    if (c !== cents) setCents(c);
  };
  const pan = PanResponder.create({
    // The deck scrolls sideways too; the thumb claims the gesture first and keeps it.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      start.current = e.nativeEvent.locationX;
      set(start.current);
      Animated.spring(hold, { toValue: 1, ...spring.press, useNativeDriver: native }).start();
    },
    onPanResponderMove: (_e, g) => set(start.current + g.dx),
    onPanResponderRelease: () => Animated.spring(hold, { toValue: 0, ...spring.press, useNativeDriver: native }).start(),
  });
  const f = toFraction(cents);
  return (
    <Glass intensity={50} style={{ borderRadius: radius.control, borderCurve: "continuous", padding: 14, gap: 12 }}>
      <Text style={[type.title3, { color: p.ink }]}>
        {"Yours by "}
        <Text style={{ fontFamily: fonts.titleItalic, color: p.accentText }}>{monthYearLong(reachBy(item.upfrontCents, cents))}</Text>
      </Text>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Put aside each month"
        accessibilityValue={{ text: `${dollars(cents)} a month` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => setCents(toCents(Math.max(0, Math.min(1, f + (e.nativeEvent.actionName === "increment" ? 0.06 : -0.06)))))}
        style={{ height: 36, justifyContent: "center" }}
      >
        <View style={{ height: 3, borderRadius: 1.5, backgroundColor: p.track }}>
          <View style={{ height: 3, borderRadius: 1.5, width: `${f * 100}%`, backgroundColor: p.accent }} />
        </View>
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: `${f * 100}%`, marginLeft: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: p.ink, boxShadow: shadow.thumb, transform: [{ scale: hold.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] }} />
      </View>
      <Text style={[type.figure, { color: p.ink2 }]}>{`${dollars(cents)} a month for the ${item.name}, ${dollars(item.upfrontCents)}`}</Text>
    </Glass>
  );
}

export function Intro({ pool, onStart, onLogIn }: { pool: PoolItem[]; onStart(): void; onLogIn(): void }) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = layout.gutter(width);
  const cardW = Math.min(width - 2 * gutter, 460);
  const [deckH, setDeckH] = useState(0);
  const [page, setPage] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scroller = useRef<ScrollView>(null);
  // Card 1 cycles through things with photos from the pool, a little of everything.
  const showcase = pool.filter((e) => e.media?.images.length || e.imageUrl).slice(0, 12);
  const [shown, setShown] = useState(0);
  const touched = useRef(false);
  useEffect(() => {
    if (page !== 0 || touched.current || showcase.length < 2 || reduced) return;
    const t = setInterval(() => setShown((n) => (n + 1) % showcase.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [page, showcase.length, reduced]);
  const current = showcase[shown % Math.max(1, showcase.length)];
  const aspect = deckH ? cardW / deckH : 0.7;
  const photo = (e?: Pick<PoolItem, "media" | "imageUrl">) => (e ? (heroFor(e, aspect) ?? e.imageUrl ?? null) : null);

  const goTo = (i: number) => scroller.current?.scrollTo({ x: i * (cardW + GAP), animated: !reduced });
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: native,
    listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP));
      if (i !== page && i >= 0 && i < CARDS) {
        haptic.quietSelect();
        setPage(i);
      }
    },
  });
  const last = page === CARDS - 1;
  const cardH = Math.max(0, deckH);
  const pin: Pick<PoolItem, "name" | "upfrontCents" | "media" | "imageUrl"> = current ?? PORSCHE;

  return (
    <View style={{ flex: 1, gap: layout.stack.base }}>
      <Rise style={{ paddingHorizontal: gutter, gap: layout.stack.tight, width: "100%", maxWidth: cardW + 2 * gutter, alignSelf: "center" }}>
        <Eyebrow>What Dandelist does</Eyebrow>
      </Rise>
      <View style={{ flex: 1 }} onLayout={(e) => setDeckH(e.nativeEvent.layout.height)}>
        {cardH > 0 ? (
          <Animated.ScrollView
            ref={scroller as never}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardW + GAP}
            decelerationRate="fast"
            disableIntervalMomentum
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingHorizontal: (width - cardW) / 2, gap: GAP, alignItems: "center" }}
          >
            <Card
              index={0}
              width={cardW}
              height={cardH}
              scrollX={scrollX}
              uri={photo(current)}
              title={<>Anything you {em("want", p.accentText)}.</>}
              body="A car, a week away, a home, a watch. Type it, say it, or tap an idea."
              onPress={showcase.length > 1 ? () => { touched.current = true; haptic.select(); setShown((n) => (n + 1) % showcase.length); } : undefined}
            >
              {current ? <NowShowing item={current} /> : null}
            </Card>
            <Card index={1} width={cardW} height={cardH} scrollX={scrollX} uri={photo(PORSCHE)} title={<>Your Dandy finds the {em("real", p.accentText)} price.</>} body="It reads the seller's own page and shows where every number came from.">
              <PriceCheck active={page === 1} />
            </Card>
            <Card index={2} width={cardW} height={cardH} scrollX={scrollX} uri={photo(PELOTON)} title={<>And what it costs to {em("keep", p.accentText)}.</>} body="Memberships, insurance, upkeep and fuel, itemised, with the rate behind each one.">
              <KeepCost />
            </Card>
            <Card index={3} width={cardW} height={cardH} scrollX={scrollX} uri={photo(pin)} title={<>Then {em("when", p.accentText)} it's yours.</>} body="Set what you could put aside each month. The date moves with you.">
              <WhenItsYours item={pin} />
            </Card>
          </Animated.ScrollView>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: gutter, gap: layout.stack.base, width: "100%", maxWidth: cardW + 2 * gutter, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: CARDS, now: page + 1 }}>
          {Array.from({ length: CARDS }, (_, i) => (
            <Pressable key={i} accessibilityLabel={`Card ${i + 1}`} onPress={() => goTo(i)} hitSlop={8}>
              <View style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? p.ink : p.ink4 }} />
            </Pressable>
          ))}
        </View>
        <View style={{ gap: 4 }}>
          <PrimaryButton label={last ? "Start my Dandelist" : "Next"} onPress={() => (last ? onStart() : goTo(page + 1))} />
          <QuietButton label="I have an account · Log in" onPress={onLogIn} />
        </View>
      </View>
    </View>
  );
}

