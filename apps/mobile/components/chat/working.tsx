import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import type { Dandy } from "../../lib/dandy";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { radius, type, usePalette } from "../../lib/theme";
import { DandyAvatar } from "../dandy-avatar";
import { AgentDot, Glass, Icon } from "../lux";

/**
 * The Dandy at work: its mark breathing and three dots rising in turn, the way a person types. Replaces the plain
 * spinner while a reply is on its way and no step is running yet. Reduced motion holds everything still.
 */
export function Working({ dandy, label }: { dandy: Pick<Dandy, "name" | "shape" | "color">; label?: string }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const breathe = useRef(new Animated.Value(0)).current;
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
  const dots = useMemo(() => [a, b, c], [a, b, c]);

  useEffect(() => {
    if (reduced) {
      breathe.setValue(0.5);
      dots.forEach((d) => d.setValue(0.6));
      return;
    }
    const half = (v: Animated.Value, to: number, ms: number) => Animated.timing(v, { toValue: to, duration: ms, easing: ease.inOut, useNativeDriver: native });
    const pulse = Animated.loop(Animated.sequence([half(breathe, 1, 900), half(breathe, 0, 900)]));
    const wave = Animated.loop(
      Animated.stagger(
        150,
        dots.map((d) => Animated.sequence([half(d, 1, 260), half(d, 0, 260), Animated.delay(420)])),
      ),
    );
    pulse.start();
    wave.start();
    return () => {
      pulse.stop();
      wave.stop();
    };
  }, [reduced, breathe, dots]);

  return (
    <View accessible accessibilityLabel={label ? `${dandy.name}: ${label}` : `${dandy.name} is on it`} accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
      <Animated.View style={{ opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }), transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }] }}>
        <DandyAvatar dandy={dandy} size={26} />
      </Animated.View>
      <Glass intensity={30} style={{ height: 28, paddingHorizontal: 11, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 5 }}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: p.accentText,
              opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] }) }],
            }}
          />
        ))}
      </Glass>
      {label ? (
        <Text style={[type.footnote, { flexShrink: 1, color: p.ink3 }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export interface StepLine {
  id: string;
  text: string;
  state: "running" | "done";
}

function StepRow({ step }: { step: StepLine }) {
  const p = usePalette();
  const live = step.state === "running";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 22 }}>
      <View style={{ width: 14, alignItems: "center" }}>{live ? <AgentDot busy size={6} /> : <Icon name="check" size={12} color={p.accentText} />}</View>
      <Text style={[type.footnote, { flex: 1, color: live ? p.ink2 : p.ink3 }]}>{step.text}</Text>
    </View>
  );
}

/**
 * The Dandy's work for one reply. While the reply is on its way every step shows, the running one with a live dot;
 * once it's done the steps fold into one quiet line ("6 steps · Priced 5 running costs") that opens on a tap.
 */
export function WorkLog({ steps, live }: { steps: StepLine[]; live: boolean }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const running = steps.some((s) => s.state === "running");
  const last = steps[steps.length - 1];
  if (!last) return null;
  if (!live && !running && !open) {
    const n = steps.length;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Show the ${n} ${n === 1 ? "step" : "steps"} behind this`} accessibilityState={{ expanded: false }} onPress={() => setOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
        <View style={{ width: 14, alignItems: "center" }}>
          <Icon name="check" size={12} color={p.accentText} />
        </View>
        <Text style={[type.footnote, { flexShrink: 1, color: p.ink3 }]} numberOfLines={1}>
          {`${n} ${n === 1 ? "step" : "steps"} · ${last.text}`}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 6, paddingLeft: 10, borderLeftWidth: StyleSheet.hairlineWidth * 2, borderLeftColor: p.hair }}>
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
      {open && !live && !running ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: true }} onPress={() => setOpen(false)} hitSlop={8} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={[type.footnote, { color: p.ink3 }]}>Hide steps</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A reply written out word by word as it arrives. The words still to come are laid out in clear ink, so the line
 * never changes height while it writes and the chat can keep to the end in one move. Reduced motion, and lines
 * from a resumed conversation, show whole.
 */
export function StreamText({ text, fresh, style }: { text: string; fresh: boolean; style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const parts = useMemo(() => text.split(/(\s+)/), [text]);
  const total = parts.length;
  const [shown, setShown] = useState(fresh ? 0 : total);
  useEffect(() => {
    if (!fresh || reduced) return setShown(total);
    // About a second and a half for a long line, quicker for a short one, never a crawl.
    const per = Math.max(12, Math.min(38, 1500 / Math.max(1, total)));
    let i = 0;
    const timer = setInterval(() => {
      i += 2;
      setShown(Math.min(i, total));
      if (i >= total) clearInterval(timer);
    }, per * 2);
    return () => clearInterval(timer);
  }, [fresh, reduced, total]);
  const done = shown >= total;
  return (
    <Text style={style} accessibilityLabel={text}>
      {done ? text : parts.slice(0, shown).join("")}
      {done ? null : <Text style={{ color: "transparent" }}>{parts.slice(shown).join("")}</Text>}
    </Text>
  );
}
