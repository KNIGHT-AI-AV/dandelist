import { usePathname } from "expo-router";
import { useEffect, useReducer, useRef, useState } from "react";
import { Animated, AppState, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, native, spring, step, useReducedMotion } from "../lib/motion";
import { layout, radius, shadow, space, type, usePalette } from "../lib/theme";
import { LAUNCH, fetchLatest, offerFor, promptDue, promptStep, updater, type Offer, type Running } from "../lib/update";
import { SCRIM } from "./list/metrics";
import { Glass, PrimaryButton, QuietButton } from "./lux";

/**
 * Where the prompt may appear: the signed-in home and its pages. Never over the welcome flow, sign-in, the new-wish
 * forms or a wish's detail, so it can't land on someone mid-way through a step.
 */
const HOME = "/wishes";
/** It waits until the home has been calm this long: no text field in focus, nothing just arrived. */
const SETTLE_MS = 1500;
const POLL_MS = 250;
/** About a phone's width, so the card reads the same in a desktop window. */
const CARD_WIDTH = 360;

const COPY = {
  store: { title: "A new version is out", line: "Update to get it. Your list stays just as it is.", go: "Update" },
  reload: { title: "A new version is out", line: "Reload to get it. Your list stays just as it is.", go: "Reload" },
} as const;

/**
 * Offers the newest version (lib/update-core.ts has the rules). Checks quietly at launch and on each return after 30
 * minutes away, and shows the prompt once the home is calm. Renders nothing in development and on a web build that
 * doesn't know its version.
 */
export function UpdatePrompt() {
  return updater.running ? <Check running={updater.running} /> : null;
}

function Check({ running }: { running: Running }) {
  const [state, dispatch] = useReducer(promptStep, LAUNCH);
  const pathname = usePathname();
  const reduced = useReducedMotion();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") dispatch({ type: "background", at: Date.now() });
      else if (s === "active") dispatch({ type: "active", at: Date.now() });
    });
    return () => sub.remove();
  }, []);

  // One check a visit, in the background of everything else; no answer just means no prompt this time.
  const { visit } = state;
  useEffect(() => {
    void fetchLatest(updater.source).then((latest) => dispatch({ type: "checked", visit, offer: offerFor(running, latest, updater.tried()) }));
  }, [visit, running]);

  const due = promptDue(state);
  const settled = useSettled(due && pathname === HOME);
  if (!due || !settled || !state.offer) return null;
  return <UpdateCard offer={state.offer} reduced={reduced} onAnswer={() => dispatch({ type: "answered" })} />;
}

/** True once `want` has held for SETTLE_MS with no text field in focus; false again as soon as `want` drops. */
function useSettled(want: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!want) return;
    let calm = 0;
    const id = setInterval(() => {
      calm = typing() ? 0 : calm + POLL_MS;
      if (calm < SETTLE_MS) return;
      clearInterval(id);
      setSettled(true);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [want]);
  return settled;
}

/** Whether a text field has focus: someone may be mid-sentence (the composer, a search), so the prompt waits. */
function typing(): boolean {
  if (Platform.OS === "web") {
    const el = (globalThis as { document?: { activeElement?: { tagName?: string; isContentEditable?: boolean } | null } }).document?.activeElement;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || !!el.isContentEditable);
  }
  return TextInput.State.currentlyFocusedInput() != null;
}

/**
 * A small glass card over the receding page: a title, one line, the update and Later. The scrim fades in over
 * step.inMs and the card rises into place on spring.snap; both leave in step.outMs. Reduced motion: opacity only.
 * Later, a tap on the page around the card, Escape on the web and Android's back all close it for this visit.
 */
function UpdateCard({ offer, reduced, onAnswer }: { offer: Offer; reduced: boolean; onAnswer(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrim = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);
  const copy = COPY[offer.kind];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: reduced ? step.outMs : step.inMs, easing: ease.out, useNativeDriver: native }),
      reduced
        ? Animated.timing(card, { toValue: 1, duration: step.outMs, easing: ease.out, useNativeDriver: native })
        : Animated.spring(card, { toValue: 1, ...spring.snap, useNativeDriver: native }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (leaving.current) return;
    leaving.current = true;
    const out = (v: Animated.Value) => Animated.timing(v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native });
    Animated.parallel([out(scrim), out(card)]).start(() => onAnswer());
  };
  const update = () => {
    if (leaving.current) return;
    // A phone opens the link (and comes back to a closed card); the web reloads.
    updater.go(offer);
    close();
  };

  return (
    // The Modal is the dialog (on the web it renders role="dialog" with this label), so the card needs no role.
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close} accessibilityLabel={copy.title}>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.gutter(width) }]}>
        {/* The card comes first so keyboard focus lands on its button; zIndex keeps it over the scrim. */}
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
              {copy.title}
            </Text>
            <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>{copy.line}</Text>
            <View style={{ marginTop: layout.stack.base, gap: space[4] }}>
              <PrimaryButton label={copy.go} onPress={update} />
              <QuietButton label="Later" onPress={close} />
            </View>
          </Glass>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1, opacity: scrim, backgroundColor: `rgba(${p.bgRgb}, ${SCRIM})` }]}>
          <Pressable aria-hidden focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </Modal>
  );
}
