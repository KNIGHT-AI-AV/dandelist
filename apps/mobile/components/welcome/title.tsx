import type { Entry } from "@dandelist/catalogue";
import { heroFor } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { fonts, layout, type, usePalette } from "../../lib/theme";
import { hostOf, monthYearLong, reachBy, shortDate } from "../../lib/welcome";
import { Grain, Shade, Wordmark } from "../lux";
import { Odometer, dollars } from "../odometer";
import { GlassReveal } from "../reveal";
import type { Stage } from "../reveal-clock";

export const BRAND = "Dandelist";
/** Owner, 2026-10-28: the opening "happens too fast"; it should feel like an experience opening. About ten seconds. */
const TITLE_MS = 10_000;
/** The clock runs this much slower than the timeline, so every beat holds a little longer (about twelve seconds). */
const PACE = 1.2;
/** Return visits start at the wordmark and take this long. */
const SHORT_MS = 1600;
const SHORT_FROM = 6600;
/** The dissolve that carries the title into the first screen, from wherever it was touched. */
const DISSOLVE_MS = 900;
/** The title's example plan: a stated monthly amount, so the date it shows is honest arithmetic. */
const EXAMPLE_MONTHLY_CENTS = 300_000;
/** Where each hero's subject sits in its photograph, so the crop keeps the subject whole. */
const FOCUS: Record<string, { x: number; y: number }> = { "porsche-911": { x: 0.42, y: 0.5 } };
/** The dissolve's edge: how much wider each disc is than the core, and how opaque. */
const FEATHER = [[1.12, 0.3], [1.06, 0.55], [1, 1]] as const;

/**
 * The opening, centred on one axis and paced slowly: a real thing surfaces through the glass, its checked price
 * spins in and lands with its source, the price becomes "Yours by …", then the wordmark resolves in the middle of
 * the screen, its gold dot settles on the i, a hairline draws and the line lands. Touch anywhere and the title
 * dissolves outward from that point into the first screen; the Skip button and Escape do the same.
 */
