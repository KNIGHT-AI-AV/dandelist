import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Atmosphere } from "../../components/atmosphere";
import { CONTROL_TOP, HERO_SHADE } from "../../components/detail/metrics";
import { AgentDot, Eyebrow, Grain, IconButton, Photo, PrimaryButton, Protect, QuietButton, Shade } from "../../components/lux";
import { PhotoCredit } from "../../components/photo-credit";
import { useAuth } from "../../lib/auth";
import { haptic } from "../../lib/motion";
import { answerPick, fetchTodayPick, knownPick, localDay, pickSkipped, rememberPick, usePickAnswers, wasPickAdded, wasPickSkipped, type TodayPick } from "../../lib/picks";
import { layout, space, type, usePalette, useType } from "../../lib/theme";
import { KIND_LABEL } from "../../lib/words";

const HERO = 420;
/** How far the title block rises onto the photo, into its shade. */
const TITLE_OVERLAP = 120;
/** "Noted" stays this long before the page closes. */
const NOTED_MS = 1800;

/**
 * Today's pick in full (owner, 2026-11-01: a person who liked a pick tapped it to see what it was, and couldn't without
 * adding it). Opened from the card on the list, it shows what was made when the pick was: its checked photo, what it
 * is, why the Dandy chose it, and the photo's credit, so nothing waits on a new request. The same two answers as the
 * card: "Add to my list" goes to the new wish screen, which finds the real price, and "Not for me" is noted before the
 * page closes; the card on the list goes with it.
 */
export default function PickDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  usePickAnswers();
  const [pick, setPick] = useState<TodayPick | null>(() => (id ? knownPick(id) : null));
  const [lost, setLost] = useState(false);
  const [noted, setNoted] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Opened without its card this run (a reload on the web, a saved link): today's pick is asked for again.
  useEffect(() => {
    if (pick || !id || auth.status !== "signedIn") return;
    let live = true;
    fetchTodayPick(auth.api, localDay())
      .then((r) => {
        if (!live) return;
        if (r.pick?.id === id) {
          rememberPick(r.pick);
          setPick(r.pick);
        } else setLost(true);
      })
      .catch(() => live && setLost(true));
    return () => {
      live = false;
    };
  }, [pick, id, auth.status, auth.api]);
  useEffect(() => () => clearTimeout(closing.current), []);

  if (!id || lost || auth.status === "signedOut") return <Redirect href="/" />;
  if (!pick) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <Atmosphere />
      </View>
    );
  }

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const add = () => router.replace({ pathname: "/wishes/new", params: { text: pick.title, pick: pick.id } });
  const skip = () => {
    rememberPick({ ...pick, status: "skipped" });
    pickSkipped(pick.id);
    void answerPick(auth.api, pick.id, "skipped").catch(() => {});
    haptic.select();
    setNoted(true);
    closing.current = setTimeout(leave, NOTED_MS);
  };
  const added = pick.status === "added" || wasPickAdded(pick.id);
  const skipped = noted || pick.status === "skipped" || wasPickSkipped(pick.id);

  const gutter = layout.gutter(winW);
  const column: ViewStyle = { width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center", paddingHorizontal: gutter };
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + layout.stack.sectionLg }} showsVerticalScrollIndicator={false}>
        {pick.photo ? (
          <View style={{ height: HERO }}>
            <Photo uri={pick.photo.url} style={StyleSheet.absoluteFill} />
            <Shade from={HERO_SHADE} />
          </View>
        ) : (
          <View style={{ height: insets.top + CONTROL_TOP + layout.headerBar + layout.stack.base }} />
        )}

        {/* Title: over the photo's shaded foot. */}
        <View style={[column, { marginTop: pick.photo ? -TITLE_OVERLAP : 0, gap: layout.stack.tight }]}>
          {pick.photo ? <Protect /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
            <AgentDot />
            <Eyebrow>{`Today's pick · ${KIND_LABEL[pick.kind]}`}</Eyebrow>
          </View>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
            {pick.title}
          </Text>
          <PhotoCredit image={pick.photo} />
        </View>

        <View style={[column, { marginTop: layout.stack.section, gap: layout.stack.section }]}>
          {pick.summary ? (
            <View style={{ gap: layout.stack.tight }}>
              <Eyebrow>What it is</Eyebrow>
              <Text style={[type.body, { color: p.ink }]}>{pick.summary}</Text>
            </View>
          ) : null}
          <View style={{ gap: layout.stack.tight }}>
            <Eyebrow>Why your Dandy picked it</Eyebrow>
            <Text style={[type.body, { color: p.ink }]}>{pick.why}</Text>
          </View>
          {added || skipped ? (
            <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink3 }]}>
              {added ? "It's on your list." : "Noted. Tomorrow's pick will learn from this."}
            </Text>
          ) : (
            <View style={{ gap: layout.stack.base }}>
              <Text style={[type.footnote, { color: p.ink2 }]}>Add it and your Dandy finds the real price.</Text>
              <View style={{ gap: space[4] }}>
                <PrimaryButton label="Add to my list" commit onPress={add} />
                <QuietButton label="Not for me" onPress={skip} style={{ alignSelf: "center" }} />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <View style={{ position: "absolute", top: insets.top + CONTROL_TOP, left: gutter }}>
        <IconButton icon="back" label="Back" onPress={leave} />
      </View>
      <Grain />
    </View>
  );
}
