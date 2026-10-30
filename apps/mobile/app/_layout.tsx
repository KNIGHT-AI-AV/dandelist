// First, so every later read of the window, a measure or a gesture is in the page's units on a zoomed web page.
import "../lib/viewport";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Reminders } from "../components/home/reminders";
import { UpdatePrompt } from "../components/update-prompt";
import { AuthProvider } from "../lib/auth";
import { CurrencyProvider } from "../lib/currency";
import { useAppFonts } from "../lib/fonts";
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
  const [loaded, error] = useAppFonts();
  // Hold the first frame until the type is ready (or failed, in which case system fonts take over).
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CurrencyProvider>
          <WishProvider>
            <StatusBar style={p.scheme === "dark" ? "light" : "dark"} />
            {/* The phone's own notifications, planned on every open (off for now: lib/notifications.ts). */}
            <Reminders />
            {/* "A new version is out", from latest.json, once the home is calm (lib/update-core.ts). */}
            <UpdatePrompt />
            {/* Navigation paints its own background between screens; without this it is React Navigation's light grey
                (#F2F2F2), which Taste Engine found on the live site. */}
            <NavigationTheme value={{ ...(p.scheme === "dark" ? DarkTheme : DefaultTheme), colors: { ...(p.scheme === "dark" ? DarkTheme : DefaultTheme).colors, background: p.bg, card: p.bg, text: p.ink, border: p.hair, primary: p.accent } }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
              {/* The detail grows out of its card over the list, so the list stays underneath (UI audit P1-17). */}
              <Stack.Screen name="wishes/[id]" options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} />
            </Stack>
            </NavigationTheme>
          </WishProvider>
        </CurrencyProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
