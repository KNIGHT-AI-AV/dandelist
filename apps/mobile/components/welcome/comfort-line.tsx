import { Platform, Text, View, type StyleProp, type TextStyle } from "react-native";
import { LONGEST_LINE } from "../../lib/comfort";
import { fonts, type, usePalette } from "../../lib/theme";

/**
 * The line under the income saying how comfortably it carries the list. Centred under the figure it may wrap to two
 * lines rather than cut off: in the Money page's card on a 390-wide phone it read "You could comfortably afford …",
 * and that is the line the page opens on. The longest line sits invisibly underneath to hold the room, so the block is
 * as tall as that one needs at this width (one line where it fits, as before) and the fader below stays put while the
 * line changes. In the intro card's compact form, beside the face, it stays one line.
 */
export function ComfortLine({ line, compact = false }: { line: string; compact?: boolean }) {
  const p = usePalette();
  const style: StyleProp<TextStyle> = [compact ? type.callout : type.title3, { fontFamily: fonts.titleItalic, color: p.accentText, textAlign: compact ? "left" : "center" }];
  if (compact) {
    return (
      <Text accessibilityLiveRegion="polite" numberOfLines={1} style={style}>
        {line}
      </Text>
    );
  }
  return (
    <View style={{ alignSelf: "stretch", justifyContent: "center" }}>
      <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" numberOfLines={2} style={[style, { opacity: 0 }]}>
        {LONGEST_LINE}
      </Text>
      <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, justifyContent: "center" }}>
        {/* Two even lines, never one word left alone on the second. */}
        <Text accessibilityLiveRegion="polite" numberOfLines={2} lineBreakStrategyIOS="push-out" textBreakStrategy="balanced" style={[style, Platform.OS === "web" ? ({ textWrap: "balance" } as object) : null]}>
          {line}
        </Text>
      </View>
    </View>
  );
}
