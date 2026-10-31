import { Canvas, Fill, ImageShader, Shader, Skia, useImage } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { usePalette } from "../lib/theme";
import { clarityTarget, useGlassClock, usePictureState, type Stage, type Treatment } from "./reveal-clock";

/**
 * Phone version of the glass reveal; `reveal.tsx` is the web version. One Skia shader bends the picture through
 * swirled glass (the title only, gentler than before), or frosts it behind a pane (cards: blur and a sheen, no
 * bending), adds grain and a light catch, and eases all of it away as the picture clears. Once clear, the canvas
 * steps aside for a plain image. A picture that fails or never arrives shows its standby clear.
 */

const SKSL = `
uniform shader image;
uniform float2 size;
uniform float time;
uniform float clarity;
uniform float mode;

float hash(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }

float glass(float2 uv) {
  float aspect = size.x / size.y;
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float2 c = float2(fract(sin(fi * 7.31) * 43.7), fract(sin(fi * 3.17) * 91.3));
    c += 0.025 * float2(sin(time * 0.21 + fi), cos(time * 0.17 + fi * 1.7));
    float2 d = (uv - c) * float2(aspect, 1.0);
    float r = length(d);
    float a = atan(d.y, d.x);
    float tw = mod(fi, 2.0) < 1.0 ? 2.0 : -2.5;
    h += exp(-r * r / 0.07) * sin(r * 48.0 + a * tw + time * 0.35 + fi);
  }
  return h;
}

half4 main(float2 p) {
  float k = 1.0 - clarity;
  float2 uv = p / size;
  float2 disp = float2(0.0);
  float shine = 0.0;
  if (mode < 0.5) {
    float e = 1.5 / size.y;
    float h0 = glass(uv);
    float2 g = float2(glass(uv + float2(e, 0.0)) - h0, glass(uv + float2(0.0, e)) - h0) / e;
    // At most about 24 px of bend at full glass (UI audit P0-2), so even the title never melts the subject.
    disp = clamp(g * 0.00044 * size.y, float2(-24.0), float2(24.0)) * k;
    float3 n = normalize(float3(-g * 0.018, 1.0));
    float3 hv = normalize(normalize(float3(-0.4, -0.6, 0.7)) + float3(0.0, 0.0, 1.0));
    shine = pow(max(dot(n, hv), 0.0), 36.0) * k;
  } else if (mode < 1.5) {
    disp = float2(sin(uv.y * 9.0 + time), cos(uv.x * 7.0 + time * 0.8)) * 2.0 * k;
  } else if (mode < 2.5) {
    disp = (float2(hash(floor(p * 0.5)), hash(floor(p * 0.5) + 3.1)) - 0.5) * 8.0 * k;
  }
  float rad = (mode < 0.5 ? 5.0 : (mode < 1.5 ? 14.0 : (mode < 2.5 ? 18.0 : 12.0))) * k;
  float2 q = p + disp;
  float4 c = float4(image.eval(q)) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    c += float4(image.eval(q + float2(cos(a), sin(a)) * rad)) * 0.1;
  }
  bool film = mode > 0.5 && mode < 1.5;
  float grain = (hash(p + fract(time) * 97.0) - 0.5) * (film ? 0.14 * (0.3 + k) : 0.06 * k);
  c.rgb += float3(grain);
  if (film) { float lum = dot(c.rgb, float3(0.299, 0.587, 0.114)); c.rgb = mix(c.rgb, float3(lum), 0.35 * k); }
  if (mode > 1.5 && mode < 2.5) { c.rgb = mix(c.rgb, float3(0.93, 0.9, 0.85), 0.26 * k); }
  if (mode > 2.5) {
    // The pane: a faint frost and one diagonal sheen that lift away as it clears.
    float d = uv.x * 0.8 + uv.y * 0.6;
    float sheen = smoothstep(0.0, 0.25, d) * (1.0 - smoothstep(0.25, 0.6, d)) * 0.14 + smoothstep(0.7, 0.85, d) * (1.0 - smoothstep(0.85, 1.1, d)) * 0.06;
    c.rgb = mix(c.rgb, float3(0.93, 0.9, 0.85), 0.1 * k) + float3(sheen * k);
  }
  c.rgb = mix(c.rgb, float3(0.04), 0.18 * k);
  c.rgb += float3(shine * 0.55);
  return half4(c);
}`;

// Make throws on an SkSL error instead of returning null, and this runs as the launch screen loads; caught, the reveal
// falls back to the plain image below rather than crashing the app.
const effect = (() => {
  try {
    return Skia.RuntimeEffect.Make(SKSL);
  } catch {
    return null;
  }
})();
const MODE: Record<Treatment, number> = { swirl: 0, film: 1, frost: 2, pane: 3 };

export function GlassReveal({ uri, standby, stage, treatment = "pane", finish = false, focus, style, children }: { uri?: string | null; standby: number; stage: Stage; treatment?: Treatment; /** Where the subject sits (0–1), so a tight crop keeps it whole. */ focus?: { x: number; y: number }; /** Generated imagery never shows bare: it keeps a fine layer of glass and grain. */ finish?: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pic = usePictureState(uri);
  const waiting = useImage(standby);
  const found = useImage(uri && !pic.failed ? uri : null, pic.onError);
  const ready = !!uri && !!found && !pic.failed;
  useEffect(() => {
    if (found && !pic.loaded) pic.onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  const { clarity, time } = useGlassClock(clarityTarget({ uri, ready, failed: pic.failed, stage, finish }), reduced, treatment);
  const picture = ready ? found : waiting;
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  const clear = clarity >= 0.999;
  // The plain picture is drawn beneath the glass from the moment it arrives, and the glass steps aside only once that
  // picture is on screen. Swapping the glass for an image that then faded in from nothing showed the dark page for a
  // beat as the glass cleared (owner, 2026-10-31: "the screen is still blacking out on the image after like the first
  // second").
  const shown = ready ? uri! : "standby";
  const [drawn, setDrawn] = useState<string | null>(null);
  const plain = clear || !effect || ready;
  const glass = !!effect && !!picture && size.width > 0 && !(clear && drawn === shown);
  // The glass crops like the plain picture beneath it (cover, about the same focus), so nothing shifts as it steps aside.
  const rect = (() => {
    if (!picture || !size.width) return { x: 0, y: 0, width: size.width, height: size.height };
    const scale = Math.max(size.width / picture.width(), size.height / picture.height());
    const width = picture.width() * scale;
    const height = picture.height() * scale;
    return { x: (size.width - width) * (focus?.x ?? 0.5), y: (size.height - height) * (focus?.y ?? 0.5), width, height };
  })();

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]} onLayout={onLayout}>
      {plain ? (
        <Image
          source={ready ? { uri: uri! } : standby}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={focus ? { left: `${focus.x * 100}%`, top: `${focus.y * 100}%` } : "center"}
          blurRadius={effect || clear ? 0 : 24}
          // Beneath the glass it must be fully drawn the moment the glass leaves, so it never fades in; without the glass
          // (no shader on this device) it still cross-dissolves from the standby.
          transition={effect ? 0 : { duration: 300, effect: "cross-dissolve" }}
          onDisplay={() => setDrawn(shown)}
        />
      ) : null}
      {glass ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={effect} uniforms={{ size: [size.width, size.height], time, clarity, mode: MODE[treatment] }}>
              <ImageShader image={picture} fit="fill" rect={rect} tx="clamp" ty="clamp" />
            </Shader>
          </Fill>
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