export function TitleSequence({ hero, short, onDone }: { hero: Entry; short: boolean; onDone(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(short || reduced ? SHORT_FROM : 0)).current;
  const out = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState<Stage>("hunting");
  const [price, setPrice] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const finished = useRef(false);

  /** Dissolves from a point (the touch, or the centre when it ends by itself), then moves on. */
  const finish = (at?: { x: number; y: number }) => {
    if (finished.current) return;
    finished.current = true;
    if (reduced) return onDone();
    setFrom(at ?? { x: width / 2, y: height / 2 });
    Animated.timing(out, { toValue: 1, duration: DISSOLVE_MS, easing: ease.inOut, useNativeDriver: native }).start(() => onDone());
  };

  useEffect(() => {
    const total = short ? SHORT_MS : reduced ? 400 : TITLE_MS * PACE;
    const anim = Animated.timing(t, { toValue: TITLE_MS, duration: total, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished: ok }) => ok && setTimeout(() => finish(), short || reduced ? 150 : 500));
    const timers = short || reduced ? [] : [setTimeout(() => setStage("found"), 800 * PACE), setTimeout(() => setStage("clear"), 1600 * PACE), setTimeout(() => setPrice(true), 2200 * PACE)];
    if (short || reduced) setStage("clear");
    timers.push(setTimeout(() => setSkippable(true), 600));
    return () => {
      anim.stop();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape skips on the web.
  useEffect(() => {
    if (Platform.OS !== "web" || !skippable) return;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skippable]);

  const range = (a: number, b: number, from0 = 0, to = 1, easing = ease.out) => t.interpolate({ inputRange: [a, b], outputRange: [from0, to], extrapolate: "clamp", easing });
  const photo = range(300, 2600, 0, 1, ease.cinema);
  const push = range(0, TITLE_MS, 1.06, 1, Easing.linear);
  const dim = range(6000, 7600, 0, 0.7, ease.cinema);
  const priceIn = range(2200, 2900);
  const priceOut = range(4300, 4900, 1, 0);
  const priceLift = range(4300, 4900, 0, -18);
  const dateIn = range(4500, 5600);
  const dateOut = range(6300, 7000, 1, 0);
  const rule = range(8000, 8900, 0, 1, ease.inOut);
  const line = range(8800, 9600);
  const by = monthYearLong(reachBy(hero.upfrontCents, EXAMPLE_MONTHLY_CENTS));
  const gutter = layout.gutter(width);
  const fade = out.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.15, 0] });
  // The dissolve's reach: a circle from the touch point that covers the farthest corner.
  const reach = from ? 2 * Math.hypot(Math.max(from.x, width - from.x), Math.max(from.y, height - from.y)) + 80 : 0;
  const centre = { position: "absolute" as const, left: gutter, right: gutter, top: 0, bottom: 0, alignItems: "center" as const, justifyContent: "center" as const };

  return (
    // Touching anywhere skips. The root is a plain view with a responder, not a button, so the Skip button is the
    // one real control (UI audit P0-8: no button inside a button on the web).
    <View
      onStartShouldSetResponder={() => skippable && !from}
      onResponderRelease={(e: GestureResponderEvent) => finish({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      style={{ flex: 1, overflow: "hidden", backgroundColor: p.bg }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: photo, transform: [{ scale: push }] }]}>
          {/* Studio-white heroes are dimmed so the page stays dark (filter works on iOS, Android and the web). */}
          <View style={[StyleSheet.absoluteFill, { filter: "brightness(0.62)" } as object]}>
            <GlassReveal uri={heroFor(hero, width / height) ?? null} standby={require("../../assets/standby/drive.jpg")} stage={stage} treatment="film" focus={FOCUS[hero.id]} style={StyleSheet.absoluteFill} />
          </View>
          <Shade look="title" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: dim }]} />

        {/* The checked price and its source, centred, then the date it becomes in the same place. */}
        <View pointerEvents="none" style={centre}>
          <Animated.View style={{ alignItems: "center", gap: 8, opacity: Animated.multiply(priceIn, priceOut), transform: [{ translateY: priceLift }] }}>
            {price ? <Odometer cents={hero.upfrontCents} format={dollars} size={52} family="bodoni" smallPrefix tracking={-1.04} rollOnMount="cinema" /> : <View style={{ height: Math.round(52 * 1.18) }} />}
            <Text style={[type.callout, { color: p.ink, textAlign: "center" }]} numberOfLines={1}>{hero.name}</Text>
            <Text style={[type.figure, { color: p.ink2, textAlign: "center" }]} numberOfLines={1}>{`${hostOf(hero.url)} · checked ${shortDate(hero.checkedAt)}`}</Text>
          </Animated.View>
        </View>
        <View pointerEvents="none" style={centre}>
          <Animated.View style={{ alignItems: "center", opacity: Animated.multiply(dateIn, dateOut), transform: [{ translateY: range(4500, 5600, 16, 0) }] }}>
            {/* A deliberate two-line set, so the year is never orphaned. */}
            <Text style={[type.dateline, { color: p.ink, textAlign: "center" }]}>Yours by</Text>
            <Text style={[type.dateline, { fontFamily: fonts.displayItalic, color: p.accentText, textAlign: "center" }]}>{by}</Text>
            <Text style={[type.figure, { color: p.ink2, marginTop: 8, textAlign: "center" }]}>at $3,000 a month</Text>
          </Animated.View>
        </View>

        {/* The word resolves in the centre, its gold dot drifts down onto the i, a champagne hairline draws beneath. */}
        <View pointerEvents="none" style={[centre, { gap: 18 }]}>
          <Wordmark
            height={72}
            word={{ opacity: range(6800, 8200, 0, 1, ease.cinema), transform: [{ translateY: range(6800, 8200, 10, 0, ease.cinema) }, { scale: range(6800, 8600, 1.04, 1, ease.cinema) }] }}
            dot={{ opacity: range(7800, 8500), transform: [{ translateY: range(7800, 8700, -18, 0, ease.cinema) }] }}
          />
          <Animated.View style={{ width: 140, height: StyleSheet.hairlineWidth * 2, backgroundColor: p.accent, transform: [{ scaleX: rule }] }} />
          <Animated.Text style={[type.title3, { color: p.ink2, textAlign: "center", opacity: line, transform: [{ translateY: range(8800, 9600, 10, 0) }] }]}>
            Price the life you <Text style={{ fontFamily: fonts.titleItalic, color: p.accentText }}>want</Text>.
          </Animated.Text>
        </View>
      </Animated.View>

      {skippable && !from ? (
        <Pressable accessibilityRole="button" onPress={() => finish({ x: width - gutter - 10, y: insets.top + 22 })} style={{ position: "absolute", top: insets.top, right: gutter - 12, minWidth: 44, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}>
          <Text style={[type.label, { color: p.ink2 }]}>Skip</Text>
        </Pressable>
      ) : null}

      {/* The dissolve: a circle of the page itself grows from the touch. Three discs, each a little wider and fainter
          than the last, feather its edge, so the title gives way from that point instead of cutting. */}
      {from ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {FEATHER.map(([grow, alpha]) => (
            <Animated.View
              key={grow}
              style={{ position: "absolute", left: from.x - reach / 2, top: from.y - reach / 2, width: reach, height: reach, borderRadius: reach / 2, backgroundColor: p.bg, opacity: alpha, transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [0, grow] }) }] }}
            />
          ))}
        </View>
      ) : null}
      <Grain />
    </View>
  );
}
