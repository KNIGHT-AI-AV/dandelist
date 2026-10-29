import { Text, View } from "react-native";
import type { Facts } from "../../lib/profile";
import { fonts, radius, type, usePalette } from "../../lib/theme";
import { AgentDot, Chip, ErrorLine, Glass } from "../lux";

const written = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `Written ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
};

/**
 * Three short lines the Dandy has noticed about the list (owner's walkthrough, 2026-10-28: "3 lines of facts about
 * you"). They come only from the list and the place they'd live, are kept until asked for again, and "New facts"
 * writes a fresh set.
 */
export function FactsCard({ facts, loading, busy, error, dandyName, onNew }: { facts: Facts | null; loading: boolean; busy: boolean; error: string | null; dandyName: string; onNew(): void }) {
  const p = usePalette();
  const lines = facts?.lines ?? [];
  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: 20, gap: 16 }}>
      {busy ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 }} accessibilityLiveRegion="polite">
          <AgentDot busy />
          <Text style={[type.callout, { color: p.ink2 }]}>{`${dandyName} is reading your list`}</Text>
        </View>
      ) : lines.length ? (
        <View style={{ gap: 14 }} accessibilityRole="list">
          {lines.map((line, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12 }} accessibilityRole="text">
              <Text style={[type.figure13, { color: p.accentText, width: 18, paddingTop: 4 }]}>{`0${i + 1}`}</Text>
              <Text style={[type.title3, { flex: 1, color: p.ink, fontFamily: fonts.titleItalic }]}>{line}</Text>
            </View>
          ))}
        </View>
      ) : loading ? null : (
        <Text style={[type.callout, { color: p.ink2 }]}>{`Ask ${dandyName} for three things it has noticed about your list.`}</Text>
      )}
      <ErrorLine>{error}</ErrorLine>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={[type.footnote, { color: p.ink3, flexShrink: 1 }]}>{busy ? "" : (written(facts?.generatedAt ?? null) ?? "")}</Text>
        <Chip label={lines.length ? "New facts" : `Ask ${dandyName}`} onPress={busy ? undefined : onNew} />
      </View>
    </Glass>
  );
}
