import { useEffect, useRef, useState } from "react";
import { Animated, Text, View, useWindowDimensions } from "react-native";
import { useDandy } from "../../lib/dandy";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { play, preloadSounds } from "../../lib/sound";
import { fonts, layout, radius, type, usePalette, useType } from "../../lib/theme";
import type { FirstWish } from "../../lib/welcome";
import { Working } from "../chat/working";
import { Eyebrow, Glass, Money, Photo, PrimaryButton } from "../lux";

/** After this long the person can move on; the hunt keeps going and lands on their list. */
const PATIENT_MS = 40_000;

/**
 * Their own first card, made in front of them (owner, 2026-10-29: "The first card needs to give you is the one that
 * you actually ... just made and needs to show it to you after you build it"). While the agent hunts, a held card and
 * one line of what it's doing; when the price lands, the real photo fades up with the price and where it came from.
 * Nothing pre-made stands in for it.
 */
export function MadeStep({ wish, pricing, line, onContinue }: { wish: FirstWish; pricing: "idle" | "pricing" | "priced" | "failed"; line: string; onContinue(): void }) {
  const p = usePalette();
  const t = useType();
  const dandy = useDandy();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [patient, setPatient] = useState(false);
  const shown = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const option = wish.option;

  useEffect(() => {
    const timer = setTimeout(() => setPatient(true), PATIENT_MS);
    return () => clearTimeout(timer);
  }, []);

  // The held card breathes slowly while it waits.
  useEffect(() => {
    if (reduced || option) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1800, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(breathe, { toValue: 0, duration: 1800, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, option, breathe]);

  // Three soft felt notes as it lands, once: a better card replacing it later stays quiet.
  useEffect(() => preloadSounds("land"), []);
  const landed = !!option;
  useEffect(() => {
    if (landed) play("land");
  }, [landed]);

  // The real card fades up, slowly, when it lands.
  useEffect(() => {
    if (!option) return;
    Animated.timing(shown, { toValue: 1, duration: reduced ? 200 : 1400, easing: ease.cinema, useNativeDriver: native }).start();
  }, [option, reduced, shown]);

  const title = wish.title ?? wish.text;
  const cardW = Math.min(width - 2 * gutter, 420);
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: gutter, gap: layout.stack.section }}>
      <View style={{ gap: layout.stack.tight, alignItems: "center" }}>
        <Eyebrow>{option ? "Your first card" : pricing === "failed" ? "Your first wish" : "Making your card"}</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]} numberOfLines={3}>
          {title}
        </Text>
      </View>

      <View style={{ width: cardW, alignSelf: "center" }}>
        <Glass style={{ borderRadius: radius.lg, overflow: "hidden", padding: 0 }}>
          <View style={{ width: "100%", aspectRatio: 4 / 5 }}>
            {/* Held: a soft glow breathing where the photo will land. */}
            <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.surface, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }) }} />
            {option?.imageUrl ? (
              <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }] }}>
                <Photo uri={option.imageUrl} style={{ width: "100%", height: "100%" }} />
              </Animated.View>
            ) : null}
          </View>
          <View style={{ padding: 18, gap: 8, minHeight: 104, justifyContent: "center" }}>
            {option ? (
              <Animated.View style={{ gap: 6, opacity: shown }}>
                <Money cents={option.upfrontCents} size="card" rollOnMount="cinema" />
                <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
                  {option.statusLabel}
                </Text>
              </Animated.View>
            ) : pricing === "failed" ? (
              <Text style={[type.callout, { color: p.ink2 }]}>{wish.failed ?? "Couldn't price that just now."} It stays on your list, and the Dandy prices it after you save.</Text>
            ) : (
              <Working dandy={dandy} label={line || `Hunting for ${title}`} />
            )}
          </View>
        </Glass>
      </View>

      <View style={{ minHeight: layout.control.primary }}>
        {option || pricing === "failed" ? (
          <PrimaryButton label="Keep going" onPress={onContinue} />
        ) : patient ? (
          <View style={{ gap: 8 }}>
            <Text style={[type.footnote, { color: p.ink3, textAlign: "center" }]}>Still hunting. It lands on your list when it's ready.</Text>
            <PrimaryButton label="Keep going" onPress={onContinue} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
