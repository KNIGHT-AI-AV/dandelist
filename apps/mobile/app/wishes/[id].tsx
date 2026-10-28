import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Breathing, ErrorLine, Eyebrow, Grain, IconButton, Photo, Protect, QuietButton, Shade } from "../../components/lux";
import { HeroGallery } from "../../components/detail/gallery";
import { CONTROL_TOP, HERO_SHADE, PARALLAX } from "../../components/detail/metrics";
import { Swap } from "../../components/detail/swap";
import { PhotoViewer, type ViewerFrom } from "../../components/detail/viewer";
import { MediaHero } from "../../components/media";
import { Statement, Take } from "../../components/statement";
import { useAuth } from "../../lib/auth";
import { FLICK, ease, native, spring, useReducedMotion } from "../../lib/motion";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import { webOnly } from "../../lib/dream";
import { photoCredit, realPhotos, showsGallery, trimBottom, type Rect } from "../../lib/gallery";
import { useWishes } from "../../lib/wishes";
import { KIND_LABEL, TIER_LABEL, agentLine } from "../../lib/words";
import { cardRect } from "../../lib/zoom";
import { Atmosphere } from "../../components/atmosphere";

const HERO = 470;
/** How far the title block rises onto the photo, into its shade. */
const TITLE_OVERLAP = 150;

/**
 * A wish in full. Opened from the list, its photograph grows out of the card it was (UI audit P1-17): the list
 * stays underneath while the page fades in, and the text rises 60 ms behind the photo. Dragging the photo down
 * follows the finger; a flick or a long enough drag sends it back into the card.
 */
