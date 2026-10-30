import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Atmosphere } from "../../components/atmosphere";
import { HeroGallery } from "../../components/detail/gallery";
import { CONTROL_TOP, HERO_SHADE, PARALLAX } from "../../components/detail/metrics";
import { WishNote } from "../../components/detail/note";
import { Recheck } from "../../components/detail/recheck";
import { RetakePhoto } from "../../components/detail/retake";
import { Swap } from "../../components/detail/swap";
import { PhotoViewer, type ViewerFrom } from "../../components/detail/viewer";
import { WaitingLight } from "../../components/waiting-light";
import { AgentDot, Breathing, EdgeFade, ErrorLine, Eyebrow, Grain, IconButton, Protect, QuietButton, Shade } from "../../components/lux";
import { MediaHero } from "../../components/media";
import { PhotoCredit } from "../../components/photo-credit";
import { Statement, Take } from "../../components/statement";
import { useAuth } from "../../lib/auth";
import { webOnly } from "../../lib/dream";
import { realPhotos, showsGallery, trimBottom } from "../../lib/gallery";
import { FLICK, ease, native, spring, step, useReducedMotion } from "../../lib/motion";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { KIND_LABEL, TIER_LABEL, agentLine } from "../../lib/words";
import { worthOf } from "../../lib/worth";
import { cardRect } from "../../lib/zoom";
import { useMoney } from "../../lib/currency";
import { savedGlyph } from "../../components/worth";

const HERO = 470;
/** How far the title block rises onto the photo, into its shade. */
const TITLE_OVERLAP = 150;
/** The list's tall card, so the loading shape matches what lands. */
const CARD_PLACEHOLDER = 232;
/** The text rises this far behind the photo as the page opens from a card. */
const RISE_DELAY_MS = 60;
/** The page fades out as the photo shrinks home: quicker than it came in, slower than a step leaves. */
const EXIT_MS = 200;
/** Pull-to-dismiss: claims a mostly vertical drag past 8 pt; a quarter-screen drag or a flick dismisses. */
const PULL = { claim: 8, steep: 1.5, dismiss: 0.25, range: 240, scale: 0.9, follow: 0.6 };
/** Title, price, why it matters, source, remove: the regions that stagger in, top to bottom. */
const SECTIONS = 5;

/**
 * A wish in full. Opened from the list, its photograph grows out of the card it was (UI audit P1-17): the list
 * stays underneath while the page fades in, and the regions rise 50 ms apart, 60 ms behind the photo. With two or
 * more real photos the hero pages through them, and a tap opens the photo full screen. Scrolling slides the page
 * over the photo with a gentle parallax. Dragging the photo down follows the finger; a flick or a long enough drag
 * sends it back into the card.
 *
 * Rhythm: regions sit `stack.section` apart; inside one, the eyebrow and title sit `stack.tight` apart, the title and
 * body `stack.base`, and lines of body `stack.tight`.
 */
