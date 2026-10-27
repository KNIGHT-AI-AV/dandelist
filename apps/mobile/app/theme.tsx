import { upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { View } from "react-native";
import { ThemeChooser } from "../components/welcome/theme";
import { usePalette, useTheme } from "../lib/theme";
import { useWishes } from "../lib/wishes";

/** The theme chooser from the welcome flow, reachable from the life list menu. */
export default function ThemeScreen() {
  const p = usePalette();
  const theme = useTheme();
  const { wishes } = useWishes();
  const total = upfrontCashCents(wishes.map((w) => w.item));
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ThemeChooser
        total={`$${Math.round(total / 100).toLocaleString("en-US")}`}
        by="your plan"
        cta="Use this theme"
        onDone={(id) => {
          theme.set(id);
          if (router.canGoBack()) router.back();
          else router.replace("/wishes");
        }}
      />
    </View>
  );
}
