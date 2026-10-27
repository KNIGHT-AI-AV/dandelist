import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Backdrop, Eyebrow, Figure, Glass, Grain, Photo, PrimaryButton, QuietButton, Shade } from "../../components/lux";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { fonts, radius, space, usePalette } from "../../lib/theme";
import { loadWelcome, saveWelcome, toWishes } from "../../lib/welcome";
import { useWishes, type Wish } from "../../lib/wishes";
import { KIND_LABEL, TIER_LABEL, agentLine, hostOf, whenChecked } from "../../lib/words";

const MAX_W = 520;

function WishCard({ w, tall }: { w: Wish; tall: boolean }) {
  const p = usePalette();
  const monthly = recurringBreakdown([w.item]).perMonth;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${w.name}, ${formatCents(w.item.upfrontCents)}`}
      onPress={() => router.push(`/wishes/${w.id}`)}
      style={({ pressed }) => ({ height: tall ? 232 : 184, borderRadius: radius.lg, overflow: "hidden", opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}
    >
      <Photo uri={w.details.agent?.imageUrl} kind={w.kind} />
      <Shade from={0.25} />
      <Glass style={{ position: "absolute", top: 14, left: 14, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
        <Eyebrow color={p.ink}>{`${KIND_LABEL[w.kind]} · ${TIER_LABEL[w.tier]}`}</Eyebrow>
      </Glass>
      <View style={{ position: "absolute", left: 18, right: 18, bottom: 16, gap: 4 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 27, lineHeight: 30, color: p.ink }} numberOfLines={2}>
          {w.name}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            {w.details.agent ? <AgentDot /> : null}
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: p.ink2 }} numberOfLines={1}>
              {monthly ? `${agentLine(w)} · + ${formatCents(monthly)}/mo` : agentLine(w)}
            </Text>
          </View>
          <Figure value={formatCents(w.item.upfrontCents)} size={24} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * After any sign-in (code, Apple, Google, GitHub), the life someone kept on the welcome screen becomes their first
 * wishes. It runs once: the saved picks are cleared before the wishes are added, so a reload can't add them twice.
 */
function useAdoptWelcome(ready: boolean, add: ReturnType<typeof useWishes>["add"]) {
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      const kept = await loadWelcome();
      if (!kept?.kept || !kept.picks.length) return;
      await saveWelcome(null);
      for (const w of toWishes(kept)) await add(w).catch(() => null);
    })();
  }, [ready, add]);
}

export default function LifeList() {
  const auth = useAuth();
  const { wishes, status, error, reload, add } = useWishes();
  useAdoptWelcome(auth.status === "signedIn" && status === "ready", add);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // App Store rule 5.1.1(v): accounts can be deleted from inside the app. A second tap confirms.
  const deleteAccount = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    const res = await auth.api("/me", { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 204) await auth.signOut();
  };
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const items = wishes.map((w) => w.item);
  const monthly = recurringBreakdown(items).perMonth;
  // The briefing is the agent's most recent real check, never an invented event.
  const latest = wishes.filter((w) => w.details.agent).sort((a, b) => b.details.agent!.checkedAt.localeCompare(a.details.agent!.checkedAt))[0];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + 120, paddingHorizontal: 12, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, height: 40 }}>
          <Eyebrow>Your life list</Eyebrow>
          <Pressable accessibilityRole="button" accessibilityLabel="Menu" onPress={() => setMenu((m) => !m)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: fonts.label, fontSize: 13, color: p.ink2 }}>{(auth.user?.email ?? "·").slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
        {menu ? (
          <Glass style={{ marginHorizontal: 12, marginTop: 6, paddingVertical: 4 }}>
            <QuietButton label="The plan" onPress={() => { setMenu(false); router.push("/plan"); }} />
            <QuietButton label="Theme" onPress={() => { setMenu(false); router.push("/theme"); }} />
            <QuietButton label="Enter a wish yourself" onPress={() => { setMenu(false); router.push("/wishes/manual"); }} />
            <QuietButton label="Sign out" onPress={() => auth.signOut()} />
            <QuietButton label="Privacy" onPress={() => { setMenu(false); router.push("/privacy"); }} />
            <QuietButton label="Terms" onPress={() => { setMenu(false); router.push("/terms"); }} />
            <QuietButton label={confirmDelete ? "Tap again to delete everything" : "Delete my account"} onPress={deleteAccount} />
          </Glass>
        ) : null}

        {wishes.length ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 18, gap: 6 }}>
          <Eyebrow>The life you want</Eyebrow>
          <Figure value={formatCents(upfrontCashCents(items))} size={58} dollarSmall />
          <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: p.ink2 }}>
            {`${formatCents(monthly)} a month to run · ${wishes.length} ${wishes.length === 1 ? "wish" : "wishes"}`}
          </Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/plan")} hitSlop={8} style={{ alignSelf: "flex-start", marginTop: 6 }}>
            <Text style={{ fontFamily: fonts.label, fontSize: 13, color: p.accent }}>See when you can have it all</Text>
          </Pressable>
        </View>
        ) : null}

        {latest ? (
          <Glass style={{ marginTop: 18, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot />
              <Eyebrow>Your agent</Eyebrow>
            </View>
            <Text style={{ fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: p.ink }}>
              {`Priced ${latest.name} at ${formatCents(latest.item.upfrontCents)}, ${latest.details.agent!.status === "verified" ? "checked on" : "an estimate from"} ${hostOf(latest.details.agent!.url)} ${whenChecked(latest.details.agent!.checkedAt)}.`}
            </Text>
          </Glass>
        ) : null}

        <View style={{ marginTop: 14, gap: 10 }}>
          {status === "loading" && wishes.length === 0 ? (
            <ActivityIndicator color={p.accent} style={{ marginTop: 40 }} />
          ) : status === "error" ? (
            <Glass style={{ padding: 18, gap: 12 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.danger }}>{error}</Text>
              <PrimaryButton label="Try again" onPress={() => reload()} />
            </Glass>
          ) : wishes.length === 0 ? (
            <View style={{ height: 520, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end", padding: 22, gap: 12 }}>
              <Backdrop source={require("../../assets/backdrop.jpg")} />
              <Shade from={0.1} />
              <Eyebrow color={p.ink}>Your first wish</Eyebrow>
              <Text style={{ fontFamily: fonts.display, fontSize: 38, lineHeight: 41, color: p.ink }}>Price the life you want.</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: p.ink2 }}>Tell the agent what you want. It finds the real price and what it costs over the years.</Text>
            </View>
          ) : (
            wishes.map((w, i) => <WishCard key={w.id} w={w} tall={i % 3 !== 2} />)
          )}
        </View>
      </ScrollView>

      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 14, alignItems: "center", paddingHorizontal: 14 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tell me what you want" onPress={() => router.push("/wishes/new")} style={{ width: "100%", maxWidth: MAX_W - 4 }}>
          <Glass intensity={60} style={{ height: 58, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: p.ink2 }}>Tell me what you want...</Text>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.label, fontSize: 20, color: p.onAccent, marginTop: -2 }}>+</Text>
            </View>
          </Glass>
        </Pressable>
      </View>
      <Grain />
    </View>
  );
}
