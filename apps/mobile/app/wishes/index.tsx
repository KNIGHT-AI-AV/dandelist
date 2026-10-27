import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Backdrop, Breathing, EdgeFade, Eyebrow, Glass, Grain, Icon, Money, Photo, PrimaryButton, QuietButton, Shade, Wordmark } from "../../components/lux";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { usePress } from "../../lib/motion";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import { loadWelcome, saveWelcome, toWishes } from "../../lib/welcome";
import { useWishes, type Wish } from "../../lib/wishes";
import { TIER_LABEL, agentLine, hostOf, whenChecked } from "../../lib/words";
import { rememberCard } from "../../lib/zoom";

function WishCard({ w, tall }: { w: Wish; tall: boolean }) {
  const p = usePalette();
  const press = usePress(0.985);
  const ref = useRef<View>(null);
  const monthly = recurringBreakdown([w.item]).perMonth;
  const open = () => {
    // The detail zooms out of this card: remember where it is (by id, not by view) before navigating.
    const go = () => router.push(`/wishes/${w.id}`);
    if (!ref.current) return go();
    ref.current.measureInWindow((x, y, width, height) => {
      rememberCard(w.id, { x, y, width, height });
      go();
    });
  };
  return (
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`${w.name}, ${formatCents(w.item.upfrontCents)}`} onPress={open} onPressIn={press.onPressIn} onPressOut={press.onPressOut} collapsable={false}>
      <Animated.View style={{ height: tall ? 232 : 184, borderRadius: radius.lg, overflow: "hidden", transform: [{ scale: press.scale }] }}>
        <Photo uri={w.details.agent?.imageUrl} />
        <Shade from={0.25} />
        <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: 16, gap: 6 }}>
          <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
            {w.name}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              {w.details.agent ? <AgentDot /> : null}
              <Text style={[type.footnote, { color: p.ink2, flexShrink: 1 }]} numberOfLines={1}>
                {monthly ? `${agentLine(w)} · + ${formatCents(monthly)}/mo` : agentLine(w)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={[type.figure, { color: p.ink2, textTransform: "uppercase" }]}>{TIER_LABEL[w.tier]}</Text>
              <Money cents={w.item.upfrontCents} size="card" />
            </View>
          </View>
        </View>
      </Animated.View>
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

/** True once `ms` have passed: waits under a second show nothing rather than a flash (NN/g, UI audit P2-26). */
function useAfter(ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on;
}

export default function LifeList() {
  const auth = useAuth();
  const { wishes, status, error, reload, add } = useWishes();
  useAdoptWelcome(auth.status === "signedIn" && status === "ready", add);
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const late = useAfter(200);
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
  const gutter = layout.gutter(width);
  const dock = layout.dockHeight(insets.bottom);
  const count = `${wishes.length} ${wishes.length === 1 ? "wish" : "wishes"}`;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: dock, paddingHorizontal: gutter, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", height: layout.headerBar }}>
          <Wordmark />
          <Pressable accessibilityRole="button" accessibilityLabel="Menu" onPress={() => setMenu((m) => !m)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" }}>
              <Text style={[type.label, { color: p.ink2 }]}>{(auth.user?.email ?? "·").slice(0, 1).toUpperCase()}</Text>
            </View>
          </Pressable>
        </View>
        {menu ? (
          <Glass style={{ marginTop: 8, paddingVertical: 4 }}>
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
          <View style={{ paddingTop: layout.stack.section, gap: layout.stack.tight }}>
            <Eyebrow>The life you want</Eyebrow>
            <Money cents={upfrontCashCents(items)} size="hero" />
            <Text style={[type.footnote, { color: p.ink2 }]}>{monthly ? `${formatCents(monthly)} a month to run · ${count}` : count}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push("/plan")} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}>
              <Text style={[type.label, { color: p.accentText }]}>See when you can have it all</Text>
            </Pressable>
          </View>
        ) : null}

        {latest ? (
          <Glass style={{ marginTop: layout.stack.base, padding: 16, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot />
              <Eyebrow>Your agent</Eyebrow>
            </View>
            <Text style={[type.callout, { color: p.ink }]}>
              {`Priced ${latest.name} at ${formatCents(latest.item.upfrontCents)}, ${latest.details.agent!.status === "verified" ? "checked on" : "an estimate from"} ${hostOf(latest.details.agent!.url)} ${whenChecked(latest.details.agent!.checkedAt)}.`}
            </Text>
          </Glass>
        ) : null}

        <View style={{ marginTop: layout.stack.base, gap: 12 }}>
          {status === "loading" && wishes.length === 0 ? (
            late ? [232, 184, 232].map((h, i) => <Breathing key={i} style={{ height: h }} />) : null
          ) : status === "error" ? (
            <Glass style={{ padding: layout.cardPad, gap: 12 }}>
              <Text style={[type.callout, { color: p.danger }]}>{error}</Text>
              <PrimaryButton label="Try again" onPress={() => reload()} />
            </Glass>
          ) : wishes.length === 0 ? (
            <View style={{ height: 520, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end", padding: layout.cardPad, gap: 12 }}>
              <Backdrop source={require("../../assets/backdrop.jpg")} />
              <Shade from={0.1} />
              <Eyebrow color={p.ink}>Your first wish</Eyebrow>
              <Text style={[t.title1, { color: p.ink }]}>Price the life you want.</Text>
              <Text style={[type.callout, { color: p.ink2 }]}>Tell the agent what you want. It finds the real price and what it costs over the years.</Text>
            </View>
          ) : (
            wishes.map((w, i) => <WishCard key={w.id} w={w} tall={i % 3 !== 2} />)
          )}
        </View>
      </ScrollView>

      <EdgeFade height={dock} />
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 16, alignItems: "center", paddingHorizontal: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tell me what you want" onPress={() => router.push("/wishes/new")} style={{ width: "100%", maxWidth: layout.list }}>
          <Glass intensity={60} style={{ height: 58, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8 }}>
            <Text style={[type.body, { flex: 1, color: p.ink2 }]}>Tell me what you want...</Text>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
              <Icon name="plus" color={p.onAccent} />
            </View>
          </Glass>
        </Pressable>
      </View>
      <Grain />
    </View>
  );
}
