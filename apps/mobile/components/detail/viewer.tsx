import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, Platform, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MediaImage } from "../../lib/agent";
import { containRect, pageAt, type Rect } from "../../lib/gallery";
import { PhotoCredit } from "../photo-credit";
import { ease, native, spring, step } from "../../lib/motion";
import { ThemeScope, layout, type, usePalette, useTheme, type ThemeId } from "../../lib/theme";
import { IconButton, Shade } from "../lux";
import { Frame, PageDots, knownAspect } from "./gallery";
import { CONTROL_TOP, HERO_SHADE, VIEWER_FOOTER, viewerTop } from "./metrics";
import { Swap } from "./swap";

/** Photos are looked at in a dark room: the light themes borrow their nearest night palette for the viewer. */
const DARK_ROOM: Record<ThemeId, ThemeId> = { emerald: "emerald", bordeaux: "bordeaux", noir: "noir", ivory: "noir", delina: "bordeaux", sapphire: "sapphire", cognac: "cognac", amethyst: "amethyst", riviera: "sapphire" };

/** Near-opaque, so the photo is the only thing lit and the page beneath is only a memory. */
const SCRIM = 0.96;

/**
 * Where the photo flies from: the tapped page's frame (`image`, cover-fitted as the hero shows it), the part of the
 * hero you could see (`clip`, above the title) and the hero itself (`hero`, where its shade sits).
 */
export interface ViewerFrom {
  index: number;
  image: Rect;
  clip: Rect;
  hero: Rect;
}

type Phase = "opening" | "open" | "closing";

/**
 * The full-screen photo viewer. The tapped photo lifts out of the hero and flies to its contained frame on a
 * settle spring while the dark room fades up (a shared-element move: position, size and crop all interpolate from
 * one clock); the close button and the footer arrive 50 ms apart behind it. It then hands over to a paging viewer on
 * the same frame. Closing runs the flight back on a faster snap spring to whichever photo is showing, which the hero
 * has already turned to. Mount it once per opening (key it). Reduced motion swaps the flight for a short cross-fade;
 * the screen passes its already-resolved setting in, since a fresh hook reads "off" for its first frame.
 */
