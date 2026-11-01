import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Atmosphere } from "../../components/atmosphere";
import { CONTROL_TOP, HERO_SHADE } from "../../components/detail/metrics";
import { AgentDot, EdgeFade, Eyebrow, Grain, IconButton, Photo, PrimaryButton, Protect, QuietButton, Shade } from "../../components/lux";
import { PhotoCredit } from "../../components/photo-credit";
import { bindToSignIn, currentSignIn, useAuth } from "../../lib/auth";
import { haptic, native } from "../../lib/motion";
import { answerPick, factsOf, fetchTodayPick, knownPick, localDay, pickSkipped, rememberPick, sameOwner, usePickAnswers, wasPickAdded, wasPickSkipped, type PickOwner, type TodayPick } from "../../lib/picks";
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
 * page closes; the card on the list goes with it. A pick belongs to the sign-in it was asked for under (review
 * R50-PICK-OWNER): the page shows and answers one only for that sign-in, shows nothing while the sign-in is still being
 * settled, and a request still out for another sign-in changes nothing.
 */
export default function PickDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  usePickAnswers();
  const userId = auth.status === "signedIn" ? (auth.user?.id ?? null) : null;
  // A new account moves currentSignIn before its user shows here, so this is the sign-in in place for this account.
  const owner = useMemo<PickOwner | null>(() => (userId ? { account: userId, at: currentSignIn() } : null), [userId]);
  // What this page's own request found, with the sign-in it was made for; and a sign-in it found nothing for.
  const [found, setFound] = useState<{ pick: TodayPick; owner: PickOwner } | null>(null);
  const [lost, setLost] = useState<PickOwner | null>(null);
  const [noted, setNoted] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: native })).current;
  const pick =(id ? knownPick(id, owner) : null) ?? (found && sameOwner(found.owner, owner) && found.pick.id === id ? found.pick : null);

  // Opened without its card for this sign-in (a reload on the web, a saved link): today's pick is asked for again, as it.
  useEffect(() => {
    if (!owner || !id || knownPick(id, owner)) return;
    const me = owner;
    let live = true;
    fetchTodayPick(bindToSignIn(auth.api, me.at), localDay())
      .then((r) => {
        if (!live) return;
        if (r.pick?.id === id) {
          rememberPick(r.pick, me);
          setFound({ pick: r.pick, owner: me });
        } else setLost(me);
      })
      .catch(() => live && setLost(me));
    return () => {
      live = false;
    };
  }, [owner, id, auth.api]);
  useEffect(() => () => clearTimeout(closing.current), []);

  if (!id || auth.status === "signedOut" || (lost && sameOwner(lost, owner))) return <Redirect href="/" />;
  if (!pick || !owner) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <Atmosphere />
      </View>
    );
  }

  const me = owner;
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const add = () => router.replace({ pathname: "/wishes/new", params: { text: pick.title, pick: pick.id } });
  const skip = () => {
    rememberPick({ ...pick, status: "skipped" }, me);
    pickSkipped(pick.id);
    void answerPick(bindToSignIn(auth.api, me.at), pick.id, "skipped").catch(() => {});
    haptic.select();
    setNoted(true);
    closing.current = setTimeout(leave, NOTED_MS);
  };
  const what = pick.about?.trim() || pick.summary;
  const facts = factsOf(pick);
  const added = pick.status === "added" || wasPickAdded(pick.id);
  const skipped = noted || pick.status === "skipped" || wasPickSkipped(pick.id);

  const gutter = layout.gutter(winW);
  const column: ViewStyle = { width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center", paddingHorizontal: gutter };
  // The scroll edge under the back button, as on a wish's page: fully in by the time the title's top reaches its lower
  // edge, so the title fades out there instead of running under the button (measured at 375 x 667, 2026-11-01).
  const edge = insets.top + layout.headerBar + layout.stack.base;
  const titleTop = pick.photo ? HERO - TITLE_OVERLAP : insets.top + CONTROL_TOP + layout.headerBar + layout.stack.base;
  const edgeIn = Math.max(1, titleTop - edge);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <Animated.ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + layout.stack.sectionLg }} showsVerticalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
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
          {/* What it is: the few sentences made with the pick, or its one-line summary on an older pick; then its facts. */}
          {what || facts.length ? (
            <View style={{ gap: layout.stack.tight }}>
              <Eyebrow>What it is</Eyebrow>
              {what ? <Text style={[type.body, { color: p.ink }]}>{what}</Text> : null}
              {facts.length ? (
                <View>
                  {facts.map((f) => (
                    <View key={f.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: layout.stack.base, paddingVertical: space[8], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.hair }}>
                      <Text style={[type.footnote, { color: p.ink3 }]}>{f.label}</Text>
                      <Text style={[type.callout, { color: p.ink, flexShrink: 1, textAlign: "right" }]}>{f.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
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
      </Animated.ScrollView>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: edge,
          opacity: scrollY.interpolate({ inputRange: [Math.max(0, edgeIn - layout.headerBar - layout.stack.base), edgeIn], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ scaleY: -1 }],
        }}
      >
        <EdgeFade height={edge} />
      </Animated.View>
      <View style={{ position: "absolute", top: insets.top + CONTROL_TOP, left: gutter }}>
        <IconButton icon="back" label="Back" onPress={leave} />
      </View>
      <Grain />
    </View>
  );
}
