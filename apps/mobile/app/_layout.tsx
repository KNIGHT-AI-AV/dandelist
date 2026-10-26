import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth";
import { usePalette } from "../lib/theme";
import { WishProvider } from "../lib/wishes";

export default function RootLayout() {
  const p = usePalette();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WishProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
        </WishProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
