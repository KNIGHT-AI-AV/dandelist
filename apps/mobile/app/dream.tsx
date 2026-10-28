import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CarBuilder, HomeBuilder, RegionPicker } from "../components/dream/builders";
import { SwipeDeck } from "../components/dream/deck";
import { ServiceQuote, WishReady } from "../components/dream/quotes";
import { Composer, KeyboardDock, KeyboardScroll, dockRoom } from "../components/inputs";
import { AgentDot, Chip, Eyebrow, Glass, Grain, IconButton, PrimaryButton } from "../components/lux";
import { Rise } from "../components/welcome/kit";
import { ListeningStrip, MicButton, useVoiceWish } from "../components/voice/say-wish";
import { useAuth } from "../lib/auth";
import { transcribeWish } from "../lib/agent";
import { dreamTurn, wishFrom, type DreamAction, type DreamEvent, type FeedItem, type LifeContext, type Widget } from "../lib/dream";
import { haptic } from "../lib/motion";
import { fonts, layout, radius, space, usePalette, type } from "../lib/theme";
import { useWishes } from "../lib/wishes";
import { Atmosphere } from "../components/atmosphere";

const IDEAS = ["A villa by the sea with a pool", "A black G-Wagon", "Private security for my family", "A year living in Kyoto"];
let seq = 0;
const nextId = () => `f${++seq}`;

/**
 * The dream builder: a chat where people say anything they want. The agent answers in words and, when it helps,
 * opens a tool right in the conversation: a home builder, a car configurator, a swipe deck of real listings, a quote
 * for a service. Each finished find goes onto the life list with what it costs to keep.
 */
