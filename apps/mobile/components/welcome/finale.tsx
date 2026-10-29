import { heroFor, heroOf } from "@dandelist/catalogue";
import { formatCents } from "../../lib/money";
import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Linking, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLICK, ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { fonts, layout, radius, shadow, space, type, usePalette, useType } from "../../lib/theme";
import { type PoolItem } from "../../lib/welcome";
import { useDandy } from "../../lib/dandy";
import { DandyAvatar } from "../dandy-avatar";
import { Chip, Rise } from "./kit";
import { CodeField, DismissKeyboard, Field, isEmail, useKeyboardLift, type CodeFieldHandle } from "../inputs";
import { Eyebrow, Glass, Money, PrimaryButton, QuietButton } from "../lux";
import { Odometer, dollars } from "../odometer";
import { GlassReveal } from "../reveal";

/**
 * The peak: the list as a deck that shuffles and spreads, then "Your Dandelist: $X", curated by the person's Dandy.
 * No dates and no budgets (owner, 2026-10-28: "we're not telling them when they're gonna have this, we're just showing
 * them what it is"). The cards arrive stacked, riffle twice like a dealer's shuffle, then fan out across the table;
 * the figure spins on every wheel and lands with the one success haptic, and a champagne light crosses the glyphs.
 * "Start over?" asks before it clears anything.
 */
