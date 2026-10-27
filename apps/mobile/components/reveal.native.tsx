import { Canvas, Fill, ImageShader, Shader, Skia, useImage } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { CLARITY, useGlassClock, type Stage, type Treatment } from "./reveal-clock";

/**
 * Phone version of the glass reveal; `reveal.tsx` is the web version. One Skia shader bends the picture through
 * swirled glass (rosettes of ripples, like poured window glass), blurs it, adds grain and a light catch, and eases
 * all of it away as the picture clears. Once clear, the canvas steps aside for a plain image.
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
    disp = g * 0.0011 * size.y * k;
    float3 n = normalize(float3(-g * 0.018, 1.0));
    float3 hv = normalize(normalize(float3(-0.4, -0.6, 0.7)) + float3(0.0, 0.0, 1.0));
    shine = pow(max(dot(n, hv), 0.0), 36.0) * k;
  } else if (mode < 1.5) {
    disp = float2(sin(uv.y * 9.0 + time), cos(uv.x * 7.0 + time * 0.8)) * 2.0 * k;
  } else {
    disp = (float2(hash(floor(p * 0.5)), hash(floor(p * 0.5) + 3.1)) - 0.5) * 8.0 * k;
  }
  float rad = (mode < 0.5 ? 5.0 : (mode < 1.5 ? 14.0 : 18.0)) * k;
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
  if (mode > 1.5) { c.rgb = mix(c.rgb, float3(0.93, 0.9, 0.85), 0.26 * k); }
  c.rgb = mix(c.rgb, float3(0.04), 0.18 * k);
  c.rgb += float3(shine * 0.55);
  return half4(c);
}`;

const effect = Skia.RuntimeEffect.Make(SKSL);
const MODE: Record<Treatment, number> = { swirl: 0, film: 1, frost: 2 };

export function GlassReveal({ uri, standby, stage, treatment = "swirl", style, children }: { uri?: string | null; standby: number; stage: Stage; treatment?: Treatment; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const waiting = useImage(standby);
  const found = useImage(uri ?? null);
  const ready = !!uri && !!found;
  const { clarity, time } = useGlassClock(ready ? CLARITY[stage] : 0, reduced);
  const picture = ready ? found : waiting;
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  const clear = ready && clarity >= 0.999;

  return (
    <View style={[{ overflow: "hidden", backgroundColor: "#0A0A0B" }, style]} onLayout={onLayout}>
      {clear || !effect ? (
        <Image source={uri ? { uri } : standby} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={clear ? 0 : 24} transition={300} />
      ) : picture && size.width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={effect} uniforms={{ size: [size.width, size.height], time, clarity, mode: MODE[treatment] }}>
              <ImageShader image={picture} fit="cover" rect={{ x: 0, y: 0, width: size.width, height: size.height }} tx="clamp" ty="clamp" />
            </Shader>
          </Fill>
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
