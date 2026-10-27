import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop, ErrorLine, Eyebrow, GlassField, Grain, PrimaryButton, QuietButton, Shade } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { signInErrorMessage, useAuth, useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import { fonts, usePalette } from "../lib/theme";

export default function SignIn() {
  const auth = useAuth();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const options = useSignInOptions();
  // A provider sign-in that came back without a ticket lands here with a reason code.
  const { error: returnedError } = useLocalSearchParams<{ error?: string }>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(() => signInErrorMessage(typeof returnedError === "string" ? returnedError : null));

  if (auth.status === "signedIn") return <Redirect href="/wishes" />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const sendCode = () => run(async () => { await auth.startEmail(email); setSentTo(email.trim()); });

  async function continueWith(option: SignInOption) {
    setProvider(option.id);
    setError(null);
    try {
      if (option.native) await auth.signInWithApple();
      else await auth.signInWith(option.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setProvider(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Backdrop source={require("../assets/backdrop.jpg")} />
      <Shade from={0.05} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28, paddingHorizontal: 24, width: "100%", maxWidth: 480, alignSelf: "center", gap: 18 }}>
          {!sentTo ? (
            <>
              <Eyebrow color={p.ink}>Dandelist</Eyebrow>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 48, lineHeight: 50, color: p.ink, letterSpacing: -0.5 }}>
                Price the life{"\n"}you <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>want</Text>.
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: p.ink2 }}>Your agent finds the real price of everything you want, and what it costs over the years.</Text>
              {options ? <SignInOptions options={options} pending={provider} disabled={busy} onChoose={continueWith} /> : null}
              <GlassField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" placeholder="you@example.com" onSubmitEditing={sendCode} />
              <ErrorLine>{error}</ErrorLine>
              <PrimaryButton label="Email me a code" busy={busy} disabled={!email.includes("@") || provider !== null} onPress={sendCode} />
            </>
          ) : (
            <>
              <Eyebrow color={p.ink}>One step</Eyebrow>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 46, color: p.ink }}>Check your email</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: p.ink2 }}>{`We sent a 6-digit code to ${sentTo}. It expires in 10 minutes.`}</Text>
              <GlassField
                label="Code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="123456"
                inputStyle={{ fontFamily: fonts.figure, fontSize: 24, letterSpacing: 8 }}
                onSubmitEditing={() => run(() => auth.verifyEmail(sentTo, code))}
              />
              <ErrorLine>{error}</ErrorLine>
              <PrimaryButton label="Sign in" busy={busy} disabled={code.length !== 6} onPress={() => run(() => auth.verifyEmail(sentTo, code))} />
              <QuietButton label="Use a different email" onPress={() => { setSentTo(null); setCode(""); setError(null); }} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Grain />
    </View>
  );
}