export function RevealCard({ picks, upfrontCents, monthlyRunningCents, onKeep, onRestart }: { picks: PoolItem[]; upfrontCents: number; monthlyRunningCents: number; onKeep(): void; onRestart(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const dandy = useDandy();
  const card = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const date = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const riffle = useRef(new Animated.Value(0)).current;
  const withPhotos = picks.filter((e) => heroOf(e));
  const shown = (withPhotos.length ? withPhotos : picks).slice(0, 7);
  const fans = useRef(shown.map(() => new Animated.Value(reduced ? 1 : 0))).current;
  const [figureW, setFigureW] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const checked = picks.filter((e) => e.status === "verified").length;

  useEffect(() => {
    if (reduced) return;
    Animated.spring(card, { toValue: 1, ...spring.reveal, useNativeDriver: native }).start();
    // Stacked, then two riffles, then the spread.
    Animated.sequence([
      Animated.delay(200),
      Animated.timing(riffle, { toValue: 1, duration: 260, easing: ease.inOut, useNativeDriver: native }),
      Animated.timing(riffle, { toValue: 0, duration: 220, easing: ease.inOut, useNativeDriver: native }),
      Animated.timing(riffle, { toValue: 1, duration: 240, easing: ease.inOut, useNativeDriver: native }),
      Animated.timing(riffle, { toValue: 0, duration: 200, easing: ease.inOut, useNativeDriver: native }),
      Animated.stagger(60, fans.map((f) => Animated.spring(f, { toValue: 1, ...spring.settle, useNativeDriver: native }))),
    ]).start();
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
  const w = 92;
  const h = 124;
  const mid = (shown.length - 1) / 2;
  const spread = Math.min(46, (Math.min(width, 520) - 2 * layout.gutter(width) - w) / Math.max(1, shown.length - 1));
  const facts = [`${picks.length} ${picks.length === 1 ? "wish" : "wishes"}`, checked ? `${checked} checked on the seller's own site` : null, monthlyRunningCents ? `${formatCents(Math.round(monthlyRunningCents))} a month to keep` : null].filter(Boolean).join(" · ");
  return (
    <Animated.View style={{ flex: 1, justifyContent: "center", paddingHorizontal: layout.gutter(width), gap: layout.stack.section, maxWidth: layout.column + 2 * layout.gutter(width), width: "100%", alignSelf: "center", opacity: card, transform: [{ scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
      {/* The deck: stacked, riffled, then fanned across the table like prints. */}
      <View style={{ height: h + 40, alignItems: "center", justifyContent: "center" }}>
        {shown.map((e, i) => {
          const off = i - mid;
          const side = i % 2 ? 1 : -1;
          const angle = shown.length > 1 ? (off / Math.max(1, mid)) * 12 : 0;
          return (
            <Animated.View
              key={e.id}
              style={{
                position: "absolute",
                width: w,
                height: h,
                borderRadius: radius.sm,
                boxShadow: shadow.print,
                transform: [
                  { translateX: Animated.add(fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [i * 0.6, off * spread] }), riffle.interpolate({ inputRange: [0, 1], outputRange: [0, side * 34] })) },
                  { translateY: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [-i * 0.8, Math.abs(off) * 6] }) },
                  { rotate: Animated.add(fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [0, angle] }), riffle.interpolate({ inputRange: [0, 1], outputRange: [0, side * 5] })).interpolate({ inputRange: [-90, 90], outputRange: ["-90deg", "90deg"] }) },
                ],
              }}
            >
              <View style={{ flex: 1, borderRadius: radius.sm, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair, backgroundColor: p.surface }}>
                <GlassReveal uri={heroFor(e, w / h) ?? null} standby={require("../../assets/standby/object.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
              </View>
            </Animated.View>
          );
        })}
      </View>
      <View style={{ gap: 12, alignItems: "center" }}>
        <Eyebrow>Your Dandelist</Eyebrow>
        <View onLayout={(e) => setFigureW(e.nativeEvent.layout.width)}>
          <Money cents={upfrontCents} size="hero" format={dollars} rollOnMount="cinema" onLand={landed} />
          {/* The light crosses the glyphs only: a narrow window slides over a champagne copy that stays put (P0-5).
              Two nested windows (56 px soft, 24 px bright) give the band a soft edge on every platform. */}
          {!reduced && figureW > 0
            ? ([[WINDOW, 0.5], [24, 0.9]] as const).map(([win, alpha]) => {
                const x = Animated.add(windowX, (WINDOW - win) / 2);
                return (
                  <Animated.View key={win} pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width: win, height: Math.round(hero * 1.18), overflow: "hidden", transform: [{ translateX: x }], opacity: sweep.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, alpha, alpha, 0] }) }}>
                    <Animated.View style={{ width: figureW, transform: [{ translateX: Animated.multiply(x, -1) }] }}>
                      <Odometer cents={upfrontCents} format={dollars} size={hero} family="bodoni" smallPrefix tracking={-0.02 * hero} color={p.shine} prefixColor={p.shine} glow={p.accent} mode="instant" />
                    </Animated.View>
                  </Animated.View>
                );
              })
            : null}
        </View>
        <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: date, transform: [{ translateY: date.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <DandyAvatar dandy={dandy} size={28} />
          <Text style={[t.title2, { color: p.ink }]}>
            Curated by <Text style={{ fontFamily: fonts.titleItalic, color: p.accentText }}>{dandy.name}</Text>
          </Text>
        </Animated.View>
        <Animated.Text style={[type.figure13, { color: p.ink2, textAlign: "center", opacity: date }]}>{facts}</Animated.Text>
      </View>
      {confirm ? (
        <Rise style={{ gap: 10 }}>
          <Text style={[type.callout, { color: p.ink, textAlign: "center" }]}>Start over? Your list and picks will be cleared.</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Chip label="Keep my list" onPress={() => setConfirm(false)} style={{ flex: 1 }} />
            <Chip label="Start over" onPress={() => { haptic.select(); onRestart(); }} style={{ flex: 1 }} />
          </View>
        </Rise>
      ) : (
        <View style={{ gap: 4 }}>
          <PrimaryButton label="Keep my Dandelist" commit onPress={onKeep} />
          <QuietButton label="Start over?" onPress={() => setConfirm(true)} />
        </View>
      )}
    </Animated.View>
  );
}

const mask = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

const EMAIL_INVALID = "Enter a full email address.";
/** The sheet's padding under its last control; while typing, that control rides the same distance above the keyboard. */
const SHEET_FOOT = space[24];

/**
 * Step 8: a sheet over the chosen look, so the peak stays close. A thick material (HIG: text-heavy layers get the
 * thicker glass), a grabber, and a drag or flick to dismiss. One field per screen: email, then a single code input
 * drawn as six slots (paste and one-time-code autofill keep working because it's one real input); the sheet's
 * height morphs between them. The sheet rides up with the keyboard on the keyboard's own curve. Submits on the
 * sixth digit; a wrong code shakes, buzzes, clears and keeps focus.
 */
export function CodeSheet({ startEmail, verifyEmail, onClose, extra }: { startEmail(email: string): Promise<void>; verifyEmail(email: string, code: string): Promise<void>; onClose(): void; extra?: React.ReactNode }) {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { height: winH, width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const up = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(0)).current;
  const lift = useKeyboardLift(insets.bottom + SHEET_FOOT, SHEET_FOOT);
  const [measured, setMeasured] = useState(false);
  const sheetH = useRef(420);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const emailInput = useRef<TextInput>(null);
  const codeInput = useRef<CodeFieldHandle>(null);

  useEffect(() => {
    Animated.timing(up, { toValue: 1, duration: reduced ? 200 : 500, easing: ease.sheet, useNativeDriver: native }).start();
  }, [up, reduced]);
  useEffect(() => {
    if (!resendIn) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const close = () => {
    Keyboard.dismiss();
    Animated.timing(up, { toValue: 0, duration: reduced ? 150 : 300, easing: ease.sheet, useNativeDriver: native }).start(onClose);
  };
  // Drag down to dismiss: a flick over 0.11 px/ms or a drag past 35% of the sheet closes it; otherwise it snaps back.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.vy > FLICK || g.dy > sheetH.current * 0.35) {
          Keyboard.dismiss();
          Animated.timing(drag, { toValue: sheetH.current + 40, duration: 220, easing: ease.out, useNativeDriver: native }).start(onClose);
        } else Animated.spring(drag, { toValue: 0, ...spring.snap, useNativeDriver: native }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, ...spring.snap, useNativeDriver: native }).start(),
    }),
  ).current;

  const send = async (to = email.trim()) => {
    setSubmitted(true);
    if (!isEmail(to)) {
      haptic.error();
      emailInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startEmail(to);
      setCode("");
      setSentTo(to);
      setResendIn(30);
      codeInput.current?.focus();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (c: string) => {
    if (!sentTo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(sentTo, c);
      haptic.soft();
    } catch (e) {
      setError((e as Error).message);
      codeInput.current?.reject();
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
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", transform: [{ translateY: Animated.add(Animated.add(up.interpolate({ inputRange: [0, 1], outputRange: [Math.min(winH, 640), 0] }), drag), lift) }] }}
      >
        <Glass
          intensity={40}
          tint={p.sheet}
          style={{ width: "100%", maxWidth: layout.column, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: `rgba(${p.inkRgb}, 0.18)` }}
        >
          <DismissKeyboard>
            <View style={{ alignItems: "center", paddingTop: layout.stack.tight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
                style={[measured ? { position: "absolute", left: 0, right: 0, top: 0 } : null, { paddingHorizontal: gutter, paddingTop: space[20], paddingBottom: insets.bottom + SHEET_FOOT, gap: layout.stack.base }]}
              >
                {!sentTo ? (
                  <>
                    <Eyebrow>Save your Dandelist</Eyebrow>
                    <Text style={[t.title2, { color: p.ink }]}>Where should we keep it?</Text>
                    {extra}
                    <Field
                      ref={emailInput}
                      label="Email"
                      value={email}
                      onChangeText={(v) => {
                        setEmail(v);
                        if (error) setError(null);
                      }}
                      autoFocus={!extra}
                      keyboardType="email-address"
                      inputMode="email"
                      autoComplete="email"
                      textContentType="username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      placeholder="you@example.com"
                      returnKeyType="go"
                      onSubmitEditing={() => send()}
                      error={error ?? (isEmail(email) ? null : EMAIL_INVALID)}
                      submitted={submitted || !!error}
                    />
                    <PrimaryButton label="Send code" busyLabel="Sending..." busy={busy} disabled={!email.trim()} onPress={() => send()} />
                  </>
                ) : (
                  <>
                    <Eyebrow>One step</Eyebrow>
                    <Text style={[t.title2, { color: p.ink }]}>{`Code sent to ${mask(sentTo)}`}</Text>
                    <CodeField
                      ref={codeInput}
                      value={code}
                      onChange={(c) => {
                        setCode(c);
                        if (error) setError(null);
                      }}
                      onComplete={verify}
                      busy={busy}
                      error={error}
                      autoFocus
                    />
                    <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: layout.stack.tight }}>
                      {Platform.OS !== "web" ? <QuietButton label="Open Mail" onPress={() => Linking.openURL(Platform.OS === "ios" ? "message://" : "mailto:")} /> : null}
                      <QuietButton label={resendIn ? `Resend in ${resendIn} s` : "Resend code"} onPress={() => !resendIn && send(sentTo)} />
                      <QuietButton
                        label="Use a different email"
                        onPress={() => {
                          setSentTo(null);
                          setCode("");
                          setError(null);
                          setSubmitted(false);
                        }}
                      />
                    </View>
                    <Text style={[type.footnote, { color: p.ink3 }]}>Not there? Check spam.</Text>
                  </>
                )}
              </View>
            </Animated.View>
          </DismissKeyboard>
        </Glass>
      </Animated.View>
    </View>
  );
}
