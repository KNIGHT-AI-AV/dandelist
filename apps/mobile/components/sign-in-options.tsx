import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { providerName, type ProviderId, type SignInOption } from "../lib/auth";
import { radius, type, usePalette } from "../lib/theme";
import { Eyebrow, Glass, Hairline } from "./lux";

/**
 * Google, GitHub, Facebook and Apple sign-in buttons for the sign-in screen and the welcome save sheet, set in the lux
 * kit: glass, hairlines, Inter. Facebook is the exception: its own blue button, as Facebook's brand rules ask.
 */

const MARK: Record<ProviderId, number> = {
  apple: require("../assets/brands/apple.svg"),
  google: require("../assets/brands/google.svg"),
  github: require("../assets/brands/github.svg"),
  facebook: require("../assets/brands/facebook.svg"),
};

const HEIGHT = 56;
/** The Apple button's busy spinner sits on a white veil, so it is drawn in black on every theme. */
const APPLE_INK = "#000000";
/** Facebook's brand blue, with white type and the white "f" mark (Facebook brand resources). */
export const FACEBOOK_BLUE = "#1877F2";

/**
 * A provider's mark on its own small disc, the same in every theme: the light Apple and GitHub marks on near-black,
 * Google's colours on white, Facebook's white mark on its blue. For lists such as settings' sign-in accounts.
 */
export function ProviderMark({ id, size = 32 }: { id: ProviderId; size?: number }) {
  const disc = id === "google" ? "#FFFFFF" : id === "facebook" ? FACEBOOK_BLUE : "#17140F";
  const mark = Math.round(size * (id === "facebook" ? 0.62 : 0.5));
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: disc, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(0, 0, 0, 0.12)" }}>
      <Image source={MARK[id]} accessibilityLabel="" style={{ width: mark, height: mark }} contentFit="contain" accessible={false} />
    </View>
  );
}

/** "Continue with Facebook": Facebook's blue, white type and its white "f" mark, the one place Facebook is named. */
function FacebookButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress(): void }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const label = "Continue with Facebook";
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      onPress={inactive ? undefined : onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        { borderRadius: radius.control, borderCurve: "continuous", opacity: disabled && !busy ? 0.45 : pressed ? 0.85 : hovered ? 0.93 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        Platform.OS === "web" ? ({ outlineWidth: 0, cursor: inactive ? "default" : "pointer" } as object) : null,
      ]}
    >
      {focused ? (
        <View pointerEvents="none" style={{ position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: p.accent }} />
      ) : null}
      <View style={{ height: HEIGHT, borderRadius: radius.control, borderCurve: "continuous", justifyContent: "center", backgroundColor: FACEBOOK_BLUE }}>
        <View style={{ position: "absolute", left: 20, top: 0, bottom: 0, justifyContent: "center" }}>
          <Image source={MARK.facebook} accessibilityLabel="" style={{ width: 22, height: 22 }} contentFit="contain" accessible={false} />
        </View>
        {busy ? <ActivityIndicator color="#FFFFFF" accessibilityLabel="Signing in with Facebook" /> : <Text style={[type.button, { textAlign: "center", color: "#FFFFFF" }]}>{label}</Text>}
      </View>
    </Pressable>
  );
}

/** "Continue with ..." on frosted glass with the provider's mark. Champagne appears only as the focus ring. */
function ProviderButton({ id, busy, disabled, onPress }: { id: ProviderId; busy: boolean; disabled: boolean; onPress(): void }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const label = `Continue with ${providerName(id)}`;
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      onPress={inactive ? undefined : onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        { borderRadius: radius.control, borderCurve: "continuous", opacity: disabled && !busy ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        Platform.OS === "web" ? ({ outlineWidth: 0, cursor: inactive ? "default" : "pointer" } as object) : null,
      ]}
    >
      {focused ? (
        <View pointerEvents="none" style={{ position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: p.accent }} />
      ) : null}
      <Glass intensity={34} style={{ height: HEIGHT, borderRadius: radius.control, borderCurve: "continuous", justifyContent: "center", borderColor: hovered && !inactive ? p.ink2 : p.line }}>
        <View style={{ position: "absolute", left: 22, top: 0, bottom: 0, justifyContent: "center" }}>
          <Image source={MARK[id]} accessibilityLabel="" style={{ width: 18, height: 18 }} contentFit="contain" accessible={false} />
        </View>
        {busy ? (
          <ActivityIndicator color={p.ink} accessibilityLabel={`Signing in with ${providerName(id)}`} />
        ) : (
          <Text style={[type.button, { textAlign: "center", color: p.ink }]}>{label}</Text>
        )}
      </Glass>
    </Pressable>
  );
}

/** Apple's own button, which iOS requires for Sign in with Apple. White reads best on the dark backdrop. */
function AppleSheetButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress(): void }) {
  const p = usePalette();
  const inactive = disabled || busy;
  return (
    <View style={{ height: HEIGHT, opacity: disabled && !busy ? 0.45 : 1 }} pointerEvents={inactive ? "none" : "auto"}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radius.control}
        style={{ height: HEIGHT, width: "100%" }}
        onPress={onPress}
      />
      {busy ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: HEIGHT / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.82)" }]}>
          <ActivityIndicator color={APPLE_INK} accessibilityLabel="Signing in with Apple" />
        </View>
      ) : null}
    </View>
  );
}

/** The provider buttons, then a quiet "or" rule above the email form. Renders nothing when no provider is on. */
export function SignInOptions({ options, pending, disabled, onChoose }: { options: SignInOption[]; pending: ProviderId | null; disabled: boolean; onChoose(option: SignInOption): void }) {
  const p = usePalette();
  if (!options.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {options.map((o) =>
        o.native && o.id === "apple" ? (
          <AppleSheetButton key={o.id} busy={pending === o.id} disabled={disabled || (pending !== null && pending !== o.id)} onPress={() => onChoose(o)} />
        ) : o.id === "facebook" ? (
          <FacebookButton key={o.id} busy={pending === o.id} disabled={disabled || (pending !== null && pending !== o.id)} onPress={() => onChoose(o)} />
        ) : (
          <ProviderButton key={o.id} id={o.id} busy={pending === o.id} disabled={disabled || (pending !== null && pending !== o.id)} onPress={() => onChoose(o)} />
        ),
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Hairline style={{ flex: 1 }} />
        <Eyebrow color={p.ink3}>or</Eyebrow>
        <Hairline style={{ flex: 1 }} />
      </View>
    </View>
  );
}
