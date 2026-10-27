import { Text, View } from "react-native";
import type { Step } from "../lib/agent";
import { formatCents } from "../lib/money";
import { type, usePalette } from "../lib/theme";
import { hostOf } from "../lib/words";
import { AgentDot, Hairline } from "./lux";

/** One line per agent step: verb and detail, and a figure where the step produced one. */
function describe(s: Step): { verb: string; detail: string; value: string; strong: boolean } {
  switch (s.type) {
    case "search":
      return { verb: "Searched", detail: s.query, value: "", strong: false };
    case "open":
      return { verb: s.ok ? "Opened" : "Couldn't open", detail: hostOf(s.url), value: "", strong: false };
    case "fx":
      return { verb: "Converted", detail: `${s.from} to ${s.to}`, value: s.rate ? s.rate.toFixed(4) : "", strong: false };
    case "check":
      return { verb: s.verified ? "Checked" : "Couldn't confirm", detail: hostOf(s.url), value: s.verified ? "on page" : "estimate", strong: s.verified };
    case "price":
      return { verb: "Priced", detail: s.label, value: s.upfrontCents != null ? formatCents(s.upfrontCents) : "", strong: true };
    case "explain":
      return { verb: "Summing up", detail: "comparing the options", value: "", strong: false };
    case "note":
      return { verb: "Note", detail: s.text, value: "", strong: false };
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The agent's trail as a timed ledger, like a statement being written line by line. */
export function Ledger({ steps, startedAt, working }: { steps: Step[]; startedAt: string; working: boolean }) {
  const p = usePalette();
  const t0 = new Date(startedAt).getTime();
  return (
    <View accessibilityRole="list" accessibilityLabel="What the agent did">
      {steps.map((s, i) => {
        const d = describe(s);
        return (
          <View key={i}>
            <Hairline />
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 11 }}>
              <Text style={[type.figure, { width: 44, color: p.ink3 }]}>{clock(new Date(s.at).getTime() - t0)}</Text>
              <Text style={[type.footnote, { flex: 1, color: p.ink }]} numberOfLines={2}>
                {d.verb} <Text style={{ color: p.ink2 }}>{d.detail}</Text>
              </Text>
              {d.value ? <Text style={[type.figure, { color: d.strong ? p.accentText : p.ink2 }]}>{d.value}</Text> : null}
            </View>
          </View>
        );
      })}
      {working ? (
        <View>
          <Hairline />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 }}>
            <View style={{ width: 44 }}>
              <AgentDot busy />
            </View>
            <Text style={[type.footnote, { color: p.ink2 }]}>{steps.length ? "Working..." : "Starting the research..."}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
