import { equivalentMonthly, horizonCashOutlay, recurringBreakdown, type Item } from "@dandelist/cost";
import { useState } from "react";
import { Text, View } from "react-native";
import { fonts, layout, radius, type, usePalette } from "../lib/theme";
import { DEFAULT_TIMELINE_MONTHS, TIMELINE_LABELS, TIMELINE_MONTHS, firmTimelineStep, timelineWords } from "../lib/timeline";
import { Fader } from "./fader";
import { Glass, Hairline, StatementRow } from "./lux";

export const HORIZON_YEARS = 5;

/**
 * The price, set like a private bank statement. Every figure comes from the cost engine. Something priceless
 * (lib/worth.ts) has one line, infinity, and nothing to add up over the years. With `timeline` (the wish page), a bar
 * sets over how long instead of a fixed `years` (owner, 2026-10-31), and the statement shows what that takes each
 * month (lib/timeline.ts).
 */
export function Statement({ item, years = HORIZON_YEARS, monthlyHint, priceless = false, timeline = false }: { item: Item; years?: number; monthlyHint?: string; priceless?: boolean; timeline?: boolean }) {
  const p = usePalette();
  const [months, setMonths] = useState(DEFAULT_TIMELINE_MONTHS);
  const span = timeline ? months / 12 : years;
  const spanWords = timeline ? timelineWords(months) : `${years} years`;
  const monthly = recurringBreakdown([item]).perMonth;
  const total = horizonCashOutlay([item], span);
  if (priceless) {
    return (
      <Glass style={{ borderRadius: radius.lg, padding: layout.cardPad, gap: 12 }}>
        <StatementRow label="Upfront" cents={0} priceless big />
      </Glass>
    );
  }
  return (
    <Glass style={{ borderRadius: radius.lg, padding: layout.cardPad, gap: 12 }}>
      <StatementRow label="Upfront" cents={item.upfrontCents} big />
      <Hairline />
      {monthly ? <StatementRow label="Every month" hint={monthlyHint || "Running costs you'd actually pay"} cents={monthly} /> : null}
      {timeline ? (
        <View style={{ gap: layout.stack.tight }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={[type.label, { color: p.ink2 }]}>Timeline</Text>
            <Text style={[type.figure, { color: p.ink }]}>{spanWords}</Text>
          </View>
          <Fader value={months} steps={TIMELINE_MONTHS} onChange={setMonths} label="Timeline" valueText={spanWords} labels={[...TIMELINE_LABELS]} firm={firmTimelineStep} />
        </View>
      ) : null}
      <StatementRow label={`Over ${spanWords}`} hint="Everything you'd actually pay" cents={total} />
      {timeline ? (
        <StatementRow label="Save each month" hint={`To cover everything in ${spanWords}`} cents={equivalentMonthly(total, span)} />
      ) : (
        <StatementRow label="Spread per month" hint="The total spread evenly. Not a bill." cents={equivalentMonthly(total, years)} />
      )}
    </Glass>
  );
}

/** The agent's one-line view, in italic Bodoni beside a champagne rule. */
export function Take({ children }: { children: string }) {
  const p = usePalette();
  if (!children) return null;
  return (
    <View style={{ borderLeftWidth: 1.5, borderLeftColor: p.accent, paddingLeft: 12 }}>
      <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]}>{children}</Text>
    </View>
  );
}
