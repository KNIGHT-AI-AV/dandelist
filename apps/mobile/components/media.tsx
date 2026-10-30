import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { cutoutSourceImage } from "../lib/photo-credit";
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
      <Image source={{ uri: model.thumbnail }} style={[StyleSheet.absoluteFill, { opacity: loaded ? 0 : 0.6 }]} contentFit="cover" blurRadius={12} />
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

/**
 * Real photographs of a place, one after another: each drifts slowly (a Ken Burns move) and crossfades into the
 * next, with thin progress lines like a magazine's story view. Reduced motion keeps the crossfade and drops the drift.
 */
export function Slideshow({ images, interval = 5200, style, children }: { images: MediaImage[]; interval?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (images.length < 2) return;
    fade.setValue(0);
    drift.setValue(0);
    progress.setValue(0);
    const run = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: reduced ? 400 : 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(drift, { toValue: reduced ? 0 : 1, duration: interval + 1100, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 1, duration: interval, easing: Easing.linear, useNativeDriver: false }),
    ]);
    run.start();
    const t = setTimeout(() => setIndex((i) => (i + 1) % images.length), interval);
    return () => {
      run.stop();
      clearTimeout(t);
    };
  }, [index, images.length, interval, reduced, fade, drift, progress]);

  if (!images.length) return <Photo />;
  const current = images[index]!;
  const previous = images[(index - 1 + images.length) % images.length]!;
  // Alternate the drift direction so consecutive shots don't move the same way.
  const dir = index % 2 === 0 ? 1 : -1;
  const scale = drift.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.1] });
  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 14 * dir] });

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]}>
      {images.length > 1 ? <Image source={{ uri: previous.url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, transform: [{ scale }, { translateX }] }]}>
        <Image source={{ uri: current.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      </Animated.View>
      {/* Preload the next shot so the crossfade never shows an empty frame. */}
      {images.length > 1 ? <Image source={{ uri: images[(index + 1) % images.length]!.url }} style={{ width: 1, height: 1, opacity: 0, position: "absolute" }} /> : null}
      {children}
      {images.length > 1 ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", gap: 4 }}>
          {images.map((img, i) => (
            <View key={img.url} style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: p.onPhotoTrack, overflow: "hidden" }}>
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
      {!current.generated ? (
        <View style={{ position: "absolute", right: 12, bottom: 10, maxWidth: "70%" }}>
          <PhotoCredit image={current} />
        </View>
      ) : (
        <Credit>{creditFor(current)}</Credit>
      )}
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
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
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
export function MediaHero({ media, fallbackUri, kind, style, glyph, children }: { media?: Media; fallbackUri?: string | null; kind?: string; style?: StyleProp<ViewStyle>; glyph?: string; children?: ReactNode }) {
  if (media?.model3d) return <Model3D model={media.model3d} style={style} />;
  if (media && (media.kind === "place" || media.kind === "experience") && media.images.length > 1) {
    return (
      <Slideshow images={media.images} style={style}>
        {children}
      </Slideshow>
    );
  }
  if (media?.cutout) {
    const original = cutoutSourceImage(media.images, media.cutout.from);
    return <TiltObject uri={media.cutout.url} style={style} credit={original ? creditFor(original) : undefined} image={original} />;
  }
  return (
    <View style={style}>
      <Photo uri={media?.images[0]?.url ?? fallbackUri} kind={kind} glyph={glyph} />
      {children}
    </View>
  );
}
