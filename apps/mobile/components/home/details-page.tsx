import { upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWishes } from "../../lib/wishes";
import { layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { TIER_LABEL, TIER_RANK } from "../../lib/words";
import { Eyebrow, Hairline, Money, Photo } from "../lux";
import { useTopRoom } from "./chrome";

/** Every wish in one condensed list: a small picture, the name, how much it's wanted, and the price. */
export function DetailsPage() {
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const { wishes } = useWishes();
  const rows = [...wishes].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.createdAt.localeCompare(b.createdAt));
  return (
    <ScrollView contentContainerStyle={{ paddingTop: top + layout.contentTop, paddingBottom: insets.bottom + space[40], paddingHorizontal: gutter, gap: space[20], width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
      <View style={{ gap: layout.stack.tight }}>
        <Eyebrow>Details</Eyebrow>
        <Money cents={upfrontCashCents(wishes.map((w) => w.item))} size="title" />
        <Text style={[type.footnote, { color: p.ink2 }]}>{`${wishes.length} ${wishes.length === 1 ? "wish" : "wishes"}`}</Text>
      </View>
      <View>
        {rows.map((w) => (
          <Pressable key={w.id} accessibilityRole="button" onPress={() => router.push(`/wishes/${w.id}`)}>
            <Hairline />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
              <View style={{ width: 48, height: 48, borderRadius: radius.sm, overflow: "hidden" }}>
                <Photo uri={w.details.agent?.imageUrl} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[t.title3, { color: p.ink }]} numberOfLines={1}>{w.name}</Text>
                <Text style={[type.figure, { color: p.ink3, textTransform: "uppercase" }]}>{TIER_LABEL[w.tier]}</Text>
              </View>
              <Money cents={w.item.upfrontCents} size="ledger" color={p.ink2} />
            </View>
          </Pressable>
        ))}
        {rows.length ? <Hairline /> : <Text style={[type.callout, { color: p.ink2 }]}>Your wishes appear here once you add them.</Text>}
      </View>
    </ScrollView>
  );
}
