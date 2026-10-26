import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../lib/auth";
import { usePalette } from "../lib/theme";

export default function Index() {
  const { status } = useAuth();
  const p = usePalette();
  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.bg }}>
        <ActivityIndicator color={p.ink} accessibilityLabel="Loading" />
      </View>
    );
  }
  return <Redirect href={status === "signedIn" ? "/wishes" : "/sign-in"} />;
}
