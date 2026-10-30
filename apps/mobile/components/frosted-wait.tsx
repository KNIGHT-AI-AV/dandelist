import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { usePalette } from "../lib/theme";
import { Glass } from "./lux";
import { WaitingLight } from "./waiting-light";

const BACKDROP = require("../assets/backdrop.jpg");

/**
 * Where a card's photo is still coming, or never came (owner, 2026-10-30: "we should have a loading image hidden behind
 * a blurred glass that has like some soft, slowly moving animation on top instead of putting the broken first letter
 * with the cut off graphic"): a picture blurred well past recognition under frosted glass, the thing's own when one is
 * in hand (the candidate being hunted), else the house backdrop, with the waiting light crossing it while the hunt still
 * looks. The real photo lands over it. The picture is drawn a little larger than the frame, and the frame clips it, so
 * its blurred edges fall outside and nothing spills under the card's words.
 */
export function FrostedWait({ uri, active }: { uri?: string | null; active: boolean }) {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={uri ? { uri } : BACKDROP} style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.25 }] }]} contentFit="cover" blurRadius={36} accessibilityIgnoresInvertColors />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, 0.38)` }]} />
      <Glass intensity={40} style={[StyleSheet.absoluteFill, { borderRadius: 0, borderWidth: 0 }]} />
      <WaitingLight active={active} />
    </View>
  );
}
