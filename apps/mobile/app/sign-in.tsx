import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CODE_LENGTH, CodeField, Field, KeyboardLift, KeyboardScroll, isEmail, type CodeFieldHandle } from "../components/inputs";
import { Backdrop, Eyebrow, Grain, IconButton, PrimaryButton, QuietButton, Shade, Wordmark } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { signInErrorMessage, useAuth, useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import { haptic } from "../lib/motion";
import { fonts, layout, space, type, usePalette, useType } from "../lib/theme";
import { Atmosphere } from "../components/atmosphere";

const EMAIL_INVALID = "Enter a full email address.";
const FAILED = "Something went wrong. Try again.";
/** Room under the form: above the home indicator at rest; while typing the form rides `layout.stack.base` above the keyboard. */
const FOOT = layout.stack.section;

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

  if (auth.status === "signedIn") return <Redirect href="/wishes" />;

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
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <Backdrop source={require("../assets/backdrop.jpg")} />
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
              <Wordmark height={30} />
              <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>
                Price everything{"\n"}you <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>want</Text>.
              </Text>
              <Text style={[type.body, { color: p.ink2, marginBottom: layout.stack.tight }]}>Dandelist finds the real price of everything you want, and what it costs over the years.</Text>
              {options ? <SignInOptions options={options} pending={provider} disabled={busy} onChoose={continueWith} /> : null}
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
              <PrimaryButton label="Email me a code" busyLabel="Sending..." busy={busy} disabled={!email.trim() || provider !== null} onPress={sendCode} />
            </>
          ) : (
            <>
              <Eyebrow color={p.ink}>One step</Eyebrow>
              <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>Check your email</Text>
              <Text style={[type.body, { color: p.ink2 }]}>{`We sent a 6-digit code to ${sentTo}. It expires in 10 minutes.`}</Text>
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
