import type { Listing } from "@dandelist/catalogue/dream";
import { useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { moneyIn } from "../../lib/dream";
import { fonts, radius, usePalette, type } from "../../lib/theme";
import { hostOf } from "../../lib/welcome";
import { Eyebrow, Icon, Shade } from "../lux";
import { Slideshow } from "../media";
import { GlassReveal } from "../reveal";

const MAX_TILT = 12;

/** One listing as a full-bleed card: its own photographs (a slideshow when there are several), price, facts, source. */
function ListingCard({ l }: { l: Listing }) {
  const p = usePalette();
  const { fontScale } = useWindowDimensions();
  const hasSlideshow = l.images.length > 1;
  // Reserve Slideshow's bottom inset, one scaled credit line and an 8px gap before its credit appears.
  const detailsBottom = hasSlideshow ? 10 + type.figure.lineHeight * fontScale + 8 : 20;
  return (
    <View style={{ flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: p.surface }}>
      {hasSlideshow ? (
        <Slideshow images={l.images} interval={3800} style={StyleSheet.absoluteFill}>
          <Shade from={0.38} />
        </Slideshow>
      ) : (
        <GlassReveal uri={l.images[0]?.url ?? null} standby={require("../../assets/standby/life.jpg")} stage="clear" treatment="swirl" finish={!!l.images[0]?.generated} style={StyleSheet.absoluteFill} />
      )}
      {!hasSlideshow ? <Shade from={0.38} /> : null}
      <View style={{ position: "absolute", left: 20, right: 20, bottom: detailsBottom, gap: 8 }}>
        <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
          {l.title}
        </Text>
        <Text style={[type.cardPrice, { color: p.ink }]}>
          {moneyIn(l.currency)(l.priceCents)}
          {l.status === "estimate" ? <Text style={[type.figure, { color: p.ink2 }]}>{"  estimate"}</Text> : null}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {l.facts.slice(0, 4).map((f) => (
            <View key={f} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: p.glassTint, borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair }}>
              <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink }]}>{f}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.figure, { color: p.ink2 }]} numberOfLines={1}>{`${l.source || hostOf(l.url)}${l.region ? ` · ${l.region}` : ""}`}</Text>
      </View>
    </View>
  );
}

/**
 * Swipe right for yes, left for no; the buttons do the same. The top card follows the finger 1:1 and tilts up to
 * ±12°; it commits past 35% of the width or above 900 px/s, otherwise springs home. The next card rises as you drag.
 * When the last card goes, the server prices the best one they liked as the wish, or deals more when they liked none
 * (owner, 2026-10-31: "Ending up with no pick").
 */
export function SwipeDeck({ cards, onSwipe, onPick, onSearchNow, onEnough }: { cards: Listing[]; onSwipe(l: Listing, verdict: "yes" | "no"): void; onPick(l: Listing): void; onSearchNow(): void; onEnough(): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - 32, 520);
  const [index, setIndex] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const liked = useRef(false);
  const top = cards[index];
  const next = cards[index + 1];

  const commit = (verdict: "yes" | "no", vx = 0) => {
    if (!top || busy.current) return;
    busy.current = true;
    haptic.select();
    const out = (verdict === "yes" ? 1 : -1) * (cardW * 1.4);
    const done = () => {
      if (verdict === "yes") liked.current = true;
      onSwipe(top, verdict);
      x.setValue(0);
      y.setValue(0);
      setIndex((i) => i + 1);
      busy.current = false;
    };
    if (reduced) return done();
    Animated.timing(x, { toValue: out, duration: Math.max(140, 220 - Math.abs(vx) * 40), easing: ease.out, useNativeDriver: native }).start(done);
  };

  // The responder is made once, so it reaches the card on top now, and the width now, through refs: it used to keep
  // the first card's, so every swipe after the first was sent as the first card's again (Codex, round 44).
  const latest = useRef({ commit, cardW });
  latest.current = { commit, cardW };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        x.setValue(g.dx);
        y.setValue(g.dy * 0.15);
      },
      onPanResponderRelease: (_e, g) => {
        const far = Math.abs(g.dx) > latest.current.cardW * 0.35;
        const fast = Math.abs(g.vx) * 1000 > 900;
        if ((far || fast) && Math.sign(g.dx || g.vx) !== 0) return latest.current.commit(g.dx + g.vx > 0 ? "yes" : "no", g.vx);
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
        <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink2 }]}>{liked.current ? "Pricing your best match." : "None of those. Finding more."}</Text>
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
            <Text style={[type.button, { letterSpacing: 2, color: p.accentText }]}>YES</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={{ position: "absolute", top: 22, right: 20, opacity: no, borderWidth: 1.5, borderColor: p.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, transform: [{ rotate: "8deg" }] }}>
            <Text style={[type.button, { letterSpacing: 2, color: p.ink }]}>PASS</Text>
          </Animated.View>
        </Animated.View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <RoundButton label="Pass" icon="close" onPress={() => commit("no")} />
        <Eyebrow>{`${index + 1} of ${cards.length}`}</Eyebrow>
        <RoundButton label="Yes" icon="heart" accent onPress={() => commit("yes")} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 22, rowGap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => top && onPick(top)} hitSlop={10}>
          <Text style={[type.footnote, { fontFamily: fonts.label, color: p.accentText }]}>Choose this one</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onSearchNow} hitSlop={10}>
          <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]}>Just search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEnough} hitSlop={10}>
          <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]}>That's enough, show the best</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Pass and Yes under the deck: 58 pt discs holding lux line icons at 24 pt (the text glyphs before them were 23). */
function RoundButton({ label, icon, accent = false, onPress }: { label: string; icon: "close" | "heart"; accent?: boolean; onPress(): void }) {
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
        <Icon name={icon} size={24} color={accent ? p.onAccent : p.ink} />
      </Animated.View>
    </Pressable>
  );
}
