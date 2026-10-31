import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Backdrop, Eyebrow, Grain, Shade } from "../../components/lux";
import { LinkError, isBrokerPending, useAuth } from "../../lib/auth";
import { usePalette } from "../../lib/theme";
import { Atmosphere } from "../../components/atmosphere";

/**
 * Where a Google, GitHub, Facebook or Apple sign-in comes back with its one-time ticket (the web at /auth/callback, a
 * phone at dandelist://auth). Swaps the ticket for a session, then opens the list. A link from settings comes back
 * here too, marked `intent=link`: it finishes the link and returns to settings, with a reason when it didn't work.
 */
export default function AuthReturn() {
  const auth = useAuth();
  const router = useRouter();
  const p = usePalette();
  const params = useLocalSearchParams<{ ticket?: string; error?: string; intent?: string }>();
  const started = useRef(false);
  /** Whether this screen is still there to move on from: a ticket that finishes after the person left it moves nothing. */
  const here = useRef(true);
  const linking = params.intent === "link";

  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

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
    if (linking) {
      const settings = (extra: Record<string, string> = {}) => router.replace({ pathname: "/wishes", params: { page: "settings", ...extra } });
      if (auth.status !== "signedIn") {
        router.replace("/sign-in");
        return;
      }
      if (!ticket) {
        settings(error && error !== "cancelled" ? { linkError: error } : {});
        return;
      }
      auth.redeemLink(ticket).then(
        () => settings({ linked: "1" }),
        (e: unknown) => settings({ linkError: e instanceof LinkError ? e.code : "failed" }),
      );
      return;
    }
    if (!ticket) {
      router.replace(error ? { pathname: "/sign-in", params: { error } } : "/");
      return;
    }
    // False when a newer sign-in or a sign-out took over meanwhile: that one decides where to go, so this stays put.
    auth.redeemTicket(ticket).then(
      (took) => {
        if (took && here.current) router.replace("/wishes");
      },
      () => {
        if (here.current) router.replace({ pathname: "/sign-in", params: { error: "failed" } });
      },
    );
  }, [auth, router, params.ticket, params.error, linking]);

  const label = linking ? "Linking your account" : "Signing you in";
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <Backdrop source={require("../../assets/backdrop.jpg")} />
      <Shade from={0.05} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <ActivityIndicator color={p.ink} accessibilityLabel={label} />
        <Eyebrow color={p.ink2}>{label}</Eyebrow>
      </View>
      <Grain />
    </View>
  );
}
