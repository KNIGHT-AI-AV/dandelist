import { useMemo } from "react";
import { Text, View } from "react-native";
import { useMoney } from "../lib/currency";
import { useReducedMotion } from "../lib/motion";
import { fonts, layout, type, usePalette } from "../lib/theme";
import type { Wish } from "../lib/wishes";
import { INFINITY, amountMarks, amountSteps, worthOf } from "../lib/worth";
import { Fader } from "./fader";
import { Eyebrow } from "./lux";
import { Odometer } from "./odometer";

/** The glyph for a wish with no photo (lux.tsx GlyphPanel): infinity, the currency's sign, or its own first letter. */
export function glyphFor(worth: "money" | "priceless" | "priced" | undefined, title: string, currencySymbol: string): string {
  if (worth === "priceless") return INFINITY;
  if (worth === "money") return currencySymbol;
  return (title.trim().replace(/^(a|an|the)\s+/i, "")[0] ?? "").toUpperCase() || INFINITY;
}

/** The panel's glyph for a saved wish no shop prices; none for the rest, which keep the quiet gradient. */
export function savedGlyph(w: Pick<Wish, "name" | "details">, currencySymbol: string): string | undefined {
  const worth = worthOf(w);
  return worth ? glyphFor(worth, w.name, currencySymbol) : undefined;
}

/**
 * A money wish's price is the person's to pick (owner, 2026-10-30: "for money spawn a slider for people to say how
 * much money!"): "How much?", the amount rolling on the odometer, and the fader from about 1,000 to 100 million of the
 * shown currency, on round stops with 10K, 100K, 1M and 10M marked. It starts where the wish named an amount.
 */
export function AmountPicker({ cents, namedCents, onChange, size = 40 }: { cents: number; namedCents?: number; onChange(cents: number): void; size?: number }) {
  const money = useMoney();
  const reduced = useReducedMotion();
  const steps = useMemo(() => amountSteps(money.rate, money.unit, namedCents), [money.rate, money.unit, namedCents]);
  const marks = useMemo(() => amountMarks(steps, money.rate), [steps, money.rate]);
  return (
    <View style={{ gap: layout.stack.tight }}>
      <Eyebrow>How much?</Eyebrow>
      <Odometer cents={cents} format={money.format} size={size} family="bodoni" smallPrefix tracking={-0.02 * size} mode={reduced ? "instant" : "ui"} />
      <Fader
        value={cents}
        steps={steps}
        onChange={onChange}
        label="How much money"
        valueText={money.format(cents)}
        labels={marks.map((c) => ({ cents: c, text: money.compact(c) }))}
        firm={(_from, to) => marks.includes(to)}
      />
    </View>
  );
}

/** A priceless wish's price: infinity in the card's price role, and the Dandy's line for it in italic. */
export function PricelessPrice({ line, align = "left" }: { line?: string; align?: "left" | "center" }) {
  const p = usePalette();
  return (
    <View style={{ gap: 4, alignItems: align === "center" ? "center" : "flex-start" }}>
      <Text accessibilityLabel="Priceless" style={[type.cardPrice, { color: p.ink }]}>
        {INFINITY}
      </Text>
      {line ? <Text style={[type.callout, { fontFamily: fonts.titleItalic, color: p.accentText, textAlign: align }]}>{line}</Text> : null}
    </View>
  );
}
