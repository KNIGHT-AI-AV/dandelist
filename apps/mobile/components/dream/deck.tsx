import type { Listing } from "@dandelist/catalogue/dream";
import { useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, radius, usePalette } from "../../lib/theme";
import { hostOf } from "../../lib/welcome";
import { Eyebrow, Shade } from "../lux";
import { Slideshow } from "../media";
import { GlassReveal } from "../reveal";

const MAX_TILT = 12;

/** One listing as a full-bleed card: its own photographs (a slideshow when there are several), price, facts, source. */
function ListingCard({ l }: { l: Listing }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: p.surface }}>
      {l.images.length > 1 ? (
        <Slideshow images={l.images} interval={3800} style={StyleSheet.absoluteFill} />
      ) : (
        <GlassReveal uri={l.images[0]?.url ?? null} standby={require("../../assets/standby/life.jpg")} stage="clear" treatment="swirl" finish={!!l.images[0]?.generated} style={StyleSheet.absoluteFill} />
      )}
      <Shade from={0.38} />
      <View style={{ position: "absolute", left: 20, right: 20, bottom: 20, gap: 8 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 27, lineHeight: 31, color: p.ink }} numberOfLines={2}>
          {l.title}
        </Text>
        <Text style={{ fontFamily: fonts.display, fontSize: 24, color: p.ink }}>{formatCents(l.priceCents)}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {l.facts.slice(0, 4).map((f) => (
            <View key={f} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: p.glassTint, borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair }}>
              <Text style={{ fontFamily: fonts.label, fontSize: 11.5, color: p.ink }}>{f}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontFamily: fonts.figure, fontSize: 11, color: p.ink2 }} numberOfLines={1}>{`${l.source || hostOf(l.url)}${l.region ? ` · ${l.region}` : ""}`}</Text>
      </View>
    </View>
  );
}

/**
 * Swipe right for yes, left for no; the buttons do the same. The top card follows the finger 1:1 and tilts up to
 * ±12°; it commits past 35% of the width or above 900 px/s, otherwise springs home. The next card rises as you drag.
 */
export function SwipeDeck({ cards, onSwipe, onSearchNow, onEnough }: { cards: Listing[]; onSwipe(l: Listing, verdict: "yes" | "no"): void; onSearchNow(): void; onEnough(): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - 32, 520);
  const [index, setIndex] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const top = cards[index];
  const next = cards[index + 1];

  const commit = (verdict: "yes" | "no", vx = 0) => {
    if (!top || busy.current) return;
    busy.current = true;
    haptic.select();
    const out = (verdict === "yes" ? 1 : -1) * (cardW * 1.4);
    const done = () => {
      onSwipe(top, verdict);
      x.setValue(0);
      y.setValue(0);
      setIndex((i) => i + 1);
      busy.current = false;
    };
    if (reduced) return done();
    Animated.timing(x, { toValue: out, duration: Math.max(140, 220 - Math.abs(vx) * 40), easing: ease.out, useNativeDriver: native }).start(done);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        x.setValue(g.dx);
        y.setValue(g.dy * 0.15);
      },
      onPanResponderRelease: (_e, g) => {
        const far = Math.abs(g.dx) > cardW * 0.35;
        const fast = Math.abs(g.vx) * 1000 > 900;
        if ((far || fast) && Math.sign(g.dx || g.vx) !== 0) return commit(g.dx + g.vx > 0 ? "yes" : "no", g.vx);
        Animated.parallel([
          Animated.spring(x, { toValue: 0, ...spring.snap, useNativeDriver: native }),
          Animated.spring(y, { toValue: 0, ...spring.snap, useNativeDriver: native }),
        ]).start();
      },
    }),
  ).current;

  if (!top) {
    return (
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
        <Text style={{ fontFamily: fonts.displayItalic, fontSize: 20, color: p.ink2 }}>That's this round.</Text>
      </View>
    );
  }

  const rotate = x.interpolate({ inputRange: [-cardW, 0, cardW], outputRange: [`-${MAX_TILT}deg`, "0deg", `${MAX_TILT}deg`], extrapolate: "clamp" });
  const nextScale = x.interpolate({ inputRange: [-cardW / 2, 0, cardW / 2], outputRange: [1, 0.95, 1], extrapolate: "clamp" });
  const yes = x.interpolate({ inputRange: [0, cardW * 0.3], outputRange: [0, 1], extrapolate: "clamp" });
  const no = x.interpolate({ inputRange: [-cardW * 0.3, 0], outputRange: [1, 0], extrapolate: "clamp" });

  return (
    <View style={{ gap: 14, alignItems: "center" }}>
      <View style={{ width: cardW, height: cardW * 1.22 }}>
        {next ? (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: nextScale }] }]}>
            <ListingCard l={next} />
          </Animated.View>
        ) : null}
        <Animated.View {...pan.panHandlers} style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }, { translateY: y }, { rotate }] }]}>
          <ListingCard l={top} />
          <Animated.View pointerEvents="none" style={{ position: "absolute", top: 22, left: 20, opacity: yes, borderWidth: 1.5, borderColor: p.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, transform: [{ rotate: "-8deg" }] }}>
            <Text style={{ fontFamily: fonts.label, fontSize: 16, letterSpacing: 2, color: p.accent }}>YES</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={{ position: "absolute", top: 22, right: 20, opacity: no, borderWidth: 1.5, borderColor: p.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, transform: [{ rotate: "8deg" }] }}>
            <Text style={{ fontFamily: fonts.label, fontSize: 16, letterSpacing: 2, color: p.ink }}>PASS</Text>
          </Animated.View>
        </Animated.View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <RoundButton label="Pass" glyph="✕" onPress={() => commit("no")} />
        <Eyebrow>{`${index + 1} of ${cards.length}`}</Eyebrow>
        <RoundButton label="Yes" glyph="♥" accent onPress={() => commit("yes")} />
      </View>
      <View style={{ flexDirection: "row", gap: 22 }}>
        <Pressable accessibilityRole="button" onPress={onSearchNow} hitSlop={10}>
          <Text style={{ fontFamily: fonts.label, fontSize: 13.5, color: p.ink2 }}>Just search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEnough} hitSlop={10}>
          <Text style={{ fontFamily: fonts.label, fontSize: 13.5, color: p.ink2 }}>That's enough, show the best</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RoundButton({ label, glyph, accent = false, onPress }: { label: string; glyph: string; accent?: boolean; onPress(): void }) {
  const p = usePalette();
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => Animated.spring(s, { toValue: 0.92, ...spring.press, useNativeDriver: native }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1, ...spring.press, useNativeDriver: native }).start()}
      onPress={onPress}
    >
      <Animated.View style={{ width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: accent ? p.accent : p.glassTint, borderWidth: StyleSheet.hairlineWidth, borderColor: accent ? p.accent : p.hair, transform: [{ scale: s }] }}>
        <Text style={{ fontSize: 22, color: accent ? p.onAccent : p.ink }}>{glyph}</Text>
      </Animated.View>
    </Pressable>
  );
}
