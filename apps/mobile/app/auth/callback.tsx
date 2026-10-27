import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Backdrop, Eyebrow, Grain, Shade } from "../../components/lux";
import { isBrokerPending, useAuth } from "../../lib/auth";
import { usePalette } from "../../lib/theme";

/**
 * Where a Google, GitHub or Apple sign-in comes back with its one-time ticket (the web at /auth/callback, a phone at
 * dandelist://auth). Swaps the ticket for a session, then opens the list.
 */
export default function AuthReturn() {
  const auth = useAuth();
  const router = useRouter();
  const p = usePalette();
  const params = useLocalSearchParams<{ ticket?: string; error?: string }>();
  const started = useRef(false);

  useEffect(() => {
    // Wait for the stored session check, so it can't overwrite the new one.
    if (auth.status === "loading" || started.current) return;
    started.current = true;
    // On Android the sign-in sheet that is still waiting gets this address too and finishes the sign-in itself.
    if (Platform.OS !== "web" && isBrokerPending() && router.canGoBack()) {
      router.back();
      return;
    }
    const ticket = typeof params.ticket === "string" ? params.ticket : "";
    const error = typeof params.error === "string" ? params.error : "";
    if (!ticket) {
      router.replace(error ? { pathname: "/sign-in", params: { error } } : "/");
      return;
    }
    auth.redeemTicket(ticket).then(
      () => router.replace("/wishes"),
      () => router.replace({ pathname: "/sign-in", params: { error: "failed" } }),
    );
  }, [auth, router, params.ticket, params.error]);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Backdrop source={require("../../assets/backdrop.jpg")} />
      <Shade from={0.05} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <ActivityIndicator color={p.ink} accessibilityLabel="Signing you in" />
        <Eyebrow color={p.ink2}>Signing you in</Eyebrow>
      </View>
      <Grain />
    </View>
  );
}
