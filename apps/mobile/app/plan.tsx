import { recurringBreakdown } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Eyebrow, Figure, Glass, GlassField, Grain, Hairline, Photo } from "../components/lux";
import { useAuth } from "../lib/auth";
import { formatCents, parseDollars } from "../lib/money";
import { getSecret, setSecret } from "../lib/storage";
import { fonts, radius, usePalette } from "../lib/theme";
import { useWishes } from "../lib/wishes";
import { TIER_LABEL, monthYear } from "../lib/words";

const MAX_W = 520;
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
  const insets = useSafeAreaInsets();
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

  function save(text: string) {
    setAside(text);
    void setSecret(KEY, text.trim() || null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40, paddingHorizontal: 24, gap: 16, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
        <Eyebrow>The plan</Eyebrow>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 42, lineHeight: 44, color: p.ink }}>When you can have it all</Text>
        <GlassField label="You put aside each month" value={aside} onChangeText={save} keyboardType="decimal-pad" inputMode="decimal" placeholder="$3,000" inputStyle={{ fontFamily: fonts.display, fontSize: 26 }} />
        {aside.trim() && monthly === null ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.danger }}>Enter an amount, like 3000.</Text> : null}

        <View>
          {rows.map(({ w, when }) => (
            <Pressable key={w.id} accessibilityRole="button" onPress={() => router.push(`/wishes/${w.id}`)}>
              <Hairline />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
                <View style={{ width: 54, height: 54, borderRadius: 14, overflow: "hidden" }}>
                  <Photo uri={w.details.agent?.imageUrl} kind={w.kind} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 21, color: p.ink }} numberOfLines={1}>{w.name}</Text>
                  <Eyebrow style={{ marginTop: 3 }} color={p.ink3}>{TIER_LABEL[w.tier]}</Eyebrow>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 19, color: p.ink }}>{when ? monthYear(when) : ""}</Text>
                  <Text style={{ fontFamily: fonts.figure, fontSize: 11.5, color: p.ink2 }}>{formatCents(w.item.upfrontCents)}</Text>
                </View>
              </View>
            </Pressable>
          ))}
          {rows.length ? <Hairline /> : <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.ink2 }}>Add a wish and it appears here with a date.</Text>}
        </View>

        {monthly && rows.length ? (
          <Glass style={{ padding: 14, gap: 6, borderRadius: radius.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot />
              <Eyebrow>Your agent</Eyebrow>
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: p.ink }}>
              {lastMust ? `At ${formatCents(monthly)} a month, your must-haves are covered by ${monthYear(lastMust.when!)}.` : `At ${formatCents(monthly)} a month, everything on your list is covered by ${monthYear(rows[rows.length - 1]!.when!)}.`}
              {runningCosts ? ` Once you have them all, running costs add ${formatCents(runningCosts)} a month.` : ""}
            </Text>
          </Glass>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: 4 }}>
          <Eyebrow>Everything upfront</Eyebrow>
          <Figure value={formatCents(running)} size={26} />
        </View>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} hitSlop={10} style={{ position: "absolute", top: insets.top + 10, left: 16 }}>
        <Glass style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 20, color: p.ink, marginTop: -3 }}>‹</Text>
        </Glass>
      </Pressable>
      <Grain />
    </View>
  );
}

