import { Text, View } from "react-native";
import { useMoney } from "../../lib/currency";
import type { Stats } from "../../lib/profile";
import { radius, type, usePalette, useType } from "../../lib/theme";
import { Breathing, Eyebrow, Glass } from "../lux";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One figure on glass: the number large in the house serif, what it counts beneath. */
function Tile({ figure, label, wide = false }: { figure: string; label: string; wide?: boolean }) {
  const p = usePalette();
  const t = useType();
  return (
    <Glass style={{ flexBasis: wide ? "100%" : "47%", flexGrow: 1, minHeight: 104, borderRadius: radius.lg, borderCurve: "continuous", padding: 18, justifyContent: "space-between", gap: 10 }}>
      <Text style={[t.title2, { color: p.ink, fontVariant: ["tabular-nums", "lining-nums"] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {figure}
      </Text>
      <Text style={[type.footnote, { color: p.ink2 }]}>{label}</Text>
    </Glass>
  );
}

/**
 * The list in numbers ("great-app stats", owner's walkthrough 2026-10-28): how many wishes and what they come to, how
 * many prices were checked, the talks with the Dandy, the days since joining, the biggest wish, and the split
 * between places, things and experiences. Money follows the chosen currency.
 */
export function StatsTiles({ stats, dandyName }: { stats: Stats | null; dandyName: string }) {
  const p = usePalette();
  const t = useType();
  const money = useMoney();
  if (!stats) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }} accessibilityLabel="Loading your numbers">
        {[0, 1, 2, 3].map((i) => (
          <Breathing key={i} style={{ flexBasis: "47%", flexGrow: 1, height: 104 }} />
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Tile figure={stats.wishes.toLocaleString("en-US")} label={stats.wishes === 1 ? "Wish" : "Wishes"} />
        <Tile figure={money.compact(stats.totalCents)} label="All of it together" />
        <Tile figure={stats.pricesChecked.toLocaleString("en-US")} label={stats.pricesChecked === 1 ? "Price checked at the seller" : "Prices checked at the seller"} />
        <Tile figure={stats.conversations.toLocaleString("en-US")} label={`Talks with ${dandyName}`} />
      </View>
      {stats.biggest ? (
        <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: 18, gap: 6 }}>
          <Eyebrow color={p.ink3}>The biggest wish</Eyebrow>
          <Text style={[t.title3, { color: p.ink }]} numberOfLines={2}>
            {stats.biggest.name}
          </Text>
          <Text style={[type.cardPrice, { color: p.accentText }]}>{money.format(stats.biggest.cents)}</Text>
        </Glass>
      ) : null}
      <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", paddingVertical: 16, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        {[
          [stats.places, "Places"],
          [stats.things, "Things"],
          [stats.experiences, "Experiences"],
        ].map(([n, label]) => (
          <View key={label} style={{ flex: 1, alignItems: "center", gap: 2 }} accessible accessibilityLabel={`${n} ${label}`}>
            <Text style={[t.title3, { color: p.ink, fontVariant: ["tabular-nums", "lining-nums"] }]}>{String(n)}</Text>
            <Text style={[type.footnote, { color: p.ink2 }]}>{label}</Text>
          </View>
        ))}
      </Glass>
      <Text style={[type.footnote, { color: p.ink3 }]}>{stats.daysSinceJoining === 0 ? "You joined Dandelist today." : `${plural(stats.daysSinceJoining, "day", "days")} with Dandelist.`}</Text>
    </View>
  );
}
