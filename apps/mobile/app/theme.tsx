import { upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "../components/lux";
import { ThemeChooser } from "../components/welcome/theme";
import { layout, usePalette, useTheme } from "../lib/theme";
import { useWishes } from "../lib/wishes";
import { counted } from "../lib/worth";
import { Atmosphere } from "../components/atmosphere";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/wishes"));

/**
 * The theme chooser from the welcome flow, reachable from the palette in the top bar and from settings. Closing it
 * keeps the theme as it was; "Use this theme" keeps the new one, and both go back to where the person was.
 */
export default function ThemeScreen() {
  const p = usePalette();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { wishes } = useWishes();
  const total = upfrontCashCents(counted(wishes).map((w) => w.item));
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <ThemeChooser
        totalCents={total}
        cta="Use this theme"
        onDone={(id) => {
          theme.set(id);
          leave();
        }}
      />
      <IconButton icon="close" label="Close" onPress={leave} style={{ position: "absolute", top: insets.top + (layout.headerBar - layout.control.icon) / 2, left: layout.gutter(width), zIndex: 10 }} />
    </View>
  );
}
