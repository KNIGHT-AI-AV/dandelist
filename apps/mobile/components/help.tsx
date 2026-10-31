import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { bindToSignIn, currentSignIn, useAuth } from "../lib/auth";
import { helpState, sendHelp } from "../lib/help";
import { askForHelp, closeHelp, sendSheet, useHelpOwner, useHelpSheet } from "../lib/help-sheet";
import { haptic, ease, useReducedMotion } from "../lib/motion";
import { screenShot } from "../lib/screen-shot";
import { layout, radius, space, type, usePalette } from "../lib/theme";
import { Eyebrow, Glass, Icon, PrimaryButton, QuietButton } from "./lux";
import { ReplayMask } from "./replay-mask";

/**
 * Help in one tap (owner, 2026-10-31: "a help icon so that it takes a direct state of everything on the application
 * ... I can just press a button ... you could literally see it with pictures"). Both ways in, the bar's button and the
 * Settings row (the way in on phones too narrow for the button), take the picture first, before anything covers the
 * screen, then ask; nothing is sent until they say so. The sheet, its picture and its answer belong to the sign-in that
 * opened it (lib/help-sheet.ts), and so does the report's request.
 */
const ask = () => askForHelp(screenShot, currentSignIn);

export function HelpButton() {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Help"
      accessibilityHint="Sends what you're seeing to the Dandelist team"
      onPress={() => {
        haptic.select();
        void ask();
      }}
      style={({ pressed }) => ({ width: layout.control.icon, height: layout.control.icon, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : 1 })}
    >
      <Icon name="help" size={22} color={p.accentText} />
    </Pressable>
  );
}

/** From Settings: the same as the bar's button, the picture being of Settings as it is when the row is pressed. */
export const reportProblem = () => void ask();

/** What the sheet says goes, with the screen's picture and without one (none could be taken, or on the web). */
const WITH_SHOT = "This screen, your latest conversation and your list go to the Dandelist team so we can see what went wrong. Nobody else sees them.";
const NO_SHOT = "Your latest conversation and your list go to the Dandelist team so we can see what went wrong. Nobody else sees them.";

/** The help sheet, mounted once (app/_layout.tsx): what will be sent, then the code to quote once it's in. */
export function HelpHost() {
  const { api, status, user } = useAuth();
  const account = status === "signedIn" ? (user?.id ?? null) : null;
  useHelpOwner(account);
  const sheet = useHelpSheet(account);
  const route = usePathname();
  const p = usePalette();
  const reduced = useReducedMotion();
  const shown = useRef(new Animated.Value(0)).current;
  const open = !!sheet;

  useEffect(() => {
    if (!open) return;
    Animated.timing(shown, { toValue: 1, duration: reduced ? 0 : 220, easing: ease.out, useNativeDriver: true }).start();
  }, [open, shown, reduced]);

  const close = () => {
    const id = sheet?.id;
    // Closes this sheet only: one opened meanwhile stays.
    Animated.timing(shown, { toValue: 0, duration: reduced ? 0 : 160, easing: ease.inOut, useNativeDriver: true }).start(() => {
      if (id) closeHelp(id);
    });
  };
  const send = async () => {
    // As the sign-in the sheet was made under, its retry after a refresh included (review of #140, lib/auth.tsx).
    const outcome = await sendSheet((s) => sendHelp(bindToSignIn(api, s.signIn), helpState(route), s.shot, s.id), currentSignIn);
    if (outcome === "sent") haptic.success();
    else if (outcome === "failed") haptic.error();
  };

  return (
    <Modal transparent visible={open} animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: shown }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: "center", paddingHorizontal: space[24] }}>
        <Animated.View style={{ opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
          <Glass intensity={70} style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: space[24], gap: space[16], maxWidth: 420, alignSelf: "center", width: "100%" }}>
            <Eyebrow>Help</Eyebrow>
            {sheet?.phase === "sent" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={[type.title3, { color: p.ink }]}>{`Sent. Your report is ${sheet.code}.`}</Text>
                <QuietButton label="Done" onPress={close} />
              </>
            ) : (
              <>
                <Text style={[type.title3, { color: p.ink }]}>Send what you're seeing?</Text>
                <Text style={[type.callout, { color: p.ink2 }]}>
                  {sheet?.shot ? WITH_SHOT : NO_SHOT}
                </Text>
                {sheet?.shot ? (
                  // Shown to the person, never in a session replay (components/replay-mask.native.tsx).
                  <ReplayMask>
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${sheet.shot}` }}
                      accessibilityLabel="The screen that will be sent"
                      contentFit="contain"
                      style={{ height: 180, borderRadius: radius.sm, backgroundColor: p.surface }}
                    />
                  </ReplayMask>
                ) : null}
                {sheet?.error ? <Text style={[type.footnote, { color: p.danger }]}>{sheet.error}</Text> : null}
                <View style={{ flexDirection: "row", gap: space[12], alignItems: "center" }}>
                  <PrimaryButton label="Send" busyLabel="Sending..." busy={sheet?.phase === "sending"} onPress={() => void send()} style={{ flex: 1 }} />
                  <QuietButton label="Cancel" onPress={close} />
                </View>
              </>
            )}
          </Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}