export function PhotoViewer({ photos, from, reduced, onSettle, onClose }: { photos: MediaImage[]; from: ViewerFrom; reduced: boolean; onSettle(i: number): void; onClose(): void }) {
  const { id } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  // One clock for the flight: 0 is the photo in the hero, 1 is the photo in the viewer. It drives layout, so JS.
  const t = useRef(new Animated.Value(0)).current;
  const top = useRef(new Animated.Value(0)).current;
  const foot = useRef(new Animated.Value(0)).current;
  const x = useRef(new Animated.Value(from.index * W)).current;
  const pager = useRef<ScrollView | null>(null);
  // A constant: a contentOffset that followed the page would yank a swipe at its halfway point.
  const start = useRef({ x: from.index * W, y: 0 }).current;
  const [phase, setPhase] = useState<Phase>("opening");
  const phaseRef = useRef<Phase>("opening");
  const [cur, setCur] = useState(from.index);
  const curRef = useRef(from.index);
  const [placed, setPlaced] = useState(false);
  const placedRef = useRef(false);
  const [drawn, setDrawn] = useState<ReadonlySet<number>>(new Set());

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    const arrive = reduced
      ? Animated.timing(t, { toValue: 1, duration: step.outMs, easing: ease.out, useNativeDriver: false })
      : Animated.spring(t, { toValue: 1, ...spring.settle, useNativeDriver: false });
    arrive.start(({ finished }) => finished && phaseRef.current === "opening" && go("open"));
    Animated.stagger(
      step.staggerMs,
      [top, foot].map((v) => Animated.timing(v, { toValue: 1, duration: step.inMs, delay: reduced ? 0 : step.staggerMs, easing: ease.out, useNativeDriver: native })),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (phaseRef.current === "closing") return;
    go("closing");
    placedRef.current = false;
    // The hero turns to this photo under the scrim, so the flight lands on the same picture.
    onSettle(curRef.current);
    Animated.parallel([top, foot].map((v) => Animated.timing(v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native }))).start();
    const leave = reduced
      ? Animated.timing(t, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: false })
      : Animated.spring(t, { toValue: 0, ...spring.snap, useNativeDriver: false });
    // Starting from wherever the flight is, so a close during the opening turns straight round.
    leave.start(({ finished }) => finished && onClose());
  };

  // Arrow keys page on the web; Escape is the Modal's own close (onRequestClose).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (ev: KeyboardEvent) => {
      const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!d || phaseRef.current !== "open") return;
      const next = Math.min(photos.length - 1, Math.max(0, curRef.current + d));
      pager.current?.scrollTo({ x: next * W, animated: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, W]);

  // Stay on the same photo when the window changes width.
  useEffect(() => {
    pager.current?.scrollTo({ x: curRef.current * W, animated: false });
  }, [W]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
        useNativeDriver: native,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          if (!placedRef.current) return;
          const i = pageAt(e.nativeEvent.contentOffset.x, W, photos.length);
          if (i === curRef.current) return;
          curRef.current = i;
          setCur(i);
        },
      }),
    [x, W, photos.length],
  );

  const area: Rect = { x: 0, y: viewerTop(insets.top), width: W, height: Math.max(0, H - viewerTop(insets.top) - insets.bottom - VIEWER_FOOTER) };
  const anchor = phase === "opening" ? from.index : cur;
  const img = photos[anchor];
  const to = containRect(img ? knownAspect(img) : undefined, area);
  const src = reduced ? { image: to, clip: to, hero: to } : from;
  const lerp = (a: number, b: number) => t.interpolate({ inputRange: [0, 1], outputRange: [a, b], extrapolate: "clamp" });

  // The flying copy stays under the pager, hidden once the page above has drawn the same photo and whenever a
  // swipe moves the page off it; it shows again the moment the viewer closes.
  const flyOpacity =
    phase !== "open" || !placed ? 1 : drawn.has(cur) ? 0 : x.interpolate({ inputRange: [cur * W - 1, cur * W, cur * W + 1], outputRange: [0, 1, 0], extrapolate: "clamp" });
  const room = DARK_ROOM[id];
  const rise = reduced ? 0 : layout.stack.tight;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: reduced ? t : 1 }]}>
        <ThemeScope id={room}>
          <Scrim opacity={reduced ? 1 : t} />
        </ThemeScope>

        {/* The flight: outside the dark room, so its shade is the page's own and lands matching the hero. */}
        {img ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: flyOpacity }]}>
            <Animated.View style={{ position: "absolute", left: lerp(src.clip.x, to.x), top: lerp(src.clip.y, to.y), width: lerp(src.clip.width, to.width), height: lerp(src.clip.height, to.height), overflow: "hidden" }}>
              <Animated.View style={{ position: "absolute", left: lerp(src.image.x - src.clip.x, 0), top: lerp(src.image.y - src.clip.y, 0), width: lerp(src.image.width, to.width), height: lerp(src.image.height, to.height) }}>
                <Frame img={img} backdrop={false} fade={false} />
              </Animated.View>
              {reduced ? null : (
                <Animated.View style={{ position: "absolute", left: src.hero.x - src.clip.x, top: src.hero.y - src.clip.y, width: src.hero.width, height: src.hero.height, opacity: t.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: "clamp" }) }}>
                  <Shade from={HERO_SHADE} />
                </Animated.View>
              )}
            </Animated.View>
          </Animated.View>
        ) : null}

        <ThemeScope id={room}>
          <StatusBar style="light" />
          {phase === "open" ? (
            <Animated.ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onScroll}
              contentOffset={start}
              onLayout={() => {
                if (placedRef.current) return;
                pager.current?.scrollTo({ x: curRef.current * W, animated: false });
                // Shown only once it rests on the right photo, so the first frame is never the first photo.
                requestAnimationFrame(() => {
                  placedRef.current = true;
                  setPlaced(true);
                });
              }}
              style={[StyleSheet.absoluteFill, { opacity: placed ? 1 : 0 }]}
            >
              {photos.map((p, i) => (
                <View key={p.url} style={{ width: W, height: H }} accessible accessibilityRole="image" accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}>
                  <View style={{ position: "absolute", left: area.x, top: area.y, width: area.width, height: area.height }}>
                    {/* No fade: the flying copy beneath hides the moment this draws, so a fade would dip to the scrim. */}
                    {Math.abs(i - cur) <= 1 ? <Frame img={p} fit="contain" backdrop={false} fade={false} onDisplay={() => setDrawn((s) => (s.has(i) ? s : new Set(s).add(i)))} /> : null}
                  </View>
                </View>
              ))}
            </Animated.ScrollView>
          ) : null}

          <Animated.View style={{ position: "absolute", top: insets.top + CONTROL_TOP, left: layout.gutter(W), opacity: top, transform: [{ translateY: top.interpolate({ inputRange: [0, 1], outputRange: [-rise, 0] }) }] }}>
            <IconButton icon="close" label="Close" onPress={close} />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={{ position: "absolute", left: layout.gutter(W), right: layout.gutter(W), bottom: insets.bottom + layout.stack.base, alignItems: "center", gap: layout.stack.tight, opacity: foot, transform: [{ translateY: foot.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }}
          >
            {photos.length > 1 ? <PageDots count={photos.length} x={x} width={W} glass={false} /> : null}
            {photos[cur] ? (
              <Swap id={String(cur)} style={{ alignSelf: "stretch" }}>
                <PhotoCredit image={photos[cur]} lines={2} style={{ textAlign: "center" }} />
              </Swap>
            ) : null}
          </Animated.View>
        </ThemeScope>
      </Animated.View>
    </Modal>
  );
}

function Scrim({ opacity }: { opacity: Animated.Value | number }) {
  const p = usePalette();
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, ${SCRIM})`, opacity }]} />;
}
