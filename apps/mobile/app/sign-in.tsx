import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, useWindowDimensions, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CODE_LENGTH, CodeField, Field, KeyboardLift, KeyboardScroll, isEmail, type CodeFieldHandle } from "../components/inputs";
import { Backdrop, Eyebrow, Grain, IconButton, PrimaryButton, QuietButton, Shade, Wordmark } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { signInErrorMessage, useAuth, useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import { ease, haptic, native, useReducedMotion } from "../lib/motion";
import { Rise } from "../components/welcome/kit";
import { fonts, layout, space, type, usePalette, useType } from "../lib/theme";
import { MAIN } from "../lib/landmark";
import { Atmosphere } from "../components/atmosphere";

const EMAIL_INVALID = "Enter a full email address.";
const FAILED = "Something went wrong. Try again.";
/** Room under the form: above the home indicator at rest; while typing the form rides `layout.stack.base` above the keyboard. */
const FOOT = layout.stack.section;
/**
 * The page arrives rather than appears (owner, 2026-11-02: "same with the login. It's just not smart"): the photograph
 * surfaces and settles, then the wordmark, the line, the words and the ways in rise one after another, slowly, as the
 * opening does. The code step that follows enters the same way, a little quicker.
 */
const ENTER = { duration: 900, distance: 18, easing: ease.cinema };
const ENTER_DELAYS = [150, 350, 550, 750, 900, 1000];
const CODE_ENTER = { duration: 600, distance: 12, easing: ease.cinema };
const SCENE_MS = 2400;

export default function SignIn() {
  const auth = useAuth();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const options = useSignInOptions();
  // A provider sign-in that came back without a ticket lands here with a reason code.
  const { error: returnedError } = useLocalSearchParams<{ error?: string }>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(() => signInErrorMessage(typeof returnedError === "string" ? returnedError : null));
  const emailInput = useRef<TextInput>(null);
  const codeInput = useRef<CodeFieldHandle>(null);
  const reduced = useReducedMotion();
  const scene = useRef(new Animated.Value(0)).current;
  // Reduce Motion is only known a moment after the first frame, so the settle can be under way when it arrives: it
  // stops there and the photograph simply stands.
  useEffect(() => {
    if (reduced) {
      scene.stopAnimation();
      scene.setValue(1);
      return;
    }
    const settle = Animated.timing(scene, { toValue: 1, duration: SCENE_MS, easing: ease.cinema, useNativeDriver: native });
    settle.start();
    return () => settle.stop();
  }, [scene, reduced]);
  // Back from the code step the email form returns quickly, so the field it focuses is never typed into unseen.
  const enter = (i: number) => (returning ? { ...CODE_ENTER, delay: 0 } : { ...ENTER, delay: ENTER_DELAYS[i] });

  // Signed in, they pass through the welcome on the way to their list (app/index.tsx), not straight to it.
  if (auth.status === "signedIn") return <Redirect href="/" />;

  const message = (e: unknown) => (e instanceof Error ? e.message : FAILED);

  async function sendCode() {
    setSubmitted(true);
    const to = email.trim();
    if (!isEmail(to)) {
      haptic.error();
      emailInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.startEmail(to);
      setCode("");
      setSentTo(to);
    } catch (e) {
      haptic.error();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(c: string) {
    if (!sentTo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.verifyEmail(sentTo, c);
    } catch (e) {
      setError(message(e));
      codeInput.current?.reject();
    } finally {
      setBusy(false);
    }
  }

  async function continueWith(option: SignInOption) {
    setProvider(option.id);
    setError(null);
    try {
      if (option.native) await auth.signInWithApple();
      else await auth.signInWith(option.id);
    } catch (e) {
      haptic.error();
      setError(message(e));
    } finally {
      setProvider(null);
    }
  }

  return (
    // Clipped, so the photograph settling from 1.06 never spills past the screen and flashes scrollbars on the web.
    <View style={{ flex: 1, overflow: "hidden", backgroundColor: p.bg }} {...MAIN}>
      <Atmosphere />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: scene, transform: [{ scale: scene.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }] }]}>
        <Backdrop source={require("../assets/backdrop.jpg")} />
      </Animated.View>
      {/* The photo stays atmosphere, not the page: the emerald dusk over it keeps the mood dark and stops its warm
          tones bleeding into borders and glass (Taste Engine adherence check, 2026-10-29). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, 0.42)` }]} />
      <Shade from={0.05} />
      {/* A way back for someone who arrived here from a link (UI audit, 2026-10-30: only the browser's Back left). */}
      <IconButton
        icon="back"
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
        style={{ position: "absolute", zIndex: 2, top: insets.top + (layout.headerBar - layout.control.icon) / 2, left: gutter }}
      />
      {/* The form is anchored to the bottom, so the whole column rides up with the keyboard instead of jumping. */}
      <KeyboardLift rest={insets.bottom + FOOT} gap={layout.stack.base} style={{ flex: 1 }}>
        <KeyboardScroll
          inset={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingTop: insets.top + space[24], paddingBottom: insets.bottom + FOOT, paddingHorizontal: gutter, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center", gap: layout.stack.base }}
        >
          {!sentTo ? (
            <>
              <Rise {...enter(0)}>
                <Wordmark height={30} />
              </Rise>
              <Rise {...enter(1)}>
                <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>
                  Price everything{"\n"}you <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>want</Text>.
                </Text>
              </Rise>
              <Rise {...enter(2)}>
                <Text style={[type.body, { color: p.ink2, marginBottom: layout.stack.tight }]}>Dandelist finds the real price of everything you want, and what it costs over the years.</Text>
              </Rise>
              {options ? (
                <Rise {...enter(3)}>
                  <SignInOptions options={options} pending={provider} disabled={busy} onChoose={continueWith} />
                </Rise>
              ) : null}
              <Rise {...enter(4)}>
              <Field
                ref={emailInput}
                label="Email"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError(null);
                }}
                autoFocus={returning}
                keyboardType="email-address"
                inputMode="email"
                autoComplete="email"
                textContentType="username"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                placeholder="you@example.com"
                returnKeyType="go"
                onSubmitEditing={sendCode}
                error={error ?? (isEmail(email) ? null : EMAIL_INVALID)}
                submitted={submitted || !!error}
              />
              </Rise>
              <Rise {...enter(5)}>
                <PrimaryButton label="Email me a code" busyLabel="Sending..." busy={busy} disabled={!email.trim() || provider !== null} onPress={sendCode} />
              </Rise>
            </>
          ) : (
            <>
              <Rise {...CODE_ENTER} delay={0}>
                <Eyebrow color={p.ink}>One step</Eyebrow>
              </Rise>
              <Rise {...CODE_ENTER} delay={100}>
                <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>Check your email</Text>
              </Rise>
              <Rise {...CODE_ENTER} delay={200}>
                <Text style={[type.body, { color: p.ink2 }]}>{`We sent a 6-digit code to ${sentTo}. It expires in 10 minutes.`}</Text>
              </Rise>
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
              <PrimaryButton label="Sign in" busy={busy} disabled={code.length !== CODE_LENGTH} onPress={() => verify(code)} />
              <QuietButton
                label="Use a different email"
                onPress={() => {
                  setSentTo(null);
                  setCode("");
                  setError(null);
                  setSubmitted(false);
                  setReturning(true);
                }}
              />
            </>
          )}
        </KeyboardScroll>
      </KeyboardLift>
      <Grain />
    </View>
  );
}
