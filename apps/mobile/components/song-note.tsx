import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { type, usePalette, type ThemeId } from "../lib/theme";
import { THEME_SONGS } from "../lib/theme-songs";
import { Icon } from "./lux";

/**
 * A theme's song, hinted at (owner, 2026-10-30: "a little tiny music note icon somewhere on the bottom, small print with
 * the name that we give the song so that ... it's like a little hint that the theme contains a different song, but we
 * don't directly say it"): the note and the name in the smallest print, in the theme's quietest ink, and nothing else.
 */
export function SongNote({ id, align = "center", style }: { id: ThemeId; align?: "center" | "end"; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: align === "end" ? "flex-end" : "center", maxWidth: "100%" }, style]}>
      <Icon name="music" size={12} color={p.ink3} />
      <Text style={[type.footnote, { color: p.ink3, flexShrink: 1 }]} numberOfLines={1}>
        {THEME_SONGS[id].name}
      </Text>
    </View>
  );
}
