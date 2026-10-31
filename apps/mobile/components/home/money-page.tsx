import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { comfortableIncome, needOf, wishEntry } from "../../lib/comfort";
import { useMoney } from "../../lib/currency";
import { biggest, keepLines, tierTotals } from "../../lib/money-summary";
import { fonts, layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { TIER_LABEL, TIER_RANK } from "../../lib/words";
import { counted, pricelessAside } from "../../lib/worth";
import { Eyebrow, Glass, Hairline, Money, QuietButton } from "../lux";
import { IncomeFader } from "../welcome/comfort";
import { useTopRoom } from "./chrome";

/** Running costs shown before "Show all". */
const KEEP_SHOWN = 5;

/** ●●● for the wish wanted most, ●○○ for someday. */
function Pips({ rank }: { rank: 1 | 2 | 3 }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: i < 4 - rank ? p.accent : p.track }} />
      ))}
    </View>
  );
}

/** A thin bar for a share of the whole. */
function Share({ of }: { of: number }) {
  const p = usePalette();
  return (
    <View style={{ height: 3, borderRadius: 1.5, backgroundColor: p.track, overflow: "hidden" }}>
      <View style={{ height: 3, width: `${Math.max(0, Math.min(1, of)) * 100}%`, backgroundColor: p.accent }} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Glass style={{ padding: layout.cardPad, gap: layout.stack.base, borderRadius: radius.lg }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </Glass>
  );
}

/**
 * Money (owner, recording 03: tapping the price opens "a full money page about the costs of all items"): the total,
 * what it all costs to keep, the income that carries it comfortably with the fader to try others, where the money
 * goes by how much each wish is wanted, and the dearest wishes. No dates and no saving plans.
 */
export function MoneyPage() {
  const p = usePalette();
  const t = useType();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const { wishes } = useWishes();
  // A priceless wish is on the list but in no sum (lib/worth.ts).
  const items = counted(wishes).map((w) => w.item);
  const total = upfrontCashCents(items);
  const aside = pricelessAside(wishes);
  const keep = recurringBreakdown(items);
  // Each wish needs the income its kind of purchase takes comfortably, its running costs included (lib/comfort.ts).
  const need = useMemo(() => needOf(wishes.map(wishEntry)), [wishes]);
  const comfortable = comfortableIncome(need);
  const [income, setIncome] = useState(comfortable);
  // A new or changed wish moves the comfortable income; the fader follows until someone moves it.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setIncome(comfortable);
  }, [comfortable, touched]);
  const tiers = useMemo(() => tierTotals(wishes), [wishes]);
  const top5 = useMemo(() => biggest(wishes), [wishes]);
  const lines = useMemo(() => keepLines(wishes), [wishes]);
  const [allLines, setAllLines] = useState(false);

  if (!wishes.length) {
    return (
      <View style={{ flex: 1, paddingTop: top + layout.contentTop, paddingHorizontal: gutter, alignItems: "center", gap: layout.stack.tight }}>
        <Eyebrow>Money</Eyebrow>
        <Text style={[t.title1, { color: p.ink, textAlign: "center" }]}>Nothing to add up yet.</Text>
        <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>Add a wish and its price, its running costs and what it would take all appear here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ scrollbarWidth: "none" } as object} contentContainerStyle={{ paddingTop: top + layout.stack.base, paddingBottom: insets.bottom + space[40], paddingHorizontal: gutter, gap: layout.stack.section, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
      <View style={{ alignItems: "center", gap: 6, paddingTop: layout.stack.base }}>
        <Eyebrow>Money</Eyebrow>
        <Money cents={total} size="hero" style={{ alignSelf: "center" }} />
        <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>{`Everything on your list, ${wishes.length} ${wishes.length === 1 ? "wish" : "wishes"}`}</Text>
        {aside ? <Text style={[type.footnote, { color: p.ink3, textAlign: "center" }]}>{aside}</Text> : null}
      </View>

      <Section title="To keep it all">
        {keep.perYear > 0 ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={[t.title2, { color: p.ink }]}>
                {money.format(keep.perMonth)}
                <Text style={[type.callout, { color: p.ink2 }]}> a month</Text>
              </Text>
              <Text style={[type.figure, { color: p.ink3 }]}>{`${money.format(keep.perYear)} a year`}</Text>
            </View>
            <View>
              {(allLines ? lines : lines.slice(0, KEEP_SHOWN)).map((l, i) => (
                <View key={`${l.text}:${i}`}>
                  <Hairline />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[12], paddingVertical: 10 }}>
                    <Text style={[type.footnote, { color: p.ink, flex: 1 }]} numberOfLines={2}>
                      {l.text}
                    </Text>
                    <Text style={[type.figure, { color: p.ink2 }]}>{`${money.format(l.perYear / 12)}/mo`}</Text>
                  </View>
                </View>
              ))}
              {lines.length > KEEP_SHOWN ? <QuietButton label={allLines ? "Show fewer" : `Show all ${lines.length}`} onPress={() => setAllLines((a) => !a)} /> : null}
            </View>
          </>
        ) : (
          // An empty list of running costs means none are recorded, not that keeping these things is free (Codex R13).
          <Text style={[type.callout, { color: p.ink2 }]}>No running costs recorded yet.</Text>
        )}
      </Section>

      <Section title="What it would take">
        <Text style={[type.callout, { color: p.ink2 }]}>
          {"You could comfortably have everything here on "}
          <Text style={{ color: p.accentText }}>{money.format(comfortable)}</Text>
          {" a year. Slide to see how other incomes feel."}
        </Text>
        <IncomeFader
          incomeCents={income}
          needCents={need}
          size={44}
          onChange={(c) => {
            setTouched(true);
            setIncome(c);
          }}
        />
      </Section>

      <Section title="By how much you want it">
        {tiers.map((tr) => (
          <View key={tr.tier} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
              <Pips rank={TIER_RANK[tr.tier]} />
              <Text style={[type.label, { color: p.ink, flex: 1 }]}>{TIER_LABEL[tr.tier]}</Text>
              <Text style={[type.figure, { color: p.ink3 }]}>{tr.count}</Text>
              <Money cents={tr.cents} size="ledger15" />
            </View>
            <Share of={tr.share} />
          </View>
        ))}
      </Section>

      <Section title="The biggest">
        {top5.map(({ wish, share }) => (
          <Pressable key={wish.id} accessibilityRole="button" accessibilityLabel={`${wish.name}, ${money.format(wish.item.upfrontCents)}, ${Math.round(share * 100)} percent of the list`} onPress={() => router.push(`/wishes/${wish.id}`)} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[8] }}>
              <Text style={[type.callout, { color: p.ink, flex: 1, fontFamily: fonts.title }]} numberOfLines={1}>
                {wish.name}
              </Text>
              <Text style={[type.figure, { color: p.ink3 }]}>{`${Math.round(share * 100)}%`}</Text>
              <Money cents={wish.item.upfrontCents} size="ledger15" />
            </View>
            <Share of={share} />
          </Pressable>
        ))}
      </Section>
    </ScrollView>
  );
}
