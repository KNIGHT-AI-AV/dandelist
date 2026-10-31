import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colorOf, type Dandy, type ShapeId } from "../lib/dandy";
import { fonts } from "../lib/theme";

/** One soft-cornered family on a 64-unit canvas. The inset leaves room for the shallow shadow. */
const SHAPE_PATHS: Record<ShapeId, string> = {
  circle: "M32 4 A28 28 0 1 1 32 60 A28 28 0 1 1 32 4 Z",
  square: "M19 7 H45 Q57 7 57 19 V45 Q57 57 45 57 H19 Q7 57 7 45 V19 Q7 7 19 7 Z",
  diamond: "M28.5 4.5 Q32 1 35.5 4.5 L59.5 28.5 Q63 32 59.5 35.5 L35.5 59.5 Q32 63 28.5 59.5 L4.5 35.5 Q1 32 4.5 28.5 Z",
  capsule: "M32 3 A17 17 0 0 1 49 20 V44 A17 17 0 0 1 15 44 V20 A17 17 0 0 1 32 3 Z",
  triangle: "M28.5 6 Q32 0 35.5 6 L60.5 49.5 Q64 56 56.5 56 H7.5 Q0 56 3.5 49.5 Z",
};

/** The same vector geometry and fill path everywhere, including the triangle: no bitmap tint/filter dependency. */
export function DandyAvatar({ dandy, size = 36, style }: { dandy: Pick<Dandy, "name" | "shape" | "color">; size?: number; style?: StyleProp<ViewStyle> }) {
  const c = colorOf(dandy);
  const triangle = dandy.shape === "triangle";
  const path = Object.prototype.hasOwnProperty.call(SHAPE_PATHS, dandy.shape) ? SHAPE_PATHS[dandy.shape] : SHAPE_PATHS.circle;
  const lineHeight = size * 0.6;
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path d={path} fill="#000000" opacity={0.22} transform="translate(0 1.5)" />
        <Path d={path} fill={c.hex} />
      </Svg>
      <Text style={{ position: "absolute", width: size, top: (size - lineHeight) / 2 + (triangle ? size * 0.1 : 0), textAlign: "center", fontFamily: fonts.title, fontSize: size * (triangle ? 0.38 : 0.47), lineHeight, color: c.light ? "#16130E" : "#F2EBDC" }}>{dandy.name.trim().charAt(0).toUpperCase() || "D"}</Text>
    </View>
  );
}
