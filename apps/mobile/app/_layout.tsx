import { BodoniModa_400Regular, BodoniModa_400Regular_Italic, BodoniModa_500Medium } from "@expo-google-fonts/bodoni-moda";
import { DMMono_400Regular } from "@expo-google-fonts/dm-mono";
import { InterTight_400Regular, InterTight_600SemiBold } from "@expo-google-fonts/inter-tight";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth";
import { usePalette } from "../lib/theme";
import { WishProvider } from "../lib/wishes";

export default function RootLayout() {
  const p = usePalette();
  const [loaded, error] = useFonts({
    BodoniModa_400Regular,
    BodoniModa_400Regular_Italic,
    BodoniModa_500Medium,
    InterTight_400Regular,
    InterTight_600SemiBold,
    DMMono_400Regular,
  });
  // Hold the first frame until the type is ready (or failed, in which case system fonts take over).
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WishProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
        </WishProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
