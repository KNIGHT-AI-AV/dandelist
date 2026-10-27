import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../lib/auth";
import { usePalette } from "../lib/theme";

export default function Index() {
  const { status } = useAuth();
  const p = usePalette();
  // The session check takes well under a second: show the page colour, not a spinner flash (UI audit P2-26).
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: p.bg }} accessibilityLabel="Loading" />;
  return <Redirect href={status === "signedIn" ? "/wishes" : "/welcome"} />;
}
