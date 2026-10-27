import type { Entry } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, useReducedMotion } from "../../lib/motion";
import { fonts, layout, type, usePalette } from "../../lib/theme";
import { hostOf, monthYearLong, reachBy, shortDate } from "../../lib/welcome";
import { Grain, Shade } from "../lux";
import { Odometer, dollars } from "../odometer";
import { GlassReveal } from "../reveal";
import type { Stage } from "../reveal-clock";

export const BRAND = "Dandelist";
const TITLE_MS = 6000;
const SHORT_MS = 1200;
/** The title's example plan: a stated monthly amount, so the date it shows is honest arithmetic. */
const EXAMPLE_MONTHLY_CENTS = 300_000;
/** Where each hero's subject sits in its photograph, so a portrait crop keeps the subject whole. */
const FOCUS: Record<string, { x: number; y: number }> = { "porsche-911": { x: 0.35, y: 0.5 } };

/**
 * The title sequence (research §4.2, step 1): a real thing, its real price, and that price becoming a date.
 * The photograph surfaces through the glass, the checked price spins in on every wheel and lands with its source,
 * the price lifts away into "Yours by …", then the wordmark sets and the line lands. Skippable from 0.6 s by tapping
 * anywhere, the Skip button or Escape; return visits get a 1.2 s cut.
 */
export function TitleSequence({ hero, short, onDone }: { hero: Entry; short: boolean; onDone(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(short || reduced ? 3800 : 0)).current;
  const [stage, setStage] = useState<Stage>("hunting");
  const [price, setPrice] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useEffect(() => {
    const total = short ? SHORT_MS : reduced ? 400 : TITLE_MS;
    const anim = Animated.timing(t, { toValue: TITLE_MS, duration: total, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished: ok }) => ok && setTimeout(finish, short || reduced ? 150 : 350));
    const timers = short || reduced ? [] : [setTimeout(() => setStage("found"), 500), setTimeout(() => setStage("clear"), 1100), setTimeout(() => setPrice(true), 1400)];
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

  const range = (a: number, b: number, from = 0, to = 1, easing = ease.out) => t.interpolate({ inputRange: [a, b], outputRange: [from, to], extrapolate: "clamp", easing });
  const photo = range(400, 1600, 0, 1, ease.cinema);
  const push = range(0, TITLE_MS, 1.04, 1, Easing.linear);
  const dim = range(3800, 5200, 0, 0.62, ease.cinema);
  const priceIn = range(1400, 1800);
  const priceOut = range(2600, 3000, 1, 0);
  const priceLift = range(2600, 3000, 0, -18);
  const dateIn = range(2720, 3420);
  const dateOut = range(3800, 4400, 1, 0);
  const rule = range(4500, 5200, 0, 1, ease.inOut);
  const line = range(5200, 5900);
  const tracking = range(3800, 5200, 6, 1.2, ease.cinema);
  const by = monthYearLong(reachBy(hero.upfrontCents, EXAMPLE_MONTHLY_CENTS));
  const gutter = layout.gutter(width);
  const focus = FOCUS[hero.id];

  return (
    // Tapping anywhere skips too. The root is a plain view with a responder, not a button, so the Skip button is the
    // one real control (UI audit P0-8: no button inside a button on the web).
    <View onStartShouldSetResponder={() => skippable} onResponderRelease={finish} style={{ flex: 1, backgroundColor: p.bg }}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: photo, transform: [{ scale: push }] }]}>
        {/* Studio-white heroes are dimmed so the page stays dark (filter works on iOS, Android and the web). */}
        <View style={[StyleSheet.absoluteFill, { filter: "brightness(0.72)" } as object]}>
          <GlassReveal uri={hero.imageUrl ?? null} standby={require("../../assets/standby/drive.jpg")} stage={stage} treatment="swirl" focus={focus} style={StyleSheet.absoluteFill} />
        </View>
      </Animated.View>
      <Shade look="title" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: dim }]} />

      {/* Lower third: the checked price and its source, then the date it becomes. */}
      <View pointerEvents="none" style={{ position: "absolute", left: gutter, right: gutter, bottom: insets.bottom + 120 }}>
        <Animated.View style={{ opacity: Animated.multiply(priceIn, priceOut), transform: [{ translateY: priceLift }], gap: 8 }}>
          {price ? <Odometer cents={hero.upfrontCents} format={dollars} size={48} family="bodoni" smallPrefix tracking={-0.96} rollOnMount="cinema" /> : <View style={{ height: Math.round(48 * 1.18) }} />}
          <Text style={[type.figure, { color: p.ink2 }]}>{`${hero.name} · ${hostOf(hero.url)} · checked ${shortDate(hero.checkedAt)}`}</Text>
        </Animated.View>
        <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0, opacity: Animated.multiply(dateIn, dateOut), transform: [{ translateY: range(2720, 3420, 16, 0) }] }}>
          {/* A deliberate two-line set, so the year is never orphaned. */}
          <Text style={[type.dateline, { color: p.ink }]}>Yours by</Text>
          <Text style={[type.dateline, { fontFamily: fonts.displayItalic, color: p.accentText }]}>{by}</Text>
          <Text style={[type.figure, { color: p.ink2, marginTop: 8 }]}>at $3,000 a month</Text>
        </Animated.View>
      </View>

      {/* The wordmark sets, letter by letter, as the tracking tightens; a champagne hairline draws beneath it. */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: "38%", alignItems: "center", gap: 16 }}>
        <View style={{ flexDirection: "row" }} accessible accessibilityLabel={BRAND}>
          {BRAND.split("").map((ch, i) => (
            <Animated.Text
              key={i}
              style={[
                type.wordmark,
                {
                  color: p.ink,
                  letterSpacing: tracking,
                  opacity: range(3800 + i * 36, 4400 + i * 36),
                  transform: [{ translateY: range(3800 + i * 36, 4400 + i * 36, 8, 0) }],
                },
              ]}
            >
              {ch}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={{ width: 120, height: StyleSheet.hairlineWidth * 2, backgroundColor: p.accent, transform: [{ scaleX: rule }] }} />
        <Animated.Text style={[type.title3, { color: p.ink2, opacity: line, transform: [{ translateY: range(5200, 5900, 10, 0) }] }]}>
          Price the life you <Text style={{ fontFamily: fonts.titleItalic, color: p.accentText }}>want</Text>.
        </Animated.Text>
      </View>

      {skippable ? (
        <Pressable accessibilityRole="button" onPress={finish} style={{ position: "absolute", top: insets.top, right: gutter - 12, minWidth: 44, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}>
          <Text style={[type.label, { color: p.ink2 }]}>Skip</Text>
        </Pressable>
      ) : null}
      <Grain />
    </View>
  );
}
