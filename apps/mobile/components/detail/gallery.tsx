import { Image, type ImageContentFit } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type StyleProp, type ViewStyle } from "react-native";
import type { MediaImage } from "../../lib/agent";
import { aspectOf, pageAt } from "../../lib/gallery";
import { ease, native, step, useReducedMotion } from "../../lib/motion";
import { layout, radius, usePalette } from "../../lib/theme";
import { Glass } from "../lux";
import { DOT, DOTS, IDLE_DOT, dotsTop } from "./metrics";

/** Width over height as each photo actually loaded, so the viewer can land a photo on its true frame. */
const loaded = new Map<string, number>();

/** A photo's shape: as it loaded when we've seen it, else as the agent recorded it. */
export function knownAspect(img: MediaImage): number | undefined {
  return loaded.get(img.url) ?? aspectOf(img);
}

/**
 * One photograph filling its frame. `backdrop` lays the quiet gradient under it while it loads (as lux's Photo
 * does); `fade` cross-dissolves it in on first load. Both are off where the photo must appear on the same frame.
 */
export function Frame({ img, fit = "cover", backdrop = true, fade = true, onDisplay }: { img: MediaImage | null; fit?: ImageContentFit; backdrop?: boolean; fade?: boolean; onDisplay?: () => void }) {
  const p = usePalette();
  return (
    <View style={StyleSheet.absoluteFill}>
      {backdrop ? <LinearGradient colors={[p.surface, p.bg]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {img ? (
        <Image
          source={{ uri: img.url }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          transition={fade ? { duration: step.inMs, effect: "cross-dissolve" } : null}
          onLoad={(e) => e.source.width && e.source.height && loaded.set(img.url, e.source.width / e.source.height)}
          onDisplay={onDisplay}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

/**
 * Paging dots that follow the pager's offset frame by frame (each dot's opacity interpolates across its page), not
 * only when a swipe ends. Over a photo they sit in a small glass pill so they read on any image.
 */
export function PageDots({ count, x, width, glass = true }: { count: number; x: Animated.Value; width: number; glass?: boolean }) {
  const p = usePalette();
  const row: ViewStyle = { flexDirection: "row", alignItems: "center", gap: DOTS.gap, paddingVertical: DOTS.padV, paddingHorizontal: DOTS.padH };
  const dots = Array.from({ length: count }, (_, i) => (
    <Animated.View
      key={i}
      style={{
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        backgroundColor: p.ink,
        opacity: width > 0 ? x.interpolate({ inputRange: [(i - 1) * width, i * width, (i + 1) * width], outputRange: [IDLE_DOT, 1, IDLE_DOT], extrapolate: "clamp" }) : IDLE_DOT,
      }}
    />
  ));
  return glass ? <Glass style={[row, { borderRadius: radius.pill }]}>{dots}</Glass> : <View style={row}>{dots}</View>;
}

type AnimatedStyle = Animated.WithAnimatedValue<StyleProp<ViewStyle>>;

/**
 * The hero as a paging gallery of real photos. It snaps a page at a time with momentum; the dots track the offset
 * continuously. While the card-to-detail zoom runs (`live` false) it shows the current photo alone, cover-fitted
 * to the growing frame exactly as a single photo would be, and hands over to the pager on the same frame once the
 * zoom lands. `drift` is the parallax transform for the photo layer; `children` (the shade) sit above the photos
 * and under the dots.
 */
export function HeroGallery({ photos, width, height, topInset, live, index, onIndex, onOpen, drift, children }: {
  photos: MediaImage[];
  width: number;
  height: number;
  topInset: number;
  live: boolean;
  index: number;
  onIndex(i: number): void;
  onOpen(i: number): void;
  drift?: AnimatedStyle;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(index * width)).current;
  const pager = useRef<ScrollView | null>(null);
  // The page the pager is on, as it last told the parent; a different `index` prop means someone else moved it.
  const at = useRef(index);
  // Where the pager starts. A constant: a contentOffset that followed the page would yank a swipe at its halfway point.
  const start = useRef({ x: index * width, y: 0 }).current;
  // The page showing when the pager took over: the photo beneath already shows it, so until it has drawn it skips
  // the loading backdrop and the fade, and the swap is invisible. After that every page loads the usual way.
  const handoff = useRef(index);
  const [handedOff, setHandedOff] = useState(false);
  const dots = useRef(new Animated.Value(live ? 1 : 0)).current;

  useEffect(() => {
    if (live) handoff.current = at.current;
    Animated.timing(dots, { toValue: live ? 1 : 0, duration: live ? step.inMs : step.outMs, easing: ease.out, useNativeDriver: native }).start();
  }, [live, dots]);

  // Moved from outside (the viewer closed on another photo): jump there under the viewer's scrim, unanimated.
  useEffect(() => {
    if (index === at.current) return;
    at.current = index;
    pager.current?.scrollTo({ x: index * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The window changed width (a browser resize, a rotation): stay on the same photo.
  useEffect(() => {
    pager.current?.scrollTo({ x: at.current * width, animated: false });
  }, [width]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
        useNativeDriver: native,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const i = pageAt(e.nativeEvent.contentOffset.x, width, photos.length);
          if (i === at.current) return;
          at.current = i;
          onIndex(i);
        },
      }),
    [x, width, photos.length, onIndex],
  );

  const current = photos[Math.min(index, photos.length - 1)];
  const rise = reduced ? 0 : layout.stack.tight;
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, drift]}>
        {current ? <Frame img={current} /> : null}
        {live ? (
          <Animated.ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            contentOffset={start}
            onLayout={() => pager.current?.scrollTo({ x: at.current * width, animated: false })}
            style={StyleSheet.absoluteFill}
          >
            {photos.map((img, i) => (
              <Pressable
                key={img.url}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                accessibilityHint="Opens it full screen"
                onPress={() => onOpen(i)}
                style={{ width, height }}
              >
                {/* Only the photos either side of the current one are drawn; the rest wait as quiet gradients. */}
                {Math.abs(i - index) > 1 ? (
                  <Frame img={null} />
                ) : !handedOff && i === handoff.current ? (
                  <Frame img={img} backdrop={false} fade={false} onDisplay={() => setHandedOff(true)} />
                ) : (
                  <Frame img={img} />
                )}
              </Pressable>
            ))}
          </Animated.ScrollView>
        ) : null}
      </Animated.View>
      {children}
      <Animated.View
        pointerEvents="none"
        {...{ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const }}
        style={{ position: "absolute", top: dotsTop(topInset), left: 0, right: 0, alignItems: "center", opacity: dots, transform: [{ translateY: dots.interpolate({ inputRange: [0, 1], outputRange: [-rise, 0] }) }] }}
      >
        <PageDots count={photos.length} x={x} width={width} />
      </Animated.View>
    </>
  );
}
