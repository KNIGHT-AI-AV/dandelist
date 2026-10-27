import type { Entry } from "@dandelist/catalogue";
import { formatCents } from "@dandelist/cost";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, haptic, native, spring, useReducedMotion } from "../../lib/motion";
import { fonts, radius, usePalette } from "../../lib/theme";
import { monthYearLong } from "../../lib/welcome";
import { ErrorLine, Eyebrow, Glass, GlassField, PrimaryButton, QuietButton } from "../lux";
import { GlassReveal } from "../reveal";
import { RollingNumber } from "./kit";

/**
 * Step 7, the peak: "Your life: $X. Yours by Month Year." The picks fan into a still life, the figure rolls and
 * lands with the one success haptic, the date masks in and a single champagne light crosses the figure.
 */
export function RevealCard({ picks, upfrontCents, monthlyRunningCents, everythingBy, onKeep, onChange }: { picks: Entry[]; upfrontCents: number; monthlyRunningCents: number; everythingBy: string; onKeep(): void; onChange(): void }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const card = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const date = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const sweep = useRef(new Animated.Value(-1)).current;
  const fans = useRef(picks.map(() => new Animated.Value(reduced ? 1 : 0))).current;
  const [figure, setFigure] = useState(reduced ? formatCents(upfrontCents) : "$0");
  const by = monthYearLong(new Date(`${everythingBy}-01T00:00:00`));

  useEffect(() => {
    if (reduced) return void haptic.success();
    Animated.spring(card, { toValue: 1, ...spring.reveal, useNativeDriver: native }).start();
    Animated.stagger(70, fans.map((f) => Animated.spring(f, { toValue: 1, ...spring.settle, useNativeDriver: native }))).start();
    const t1 = setTimeout(() => setFigure(formatCents(upfrontCents)), 350);
    const t2 = setTimeout(() => {
      haptic.success();
      Animated.timing(date, { toValue: 1, duration: 600, easing: ease.out, useNativeDriver: native }).start();
      Animated.timing(sweep, { toValue: 1, duration: 1400, easing: ease.inOut, useNativeDriver: native }).start();
    }, 1400);
    return () => [t1, t2].forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = picks.slice(0, 5);
  return (
    <Animated.View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 22, gap: 22, maxWidth: 560, width: "100%", alignSelf: "center", opacity: card, transform: [{ scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
      {/* The still life: the picks fanned like prints on a table. */}
      <View style={{ height: 180, alignItems: "center", justifyContent: "center" }}>
        {shown.map((e, i) => {
          const mid = (shown.length - 1) / 2;
          const angle = (i - mid) * 7;
          return (
            <Animated.View
              key={e.id}
              style={{
                position: "absolute",
                width: 116,
                height: 156,
                borderRadius: 14,
                overflow: "hidden",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: p.hair,
                opacity: fans[i],
                transform: [
                  { translateX: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [0, (i - mid) * 58] }) },
                  { translateY: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: [20, Math.abs(i - mid) * 8] }) },
                  { rotate: fans[i]!.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${angle}deg`] }) },
                ],
              }}
            >
              <GlassReveal uri={e.imageUrl ?? null} standby={require("../../assets/standby/object.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
            </Animated.View>
          );
        })}
      </View>
      <View style={{ gap: 6 }}>
        <Eyebrow>Your life</Eyebrow>
        <View style={{ overflow: "hidden" }}>
          <RollingNumber value={figure} size={56} family={fonts.display} />
          {!reduced ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { opacity: sweep.interpolate({ inputRange: [-1, -0.85, 0.85, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: sweep.interpolate({ inputRange: [-1, 1], outputRange: [-160, 420] }) }] }]}
            >
              <LinearGradient colors={["rgba(210,180,124,0)", "rgba(240,215,160,0.55)", "rgba(210,180,124,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: 120, height: "100%" }} />
            </Animated.View>
          ) : null}
        </View>
        <Animated.Text style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: p.ink, opacity: date, transform: [{ translateY: date.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          Yours by <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>{by}</Text>.
        </Animated.Text>
      </View>
      <Glass style={{ padding: 16, gap: 8 }}>
        {[
          ["Upfront", formatCents(upfrontCents)],
          ["Every month, once it's yours", monthlyRunningCents ? formatCents(monthlyRunningCents) : "none"],
        ].map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: p.ink2 }}>{k}</Text>
            <Text style={{ fontFamily: fonts.figure, fontSize: 13.5, color: p.ink }}>{v}</Text>
          </View>
        ))}
      </Glass>
      <View style={{ gap: 6 }}>
        <PrimaryButton label="Keep this life" onPress={onKeep} />
        <QuietButton label="Change picks" onPress={onChange} />
      </View>
    </Animated.View>
  );
}

const mask = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

/**
 * Step 8: a sheet over the reveal, so the peak stays visible. One field per screen: email, then a single code input
 * drawn as six slots (paste and one-time-code autofill keep working because it's one real input). Submits on the
 * sixth digit; a wrong code shakes, buzzes and keeps the digits.
 */
export function CodeSheet({ startEmail, verifyEmail, onClose, extra }: { startEmail(email: string): Promise<void>; verifyEmail(email: string, code: string): Promise<void>; onClose(): void; extra?: React.ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const up = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    Animated.timing(up, { toValue: 1, duration: reduced ? 200 : 450, easing: ease.sheet, useNativeDriver: native }).start();
  }, [up, reduced]);
  useEffect(() => {
    if (!resendIn) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,11,0.45)" }]} onPress={onClose} />
      <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: [{ translateY: up.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] }}>
        <Glass intensity={70} style={{ borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 24, paddingBottom: insets.bottom + 24, gap: 16, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          {!sentTo ? (
            <>
              <Eyebrow>Save your life list</Eyebrow>
              <Text style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 33, color: p.ink }}>Where should we keep it?</Text>
              {extra}
              <GlassField label="Email" value={email} onChangeText={setEmail} autoFocus={!extra} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" placeholder="you@example.com" onSubmitEditing={() => send()} />
              <ErrorLine>{error}</ErrorLine>
              <PrimaryButton label="Send code" busy={busy} disabled={!email.includes("@")} onPress={() => send()} />
            </>
          ) : (
            <>
              <Eyebrow>One step</Eyebrow>
              <Text style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 31, color: p.ink }}>{`Code sent to ${mask(sentTo)}`}</Text>
              <Animated.View style={{ transform: [{ translateX: shake }] }}>
                <Pressable onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8 }} accessibilityLabel="Six-digit code">
                  {Array.from({ length: 6 }, (_, i) => (
                    <View key={i} style={{ flex: 1, height: 58, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: error ? p.danger : i === code.length ? p.accent : p.hair, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,10,11,0.35)" }}>
                      <Text style={{ fontFamily: fonts.figure, fontSize: 24, color: p.ink }}>{code[i] ?? ""}</Text>
                    </View>
                  ))}
                </Pressable>
                <TextInput
                  ref={input}
                  value={code}
                  onChangeText={(t) => {
                    const c = t.replace(/\D/g, "").slice(0, 6);
                    setCode(c);
                    if (c.length === 6) void verify(c);
                  }}
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
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.ink3 }}>Not there? Check spam.</Text>
            </>
          )}
        </Glass>
      </Animated.View>
    </View>
  );
}