export default function WishDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const { wishes, status, remove } = useWishes();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = useRef(id ? cardRect(id) : undefined).current;
  const zoom = !!from && !reduced;
  // 0 = the card's rectangle, 1 = the full-width hero.
  const grow = useRef(new Animated.Value(zoom ? 0 : 1)).current;
  const page = useRef(new Animated.Value(zoom ? 0 : 1)).current;
  const pull = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);
  // The gallery takes over from the single grown photo once the zoom has landed, and hands back before it shrinks.
  const [settled, setSettled] = useState(!zoom);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewing, setViewing] = useState<(ViewerFrom & { key: number }) | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: native })).current;
  const hero = useRef<View>(null);

  useEffect(() => {
    if (!zoom) return;
    Animated.spring(grow, { toValue: 1, ...spring.settle, useNativeDriver: false }).start(({ finished }) => finished && setSettled(true));
    Animated.timing(page, { toValue: 1, duration: 320, delay: 60, easing: ease.out, useNativeDriver: false }).start();
  }, [zoom, grow, page]);

  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    const done = () => (router.canGoBack() ? router.back() : router.replace("/wishes"));
    if (!zoom) return done();
    setSettled(false);
    Animated.parallel([
      Animated.spring(grow, { toValue: 0, ...spring.settle, useNativeDriver: false }),
      Animated.timing(page, { toValue: 0, duration: 200, easing: ease.out, useNativeDriver: false }),
      Animated.timing(pull, { toValue: 0, duration: 200, easing: ease.out, useNativeDriver: false }),
    ]).start(done);
  };

  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => pull.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.vy > FLICK || g.dy > winH * 0.25) back();
        else Animated.spring(pull, { toValue: 0, ...spring.snap, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => Animated.spring(pull, { toValue: 0, ...spring.snap, useNativeDriver: false }).start(),
    }),
  ).current;

  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;
  const w = wishes.find((x) => x.id === id);
  if (!w) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
        <Atmosphere />
        {status === "loading" || status === "idle" ? <Breathing style={{ width: "100%", maxWidth: layout.list, height: 232 }} /> : <Text style={[type.callout, { color: p.ink2 }]}>That wish wasn't found.</Text>}
        <QuietButton label="Back to your list" onPress={() => router.replace("/wishes")} />
      </View>
    );
  }
  const a = w.details.agent;

  async function onRemove() {
    if (!confirm) return setConfirm(true);
    try {
      await remove(w!.id);
      router.replace("/wishes");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const r = from ?? { x: 0, y: 0, width: winW, height: HERO };
  const lerp = (a0: number, b0: number) => grow.interpolate({ inputRange: [0, 1], outputRange: [a0, b0] });
  // Pulling down shrinks the photo to 0.9 and rounds its corners over the first 240 px.
  const pulled = pull.interpolate({ inputRange: [0, 240], outputRange: [1, 0.9], extrapolate: "clamp" });
  const gutter = layout.gutter(winW);
  const photos = realPhotos(a?.media);
  const gallery = showsGallery(a?.media);
  // The photo drifts down at a fraction of the scroll, so the page slides over it. Transform only; off under reduced motion.
  const drift = reduced ? undefined : { transform: [{ translateY: scrollY.interpolate({ inputRange: [0, HERO], outputRange: [0, HERO * PARALLAX], extrapolate: "clamp" }) }] };
  const openPhoto = (index: number, image: Rect) =>
    hero.current?.measureInWindow((x, y, width, height) => {
      const frame = { x, y, width, height };
      setViewing({ key: Date.now(), index, image, hero: frame, clip: trimBottom(frame, TITLE_OVERLAP) });
    });

  return (
    <View style={{ flex: 1 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: p.bg, opacity: page }]} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
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
              borderRadius: Animated.add(lerp(radius.lg, 0), pull.interpolate({ inputRange: [0, 240], outputRange: [0, radius.lg], extrapolate: "clamp" })),
              overflow: "hidden",
              transform: [{ translateY: Animated.multiply(pull, 0.6) }, { scale: pulled }],
            }}
          >
            {gallery ? (
              <HeroGallery photos={photos} width={winW} height={HERO} topInset={insets.top} live={settled} index={photoIndex} onIndex={setPhotoIndex} onOpen={openPhoto} drift={drift}>
                <Shade from={HERO_SHADE} />
              </HeroGallery>
            ) : (
              <>
                <Animated.View style={[StyleSheet.absoluteFill, drift]}>
                  <MediaHero media={a?.media} fallbackUri={a?.imageUrl} kind={w.kind} style={StyleSheet.absoluteFill} />
                </Animated.View>
                <Shade from={HERO_SHADE} />
              </>
            )}
          </Animated.View>
        </View>
        <Animated.View style={{ opacity: page, transform: [{ translateY: page.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
          <View style={{ marginTop: -150, paddingHorizontal: gutter, gap: layout.stack.tight, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
            {/* Text protection over the photo: a 35% dimming layer behind the title block (HIG Materials, P1-22). */}
            <Protect />
            <Eyebrow>{[KIND_LABEL[w.kind], TIER_LABEL[w.tier], a?.seller].filter(Boolean).join(" · ")}</Eyebrow>
            <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>{w.name}</Text>
            {/* The showing photo's credit and licence, as a caption: the hero's foot is under the title. */}
            {gallery && photos[photoIndex] ? (
              <Swap id={photos[photoIndex]!.url}>
                <Text numberOfLines={1} style={[type.figure, { color: p.ink3 }]}>{photoCredit(photos[photoIndex]!)}</Text>
              </Swap>
            ) : null}
          </View>
          <View style={{ paddingHorizontal: gutter, marginTop: layout.stack.base + 4, gap: 20, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
            <Statement item={w.item} monthlyHint={w.item.recurring.map((rr) => rr.label).filter(Boolean).join(", ")} />
            {a?.explanation ? <Take>{a.explanation}</Take> : null}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {a ? <AgentDot /> : null}
                <Text style={[type.footnote, { color: p.ink2 }]}>{agentLine(w)}</Text>
              </View>
              {a && a.source.currency !== "USD" ? (
                <Text style={[type.footnote, { color: p.ink3 }]}>{`Listed at ${a.source.price.toLocaleString("en-US")} ${a.source.currency}, converted at ${a.source.rate} on ${a.source.rateDate}.`}</Text>
              ) : null}
              {a ? (
                <Pressable accessibilityRole="link" onPress={() => webOnly(a.url) && Linking.openURL(webOnly(a.url))} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}>
                  <Text style={[type.label, { color: p.accentText }]}>Open the source page</Text>
                </Pressable>
              ) : null}
            </View>
            <ErrorLine>{error}</ErrorLine>
            <QuietButton label={confirm ? "Tap again to remove it" : "Remove from my list"} onPress={onRemove} style={{ alignSelf: "flex-start" }} />
          </View>
        </Animated.View>
      </Animated.ScrollView>
      <Animated.View style={{ position: "absolute", top: insets.top + CONTROL_TOP, left: gutter, opacity: page }}>
        <IconButton icon="back" label="Back" onPress={back} />
      </Animated.View>
      <Grain />
      {viewing ? <PhotoViewer key={viewing.key} photos={photos} from={viewing} onSettle={setPhotoIndex} onClose={() => setViewing(null)} /> : null}
    </View>
  );
}
