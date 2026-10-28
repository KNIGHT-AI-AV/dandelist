import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWishes } from "../../lib/wishes";
import { layout, space, usePalette } from "../../lib/theme";
import { Eyebrow, Money } from "../lux";
import { useTopRoom } from "./chrome";

/** What everything on the list costs: the total, the cost to keep it all, and the income that carries it. */
export function MoneyPage() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const { wishes } = useWishes();
  const items = wishes.map((w) => w.item);
  return (
    <ScrollView contentContainerStyle={{ paddingTop: top + layout.contentTop, paddingBottom: insets.bottom + space[40], paddingHorizontal: gutter, gap: space[20], width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
      <View style={{ gap: layout.stack.tight }}>
        <Eyebrow>Money</Eyebrow>
        <Money cents={upfrontCashCents(items)} size="hero" />
        <Money cents={recurringBreakdown(items).perMonth} size="ledger" color={p.ink2} />
      </View>
    </ScrollView>
  );
}
