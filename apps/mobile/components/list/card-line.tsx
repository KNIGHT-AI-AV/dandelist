import { Text, View } from "react-native";
import { useMoney } from "../../lib/currency";
import { space, type, usePalette } from "../../lib/theme";
import type { Wish } from "../../lib/wishes";
import { agentLine } from "../../lib/words";
import { AgentDot } from "../lux";

/**
 * The line under a card's name: where the price came from, then what the wish costs each month. When the line is too
 * long, its first part gives way and the monthly figure stays whole (owner's screenshot, 2026-11-01: "+ $1,10…" for
 * $1,105 a month). The list's card and its copy in the quick actions both use it, so both show the same figure in the
 * person's currency.
 */
export function CardLine({ w, monthlyCents }: { w: Wish; monthlyCents: number }) {
  const p = usePalette();
  const money = useMoney();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[8], flexShrink: 1 }}>
      {w.details.agent ? <AgentDot /> : null}
      <View style={{ flexDirection: "row", flexShrink: 1 }}>
        <Text style={[type.footnote, { color: p.ink2, flexShrink: 1 }]} numberOfLines={1}>
          {agentLine(w)}
        </Text>
        {monthlyCents ? (
          <Text style={[type.footnote, { color: p.ink2, flexShrink: 0 }]} numberOfLines={1}>
            {` · + ${money.format(monthlyCents)}/mo`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
