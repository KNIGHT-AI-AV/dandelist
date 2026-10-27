import type { Entry } from "@dandelist/catalogue";
import { heroOf } from "@dandelist/catalogue";
import { formatCents } from "@dandelist/cost";
import { useEffect, useRef, useState } from "react";
import { Animated, Linking, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLICK, ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { fonts, layout, radius, shadow, type, usePalette, useType } from "../../lib/theme";
import { monthYearLong } from "../../lib/welcome";
import { ErrorLine, Eyebrow, Glass, GlassField, Money, PrimaryButton, QuietButton } from "../lux";
import { Odometer } from "../odometer";
import { GlassReveal } from "../reveal";

/**
 * Step 7, the peak: "Your life: $X. Yours by Month Year." on one centred axis. The picks that have photographs fan
 * into a still life, the figure spins on every wheel and lands on the total it already showed (it never counts up
 * from $0) with the one success haptic, the date rises in, and a single champagne light crosses the glyphs.
 */
export function RevealCard({ picks, upfrontCents, monthlyRunningCents, everythingBy, onKeep, onChange }: { picks: Entry[]; upfrontCents: number; monthlyRunningCents: number; everythingBy: string; onKeep(): void; onChange(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const card = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const date = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const withPhotos = picks.filter((e) => heroOf(e));
  const shown = withPhotos.length >= 3 ? withPhotos.slice(0, 5) : [withPhotos[0] ?? picks[0]].filter((e): e is Entry => !!e);
  const fans = useRef(shown.map(() => new Animated.Value(reduced ? 1 : 0))).current;
  const [figureW, setFigureW] = useState(0);
  const by = monthYearLong(new Date(`${everythingBy}-01T00:00:00`));
  const single = shown.length < 3;

  useEffect(() => {
    if (reduced) return;
    Animated.spring(card, { toValue: 1, ...spring.reveal, useNativeDriver: native }).start();
    Animated.stagger(70, fans.map((f) => Animated.spring(f, { toValue: 1, ...spring.settle, useNativeDriver: native }))).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const landed = () => {
    haptic.success();
    if (reduced) return;
    Animated.timing(date, { toValue: 1, duration: 600, easing: ease.out, useNativeDriver: native }).start();
    Animated.timing(sweep, { toValue: 1, duration: 1100, delay: 120, easing: ease.inOut, useNativeDriver: native }).start();
  };

  const hero = t.hero.fontSize ?? 56;
  const WINDOW = 56;
  const windowX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-WINDOW, figureW] });
  return (
    <Animated.View style={{ flex: 1, justifyContent: "center", paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: layout.column + 2 * layout.gutter(width), width: "100%", alignSelf: "center", opacity: card, transform: [{ scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
      {/* The still life: the picks fanned like prints on a table, each arriving through film. */}
      <View style={{ height: single ? 200 : 168, alignItems: "center", justifyContent: "center" }}>
        {shown.map((e, i) => {
          const mid = (shown.length - 1) / 2;
          const angle = shown.length > 1 ? ((i - mid) / mid) * 8 : 0;
          const w = single ? 140 : 104;
          const h = single ? 188 : 140;
          return (
            <Animated.View
              key={e.id}
              style={{
                position: "absolute",
                width: w,
                height: h,
                borderRadius: radius.sm,
                boxShadow: shadow.print,
                opacity: fans[i],
                transform: [
                  { translateX: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [0, (i - mid) * 56] }) },
                  { translateY: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [20, Math.abs(i - mid) * 7] }) },
                  { rotate: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${angle}deg`] }) },
                ],
              }}
            >
              <View style={{ flex: 1, borderRadius: radius.sm, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair }}>
                <GlassReveal uri={heroOf(e) ?? null} standby={require("../../assets/standby/object.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
              </View>
            </Animated.View>
          );
        })}
      </View>
      <View style={{ gap: 12, alignItems: "center" }}>
        <Eyebrow>Your life</Eyebrow>
        <View onLayout={(e) => setFigureW(e.nativeEvent.layout.width)}>
          <Money cents={upfrontCents} size="hero" rollOnMount="cinema" onLand={landed} />
          {/* The light crosses the glyphs only: a narrow window slides over a champagne copy that stays put (P0-5).
              Two nested windows (56 px soft, 24 px bright) give the band a soft edge on every platform. */}
          {!reduced && figureW > 0
            ? ([[WINDOW, 0.5], [24, 0.9]] as const).map(([win, alpha]) => {
                const x = Animated.add(windowX, (WINDOW - win) / 2);
                return (
                  <Animated.View key={win} pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width: win, height: Math.round(hero * 1.18), overflow: "hidden", transform: [{ translateX: x }], opacity: sweep.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, alpha, alpha, 0] }) }}>
                    <Animated.View style={{ width: figureW, transform: [{ translateX: Animated.multiply(x, -1) }] }}>
                      <Odometer cents={upfrontCents} format={formatCents} size={hero} family="bodoni" smallPrefix tracking={-0.02 * hero} color={p.shine} prefixColor={p.shine} glow={p.accent} mode="instant" />
                    </Animated.View>
                  </Animated.View>
                );
              })
            : null}
        </View>
        <Animated.Text style={[t.title2, { color: p.ink, textAlign: "center", opacity: date, transform: [{ translateY: date.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          Yours by <Text style={{ fontFamily: fonts.titleItalic, color: p.accentText }}>{by}</Text>.
        </Animated.Text>
        <Animated.Text style={[type.figure13, { color: p.ink2, textAlign: "center", opacity: date }]}>
          {monthlyRunningCents ? `Running costs once it's yours: ${formatCents(Math.round(monthlyRunningCents))}/mo` : "No running costs"}
        </Animated.Text>
      </View>
      <View style={{ gap: 4 }}>
        <PrimaryButton label="Keep this life" commit onPress={onKeep} />
        <QuietButton label="Change picks" onPress={onChange} />
      </View>
    </Animated.View>
  );
}

const mask = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

/** The code slot's caret: 2 × 24 in the accent, blinking in 530 ms steps. */
function Caret() {
  const p = usePalette();
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn((v) => !v), 530);
    return () => clearInterval(t);
  }, []);
  return <View style={{ width: 2, height: 24, borderRadius: 1, backgroundColor: p.accentText, opacity: on ? 1 : 0 }} />;
}

/**
 * Step 8: a sheet over the chosen look, so the peak stays close. A thick material (HIG: text-heavy layers get the
 * thicker glass), a grabber, and a drag or flick to dismiss. One field per screen: email, then a single code input
 * drawn as six slots (paste and one-time-code autofill keep working because it's one real input); the sheet's
 * height morphs between them. Submits on the sixth digit; a wrong code shakes, buzzes and keeps the digits.
 */
export function CodeSheet({ startEmail, verifyEmail, onClose, extra }: { startEmail(email: string): Promise<void>; verifyEmail(email: string, code: string): Promise<void>; onClose(): void; extra?: React.ReactNode }) {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { height: winH, width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const up = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(0)).current;
  const [measured, setMeasured] = useState(false);
  const sheetH = useRef(420);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    Animated.timing(up, { toValue: 1, duration: reduced ? 200 : 500, easing: ease.sheet, useNativeDriver: native }).start();
  }, [up, reduced]);
  useEffect(() => {
    if (!resendIn) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const close = () => Animated.timing(up, { toValue: 0, duration: reduced ? 150 : 300, easing: ease.sheet, useNativeDriver: native }).start(onClose);
  // Drag down to dismiss: a flick over 0.11 px/ms or a drag past 35% of the sheet closes it; otherwise it snaps back.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.vy > FLICK || g.dy > sheetH.current * 0.35) {
          Animated.timing(drag, { toValue: sheetH.current + 40, duration: 220, easing: ease.out, useNativeDriver: native }).start(onClose);
        } else Animated.spring(drag, { toValue: 0, ...spring.snap, useNativeDriver: native }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, ...spring.snap, useNativeDriver: native }).start(),
    }),
  ).current;

  const send = async (to = email.trim()) => {
    setBusy(true);
    setError(null);
    try {
      await startEmail(to);
      setSentTo(to);
      setResendIn(30);
      setTimeout(() => input.current?.focus(), 350);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (c: string) => {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(sentTo, c);
      haptic.soft();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      if (!reduced) Animated.sequence([-6, 6, -4, 4, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 60, useNativeDriver: native }))).start();
    } finally {
      setBusy(false);
    }
  };

  const gutter = layout.gutter(width);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: up }]}>
        <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, 0.55)` }]} onPress={close} />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", transform: [{ translateY: Animated.add(up.interpolate({ inputRange: [0, 1], outputRange: [Math.min(winH, 640), 0] }), drag) }] }}
      >
        <Glass
          intensity={40}
          tint={p.sheet}
          style={{ width: "100%", maxWidth: layout.column, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: `rgba(${p.inkRgb}, 0.18)` }}
        >
          <View style={{ alignItems: "center", paddingTop: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={{ width: 36, height: 5, borderRadius: 2.5, backgroundColor: `rgba(${p.inkRgb}, 0.28)` }} />
          </View>
          {/* The height follows the content on a settle spring, so email → code morphs instead of jumping. */}
          <Animated.View style={measured ? { height, overflow: "hidden" } : null}>
            <View
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                sheetH.current = h + 13;
                if (!measured) {
                  height.setValue(h);
                  setMeasured(true);
                } else Animated.spring(height, { toValue: h, ...spring.settle, useNativeDriver: false }).start();
              }}
              style={[measured ? { position: "absolute", left: 0, right: 0, top: 0 } : null, { paddingHorizontal: gutter, paddingTop: 20, paddingBottom: insets.bottom + 24, gap: 16 }]}
            >
              {!sentTo ? (
                <>
                  <Eyebrow>Save your life list</Eyebrow>
                  <Text style={[t.title2, { color: p.ink }]}>Where should we keep it?</Text>
                  {extra}
                  <GlassField label="Email" value={email} onChangeText={setEmail} autoFocus={!extra} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" placeholder="you@example.com" onSubmitEditing={() => send()} />
                  <ErrorLine>{error}</ErrorLine>
                  <PrimaryButton label="Send code" busyLabel="Sending..." busy={busy} disabled={!email.includes("@")} onPress={() => send()} />
                </>
              ) : (
                <>
                  <Eyebrow>One step</Eyebrow>
                  <Text style={[t.title2, { color: p.ink }]}>{`Code sent to ${mask(sentTo)}`}</Text>
                  <Animated.View style={{ transform: [{ translateX: shake }] }}>
                    <Pressable onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8 }} accessibilityLabel="Six-digit code">
                      {Array.from({ length: 6 }, (_, i) => (
                        <View key={i} style={{ flex: 1, height: 58, borderRadius: radius.sm, borderWidth: 1, borderColor: error ? p.danger : focused && i === code.length ? p.accentText : p.line, alignItems: "center", justifyContent: "center", backgroundColor: p.glassTint }}>
                          {code[i] ? <Text style={[type.title2, { fontFamily: fonts.title, color: p.ink, fontVariant: ["tabular-nums"] }]}>{code[i]}</Text> : focused && i === code.length ? <Caret /> : null}
                        </View>
                      ))}
                    </Pressable>
                    <TextInput
                      ref={input}
                      value={code}
                      onChangeText={(v) => {
                        const c = v.replace(/\D/g, "").slice(0, 6);
                        setCode(c);
                        if (c.length === 6) void verify(c);
                      }}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      caretHidden
                      style={[StyleSheet.absoluteFill, { opacity: 0.01, color: "transparent" }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null]}
                    />
                  </Animated.View>
                  <ErrorLine>{error}</ErrorLine>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    {Platform.OS !== "web" ? <QuietButton label="Open Mail" onPress={() => Linking.openURL(Platform.OS === "ios" ? "message://" : "mailto:")} /> : null}
                    <QuietButton label={resendIn ? `Resend in ${resendIn} s` : "Resend code"} onPress={() => !resendIn && send(sentTo)} />
                    <QuietButton label="Use a different email" onPress={() => { setSentTo(null); setCode(""); setError(null); }} />
                  </View>
                  <Text style={[type.footnote, { color: p.ink3 }]}>Not there? Check spam.</Text>
                </>
              )}
            </View>
          </Animated.View>
        </Glass>
      </Animated.View>
    </View>
  );
}
