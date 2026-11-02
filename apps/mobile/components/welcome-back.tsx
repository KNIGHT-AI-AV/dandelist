import { Image as ExpoImage } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAIN } from "../lib/landmark";
import { ease, native, useReducedMotion } from "../lib/motion";
import { play, preloadSounds } from "../lib/sound";
import { fonts, layout, type, usePalette } from "../lib/theme";
import { zoom } from "../lib/viewport";
import { getSecret, setSecret } from "../lib/storage";
import { LAST_HERO_KEY, heroWish, welcomeLines } from "../lib/welcome-back";
import { useWishes } from "../lib/wishes";
import { Grain, Shade, Wordmark } from "./lux";

/** The welcome back runs this long before it dissolves into the list by itself; a touch ends it sooner. */
const WELCOME_MS = 4200;
/** It waits at most this long for the list, so it can speak about it, before it starts anyway. */
const LIST_WAIT_MS = 1500;
/** A touch skips it from here on, so the very first frame never swallows a tap meant for the list. */
const SKIP_AFTER_MS = 400;
const DISSOLVE_MS = 1100;
/** How soft the wish's photograph is behind the words, so the wordmark and the greeting stand out (owner, 2026-11-02). */
const HERO_BLUR = 10;
/** With reduced motion: everything shown at once, held this long, then the list. */
const STILL_MS = 1400;
/** The dissolve's edge on phones: how much wider each disc is than the core, and how opaque (as the title). */
const FEATHER = [
  [1.12, 0.3],
  [1.06, 0.55],
  [1, 1],
] as const;

/**
 * The welcome for someone signed in who comes back (owner, 2026-11-02: "something that welcomes them back, something
 * better than just going straight to the same page"): a short cut of the opening, on one axis and in the same film.
 * The photograph of the first wish on their list surfaces behind the glass and drifts in slowly, the wordmark
 * resolves and its gold dot settles, a champagne hairline draws, then "Welcome back" and what their list holds. It
 * dissolves into the list by itself; a touch anywhere dissolves it from that point, as the opening does.
 */