export default function Dream() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const auth = useAuth();
  const { add } = useWishes();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [life, setLife] = useState<LifeContext | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  // The docked composer's height, measured (it grows with its text); one capsule until the first layout.
  const [dock, setDock] = useState<number>(layout.control.primary);
  const session = useRef<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  // Say it instead of typing: the words land in the composer to read over, then send as usual.
  const voice = useVoiceWish({
    transcribe: (wav) => transcribeWish(auth.api, wav),
    onHeard: setText,
    onError: (message) => message && setFeed((f) => [...f, { id: nextId(), kind: "agent", text: message }]),
  });

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    void auth
      .api("/me/life")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { life?: LifeContext } | null) => b?.life && setLife(b.life))
      .catch(() => {});
  }, [auth.status, auth]);

  if (auth.status === "signedOut") return <Redirect href="/welcome" />;

  const push = (item: FeedItem) => setFeed((f) => [...f, item]);
  const onEvent = (e: DreamEvent) => {
    if (e.type === "text") push({ id: nextId(), kind: "agent", text: e.text });
    else if (e.type === "step") setFeed((f) => (f.some((x) => x.kind === "step" && x.id === e.id) ? f.map((x) => (x.kind === "step" && x.id === e.id ? { ...x, text: e.text, state: e.state } : x)) : [...f, { id: e.id, kind: "step", text: e.text, state: e.state }]));
    else if (e.type === "widget") push({ id: nextId(), kind: "widget", widget: e.widget });
    else if (e.type === "life") setLife(e.life);
    else if (e.type === "error") {
      haptic.error();
      push({ id: nextId(), kind: "agent", text: e.message });
    }
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  };

  const send = async (action: DreamAction, echo?: string) => {
    if (busy) return;
    if (echo) push({ id: nextId(), kind: "you", text: echo });
    setBusy(true);
    try {
      session.current = await dreamTurn(auth.apiStream, session.current, action, onEvent);
    } catch (e) {
      haptic.error();
      push({ id: nextId(), kind: "agent", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const submit = (t = text) => {
    const msg = t.trim();
    if (!msg) return;
    setText("");
    void send({ type: "message", text: msg }, msg);
  };

  const renderWidget = (w: Widget) => {
    switch (w.kind) {
      case "home_builder":
        return <HomeBuilder w={w} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} onSearchNow={() => send({ type: "search_now", widgetId: w.id })} onRegion={() => setRegionOpen(true)} />;
      case "car_builder":
        return <CarBuilder w={w} onApply={(values) => send({ type: "builder", widgetId: w.id, values })} />;
      case "deck":
        return (
          <View style={{ gap: 10 }}>
            <Text style={[type.title3, { color: p.ink, paddingHorizontal: 4 }]}>{w.title}</Text>
            <SwipeDeck cards={w.cards} onSwipe={(l, verdict) => void send({ type: "swipe", widgetId: w.id, listingId: l.id, verdict })} onPick={(l) => void send({ type: "pick", widgetId: w.id, listingId: l.id }, l.title)} onSearchNow={() => send({ type: "search_now", widgetId: w.id })} onEnough={() => send({ type: "message", text: "That's enough, show me the best match." }, "That's enough, show me the best match.")} />
          </View>
        );
      case "service_quote":
        return (
          <ServiceQuote w={w} onAccept={() => send({ type: "pick", widgetId: w.id })} />
        );
      case "wish_ready":
        return <WishReady w={w} onAdd={async () => { await add(wishFrom(w.wish)); }} />;
      case "item":
        return (
          <Glass style={{ padding: 18, gap: 14, borderRadius: radius.lg }}>
            <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]}>{w.text}</Text>
            <PrimaryButton label="Find the real price" onPress={() => router.push({ pathname: "/wishes/new", params: { text: w.text } })} />
          </Glass>
        );
      case "region_picker":
        return <RegionPicker current={life?.home ?? w.current} onPick={(home) => send({ type: "region", home }, `I'll live in ${home.label}.`)} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <KeyboardScroll ref={scroll} keepEnd dock={dock} contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: dockRoom(dock, insets.bottom), paddingHorizontal: gutter, gap: space[12], width: "100%", maxWidth: layout.column + 2 * gutter, alignSelf: "center" }}>
        {!feed.length ? (
          <Rise style={{ gap: 18, paddingTop: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot />
              <Eyebrow>Your agent · Muse Spark by Meta</Eyebrow>
            </View>
            <Text style={[type.title1, { color: p.ink }]}>
              Tell me the life you <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>want</Text>.
            </Text>
            <Text style={[type.callout, { color: p.ink2 }]}>Anything at all. I'll find the real thing, its price, and what it costs to keep.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {IDEAS.map((i) => (
                <Chip key={i} label={i} onPress={() => submit(i)} />
              ))}
            </View>
          </Rise>
        ) : null}
        {feed.map((f) =>
          f.kind === "you" ? (
            <Rise key={f.id} style={{ alignSelf: "flex-end", maxWidth: "86%" }}>
              <Glass style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.md }}>
                <Text style={[type.callout, { color: p.ink }]}>{f.text}</Text>
              </Glass>
            </Rise>
          ) : f.kind === "agent" ? (
            <Rise key={f.id} style={{ maxWidth: "94%" }}>
              <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]}>{f.text}</Text>
            </Rise>
          ) : f.kind === "step" ? (
            <Rise key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 16, alignItems: "center" }}>{f.state === "running" ? <ActivityIndicator size="small" color={p.accent} /> : <Text style={[type.footnote, { fontFamily: fonts.label, color: p.accent }]}>✓</Text>}</View>
              <Text style={[type.footnote, { flex: 1, color: f.state === "running" ? p.ink2 : p.ink }]}>{f.text}</Text>
            </Rise>
          ) : (
            <Rise key={f.id}>{renderWidget(f.widget)}</Rise>
          ),
        )}
        {regionOpen ? <RegionPicker current={life?.home ?? null} onPick={(home) => { setRegionOpen(false); void send({ type: "region", home }, `I'll live in ${home.label}.`); }} /> : null}
        {busy && !feed.some((f) => f.kind === "step" && f.state === "running") ? <ActivityIndicator color={p.accent} style={{ alignSelf: "flex-start", marginTop: 6 }} /> : null}
      </KeyboardScroll>

      <KeyboardDock onHeight={setDock} maxWidth={layout.column}>
        <Composer
          value={text}
          onChangeText={setText}
          onSend={submit}
          placeholder="Tell me what you want..."
          label="Message"
          busy={busy}
          idleAction={voice.supported ? <MicButton voice={voice} compact /> : undefined}
          cover={voice.phase !== "idle" ? <ListeningStrip voice={voice} /> : undefined}
        />
      </KeyboardDock>

      <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + space[4], left: gutter, right: gutter, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} />
        <Pressable accessibilityRole="button" accessibilityLabel={life?.home ? `Living in ${life.home.label}` : "Where you'll live"} onPress={() => setRegionOpen((o) => !o)} hitSlop={8}>
          <Glass style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, justifyContent: "center" }}>
            <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink }]}>{life?.home ? `Living in ${life.home.label}  ▾` : "Where you'll live  ▾"}</Text>
          </Glass>
        </Pressable>
      </View>
      <Grain />
    </View>
  );
}

