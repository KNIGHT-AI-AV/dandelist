import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { selectMediaHero } from "../lib/media-hero";
import { useReducedMotion } from "../lib/motion";
import { createSlideshow, nextSlideshowIndex, slideshowReducer, slideshowSignature, type SlideRecord, type SlideshowEvent } from "../lib/slideshow-state";
import { type, usePalette } from "../lib/theme";
import { Embed } from "./embed";
import { Photo } from "./lux";
import { PhotoCredit } from "./photo-credit";

/** What the agent found to show a wish: real photographs first, a 3D model when a true match exists. */
export type MediaImage = { url: string; width?: number; height?: number; source: string; credit?: string; license?: string; sourcePage?: string; clean?: boolean; generated?: boolean; author?: { name: string; url: string } };
export type Model3d = { provider: "sketchfab"; uid: string; name: string; author: string; license: string; embedUrl: string; thumbnail: string };
export type Media = {
  kind: "product" | "vehicle" | "place" | "experience" | "other";
  images: MediaImage[];
  model3d?: Model3d;
  cutout?: { url: string; width?: number; height?: number; from: string; model: string };
};

function Credit({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text numberOfLines={1} style={{ position: "absolute", right: 12, bottom: 10, maxWidth: "70%", ...type.figure, color: p.ink3 }}>
      {children}
    </Text>
  );
}

function creditFor(img: MediaImage): string {
  if (img.generated) return "Image made with AI";
  return [img.credit, img.license, img.source].filter(Boolean).join(" · ");
}

/**
 * A touchable 3D model. Sketchfab's own viewer does the rendering and the drag-to-turn; on phones it runs in a
 * web view, on the web in an iframe.
 */
export function Model3D({ model, style }: { model: Model3d; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const [loaded, setLoaded] = useState(false);
  const hint = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!loaded) return;
    Animated.timing(hint, { toValue: 0, delay: 2600, duration: 600, useNativeDriver: true }).start();
  }, [loaded, hint]);

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]}>
      <Image source={{ uri: model.thumbnail }} accessibilityLabel="" style={[StyleSheet.absoluteFill, { opacity: loaded ? 0 : 0.6 }]} contentFit="cover" blurRadius={12} />
      <View style={StyleSheet.absoluteFill}>
        <Embed uri={model.embedUrl} title={model.name} onLoad={() => setLoaded(true)} />
      </View>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 44, alignItems: "center", opacity: hint }}>
        <Text style={[type.eyebrow, { color: p.ink }]}>{loaded ? "Drag to turn it" : "Loading the 3D model"}</Text>
      </Animated.View>
      <Credit>{`3D model by ${model.author} on Sketchfab · ${model.license}`}</Credit>
    </View>
  );
}

/** A record keeps this same full-size Image instance when it becomes the committed underlay. */
function SlideshowLayer({ record, ready, interval, reduced, dispatch }: { record: SlideRecord; ready: boolean; interval: number; reduced: boolean; dispatch: Dispatch<SlideshowEvent> }) {
  const source = useRef({ uri: record.image.url }).current;
  const fade = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    let live = true;
    const run = Animated.timing(fade, { toValue: 1, duration: reduced ? 400 : 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    run.start(({ finished }) => {
      if (!live) return;
      if (finished) fade.setValue(1);
      dispatch({ type: "finish", record, finished });
    });
    return () => {
      live = false;
      run.stop();
      dispatch({ type: "cancel", record });
    };
  }, [ready, reduced, fade, record, dispatch]);

  useEffect(() => {
    if (!ready) return;
    drift.setValue(0);
    const run = Animated.timing(drift, { toValue: reduced ? 0 : 1, duration: interval + 1100, easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [ready, reduced, interval, drift]);

  // Alternate the drift direction so consecutive shots don't move the same way.
  const dir = record.index % 2 === 0 ? 1 : -1;
  const scale = drift.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.1] });
  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 14 * dir] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, transform: [{ scale }, { translateX }] }]}>
      <Image
        source={source}
        accessibilityLabel=""
        recyclingKey={`${record.epoch}:${record.attempt}`}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessibilityIgnoresInvertColors
        onDisplay={() => dispatch({ type: "display", record })}
        onError={() => dispatch({ type: "error", record })}
      />
    </Animated.View>
  );
}

/**
 * Real photographs of a place, one after another: each drifts slowly (a Ken Burns move) and crossfades into the
 * next, with thin progress lines like a magazine's story view. Reduced motion keeps the crossfade and drops the drift.
 */
