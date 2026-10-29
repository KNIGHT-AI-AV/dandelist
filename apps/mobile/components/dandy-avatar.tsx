import { Image, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colorOf, type Dandy, type ShapeId } from "../lib/dandy";
import { fonts } from "../lib/theme";

/** A rounded equilateral triangle, white on clear, tinted to the Dandy's colour (assets/shapes, drawn with PIL). */
const TRIANGLE = require("../assets/shapes/triangle.png");

/** The outline of each shape at a size: corner radii, and a turn for the diamond. */
function shapeStyle(shape: ShapeId, size: number): ViewStyle {
  switch (shape) {
    case "square":
      return { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.24, borderCurve: "continuous" };
    case "diamond":
      return { width: size * 0.72, height: size * 0.72, borderRadius: size * 0.12, transform: [{ rotate: "45deg" }] };
    case "capsule":
      return { width: size * 0.62, height: size, borderRadius: size };
    default:
      return { width: size, height: size, borderRadius: size / 2 };
  }
}

/** A Dandy's mark: its shape filled with its colour, its initial set in the house serif on top. */
export function DandyAvatar({ dandy, size = 36, style }: { dandy: Pick<Dandy, "name" | "shape" | "color">; size?: number; style?: StyleProp<ViewStyle> }) {
  const c = colorOf(dandy);
  const triangle = dandy.shape === "triangle";
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {triangle ? (
        <>
          {/* The same soft shadow as the other shapes, from a blurred dark copy of the triangle. */}
          <Image source={TRIANGLE} blurRadius={3} style={{ position: "absolute", width: size, height: size, top: 2, tintColor: "rgba(0,0,0,0.35)" }} />
          <Image source={TRIANGLE} style={{ width: size, height: size, tintColor: c.hex }} />
        </>
      ) : (
        <View style={[shapeStyle(dandy.shape, size), { backgroundColor: c.hex, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" } as ViewStyle]} />
      )}
      {/* The triangle's middle sits low, so its initial is smaller and set lower. */}
      <Text style={{ position: "absolute", fontFamily: fonts.title, fontSize: size * (triangle ? 0.4 : 0.52), lineHeight: size * (triangle ? 0.5 : 0.62), marginTop: triangle ? size * 0.12 : 0, color: c.light ? "#16130E" : "#F2EBDC" }}>{dandy.name.trim().charAt(0).toUpperCase() || "D"}</Text>
    </View>
  );
}
