import { BodoniModa_400Regular, BodoniModa_400Regular_Italic } from "@expo-google-fonts/bodoni-moda";
import { DMMono_400Regular } from "@expo-google-fonts/dm-mono";
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { InterTight_400Regular } from "@expo-google-fonts/inter-tight";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider, usePalette } from "../lib/theme";
import { WishProvider } from "../lib/wishes";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const p = usePalette();
  const [loaded, error] = useFonts({
    // Bodoni Moda's optical cuts (OFL; assets/fonts/OFL-BodoniModa.txt): Display (opsz 72) for 28 px and up, Title
    // (opsz 28) for 18–27 px, and the package's 11 pt text cut below that (UI audit P1-9).
    BodoniDisplay: require("../assets/fonts/BodoniModaDisplay-Regular.ttf"),
    BodoniDisplay_Italic: require("../assets/fonts/BodoniModaDisplay-Italic.ttf"),
    BodoniTitle: require("../assets/fonts/BodoniModaTitle-Regular.ttf"),
    BodoniTitle_Italic: require("../assets/fonts/BodoniModaTitle-Italic.ttf"),
    BodoniModa_400Regular,
    BodoniModa_400Regular_Italic,
    // Instrument Serif (OFL), the logo's face, sets every serif role since the readability pass of 2026-10-27.
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    InterTight_400Regular,
    DMMono_400Regular,
  });
  // Hold the first frame until the type is ready (or failed, in which case system fonts take over).
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WishProvider>
          <StatusBar style={p.scheme === "dark" ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
            {/* The detail grows out of its card over the list, so the list stays underneath (UI audit P1-17). */}
            <Stack.Screen name="wishes/[id]" options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} />
          </Stack>
        </WishProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
