import { useEffect, useRef, useState } from "react";
import { Animated, Text, View, useWindowDimensions } from "react-native";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { play, preloadSounds } from "../../lib/sound";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import type { FirstWish } from "../../lib/welcome";
import { Working } from "../chat/working";
import { Eyebrow, Glass, Money, Photo, PrimaryButton, QuietButton } from "../lux";
import { AmountPicker, PricelessPrice, glyphFor } from "../worth";

/** After this long the person can move on; the hunt keeps going and lands on their list. */
const PATIENT_MS = 40_000;

/**
 * What the card says after the reason a first wish couldn't be priced. The server sends the reason alone ("Couldn't
 * price that just now."), so this follows it once (owner, 2026-10-30: it used to say the list part twice).
 */
export const STAYS_ON_LIST = "It stays on your list, and the Dandy prices it after you save.";

/**
 * Their own first card, made in front of them (owner, 2026-10-29: "The first card needs to give you is the one that
 * you actually ... just made and needs to show it to you after you build it"). While the agent hunts, a held card and
 * one line of what it's doing; when the price lands, the real photo fades up with the price and where it came from.
 * Nothing pre-made stands in for it.
 *
 * Money itself and the priceless (owner, 2026-10-30): money asks "How much?" on a slider, starting at any amount the
 * wish named, with a checked photo when one is found; something priceless shows infinity and the Dandy's line. A card
 * without a photo never shows an empty box: the panel holds infinity, the currency's sign, or the wish's first letter.
 */
export function MadeStep({ wish, pricing, line, onContinue, onAmount, onPrice }: { wish: FirstWish; pricing: "idle" | "pricing" | "priced" | "failed"; line: string; onContinue(): void; onAmount(cents: number): void; onPrice(): void }) {
  const p = usePalette();
  const t = useType();
  const dandy = useDandy();
  const money = useMoney();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [patient, setPatient] = useState(false);
  const shown = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const option = wish.option;
  const worth = wish.worth;
  // The card has landed: a price, an amount to pick, or infinity.
  const landed = !!option || !!worth;
  const failed = !landed && pricing === "failed";

  useEffect(() => {
    const timer = setTimeout(() => setPatient(true), PATIENT_MS);
    return () => clearTimeout(timer);
  }, []);

  // The held card breathes slowly while it waits; it is still once anything lands, or the hunt gave up.
  useEffect(() => {
    if (reduced || landed || failed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1800, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(breathe, { toValue: 0, duration: 1800, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, landed, failed, breathe]);

  // Three soft felt notes as it lands, once: a better card replacing it later stays quiet.
  useEffect(() => preloadSounds("land"), []);
  useEffect(() => {
    if (landed) play("land");
  }, [landed]);

  // The real card fades up, slowly, when it lands; a card that couldn't be priced shows its panel at once.
  useEffect(() => {
    if (failed) return shown.setValue(1);
    if (!landed) return;
    Animated.timing(shown, { toValue: 1, duration: reduced ? 200 : 1400, easing: ease.cinema, useNativeDriver: native }).start();
  }, [landed, failed, reduced, shown]);

  const title = wish.title ?? wish.text;
  const cardW = Math.min(width - 2 * gutter, 420);
  const photo = option?.imageUrl ?? wish.photo?.imageUrl;
  // The amount slider needs the room under the photo, so a money card's photo is wide (4:3) and gives way on a short
  // screen, where the step's other parts take about 520 pt; every other card keeps its tall 4:5.
  const photoH = worth === "money" ? Math.max(120, Math.min(Math.round((cardW * 3) / 4), height - 520)) : Math.round((cardW * 5) / 4);
  // An older server added the list sentence itself; it is said once, here.
  const why = (wish.failed ?? "Couldn't price that just now.").replace(/\s*It stays on your list\.?\s*$/i, "");
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: gutter, gap: layout.stack.section }}>
      <View style={{ gap: layout.stack.tight, alignItems: "center" }}>
        <Eyebrow>{landed ? "Your first card" : failed ? "Your first wish" : "Making your card"}</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]} numberOfLines={3}>
          {title}
        </Text>
      </View>

      <View style={{ width: cardW, alignSelf: "center" }}>
        <Glass style={{ borderRadius: radius.lg, overflow: "hidden", padding: 0 }}>
          <View style={{ width: "100%", height: photoH }}>
            {/* Held: a soft glow breathing where the photo will land. */}
            <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.surface, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }) }} />
            {landed || failed ? (
              <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }] }}>
                <Photo uri={photo} glyph={glyphFor(worth, title, money.symbol)} style={{ width: "100%", height: "100%" }} />
              </Animated.View>
            ) : null}
          </View>
          <View style={{ padding: 18, gap: 8, minHeight: 104, justifyContent: "center" }}>
            {worth === "money" || worth === "priceless" ? (
              <Animated.View style={{ opacity: shown, gap: 4 }}>
                {worth === "money" ? <AmountPicker cents={wish.amountCents ?? 0} namedCents={wish.namedCents} onChange={onAmount} /> : <PricelessPrice line={wish.line} />}
                {/* The reading can be wrong ("a gold bar" is a thing to buy): hunt it as an ordinary wish instead. */}
                <QuietButton label="Price it" onPress={onPrice} style={{ alignSelf: "flex-start" }} />
              </Animated.View>
            ) : option ? (
              <Animated.View style={{ gap: 6, opacity: shown }}>
                <Money cents={option.upfrontCents} size="card" rollOnMount="cinema" />
                <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
                  {option.statusLabel}
                </Text>
              </Animated.View>
            ) : failed ? (
              <Text style={[type.callout, { color: p.ink2 }]}>{`${why} ${STAYS_ON_LIST}`}</Text>
            ) : (
              <Working dandy={dandy} label={line || `Hunting for ${title}`} />
            )}
          </View>
        </Glass>
      </View>

      <View style={{ minHeight: layout.control.primary }}>
        {landed || failed ? (
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
