import { View, type DimensionValue } from "react-native";
import { Breathing } from "../lux";
import { layout, radius, type, useType } from "../../lib/theme";
import { CARD_GAP, cardHeight } from "./metrics";

/** The hero figure's line box is 1.18 times its size (components/odometer.tsx, `useLook`). */
const ODOMETER_LINE = 1.18;
/** Placeholder bars run about as long as the words they stand in for. */
const BAR: Record<"eyebrow" | "figure" | "line" | "link", DimensionValue> = { eyebrow: "40%", figure: "62%", line: "48%", link: "56%" };
/** The agent's note while it loads: padding, its label row and two lines of callout, as it most often reads. */
const NOTE_HEIGHT = 2 * layout.cardPad + type.eyebrow.lineHeight + layout.stack.tight + 2 * type.callout.lineHeight;

/**
 * The wish list while it loads, built from the real layout's measurements: the hero (label, figure, running cost,
 * the plan link), the agent's note and the first three cards in their two-tall-one-short rhythm. Drawn over the
 * content area, so when the wishes arrive they cross-fade in where the placeholders stood.
 */
export function ListSkeleton() {
  const t = useType();
  const figure = Math.round((t.hero.fontSize ?? type.hero.fontSize) * ODOMETER_LINE);
  const bar = (height: number, width: DimensionValue) => <Breathing style={{ height, width, borderRadius: radius.xs }} />;
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ paddingTop: layout.stack.section, gap: layout.stack.tight }}>
        {bar(type.eyebrow.lineHeight, BAR.eyebrow)}
        {bar(figure, BAR.figure)}
        {bar(type.footnote.lineHeight, BAR.line)}
        <View style={{ minHeight: layout.control.chip, justifyContent: "center" }}>{bar(type.label.lineHeight, BAR.link)}</View>
      </View>
      <Breathing style={{ marginTop: layout.stack.base, height: NOTE_HEIGHT, borderRadius: radius.md }} />
      <View style={{ marginTop: layout.stack.base }}>
        {[0, 1, 2].map((slot) => (
          <Breathing key={slot} style={{ height: cardHeight(slot), marginBottom: CARD_GAP, borderRadius: radius.lg, borderCurve: "continuous" }} />
        ))}
      </View>
    </View>
  );
}
