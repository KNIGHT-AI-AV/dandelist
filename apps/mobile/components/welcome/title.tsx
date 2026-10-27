import type { Entry } from "@dandelist/catalogue";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, useReducedMotion } from "../../lib/motion";
import { fonts, usePalette } from "../../lib/theme";
import { hostOf, monthYearLong, reachBy, shortDate } from "../../lib/welcome";
import { Grain, Shade } from "../lux";
import { GlassReveal } from "../reveal";
import type { Stage } from "../reveal-clock";
import { RollingNumber } from "./kit";

export const BRAND = "Dandelist";
const TITLE_MS = 6000;
const SHORT_MS = 1200;
/** The title's example plan: a stated monthly amount, so the date it shows is honest arithmetic. */
const EXAMPLE_MONTHLY_CENTS = 300_000;

/**
 * The title sequence (research §4.2, step 1): a real thing, its real price, and that price becoming a date.
 * The photograph surfaces through the glass, the checked price rolls up with its source, the price lifts away into
 * "Yours by …", then the wordmark sets and the line lands. Skippable from 0.6 s; return visits get a 1.2 s cut.
 */
export function TitleSequence({ hero, short, onDone }: { hero: Entry; short: boolean; onDone(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(short || reduced ? 3800 : 0)).current;
  const [stage, setStage] = useState<Stage>("hunting");
  const [price, setPrice] = useState("$000,000");
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
    const timers = short || reduced ? [] : [
      setTimeout(() => setStage("found"), 500),
      setTimeout(() => setStage("clear"), 1100),
      setTimeout(() => setPrice(`$${Math.round(hero.upfrontCents / 100).toLocaleString("en-US")}`), 1450),
    ];
    if (short || reduced) setStage("clear");
    timers.push(setTimeout(() => setSkippable(true), 600));
    return () => {
      anim.stop();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    // Tapping anywhere skips too; the visible "Skip" is the accessible control, so this layer isn't a button itself.
    <Pressable accessible={false} onPress={() => skippable && finish()} style={{ flex: 1, backgroundColor: p.bg }}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: photo, transform: [{ scale: push }] }]}>
        <GlassReveal uri={hero.imageUrl ?? null} standby={require("../../assets/standby/drive.jpg")} stage={stage} treatment="swirl" style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Shade from={0.35} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: dim }]} />

      {/* Lower third: the checked price and its source, then the date it becomes. */}
      <View pointerEvents="none" style={{ position: "absolute", left: 28, right: 28, bottom: insets.bottom + 120 }}>
        <Animated.View style={{ opacity: Animated.multiply(priceIn, priceOut), transform: [{ translateY: priceLift }], gap: 6 }}>
          <RollingNumber value={price} size={40} color={p.ink} />
          <Text style={{ fontFamily: fonts.figure, fontSize: 12, color: p.ink2 }}>{`${hero.name} · ${hostOf(hero.url)} · checked ${shortDate(hero.checkedAt)}`}</Text>
        </Animated.View>
        <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 6, opacity: Animated.multiply(dateIn, dateOut), transform: [{ translateY: range(2720, 3420, 16, 0) }] }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: p.ink }}>
            Yours by <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>{by}</Text>
          </Text>
          <Text style={{ fontFamily: fonts.figure, fontSize: 12, color: p.ink2, marginTop: 6 }}>at $3,000 a month</Text>
        </Animated.View>
      </View>

      {/* The wordmark sets, letter by letter, as the tracking tightens; a champagne hairline draws beneath it. */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: "38%", alignItems: "center", gap: 14 }}>
        <View style={{ flexDirection: "row" }} accessible accessibilityLabel={BRAND}>
          {BRAND.split("").map((ch, i) => (
            <Animated.Text
              key={i}
              style={{
                fontFamily: fonts.display,
                fontSize: 54,
                lineHeight: 60,
                color: p.ink,
                letterSpacing: tracking,
                opacity: range(3800 + i * 36, 4400 + i * 36),
                transform: [{ translateY: range(3800 + i * 36, 4400 + i * 36, 8, 0) }],
              }}
            >
              {ch}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={{ width: 120, height: StyleSheet.hairlineWidth * 2, backgroundColor: p.accent, transform: [{ scaleX: rule }] }} />
        <Animated.Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink2, opacity: line, transform: [{ translateY: range(5200, 5900, 10, 0) }] }}>
          Price the life you <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>want</Text>.
        </Animated.Text>
      </View>

      {skippable ? (
        <Pressable accessibilityRole="button" onPress={finish} hitSlop={12} style={{ position: "absolute", top: insets.top + 14, right: 20 }}>
          <Text style={{ fontFamily: fonts.figure, fontSize: 12, color: p.ink2, letterSpacing: 1 }}>Skip</Text>
        </Pressable>
      ) : null}
      <Grain />
    </Pressable>
  );
}
