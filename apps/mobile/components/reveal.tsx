import { Asset } from "expo-asset";
import { createElement as h, useId, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { usePalette } from "../lib/theme";
import { clarityTarget, useGlassClock, usePictureState, type Stage, type Treatment } from "./reveal-clock";

/**
 * Web version of the glass reveal; `reveal.native.tsx` is the Skia version for phones.
 * The picture sits behind textured glass and surfaces as it clears. `swirl` (the title only) bends it through a
 * swirled-glass map, at most 24 px; `pane` (cards) is a frosted pane with no bending that clears in 450 ms;
 * `film` and `frost` are softer finishes. A picture that fails or never arrives shows its standby clear.
 */

const asset = (m: number) => Asset.fromModule(m).uri;
const DISP = asset(require("../assets/glass-swirl-disp.png"));
const SHINE = asset(require("../assets/glass-swirl.png"));
const GRAIN = asset(require("../assets/grain.png"));

export function GlassReveal({ uri, standby, stage, treatment = "pane", finish = false, focus, style, children }: { uri?: string | null; standby: number; stage: Stage; treatment?: Treatment; /** Where the subject sits (0–1), so a tight crop keeps it whole. */ focus?: { x: number; y: number }; /** Generated imagery never shows bare: it keeps a fine layer of glass and grain. */ finish?: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const pic = usePictureState(uri);
  const ready = !!uri && pic.loaded;
  const { clarity, time } = useGlassClock(clarityTarget({ uri, ready, failed: pic.failed, stage, finish }), reduced, treatment);
  const k = 1 - clarity;
  const id = `glass${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const blur = treatment === "swirl" ? 2.5 * k : treatment === "pane" ? 12 * k : treatment === "film" ? 14 * k : 18 * k;
  const bend = treatment === "swirl" ? 24 * k : treatment === "frost" ? 10 * k : 0;
  const drift = 24 * Math.sin(time * 0.15);
  const picture = (src: string, opacity: number, events?: { onLoad(): void; onError(): void }) =>
    h("img", {
      src,
      alt: "",
      draggable: false,
      ...events,
      style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focus ? `${focus.x * 100}% ${focus.y * 100}%` : "50% 50%", opacity, transition: "opacity 300ms cubic-bezier(0.23,1,0.32,1)" },
    });

  return (
    <View style={[{ overflow: "hidden", backgroundColor: p.bg }, style]}>
      {bend > 0.05
        ? h(
            "svg",
            { width: 0, height: 0, style: { position: "absolute" }, "aria-hidden": true },
            h(
              "filter",
              { id, x: "-5%", y: "-5%", width: "110%", height: "110%", colorInterpolationFilters: "sRGB" },
              h("feImage", { href: DISP, x: drift, y: drift * 0.6, width: 512, height: 512, preserveAspectRatio: "none", result: "map" }),
              h("feTile", { in: "map", result: "tiled" }),
              h("feDisplacementMap", { in: "SourceGraphic", in2: "tiled", scale: bend, xChannelSelector: "R", yChannelSelector: "G" }),
            ),
          )
        : null}
      {h(
        "div",
        {
          style: {
            position: "absolute",
            inset: "-3%",
            filter: `${bend > 0.05 ? `url(#${id}) ` : ""}blur(${blur.toFixed(2)}px) saturate(${treatment === "film" ? 1 - 0.35 * k : 1})`,
            transform: `scale(${1 + 0.04 * k})`,
          },
        },
        picture(asset(standby), ready ? 0 : 1),
        uri && !pic.failed ? picture(uri, ready ? 1 : 0, { onLoad: pic.onLoad, onError: pic.onError }) : null,
      )}
      {treatment === "swirl" && k > 0.01
        ? h("div", { style: { position: "absolute", inset: 0, backgroundImage: `url(${SHINE})`, backgroundSize: "512px 512px", backgroundPosition: `${drift}px ${drift * 0.6}px`, opacity: 0.75 * k, mixBlendMode: "screen", pointerEvents: "none" } })
        : null}
      {/* The pane's light: a faint frost and one diagonal sheen that both lift away as the picture clears. */}
      {treatment === "pane" && k > 0.01
        ? h("div", { style: { position: "absolute", inset: 0, background: `linear-gradient(115deg, rgba(255,255,255,${0.14 * k}) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,${0.06 * k}) 62%, rgba(255,255,255,0) 100%), rgba(237,230,216,${0.1 * k})`, pointerEvents: "none" } })
        : null}
      {treatment === "frost" && k > 0.01
        ? h("div", { style: { position: "absolute", inset: 0, background: `rgba(237,230,216,${0.22 * k})`, backdropFilter: `blur(${(10 * k).toFixed(1)}px)`, pointerEvents: "none" } })
        : null}
      {/* Film grain stays faintly even when clear on the film treatment; it is the finish, not the effect. */}
      {h("div", { style: { position: "absolute", inset: 0, backgroundImage: `url(${GRAIN})`, opacity: treatment === "film" ? 0.25 + 0.45 * k : 0.35 * k, mixBlendMode: "overlay", pointerEvents: "none" } })}
      {k > 0.02 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, ${0.18 * k})` }]} /> : null}
      {children}
    </View>
  );
}
