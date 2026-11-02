import { Redirect, router } from "expo-router";
import { View } from "react-native";
import { WelcomeBack } from "../components/welcome-back";
import { useAuth } from "../lib/auth";
import { usePalette } from "../lib/theme";

export default function Index() {
  const { status } = useAuth();
  const p = usePalette();
  // The session check takes well under a second: show the page colour, not a spinner flash (UI audit P2-26).
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: p.bg }} accessibilityLabel="Loading" />;
  // Someone signed in is welcomed back before their list, on every return and right after signing in (owner,
  // 2026-11-02: "it shouldn't just take them to the straight homepage").
  if (status === "signedIn") return <WelcomeBack onDone={() => router.replace("/wishes")} />;
  return <Redirect href="/welcome" />;
}