export function WelcomeBack({ onDone }: { onDone(): void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { wishes, status } = useWishes();
  const listReady = status === "ready" || status === "error";
  const [started, setStarted] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const finished = useRef(false);
  const t = useRef(new Animated.Value(0)).current;
  const photoIn = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;
  // The wish shown last time, so this time's is another; read before the welcome starts (undefined until read).
  const [last, setLast] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getSecret(LAST_HERO_KEY).then(
      (v) => live && setLast(v),
      () => live && setLast(null),
    );
    return () => {
      live = false;
    };
  }, []);

  // What it says is fixed once it starts, so a list still arriving never rewrites a line on screen. It speaks about the
  // list only once the list has loaded: a slow or failed load gets the greeting alone, never "empty".
  const said = useRef<{
    title: string;
    line: string | null;
    hero: string | null;
    heroId: string | null;
    heroName: string | null;
  } | null>(null);
  if (started && !said.current) {
    const known = status === "ready" ? wishes : null;
    const hero = known ? heroWish(known, last ?? null) : null;
    said.current = {
      ...welcomeLines(known),
      hero: hero?.details?.agent?.imageUrl ?? null,
      heroId: hero?.id ?? null,
      heroName: hero?.name ?? null,
    };
  }

  useEffect(() => {
    if (listReady && last !== undefined) return setStarted(true);
    const wait = setTimeout(() => setStarted(true), LIST_WAIT_MS);
    return () => clearTimeout(wait);
  }, [listReady, last]);

  // Remembered once it is on screen, so the next welcome shows another of their wishes.
  useEffect(() => {
    const id = started ? said.current?.heroId : null;
    if (id) void setSecret(LAST_HERO_KEY, id).catch(() => undefined);
  }, [started]);

  useEffect(() => preloadSounds("title"), []);

  const finish = (at?: { x: number; y: number }) => {
    if (finished.current) return;
    finished.current = true;
    if (reduced) return onDone();
    setFrom(at ?? { x: width / 2, y: height / 2 });
    Animated.timing(out, {
      toValue: 1,
      duration: DISSOLVE_MS,
      easing: ease.inOut,
      useNativeDriver: native,
    }).start(() => onDone());
  };

  useEffect(() => {
    if (!started) return;
    if (reduced) {
      t.setValue(WELCOME_MS);
      const still = setTimeout(() => finish(), STILL_MS);
      return () => clearTimeout(still);
    }
    const skip = setTimeout(() => setSkippable(true), SKIP_AFTER_MS);
    const chord = setTimeout(() => play("title"), 300);
    Animated.timing(t, {
      toValue: WELCOME_MS,
      duration: WELCOME_MS,
      easing: Easing.linear,
      useNativeDriver: false, // In JS, as the title's clock: the native driver drops interpolate()'s easing on a phone (iOS audit, 2026-10-29).
    }).start(({ finished: ran }) => ran && finish());
    return () => {
      clearTimeout(skip);
      clearTimeout(chord);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, reduced]);

  // Escape or Return ends it on the web, as a touch does.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") finish();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = (a: number, b: number, from0 = 0, to = 1, easing = ease.cinema) =>
    t.interpolate({
      inputRange: [a, b],
      outputRange: [from0, to],
      extrapolate: "clamp",
      easing,
    });
  const gutter = layout.gutter(width);
  const fade = out.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [1, 0.15, 0],
  });
  const reach = from ? 2 * Math.hypot(Math.max(from.x, width - from.x), Math.max(from.y, height - from.y)) + 80 : 0;
  const words = said.current;

  return (
    <View
      {...MAIN}
      accessibilityLabel={words?.title ?? "Welcome back"}
      onStartShouldSetResponder={() => skippable && !from}
      onResponderRelease={(e: GestureResponderEvent) =>
        finish({
          x: e.nativeEvent.pageX / zoom(),
          y: e.nativeEvent.pageY / zoom(),
        })
      }
      style={{ flex: 1, overflow: "hidden", backgroundColor: p.bg }}
    >
      {words ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          {words.hero ? (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: photoIn,
                  transform: [
                    {
                      scale: range(0, WELCOME_MS, 1.08, 1, Easing.out(Easing.quad)),
                    },
                  ],
                },
              ]}
            >
              {/* Their own wish, dimmed so the page stays dark, as the opening's hero is. */}
              <View style={[StyleSheet.absoluteFill, { filter: "brightness(0.55)" } as object]}>
                <ExpoImage
                  source={{ uri: words.hero }}
                  contentFit="cover"
                  blurRadius={HERO_BLUR}
                  transition={0}
                  accessible={false}
                  style={StyleSheet.absoluteFill}
                  onLoad={() =>
                    Animated.timing(photoIn, {
                      toValue: 1,
                      duration: reduced ? 0 : 900,
                      easing: ease.cinema,
                      useNativeDriver: false,
                    }).start()
                  }
                />
              </View>
              <Shade look="title" />
            </Animated.View>
          ) : null}

          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: gutter,
              right: gutter,
              top: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
            }}
          >
            <Wordmark
              height={56}
              word={{
                opacity: range(300, 1300),
                transform: [{ translateY: range(300, 1300, 10, 0) }, { scale: range(300, 1500, 1.04, 1) }],
              }}
              dot={{
                opacity: range(1000, 1500),
                transform: [{ translateY: range(1000, 1700, -16, 0) }],
              }}
            />
            <Animated.View
              style={{
                width: 120,
                height: StyleSheet.hairlineWidth * 2,
                backgroundColor: p.accent,
                transform: [{ scaleX: range(1300, 2000) }],
              }}
            />
            <Animated.Text
              accessibilityRole="header"
              style={[
                type.title2,
                {
                  color: p.ink,
                  textAlign: "center",
                  opacity: range(1700, 2500),
                  transform: [{ translateY: range(1700, 2500, 12, 0) }],
                },
              ]}
            >
              {words.title === "Welcome back" ? (
                <>
                  Welcome{" "}
                  <Text
                    style={{
                      fontFamily: fonts.titleItalic,
                      color: p.accentText,
                    }}
                  >
                    back
                  </Text>
                </>
              ) : (
                words.title
              )}
            </Animated.Text>
            {words.line ? (
              <Animated.Text
                style={[
                  type.callout,
                  {
                    color: p.ink2,
                    textAlign: "center",
                    opacity: range(2200, 2900),
                    transform: [{ translateY: range(2200, 2900, 8, 0) }],
                  },
                ]}
              >
                {words.line}
              </Animated.Text>
            ) : null}
          </View>

          {words.heroName ? (
            <Animated.Text
              numberOfLines={1}
              style={[
                type.figure,
                {
                  position: "absolute",
                  left: gutter,
                  right: gutter,
                  bottom: insets.bottom + layout.stack.section,
                  color: p.ink2,
                  textAlign: "center",
                  opacity: range(2600, 3300),
                },
              ]}
            >
              {words.heroName}
            </Animated.Text>
          ) : null}
        </Animated.View>
      ) : null}

      {skippable && !from ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => finish({ x: width - gutter - 10, y: insets.top + 22 })}
          style={{
            position: "absolute",
            top: insets.top,
            right: gutter - 12,
            minWidth: 44,
            minHeight: 44,
            paddingHorizontal: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[type.label, { color: p.ink2 }]}>Skip</Text>
        </Pressable>
      ) : null}

      {/* The dissolve, as the opening's: a circle of the page grows from the touch and the list shows through it. */}
      {from ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {Platform.OS === "web" ? (
            <Animated.View
              style={
                {
                  position: "absolute",
                  left: from.x - reach / 2,
                  top: from.y - reach / 2,
                  width: reach,
                  height: reach,
                  borderRadius: reach / 2,
                  backgroundImage: `radial-gradient(circle closest-side, ${p.bg} 78%, rgba(${p.bgRgb}, 0) 100%)`,
                  transform: [
                    {
                      scale: out.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1.3],
                      }),
                    },
                  ],
                } as object
              }
            />
          ) : (
            FEATHER.map(([grow, alpha]) => (
              <Animated.View
                key={grow}
                style={{
                  position: "absolute",
                  left: from.x - reach / 2,
                  top: from.y - reach / 2,
                  width: reach,
                  height: reach,
                  borderRadius: reach / 2,
                  backgroundColor: p.bg,
                  opacity: alpha,
                  transform: [
                    {
                      scale: out.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, grow],
                      }),
                    },
                  ],
                }}
              />
            ))
          )}
        </View>
      ) : null}
      <Grain />
    </View>
  );
}