export default function WishDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const { wishes, status, remove } = useWishes();
  const p = usePalette();
  const t = useType();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = useRef(id ? cardRect(id) : undefined).current;
  const zoom = !!from && !reduced;
  // 0 = the card's rectangle, 1 = the full-width hero.
  const grow = useRef(new Animated.Value(zoom ? 0 : 1)).current;
  // The page's own background (the list shows through until it lands) and, without a card to grow from, the photo.
  const page = useRef(new Animated.Value(0)).current;
  // The photo itself: already there when it grows from a card, faded up with the page otherwise.
  const photo = useRef(new Animated.Value(zoom ? 1 : 0)).current;
  const sections = useRef(Array.from({ length: SECTIONS }, () => new Animated.Value(0))).current;
  const pull = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);
  // The gallery takes over from the single grown photo once the zoom has landed, and hands back before it shrinks.
  const [settled, setSettled] = useState(!zoom);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewing, setViewing] = useState<(ViewerFrom & { key: number }) | null>(null);
  // A retake is looking for a better photo: light crosses the one there until the new one lands.
  const [retaking, setRetaking] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  // The offset is also kept in JS: the pull gesture only claims at the top, and the viewer's flight starts from where
  // the parallax has carried the photo (a measured rect would not include a native-driven transform).
  const scrollTop = useRef(0);
  const onScroll = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: native,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollTop.current = e.nativeEvent.contentOffset.y;
      },
    }),
  ).current;
  const hero = useRef<View>(null);
  const scroller = useRef<ScrollView>(null);
  // The wish as last seen, so the page stays whole while it fades out after a remove.
  const kept = useRef<Wish | undefined>(undefined);

  const regions = (to: 0 | 1, ms: number) => sections.map((v) => Animated.timing(v, { toValue: to, duration: ms, easing: ease.out, useNativeDriver: native }));

  // The entrance plays once, when the wish is first there to show (at once from a card; after loading from a link).
  const ready = wishes.some((x) => x.id === id);
  const entered = useRef(false);
  useEffect(() => {
    if (!ready || entered.current) return;
    entered.current = true;
    if (zoom) {
      Animated.spring(grow, { toValue: 1, ...spring.settle, useNativeDriver: false }).start(({ finished }) => finished && setSettled(true));
      Animated.timing(page, { toValue: 1, duration: step.inMs, delay: RISE_DELAY_MS, easing: ease.out, useNativeDriver: false }).start();
      Animated.sequence([Animated.delay(RISE_DELAY_MS), Animated.stagger(step.staggerMs, regions(1, step.inMs))]).start();
      return;
    }
    // Opened without a card (a link, or reduced motion): the page fades up and the regions follow, or under
    // reduced motion everything cross-fades in at once.
    Animated.parallel([page, photo].map((v) => Animated.timing(v, { toValue: 1, duration: reduced ? step.outMs : step.inMs, easing: ease.out, useNativeDriver: false }))).start();
    (reduced ? Animated.parallel(regions(1, step.outMs)) : Animated.stagger(step.staggerMs, regions(1, step.inMs))).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** Plays the page out (faster than it came in) and then calls `done`. */
  const exit = (done: () => void, home = zoom) => {
    if (home) {
      setSettled(false);
      Animated.parallel([
        Animated.spring(grow, { toValue: 0, ...spring.settle, useNativeDriver: false }),
        Animated.timing(page, { toValue: 0, duration: EXIT_MS, easing: ease.out, useNativeDriver: false }),
        Animated.timing(pull, { toValue: 0, duration: EXIT_MS, easing: ease.out, useNativeDriver: false }),
        ...regions(0, step.outMs),
      ]).start(done);
      return;
    }
    Animated.parallel([...[page, photo].map((v) => Animated.timing(v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: false })), ...regions(0, step.outMs)]).start(done);
  };

  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    exit(() => (router.canGoBack() ? router.back() : router.replace("/wishes")));
  };

  const drag = useRef(
    PanResponder.create({
      // Only at the top of the page: scrolled down, a downward drag scrolls back up.
      onMoveShouldSetPanResponder: (_e, g) => scrollTop.current <= 0 && g.dy > PULL.claim && Math.abs(g.dy) > Math.abs(g.dx) * PULL.steep,
      onPanResponderMove: (_e, g) => pull.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.vy > FLICK || g.dy > winH * PULL.dismiss) back();
        else Animated.spring(pull, { toValue: 0, ...spring.snap, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => Animated.spring(pull, { toValue: 0, ...spring.snap, useNativeDriver: false }).start(),
    }),
  ).current;

  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;
  const found = wishes.find((x) => x.id === id);
  if (found) kept.current = found;
  const w = found ?? (removing ? kept.current : undefined);
  if (!w) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center", gap: layout.stack.base, padding: layout.gutter(winW) }}>
        <Atmosphere />
        {status === "loading" || status === "idle" ? <Breathing style={{ width: "100%", maxWidth: layout.list, height: CARD_PLACEHOLDER }} /> : <Text style={[type.callout, { color: p.ink2 }]}>That wish wasn't found.</Text>}
        <QuietButton label="Back to your list" onPress={() => router.replace("/wishes")} />
      </View>
    );
  }
  // The agent's record of where the price came from. Money's amount is the person's own and the priceless has none,
  // so those show no source to open or check again, only the photo the agent found for money (lib/worth.ts).
  const worth = worthOf(w);
  const a = worth ? undefined : w.details.agent;
  const pictured = w.details.agent;

  async function onRemove() {
    // Two taps: the first only arms it.
    if (!confirm) return setConfirm(true);
    if (removing || leaving.current) return;
    leaving.current = true;
    setRemoving(true);
    setError(null);
    // The page fades out while the server removes it; it comes back with the reason if that fails.
    const out = new Promise<void>((resolve) => exit(resolve, false));
    try {
      await Promise.all([remove(w!.id), out]);
      router.replace("/wishes");
    } catch (e) {
      leaving.current = false;
      setRemoving(false);
      setConfirm(false);
      setError((e as Error).message);
      Animated.parallel([page, photo].map((v) => Animated.timing(v, { toValue: 1, duration: step.inMs, easing: ease.out, useNativeDriver: false }))).start();
      Animated.stagger(step.staggerMs, regions(1, step.inMs)).start();
    }
  }

  const r = from ?? { x: 0, y: 0, width: winW, height: HERO };
  const lerp = (a0: number, b0: number) => grow.interpolate({ inputRange: [0, 1], outputRange: [a0, b0] });
  // Pulling down shrinks the photo and rounds its corners over the first PULL.range points.
  const pulled = pull.interpolate({ inputRange: [0, PULL.range], outputRange: [1, PULL.scale], extrapolate: "clamp" });
  const gutter = layout.gutter(winW);
  const column: ViewStyle = { width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center", paddingHorizontal: gutter };
  const enter = (i: number) => ({
    opacity: sections[i]!,
    transform: [{ translateY: sections[i]!.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : layout.stack.base, 0] }) }],
  });
  const photos = realPhotos(pictured?.media);
  const gallery = showsGallery(pictured?.media);
  // The photo drifts down at a fraction of the scroll, so the page slides over it. Transform only; off under reduced motion.
  const drift = reduced ? undefined : { transform: [{ translateY: scrollY.interpolate({ inputRange: [0, HERO], outputRange: [0, HERO * PARALLAX], extrapolate: "clamp" }) }] };
  const openPhoto = (index: number) =>
    hero.current?.measureInWindow((x, y, width, height) => {
      const frame = { x, y, width, height };
      // The photo layer sits where the parallax has carried it, below the hero's own top.
      const shift = reduced ? 0 : PARALLAX * Math.min(HERO, Math.max(0, scrollTop.current));
      const image = { ...frame, y: frame.y + shift };
      // A second tap before the viewer is up must not re-key it mid-presentation.
      setViewing((v) => v ?? { key: Date.now(), index, image, hero: frame, clip: trimBottom(frame, TITLE_OVERLAP) });
    });
  // A new figure (after "Use the new price") cross-fades the statement rather than snapping it.
  const priceKey = [w.item.upfrontCents, ...w.item.recurring.map((rr) => `${rr.amountCents}/${rr.period}`)].join("|");

  return (
    <View style={{ flex: 1 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: page }]} />
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom + layout.stack.sectionLg }}
        style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object}
      >
        <View ref={hero} style={{ height: HERO, width: "100%" }} {...drag.panHandlers}>
          <Animated.View
            style={{
              position: "absolute",
              left: lerp(r.x, 0),
              top: lerp(r.y, 0),
              width: lerp(r.width, winW),
              height: lerp(r.height, HERO),
              borderRadius: Animated.add(lerp(radius.lg, 0), pull.interpolate({ inputRange: [0, PULL.range], outputRange: [0, radius.lg], extrapolate: "clamp" })),
              borderCurve: "continuous",
              overflow: "hidden",
              opacity: photo,
              transform: [{ translateY: Animated.multiply(pull, PULL.follow) }, { scale: pulled }],
            }}
          >
            {gallery ? (
              <HeroGallery photos={photos} width={winW} height={HERO} topInset={insets.top} live={settled} index={photoIndex} onIndex={setPhotoIndex} onOpen={openPhoto} drift={drift}>
                <Shade from={HERO_SHADE} />
              </HeroGallery>
            ) : (
              <>
                <Animated.View style={[StyleSheet.absoluteFill, drift]}>
                  <MediaHero media={pictured?.media} fallbackUri={pictured?.imageUrl} kind={w.kind} glyph={savedGlyph(w, money.symbol)} style={StyleSheet.absoluteFill} />
                </Animated.View>
                <Shade from={HERO_SHADE} />
              </>
            )}
            <WaitingLight active={retaking} />
          </Animated.View>
        </View>

        {/* Title: over the photo's shaded foot. */}
        <Animated.View style={[column, { marginTop: -TITLE_OVERLAP, gap: layout.stack.tight }, enter(0)]}>
          {/* Text protection over the photo: a 35% dimming layer behind the title block (HIG Materials, P1-22). */}
          <Protect />
          <Eyebrow>{[KIND_LABEL[w.kind], TIER_LABEL[w.tier]].join(" · ")}</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
            {w.name}
          </Text>
          {/* The showing photo's credit and licence, as a caption: the hero's foot is under the title. */}
          {gallery && photos[photoIndex] ? (
            <Swap id={photos[photoIndex]!.url}>
              <PhotoCredit image={photos[photoIndex]} />
            </Swap>
          ) : (
            // A single photo is credited the same way; a 3D model and a cut-out carry their own credit.
            <PhotoCredit image={!pictured?.media?.model3d && !pictured?.media?.cutout ? pictured?.media?.images[0] : null} />
          )}
          <RetakePhoto wish={w} onBusy={setRetaking} />
        </Animated.View>

        <View style={[column, { marginTop: layout.stack.section, gap: layout.stack.section }]}>
          {/* Price: the statement, then the agent's take. */}
          <Animated.View style={[{ gap: layout.stack.base }, enter(1)]}>
            <Swap id={priceKey}>
              <Statement item={w.item} priceless={worth === "priceless"} monthlyHint={w.item.recurring.map((rr) => rr.label).filter(Boolean).join(", ")} />
            </Swap>
            {a?.explanation ? <Take>{a.explanation}</Take> : worth === "priceless" && w.details.line ? <Take>{w.details.line}</Take> : null}
          </Animated.View>

          {/* Why it matters to them, in their own words (saved as they type). */}
          <Animated.View style={enter(2)}>
            <WishNote key={w.id} wish={w} onReveal={(dy) => scroller.current?.scrollTo({ y: Math.max(0, scrollTop.current + dy), animated: true })} />
          </Animated.View>

          {/* Source: who sells it, how the price was found, and the check. Something priceless has none. */}
          <Animated.View style={[{ gap: layout.stack.base, ...(worth === "priceless" ? { display: "none" as const } : null) }, enter(3)]}>
            <View style={{ gap: layout.stack.tight }}>
              <Eyebrow>Source</Eyebrow>
              <Text style={[type.title3, { color: p.ink }]}>{a ? a.seller : agentLine(w)}</Text>
            </View>
            {a ? (
              <View style={{ gap: layout.stack.tight }}>
                <Swap id={agentLine(w)}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: layout.stack.tight }}>
                    <AgentDot />
                    <Text style={[type.footnote, { color: p.ink2 }]}>{agentLine(w)}</Text>
                  </View>
                </Swap>
                {a.source && a.source.currency !== "USD" ? (
                  <Text style={[type.footnote, { color: p.ink3 }]}>{`Listed at ${a.source.price.toLocaleString("en-US")} ${a.source.currency}, converted at ${a.source.rate} on ${a.source.rateDate}.`}</Text>
                ) : null}
                {webOnly(a.url) ? (
                  <Pressable accessibilityRole="link" onPress={() => Linking.openURL(webOnly(a.url))} style={{ alignSelf: "flex-start", minHeight: layout.control.chip, justifyContent: "center" }}>
                    <Text style={[type.label, { color: p.accentText }]}>Open the source page</Text>
                  </Pressable>
                ) : null}
                <Recheck key={w.id} wish={w} />
              </View>
            ) : null}
          </Animated.View>

          {/* Remove: two taps, the second labelled. */}
          <Animated.View style={[{ alignItems: "flex-start" }, enter(4)]}>
            {/* The reason sits a tight step above the button; an empty slot adds no gap. */}
            <Swap id={error ?? ""}>{error ? <View style={{ paddingBottom: layout.stack.tight }}><ErrorLine>{error}</ErrorLine></View> : null}</Swap>
            <Swap id={confirm ? "confirm" : "remove"}>
              <QuietButton label={confirm ? "Tap again to remove it" : "Remove from my list"} onPress={onRemove} />
            </Swap>
          </Animated.View>
        </View>
      </Animated.ScrollView>
      {/* A scroll edge under the back button: once the photo has scrolled away, text fades before it reaches the button. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + layout.headerBar + layout.stack.base,
          // Fully in by the time the title's top (HERO − TITLE_OVERLAP in the page) reaches the fade's lower edge.
          opacity: scrollY.interpolate({
            inputRange: [HERO - TITLE_OVERLAP - 2 * (layout.headerBar + layout.stack.base), HERO - TITLE_OVERLAP - (layout.headerBar + layout.stack.base)],
            outputRange: [0, 1],
            extrapolate: "clamp",
          }),
          transform: [{ scaleY: -1 }],
        }}
      >
        <EdgeFade height={insets.top + layout.headerBar + layout.stack.base} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", top: insets.top + CONTROL_TOP, left: gutter, opacity: page }}>
        <IconButton icon="back" label="Back" onPress={back} />
      </Animated.View>
      <Grain />
      {viewing ? <PhotoViewer key={viewing.key} photos={photos} from={viewing} reduced={reduced} onSettle={setPhotoIndex} onClose={() => setViewing(null)} /> : null}
    </View>
  );
}
