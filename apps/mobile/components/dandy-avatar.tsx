import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colorOf, type Dandy, type ShapeId } from "../lib/dandy";
import { fonts } from "../lib/theme";

/** The outline of each shape at a size: corner radii, and a turn for the diamond. */
function shapeStyle(shape: ShapeId, size: number): ViewStyle {
  switch (shape) {
    case "square":
      return { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.24, borderCurve: "continuous" };
    case "diamond":
      return { width: size * 0.72, height: size * 0.72, borderRadius: size * 0.12, transform: [{ rotate: "45deg" }] };
    case "capsule":
      return { width: size * 0.62, height: size, borderRadius: size };
    case "leaf":
      return { width: size * 0.9, height: size * 0.9, borderTopLeftRadius: size * 0.9, borderBottomRightRadius: size * 0.9, borderTopRightRadius: size * 0.12, borderBottomLeftRadius: size * 0.12 };
    default:
      return { width: size, height: size, borderRadius: size / 2 };
  }
}

/** A Dandy's mark: its shape filled with its colour, its initial set in the house serif on top. */
export function DandyAvatar({ dandy, size = 36, style }: { dandy: Pick<Dandy, "name" | "shape" | "color">; size?: number; style?: StyleProp<ViewStyle> }) {
  const c = colorOf(dandy);
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[shapeStyle(dandy.shape, size), { backgroundColor: c.hex, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" } as ViewStyle]} />
      <Text style={{ position: "absolute", fontFamily: fonts.title, fontSize: size * 0.52, lineHeight: size * 0.62, color: c.light ? "#16130E" : "#F2EBDC" }}>{dandy.name.trim().charAt(0).toUpperCase() || "D"}</Text>
    </View>
  );
}
