import { Redirect, router, type Href } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Atmosphere } from "../components/atmosphere";
import { takeReturn } from "../components/consent-gate";
import { AgentDot, ErrorLine, Eyebrow, PrimaryButton, QuietButton, Wordmark } from "../components/lux";
import { useAccountConsent } from "../lib/account-consent";
import { useAuth } from "../lib/auth";
import { MAIN } from "../lib/landmark";
import { layout, space, type, usePalette, useType } from "../lib/theme";

/** The page's words, the same as the privacy policy's (lib/legal.ts): who gets what, and the age. */
export const CONSENT = {
  eyebrow: "Before you start",
  title: "Dandelist works with Meta's AI",
  lines: [
    "To price what you want, it sends what you type or say, and your answers, to Meta's AI. When Meta is busy, Anthropic's Claude does the same work.",
    "Neither gets your name or email, and neither trains on what you send.",
  ],
  age: "You need to be 18 or older to use it.",
  agree: "I'm 18 or older and I agree",
  saving: "Saving",
  signOut: "Sign out",
  legal: "Privacy & Terms",
  unread: "Couldn't check your account just now.",
  again: "Try again",
} as const;

/**
 * The first thing after making an account or signing in (the owner, 2026-11-06), and the only page a signed-in account
 * sees until its yes is saved (components/consent-gate.tsx). The yes is the account's, kept by the server across
 * devices. Saying no is signing out; the privacy policy and terms stay a tap away.
 */
export default function ConsentPage() {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const auth = useAuth();
  const consent = useAccountConsent();
  // This page mounts in the open app only as it opens (the yes just saved, or signed out): the gate swaps the whole tree.
  // It sends them on to where they were headed, else the start, once.
  const [onward] = useState(() => (auth.status !== "signedIn" || consent.state === "accepted" ? (takeReturn() ?? "/") : null));
  if (onward) return <Redirect href={onward as Href} />;

  // Reading the account's answer: nothing to say yet.
  if (consent.state === "checking" || consent.state === "none") {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }} {...MAIN}>
        <AgentDot busy />
      </View>
    );
  }

  const unread = consent.state === "failed";
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }} {...MAIN}>
      <Atmosphere />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: insets.top + space[24],
          paddingBottom: insets.bottom + space[24],
          paddingHorizontal: gutter,
          width: "100%",
          maxWidth: layout.column + 2 * gutter,
          alignSelf: "center",
          gap: layout.stack.section,
        }}
      >
        <Wordmark />
        {unread ? (
          <View style={{ gap: layout.stack.tight }}>
            <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
              {CONSENT.unread}
            </Text>
            <ErrorLine>{consent.error}</ErrorLine>
          </View>
        ) : (
          <View style={{ gap: layout.stack.tight }}>
            <Eyebrow>{CONSENT.eyebrow}</Eyebrow>
            <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
              {CONSENT.title}
            </Text>
            {CONSENT.lines.map((line) => (
              <Text key={line} style={[type.callout, { color: p.ink2, marginTop: layout.stack.tight }]}>
                {line}
              </Text>
            ))}
            <Text style={[type.callout, { color: p.ink, marginTop: layout.stack.tight }]}>{CONSENT.age}</Text>
            <ErrorLine>{consent.error}</ErrorLine>
          </View>
        )}
        <View style={{ gap: space[4] }}>
          {unread ? (
            <PrimaryButton label={CONSENT.again} onPress={consent.retry} />
          ) : (
            <PrimaryButton label={CONSENT.agree} busyLabel={CONSENT.saving} busy={consent.saving} onPress={() => void consent.accept()} />
          )}
          <QuietButton label={CONSENT.signOut} onPress={() => void auth.signOut()} />
          <QuietButton label={CONSENT.legal} color={p.ink3} onPress={() => router.push("/legal")} />
        </View>
      </ScrollView>
    </View>
  );
}
