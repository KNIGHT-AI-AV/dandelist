import { equivalentMonthly, horizonCashOutlay, recurringBreakdown, type Item } from "@dandelist/cost";
import { Text, View } from "react-native";
import { fonts, layout, radius, type, usePalette } from "../lib/theme";
import { Glass, Hairline, StatementRow } from "./lux";

export const HORIZON_YEARS = 5;

/**
 * The price, set like a private bank statement. Every figure comes from the cost engine. Something priceless
 * (lib/worth.ts) has one line, infinity, and nothing to add up over the years.
 */
export function Statement({ item, years = HORIZON_YEARS, monthlyHint, priceless = false }: { item: Item; years?: number; monthlyHint?: string; priceless?: boolean }) {
  const monthly = recurringBreakdown([item]).perMonth;
  const total = horizonCashOutlay([item], years);
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
      <StatementRow label={`Over ${years} years`} hint="Everything you'd actually pay" cents={total} />
      <StatementRow label="Spread per month" hint="The total spread evenly. Not a bill." cents={equivalentMonthly(total, years)} />
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
