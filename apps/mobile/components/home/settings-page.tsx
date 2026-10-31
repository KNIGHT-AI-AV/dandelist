import { reportProblem } from "../help";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { linkErrorMessage, useAuth, useSignInOptions, type LinkedIdentity } from "../../lib/auth";
import { CURRENCIES, useMoney } from "../../lib/currency";
import { personaOf, useDandy } from "../../lib/dandy";
import { symbolOf } from "../../lib/fx";
import { useMemories } from "../../lib/memory";
import { haptic } from "../../lib/motion";
import { useSoundsOn } from "../../lib/sound";
import { fetchFacts, fetchHome, fetchIdentities, fetchStats, newFacts, saveHome, useProfile, type Facts, type Home, type Stats } from "../../lib/profile";
import { THEMES, layout, radius, space, type, usePalette, useTheme } from "../../lib/theme";
import { DandyAvatar } from "../dandy-avatar";
import { Chip, Glass, QuietButton } from "../lux";
import { AgentKeys } from "../settings/agent-keys";
import { DandyEditor } from "../settings/dandy-editor";
import { DeleteAccount } from "../settings/delete-account";
import { FactsCard } from "../settings/facts";
import { Card, Row, RowRule, Section } from "../settings/kit";
import { LinkedAccounts } from "../settings/linked-accounts";
import { MemoryCard } from "../settings/memory";
import { NotificationSettings } from "../settings/notifications";
import { PlacePicker, type Place } from "../settings/place-picker";
import { placeLabel } from "../settings/places";
import { NameField, ProfileCard } from "../settings/profile-card";
import { StatsTiles } from "../settings/stats";
import { SongNote } from "../song-note";
import { useTopRoom } from "./chrome";
import { usePager } from "./pager";

/**
 * The person's settings (owner's walkthrough, 2026-10-28): their picture and name, where they'd live and the currency
 * everything shows in, their Dandy, the list in numbers, three things the Dandy has noticed, the look, the sign-in
 * accounts on the account, and at the bottom Privacy & Terms, signing out and, behind a deliberate second step,
 * deleting the account. Its figures refresh each time the page comes to the front.
 */