export function Slideshow({ images, interval = 5200, style, children }: { images: MediaImage[]; interval?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [state, dispatch] = useReducer(slideshowReducer, images, createSlideshow);
  // React retries this render before committing: old metadata/layers never accompany a new semantic deck.
  if (state.signature !== slideshowSignature(images)) dispatch({ type: "deck", images });
  const progress = useRef(new Animated.Value(0)).current;
  const nextIndex = nextSlideshowIndex(state);
  const cycling = nextIndex !== undefined;

  useEffect(() => {
    if (!cycling) return;
    const clock = setInterval(() => dispatch({ type: "tick", epoch: state.epoch }), interval);
    return () => clearInterval(clock);
  }, [state.epoch, interval, cycling]);

  useEffect(() => {
    progress.setValue(0);
    if (!state.shown) return;
    const run = Animated.timing(progress, { toValue: 1, duration: interval, easing: Easing.linear, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [state.shown, interval, progress]);

  const layers = [state.shown, state.candidate?.record].filter((record): record is SlideRecord => !!record);
  const current = state.shown?.image;
  const index = state.shown?.index ?? -1;
  const preload = nextIndex !== undefined && nextIndex !== state.candidate?.record.index ? state.images[nextIndex] : undefined;

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]}>
      {!state.images.length ? <Photo /> : null}
      {layers.map((record) => <SlideshowLayer key={`${record.epoch}:${record.attempt}`} record={record} ready={record === state.shown || state.candidate?.phase === "fading"} interval={interval} reduced={reduced} dispatch={dispatch} />)}
      {/* Cache hint only: readiness belongs to the matching full-size node's onDisplay. */}
      {preload ? <Image source={{ uri: preload.url }} accessibilityLabel="" style={{ width: 1, height: 1, opacity: 0, position: "absolute" }} /> : null}
      {children}
      {state.images.length > 1 ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", gap: 4 }}>
          {state.images.map((img, i) => (
            <View key={`${i}:${img.url}`} style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: p.onPhotoTrack, overflow: "hidden" }}>
              <Animated.View
                style={{
                  height: 2,
                  backgroundColor: p.onPhoto,
                  width: i < index ? "100%" : i === index ? progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) : "0%",
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
      {current && !current.generated ? (
        <View style={{ position: "absolute", right: 12, bottom: 10, maxWidth: "70%" }}>
          <PhotoCredit image={current} />
        </View>
      ) : current ? (
        <Credit>{creditFor(current)}</Credit>
      ) : null}
    </View>
  );
}

/**
 * A product you can turn with a finger: the clean cutout tilts in perspective as you drag, a soft sheen follows the
 * angle, and it springs back when let go. It reads as an object on a plinth, not a flat photo.
 */
export function TiltObject({ uri, style, credit, image }: { uri: string; style?: StyleProp<ViewStyle>; credit?: string; image?: MediaImage }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const rx = useRef(new Animated.Value(0)).current;
  const ry = useRef(new Animated.Value(0)).current;
  const idle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    // A slow idle sway so the object looks alive before anyone touches it.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idle, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(idle, { toValue: -1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, idle]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        ry.setValue(Math.max(-35, Math.min(35, g.dx / 4)));
        rx.setValue(Math.max(-18, Math.min(18, -g.dy / 6)));
      },
      onPanResponderRelease: () => {
        Animated.parallel([
          Animated.spring(rx, { toValue: 0, stiffness: 140, damping: 14, mass: 1, useNativeDriver: true }),
          Animated.spring(ry, { toValue: 0, stiffness: 140, damping: 14, mass: 1, useNativeDriver: true }),
        ]).start();
      },
    }),
  ).current;

  const swayY = idle.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] });
  const rotateY = Animated.add(ry, swayY).interpolate({ inputRange: [-45, 45], outputRange: ["-45deg", "45deg"] });
  const rotateX = rx.interpolate({ inputRange: [-45, 45], outputRange: ["-45deg", "45deg"] });
  const sheenX = Animated.add(ry, swayY).interpolate({ inputRange: [-45, 45], outputRange: [-120, 120] });

  return (
    <View style={[{ overflow: "hidden", alignItems: "center", justifyContent: "center" }, style]} {...pan.panHandlers}>
      <LinearGradient colors={[p.surface, p.bg]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* The plinth's soft light pool. */}
      <View pointerEvents="none" style={{ position: "absolute", bottom: "14%", width: "62%", height: 26, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", transform: [{ scaleY: 0.5 }] }} />
      <Animated.View style={{ width: "78%", height: "70%", transform: [{ perspective: 900 }, { rotateX }, { rotateY }] }}>
        <Image source={{ uri }} accessibilityLabel="" style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.22, transform: [{ translateX: sheenX }] }]}>
          <LinearGradient colors={["rgba(255,255,255,0)", "rgba(255,248,235,0.55)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
      <Text pointerEvents="none" style={[type.eyebrow, { position: "absolute", bottom: 40, color: p.ink3 }]}>
        Drag to turn
      </Text>
      {image && !image.generated ? (
        <View style={{ position: "absolute", right: 12, bottom: 10, maxWidth: "70%" }}>
          <PhotoCredit image={image} />
        </View>
      ) : credit ? (
        <Credit>{credit}</Credit>
      ) : null}
    </View>
  );
}

/** Picks the richest way to show a wish: a 3D model, a slideshow of a place, a turnable cutout, or the photo. */
export function MediaHero({ media, fallbackUri, kind, style, glyph, children, showCutoutCredit = true }: { media?: Media; fallbackUri?: string | null; kind?: string; style?: StyleProp<ViewStyle>; glyph?: string; children?: ReactNode; showCutoutCredit?: boolean }) {
  const selected = selectMediaHero(media);
  if (selected.kind === "model") return <Model3D model={selected.model} style={style} />;
  if (selected.kind === "slideshow") {
    return (
      <Slideshow images={selected.images} style={style}>
        {children}
      </Slideshow>
    );
  }
  if (selected.kind === "cutout") {
    // A detail caption can credit the original outside its shade; other consumers keep the internal credit.
    const original = showCutoutCredit ? selected.original : undefined;
    return <TiltObject uri={selected.cutout.url} style={style} credit={original ? creditFor(original) : undefined} image={original} />;
  }
  return (
    <View style={style}>
      <Photo uri={selected.image?.url ?? fallbackUri} kind={kind} glyph={glyph} />
      {children}
    </View>
  );
}
