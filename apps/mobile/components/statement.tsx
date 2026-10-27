import { equivalentMonthly, horizonCashOutlay, recurringBreakdown, type Item } from "@dandelist/cost";
import { Text, View } from "react-native";
import { formatCents } from "../lib/money";
import { fonts, radius, space, usePalette } from "../lib/theme";
import { Glass, Hairline, StatementRow } from "./lux";

export const HORIZON_YEARS = 5;

/** The price, set like a private bank statement. Every figure comes from the cost engine. */
export function Statement({ item, years = HORIZON_YEARS, monthlyHint }: { item: Item; years?: number; monthlyHint?: string }) {
  const monthly = recurringBreakdown([item]).perMonth;
  const total = horizonCashOutlay([item], years);
  return (
    <Glass style={{ borderRadius: radius.lg, padding: 18, gap: 12 }}>
      <StatementRow label="Upfront" value={formatCents(item.upfrontCents)} big />
      <Hairline />
      {monthly ? <StatementRow label="Every month" hint={monthlyHint || "Running costs you'd actually pay"} value={formatCents(monthly)} /> : null}
      <StatementRow label={`Over ${years} years`} hint="Everything you'd actually pay" value={formatCents(total)} />
      <StatementRow label="Spread per month" hint="The total spread evenly. Not a bill." value={formatCents(equivalentMonthly(total, years))} />
    </Glass>
  );
}

/** The agent's one-line view, in italic Bodoni beside a champagne rule. */
export function Take({ children }: { children: string }) {
  const p = usePalette();
  if (!children) return null;
  return (
    <View style={{ borderLeftWidth: 1.5, borderLeftColor: p.accent, paddingLeft: space.md }}>
      <Text style={{ fontFamily: fonts.displayItalic, fontSize: 17, lineHeight: 24, color: p.ink }}>{children}</Text>
    </View>
  );
}
