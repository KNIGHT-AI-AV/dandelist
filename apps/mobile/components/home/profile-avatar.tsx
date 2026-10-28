import { Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { type, usePalette } from "../../lib/theme";

/** The signed-in person in a small disc: their initial for now; settings adds the picture they choose. */
export function ProfileAvatar({ size }: { size: number }) {
  const p = usePalette();
  const auth = useAuth();
  const initial = (auth.user?.email ?? "·").slice(0, 1).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Text style={[type.label, { color: p.ink2 }]}>{initial}</Text>
    </View>
  );
}
