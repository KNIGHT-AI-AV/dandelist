import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { giveAiConsent, useAiConsent } from "../lib/ai-consent";
import { useAuth } from "../lib/auth";
import { ease, native, spring, step, useReducedMotion } from "../lib/motion";
import { layout, radius, shadow, space, type, usePalette } from "../lib/theme";
import { SCRIM } from "./list/metrics";
import { Glass, PrimaryButton, QuietButton } from "./lux";

/** The card's words, the same as the privacy policy's (lib/legal.ts): who gets what, and the age. */
export const CONSENT = {
  title: "Dandelist works with Meta's AI",
  lines: [
    "To price what you want, it sends what you type or say, and your answers, to Meta's AI. When Meta is busy, Anthropic's Claude does the same work.",
    "Neither gets your name or email, and neither trains on what you send.",
  ],
  age: "You need to be 18 or older to use it.",
  agree: "I'm 18 or older, go ahead",
  later: "Not now",
  signOut: "Sign out",
  legal: "Privacy & Terms",
} as const;

/** About a phone's width, so the card reads the same in a desktop window (as the update prompt's). */
const CARD_WIDTH = 380;

/**
 * Before sign-in: `gate(go)` runs `go` at once when the device has said yes, and otherwise shows the card first, then
 * runs `go` on the yes. The welcome's first wish goes through it, typed or said, so nothing leaves before the yes.
 */
export function useConsentGate(): { gate(go: () => void): void; card: ReactNode } {
  const given = useAiConsent();
  const [pending, setPending] = useState<{ go: () => void } | null>(null);
  const gate = (go: () => void) => (given ? go() : setPending({ go }));
  const card = pending ? (
    <ConsentCard
      decline={CONSENT.later}
      onRead={() => setPending(null)}
      onAgree={() => {
        setPending(null);
        void giveAiConsent();
        pending.go();
      }}
      onDecline={() => setPending(null)}
    />
  ) : null;
  return { gate, card };
}

/**
 * Signed in on a device that hasn't said yes (an account from before the card, or one signed in on a new device): the
 * card over the app until they agree or sign out. The privacy page stays readable from its link.
 */
export function AiConsentGate() {
  const auth = useAuth();
  const given = useAiConsent();
  const pathname = usePathname();
  if (auth.status !== "signedIn" || given !== false || pathname === "/legal") return null;
  return <ConsentCard decline={CONSENT.signOut} onRead={() => undefined} onAgree={() => void giveAiConsent()} onDecline={() => void auth.signOut()} />;
}

/**
 * The card, in the update prompt's dress: a glass card over the receding page, rising on spring.snap. It has no tap-
 * outside or back-button close, since it only goes on an answer; reduced motion gets opacity only.
 */
function ConsentCard({ decline, onAgree, onDecline, onRead }: { decline: string; onAgree(): void; onDecline(): void; onRead(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const scrim = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: reduced ? step.outMs : step.inMs, easing: ease.out, useNativeDriver: native }),
      reduced
        ? Animated.timing(card, { toValue: 1, duration: step.outMs, easing: ease.out, useNativeDriver: native })
        : Animated.spring(card, { toValue: 1, ...spring.snap, useNativeDriver: native }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = (then: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    const out = (v: Animated.Value) => Animated.timing(v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native });
    Animated.parallel([out(scrim), out(card)]).start(() => then());
  };

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => undefined} accessibilityLabel={CONSENT.title}>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.gutter(width) }]}>
        <Animated.View
          style={{
            zIndex: 2,
            width: "100%",
            maxWidth: CARD_WIDTH,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            boxShadow: shadow.lift,
            opacity: card.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
            transform: [
              { translateY: card.interpolate({ inputRange: [0, 1], outputRange: reduced ? [0, 0] : [space[12], 0] }) },
              { scale: card.interpolate({ inputRange: [0, 1], outputRange: reduced ? [1, 1] : [0.96, 1] }) },
            ],
          }}
        >
          <Glass tint={p.sheet} style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: space[24], gap: layout.stack.tight }}>
            <Text accessibilityRole="header" style={[type.title3, { color: p.ink, textAlign: "center" }]}>
              {CONSENT.title}
            </Text>
            {CONSENT.lines.map((line) => (
              <Text key={line} style={[type.callout, { color: p.ink2, textAlign: "center" }]}>
                {line}
              </Text>
            ))}
            <Text style={[type.callout, { color: p.ink, textAlign: "center" }]}>{CONSENT.age}</Text>
            <View style={{ marginTop: layout.stack.base, gap: space[4] }}>
              <PrimaryButton label={CONSENT.agree} onPress={() => leave(onAgree)} />
              <QuietButton label={decline} onPress={() => leave(onDecline)} />
              <QuietButton
                label={CONSENT.legal}
                color={p.ink3}
                onPress={() =>
                  // Reading the policy is not an answer: the welcome's card closes and the next send asks again;
                  // signed in, the card is back when they return from the page.
                  leave(() => {
                    onRead();
                    router.push("/legal");
                  })
                }
              />
            </View>
          </Glass>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1, opacity: scrim, backgroundColor: `rgba(${p.bgRgb}, ${SCRIM})` }]}>
          <Pressable aria-hidden focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </Modal>
  );
}
