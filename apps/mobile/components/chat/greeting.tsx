import { useEffect, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { personaOf, type Dandy } from "../../lib/dandy";
import { greeting } from "../../lib/dream";
import { usePress } from "../../lib/motion";
import { fonts, layout, radius, type, usePalette, useType } from "../../lib/theme";
import { DandyAvatar } from "../dandy-avatar";
import { AgentDot, Eyebrow, Glass } from "../lux";
import { Rise } from "../welcome/kit";

/** The hour, kept current while the chat sits open, so "Good morning" turns into "Good afternoon" on its own. */
function useHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);
  return hour;
}

/** One suggestion: the words they'd say, a tap away. Full width, so a longer one wraps instead of being cut. */
function Suggestion({ label, onPress, delay }: { label: string; onPress(): void; delay: number }) {
  const p = usePalette();
  const press = usePress(0.98);
  return (
    <Rise delay={delay}>
      <Pressable accessibilityRole="button" accessibilityHint="Sends this to your Dandy" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <Animated.View style={{ transform: [{ scale: press.scale }] }}>
          <Glass intensity={30} style={{ minHeight: layout.control.chip, borderRadius: radius.control, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <AgentDot size={6} />
            <Text style={[type.callout, { flex: 1, color: p.ink }]}>{label}</Text>
          </Glass>
        </Animated.View>
      </Pressable>
    </Rise>
  );
}

/**
 * An empty chat: the Dandy's mark and name, a greeting for the time of day in its personality, and three fresh
 * suggestions from what it knows about them (lib/suggestions). Tapping one sends it.
 */
export function Greeting({ dandy, items, loading, onPick }: { dandy: Dandy; items: string[]; loading: boolean; onPick(text: string): void }) {
  const p = usePalette();
  const t = useType();
  const hour = useHour();
  const g = greeting(dandy.persona, hour, dandy.name);
  return (
    <Rise style={{ gap: 20, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <DandyAvatar dandy={dandy} size={44} />
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Eyebrow color={p.accentText}>{dandy.name}</Eyebrow>
          <Text style={[type.footnote, { color: p.ink3 }]}>{personaOf(dandy).name}</Text>
        </View>
      </View>
      <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
        {g.hello}
        {"\n"}
        <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>{g.ask}</Text>
      </Text>
      <Text style={[type.callout, { color: p.ink2 }]}>{g.intro}</Text>
      <View style={{ gap: 10 }}>
        {items.length
          ? items.map((s, i) => <Suggestion key={s} label={s} delay={80 + i * 60} onPress={() => onPick(s)} />)
          : loading
            ? [0, 1, 2].map((i) => <View key={i} accessibilityElementsHidden style={{ height: layout.control.chip, borderRadius: radius.control, backgroundColor: p.track, opacity: 0.7 - i * 0.15 }} />)
            : null}
      </View>
    </Rise>
  );
}