export function SettingsPage() {
  const p = usePalette();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const { page } = usePager();
  const here = page === "settings";
  const dandy = useDandy();
  const theme = useTheme();
  const [soundsOn, setSoundsOn] = useSoundsOn();
  const money = useMoney();
  const options = useSignInOptions();
  const { profile } = useProfile();
  const params = useLocalSearchParams<{ linked?: string; linkError?: string }>();
  const scroll = useRef<ScrollView>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsLoading, setFactsLoading] = useState(true);
  const [factsBusy, setFactsBusy] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);
  // What the Dandy remembers, owned by the sign-in that loaded it (lib/memory.ts).
  const memory = useMemories(here && auth.status === "signedIn");
  const [identities, setIdentities] = useState<LinkedIdentity[] | null>(null);
  // undefined while loading, null when no place is chosen yet.
  const [home, setHome] = useState<Home | null | undefined>(undefined);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [editingDandy, setEditingDandy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Each time settings comes to the front its figures are brought up to date: a wish added a moment ago counts.
  useEffect(() => {
    if (!here || auth.status !== "signedIn") return;
    let live = true;
    fetchStats(auth.api).then((s) => live && setStats(s)).catch(() => {});
    fetchIdentities(auth.api).then((i) => live && setIdentities(i)).catch(() => {});
    fetchHome(auth.api).then((l) => live && setHome(l.home), () => live && setHome((h) => (h === undefined ? null : h)));
    fetchFacts(auth.api)
      .then((f) => live && setFacts(f))
      .catch(() => {})
      .finally(() => live && setFactsLoading(false));
    return () => {
      live = false;
    };
  }, [here, auth.status, auth.api]);

  // A link that left the app (the web) comes back here with how it went.
  useEffect(() => {
    const code = typeof params.linkError === "string" ? params.linkError : null;
    if (!code && params.linked !== "1") return;
    setNotice(linkErrorMessage(code));
    if (params.linked === "1") void fetchIdentities(auth.api).then(setIdentities).catch(() => {});
    router.setParams({ linked: undefined, linkError: undefined });
  }, [params.linked, params.linkError, auth.api]);

  const askFacts = async () => {
    setFactsBusy(true);
    setFactsError(null);
    try {
      setFacts(await newFacts(auth.api, dandy.persona));
      haptic.success();
    } catch (e) {
      setFactsError(e instanceof Error ? e.message : "Nothing came to mind just now. Try again.");
    } finally {
      setFactsBusy(false);
    }
  };

  /** Forgets one line the Dandy remembers, or every line (null). */
  const forget = async (id: string | null) => {
    if (await memory.forget(id)) haptic.success();
  };

  const savePlace = async (place: Place) => {
    const next: Home = { country: place.country, ...(place.city ? { city: place.city } : {}), label: placeLabel(place.country, place.city) };
    // The chosen currency goes with it, so moving country never switches it behind their back.
    const life = await saveHome(auth.api, next, money.code);
    setHome(life.home);
  };

  const persona = personaOf(dandy);
  const email = profile?.email ?? auth.user?.email ?? "";
  return (
    <>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingTop: top + layout.contentTop, paddingBottom: insets.bottom + space[64], paddingHorizontal: gutter, gap: layout.stack.section + 8, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}
      >
        <ProfileCard />

        <Section title="About you" hint="Homes, staff and services are priced for where you'd live. Every price shows in your currency.">
          <NameField />
          <Card>
            <Row first label="Where you'd live" value={home === undefined ? " " : (home?.label ?? "Choose a place")} onPress={() => setPlaceOpen(true)} hint="Opens a list of countries and cities" />
            <RowRule />
            <View style={{ paddingHorizontal: layout.cardPad, paddingVertical: 14, gap: 12 }}>
              <Text style={[type.body, { color: p.ink }]}>Currency</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
                {CURRENCIES.map((c) => (
                  <Chip key={c.code} label={`${symbolOf(c.code)} ${c.code}`} selected={money.code === c.code} onPress={() => money.choose(c.code)} style={{ flexBasis: "30%", flexGrow: 1 }} />
                ))}
              </View>
              <Text style={[type.footnote, { color: p.ink3 }]}>{CURRENCIES.find((c) => c.code === money.code)?.name}</Text>
              <Text style={[type.footnote, { color: p.ink3 }]}>{money.rateDescription}{money.code === "USD" ? "" : " For comparison; your payment provider may use a different rate."}</Text>
            </View>
          </Card>
        </Section>

        <Section title="Your Dandy">
          {editingDandy ? (
            <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: layout.cardPad, gap: layout.stack.base }}>
              <DandyEditor />
              <View style={{ alignItems: "center" }}>
                <QuietButton label="Done" onPress={() => setEditingDandy(false)} />
              </View>
            </Glass>
          ) : (
            <Card>
              <Row first leading={<DandyAvatar dandy={dandy} size={40} />} label={dandy.name} detail={`${persona.name}. ${persona.line}`} onPress={() => setEditingDandy(true)} hint="Change its name, personality, shape and colour" />
            </Card>
          )}
        </Section>

        <Section title="Your list">
          <StatsTiles stats={stats} dandyName={dandy.name} />
        </Section>

        <Section title={`What ${dandy.name} has noticed`}>
          <FactsCard facts={facts} loading={factsLoading} busy={factsBusy} error={factsError} dandyName={dandy.name} onNew={askFacts} />
        </Section>

        <Section title={`What ${dandy.name} remembers`} hint={`What you tell ${dandy.name} in the chat that it keeps for next time, like who you buy for and what you love. Remove anything you'd rather it forgot.`}>
          <MemoryCard memories={memory.memories} busy={memory.busy} error={memory.error} onForget={(id) => void forget(id)} onForgetAll={() => void forget(null)} />
        </Section>

        <Section title="Look">
          <Card>
            <Row first label="Theme" value={THEMES[theme.id].name} valueNote={<SongNote id={theme.id} align="end" />} onPress={() => router.push("/theme")} />
            <Row
              label="Sounds"
              accessory={<Switch accessibilityLabel="Sounds" value={soundsOn} onValueChange={setSoundsOn} trackColor={{ false: p.track, true: p.accent }} ios_backgroundColor={p.track} />}
            />
          </Card>
        </Section>

        {/* Today's pick and the nudge, on phones once notifications are switched on (lib/notifications.ts). */}
        <NotificationSettings />

        <Section title="Sign-in accounts">
          <LinkedAccounts identities={identities} options={options} email={email} onChange={setIdentities} notice={notice} />
        </Section>

        <Section title="Agents" hint="Let an AI agent, like Claude, run your list through Dandelist's MCP server. A key reaches your account only, and you can revoke it any time.">
          <AgentKeys />
        </Section>

        <Section title="Account">
          <Card>
            <Row first label="Report a problem" onPress={reportProblem} hint="Sends the app's state and your latest conversation to the Dandelist team" />
            <Row label="Privacy & Terms" onPress={() => router.push("/legal")} />
            <Row label="Sign out" onPress={() => void auth.signOut()} />
            <Row
              label="Delete account"
              danger
              onPress={() => {
                setDeleting(true);
                setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
              }}
            />
          </Card>
          {deleting ? <DeleteAccount onCancel={() => setDeleting(false)} /> : null}
        </Section>
      </ScrollView>
      <PlacePicker open={placeOpen} initial={home ? { country: home.country, city: home.city ?? null } : null} onClose={() => setPlaceOpen(false)} onSave={savePlace} />
    </>
  );
}
