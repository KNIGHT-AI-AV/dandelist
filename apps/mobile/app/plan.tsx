import { recurringBreakdown } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Eyebrow, Glass, GlassField, Grain, Hairline, IconButton, Money, Photo } from "../components/lux";
import { useAuth } from "../lib/auth";
import { formatCents, parseDollars } from "../lib/money";
import { getSecret, setSecret } from "../lib/storage";
import { fonts, layout, radius, type, usePalette, useType } from "../lib/theme";
import { useWishes } from "../lib/wishes";
import { TIER_LABEL, monthYear } from "../lib/words";

const KEY = "dandelist.monthlyAside";
const RANK = { must: 0, nice: 1, dream: 2 } as const;

/** The month a running total is reached, saving `monthly` cents a month from now. */
function reachBy(cumulativeCents: number, monthlyCents: number, now = new Date()): Date {
  const months = Math.ceil(cumulativeCents / monthlyCents);
  return new Date(now.getFullYear(), now.getMonth() + months, 1);
}

export default function Plan() {
  const auth = useAuth();
  const { wishes } = useWishes();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [aside, setAside] = useState("");
  useEffect(() => {
    getSecret(KEY).then((v) => v && setAside(v));
  }, []);
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const monthly = aside.trim() ? parseDollars(aside) : null;
  // Must before nice before dream; within a tier, the order they were added.
  const ordered = [...wishes].sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.createdAt.localeCompare(b.createdAt));
  let running = 0;
  const rows = ordered.map((w) => {
    running += w.item.upfrontCents;
    return { w, when: monthly ? reachBy(running, monthly) : null };
  });
  const lastMust = [...rows].reverse().find((r) => r.w.tier === "must");
  const runningCosts = recurringBreakdown(wishes.map((w) => w.item)).perMonth;
  const gutter = layout.gutter(width);

  function save(text: string) {
    setAside(text);
    void setSecret(KEY, text.trim() || null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: insets.bottom + 40, paddingHorizontal: gutter, gap: 20, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
        <View style={{ gap: layout.stack.tight }}>
          <Eyebrow>The plan</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>When you can have it all</Text>
        </View>
        <GlassField label="You put aside each month" value={aside} onChangeText={save} keyboardType="decimal-pad" inputMode="decimal" placeholder="$3,000" inputStyle={[type.title2, { fontVariant: ["tabular-nums"] }]} />
        {aside.trim() && monthly === null ? <Text style={[type.footnote, { color: p.danger }]}>Enter an amount, like 3000.</Text> : null}

        <View>
          {rows.map(({ w, when }) => (
            <Pressable key={w.id} accessibilityRole="button" onPress={() => router.push(`/wishes/${w.id}`)}>
              <Hairline />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
                <View style={{ width: 56, height: 56, borderRadius: radius.sm, overflow: "hidden" }}>
                  <Photo uri={w.details.agent?.imageUrl} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.title3, { color: p.ink }]} numberOfLines={1}>{w.name}</Text>
                  <Text style={[type.figure, { color: p.ink3, textTransform: "uppercase" }]}>{TIER_LABEL[w.tier]}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]}>{when ? monthYear(when) : ""}</Text>
                  <Money cents={w.item.upfrontCents} size="ledger" color={p.ink2} />
                </View>
              </View>
            </Pressable>
          ))}
          {rows.length ? <Hairline /> : <Text style={[type.callout, { color: p.ink2 }]}>Add a wish and it appears here with a date.</Text>}
        </View>

        {monthly && rows.length ? (
          <Glass style={{ padding: 16, gap: 8, borderRadius: radius.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot />
              <Eyebrow>Your agent</Eyebrow>
            </View>
            <Text style={[type.callout, { color: p.ink }]}>
              {lastMust ? `At ${formatCents(monthly)} a month, your must-haves are covered by ${monthYear(lastMust.when!)}.` : `At ${formatCents(monthly)} a month, everything on your list is covered by ${monthYear(rows[rows.length - 1]!.when!)}.`}
              {runningCosts ? ` Once you have them all, running costs add ${formatCents(runningCosts)} a month.` : ""}
            </Text>
          </Glass>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: 4 }}>
          <Eyebrow>Everything upfront</Eyebrow>
          <Money cents={running} size="title" align="right" />
        </View>
      </ScrollView>
      <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} style={{ position: "absolute", top: insets.top + 4, left: 16 }} />
      <Grain />
    </View>
  );
}
