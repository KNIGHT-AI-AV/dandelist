import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { closeHelp, helpState, openHelp, sendHelp, useHelpAsking } from "../lib/help";
import { haptic, ease, useReducedMotion } from "../lib/motion";
import { screenShot } from "../lib/screen-shot";
import { layout, radius, space, type, usePalette } from "../lib/theme";
import { Eyebrow, Glass, Icon, PrimaryButton, QuietButton } from "./lux";

/**
 * Help in one tap (owner, 2026-10-31: "a help icon so that it takes a direct state of everything on the application
 * ... I can just press a button ... you could literally see it with pictures"). The bar's button takes the picture
 * first, before anything covers the screen, then asks; nothing is sent until they say so.
 */
export function HelpButton() {
  const p = usePalette();
  const taking = useRef(false);
  const ask = async () => {
    if (taking.current) return;
    taking.current = true;
    haptic.select();
    const shot = await screenShot();
    openHelp(shot);
    taking.current = false;
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Help"
      accessibilityHint="Sends what you're seeing to the Dandelist team"
      onPress={() => void ask()}
      style={({ pressed }) => ({ width: layout.control.icon, height: layout.control.icon, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : 1 })}
    >
      <Icon name="help" size={22} color={p.accentText} />
    </Pressable>
  );
}

/** The help sheet, mounted once (app/_layout.tsx): what will be sent, then the code to quote once it's in. */
export function HelpHost() {
  const asking = useHelpAsking();
  const { api, status } = useAuth();
  const route = usePathname();
  const p = usePalette();
  const reduced = useReducedMotion();
  const [state, setState] = useState<"ready" | "sending" | "sent">("ready");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const open = !!asking && status === "signedIn";

  useEffect(() => {
    if (!open) return;
    setState("ready");
    setError(null);
    Animated.timing(shown, { toValue: 1, duration: reduced ? 0 : 220, easing: ease.out, useNativeDriver: true }).start();
  }, [open, shown, reduced]);

  const close = () => Animated.timing(shown, { toValue: 0, duration: reduced ? 0 : 160, easing: ease.inOut, useNativeDriver: true }).start(() => closeHelp());
  const send = async () => {
    if (state !== "ready") return;
    setState("sending");
    setError(null);
    try {
      const sent = await sendHelp(api, helpState(route), asking?.shot);
      setCode(sent.code);
      setState("sent");
      haptic.success();
    } catch (e) {
      setError((e as Error).message);
      setState("ready");
      haptic.error();
    }
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
            {state === "sent" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={[type.title3, { color: p.ink }]}>{`Sent. Your report is ${code}.`}</Text>
                <QuietButton label="Done" onPress={close} />
              </>
            ) : (
              <>
                <Text style={[type.title3, { color: p.ink }]}>Send what you're seeing?</Text>
                <Text style={[type.callout, { color: p.ink2 }]}>
                  This screen, your latest conversation and your list go to the Dandelist team so we can see what went wrong. Nobody else sees them.
                </Text>
                {asking?.shot ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${asking.shot}` }}
                    accessibilityLabel="The screen that will be sent"
                    contentFit="contain"
                    style={{ height: 180, borderRadius: radius.sm, backgroundColor: p.surface }}
                  />
                ) : null}
                {error ? <Text style={[type.footnote, { color: p.danger }]}>{error}</Text> : null}
                <View style={{ flexDirection: "row", gap: space[12], alignItems: "center" }}>
                  <PrimaryButton label="Send" busyLabel="Sending..." busy={state === "sending"} onPress={() => void send()} style={{ flex: 1 }} />
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

/** For Settings, where the screen behind is Settings itself: the report goes without a picture. */
export const reportProblem = () => openHelp(null);
