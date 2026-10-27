import { Asset } from "expo-asset";
import { createElement as h, useId, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { usePalette } from "../lib/theme";
import { CLARITY, FINISHED, useGlassClock, type Stage, type Treatment } from "./reveal-clock";

/**
 * Web version of the glass reveal; `reveal.native.tsx` is the Skia version for phones.
 * The picture sits behind textured glass: an SVG displacement filter bends it through a swirled-glass map,
 * a highlight layer catches the light, and both ease away as the picture clears.
 */

const asset = (m: number) => Asset.fromModule(m).uri;
const DISP = asset(require("../assets/glass-swirl-disp.png"));
const SHINE = asset(require("../assets/glass-swirl.png"));
const GRAIN = asset(require("../assets/grain.png"));

export function GlassReveal({ uri, standby, stage, treatment = "swirl", finish = false, style, children }: { uri?: string | null; standby: number; stage: Stage; treatment?: Treatment; /** Generated imagery never shows bare: it keeps a fine layer of glass and grain. */ finish?: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = useState<string | null>(null);
  const ready = !!uri && loaded === uri;
  const { clarity, time } = useGlassClock(ready ? Math.min(CLARITY[stage], finish ? FINISHED : 1) : !uri && stage === "clear" ? FINISHED : 0, reduced);
  const k = 1 - clarity;
  const id = `glass${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const blur = treatment === "swirl" ? 2.5 * k : treatment === "film" ? 14 * k : 18 * k;
  const drift = 24 * Math.sin(time * 0.15);
  const picture = (src: string, onLoad?: () => void, opacity = 1) =>
    h("img", {
      src,
      alt: "",
      onLoad,
      draggable: false,
      style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity, transition: "opacity 600ms cubic-bezier(0.25,0.1,0.25,1)" },
    });

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]}>
      {h(
        "svg",
        { width: 0, height: 0, style: { position: "absolute" }, "aria-hidden": true },
        h(
          "filter",
          { id, x: "-5%", y: "-5%", width: "110%", height: "110%", colorInterpolationFilters: "sRGB" },
          h("feImage", { href: DISP, x: drift, y: drift * 0.6, width: 512, height: 512, preserveAspectRatio: "none", result: "map" }),
          h("feTile", { in: "map", result: "tiled" }),
          h("feDisplacementMap", { in: "SourceGraphic", in2: "tiled", scale: treatment === "swirl" ? 60 * k : treatment === "frost" ? 10 * k : 0, xChannelSelector: "R", yChannelSelector: "G" }),
        ),
      )}
      {h(
        "div",
        {
          style: {
            position: "absolute",
            inset: "-3%",
            filter: `url(#${id}) blur(${blur.toFixed(2)}px) saturate(${treatment === "film" ? 1 - 0.35 * k : 1})`,
            transform: `scale(${1 + 0.04 * k})`,
          },
        },
        picture(asset(standby), undefined, ready ? 0 : 1),
        uri ? picture(uri, () => setLoaded(uri), ready ? 1 : 0) : null,
      )}
      {treatment === "swirl"
        ? h("div", { style: { position: "absolute", inset: 0, backgroundImage: `url(${SHINE})`, backgroundSize: "512px 512px", backgroundPosition: `${drift}px ${drift * 0.6}px`, opacity: 0.75 * k, mixBlendMode: "screen", pointerEvents: "none" } })
        : null}
      {treatment === "frost"
        ? h("div", { style: { position: "absolute", inset: 0, background: `rgba(237,230,216,${0.22 * k})`, backdropFilter: `blur(${(10 * k).toFixed(1)}px)`, pointerEvents: "none" } })
        : null}
      {/* Film grain stays faintly even when clear on the film treatment; it is the finish, not the effect. */}
      {h("div", { style: { position: "absolute", inset: 0, backgroundImage: `url(${GRAIN})`, opacity: treatment === "film" ? 0.25 + 0.45 * k : 0.35 * k, mixBlendMode: "overlay", pointerEvents: "none" } })}
      {k > 0.02 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, ${0.18 * k})` }]} /> : null}
      {children}
    </View>
  );
}
