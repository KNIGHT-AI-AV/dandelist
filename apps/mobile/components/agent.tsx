import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Image, Linking, Pressable, Text, View } from "react-native";
import { describeStep, hostOf, type PriceOption, type Step } from "../lib/agent";
import { formatCents } from "../lib/money";
import { fonts, radius, space, type, usePalette } from "../lib/theme";

export function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const p = usePalette();
  const body = (
    <View style={{ minHeight: 40, paddingHorizontal: space.md, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: selected ? p.accent : p.line, backgroundColor: selected ? p.accentSoft : "transparent" }}>
      <Text style={[type.small, { color: p.ink, fontSize: 14 }]}>{label}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      {body}
    </Pressable>
  );
}

export function Badge({ verified }: { verified: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 999, backgroundColor: verified ? p.accentSoft : p.glass, borderWidth: 1, borderColor: verified ? p.accent : p.line }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: verified ? p.accent : p.muted }} />
      <Text style={[type.label, { fontSize: 11, color: verified ? p.accent : p.muted, textTransform: "uppercase", letterSpacing: 1 }]}>{verified ? "Price checked" : "Estimate"}</Text>
    </View>
  );
}

function Pulse() {
  const p = usePalette();
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.3, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.accent, opacity: v }} />;
}

/** The agent's work, step by step: searches, pages opened, prices checked. */
export function Trail({ steps, working }: { steps: Step[]; working: boolean }) {
  const p = usePalette();
  return (
    <View accessibilityRole="list" accessibilityLabel="What the agent did" style={{ gap: 0 }}>
      {steps.map((s, i) => {
        const d = describeStep(s);
        const strong = s.type === "check" && s.verified;
        return (
          <View key={i} style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ alignItems: "center", width: 12 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: strong ? p.accent : p.muted }} />
              {i < steps.length - 1 || working ? <View style={{ flex: 1, width: 1, backgroundColor: p.line, marginVertical: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md }}>
              <Text style={[type.label, { color: strong ? p.accent : p.ink }]}>{d.verb}</Text>
              <Text style={[type.small, { color: p.muted }]} numberOfLines={2}>
                {d.detail}
              </Text>
            </View>
          </View>
        );
      })}
      {working ? (
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
          <View style={{ width: 12, alignItems: "center" }}>
            <Pulse />
          </View>
          <Text style={[type.small, { color: p.muted }]}>{steps.length ? "Working…" : "Starting the research…"}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Figure({ label, value, hint, big = false }: { label: string; value: string; hint?: string; big?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={[type.small, { color: p.muted }]}>{label}</Text>
        {hint ? <Text style={[type.small, { color: p.muted, fontSize: 12, opacity: 0.8 }]}>{hint}</Text> : null}
      </View>
      <Text style={{ fontFamily: fonts.figure, fontSize: big ? 26 : 16, color: p.ink, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

export function OptionCard({ option, years, selected, onSelect }: { option: PriceOption; years: number; selected: boolean; onSelect: () => void }) {
  const p = usePalette();
  const monthly = option.totals.monthlyCents;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${option.label} from ${option.seller}, ${formatCents(option.upfrontCents)} upfront`}
      onPress={onSelect}
      style={{ borderRadius: radius.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? p.accent : p.line, backgroundColor: p.glass, overflow: "hidden" }}
    >
      {option.imageUrl ? (
        <View style={{ height: 170, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" }}>
          <Image source={{ uri: option.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="contain" accessibilityIgnoresInvertColors />
        </View>
      ) : null}
      <View style={{ padding: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={[type.title, { fontSize: 20, lineHeight: 25, color: p.ink }]}>{option.label}</Text>
            <Text style={[type.small, { color: p.muted }]}>{`${option.seller} · ${hostOf(option.url)}`}</Text>
          </View>
          <Badge verified={option.status === "verified"} />
        </View>
        <Figure label="Upfront" value={formatCents(option.upfrontCents)} big />
        {monthly ? <Figure label="Every month" value={formatCents(monthly)} hint={option.recurring.map((r) => r.label).join(", ")} /> : null}
        <Figure label={`Over ${years} years`} value={formatCents(option.totals.horizonCents)} />
        <Figure label="Spread per month" value={formatCents(option.totals.spreadMonthlyCents)} hint="The total spread evenly. Not a bill." />
        {option.source.currency !== "USD" ? (
          <Text style={[type.small, { color: p.muted }]}>{`Listed at ${option.source.price.toLocaleString("en-US")} ${option.source.currency}, converted at ${option.source.rate} (${option.source.rateDate}).`}</Text>
        ) : null}
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(option.url)} hitSlop={8}>
          <Text style={[type.label, { color: p.accent }]}>Open the source page</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function Working({ label }: { label: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md }}>
      <ActivityIndicator color={p.accent} />
      <Text style={[type.body, { color: p.muted }]}>{label}</Text>
    </View>
  );
}
