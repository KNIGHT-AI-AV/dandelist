import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { native, useReducedMotion } from "../lib/motion";
import { fonts, usePalette } from "../lib/theme";

/**
 * Money that rolls like a mechanical odometer. Each digit is a wheel of 0–9 repeated; when the figure changes, every
 * digit from the first one that changed spins at least one full turn (the last two spin twice), settling left to right
 * on a 45 ms stagger with an expo-out curve. While a wheel is fast, two ghost copies trail it and it stretches a touch,
 * which reads as motion blur; on the web it also gets a real blur. Unchanged digits stay still. Reduced motion shows
 * the new figure at once.
 */

const CYCLES = 5;
// One Text node per wheel: digits stacked one per line, so a wheel is cheap however many turns it makes.
const COLUMN = Array.from({ length: CYCLES * 10 }, (_, i) => String(i % 10)).join("\n");
const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export function Odometer({ value, size = 22, family = fonts.figure, color, style }: { value: string; size?: number; family?: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const line = Math.round(size * 1.18);
  const chars = value.split("");
  const previous = useRef(value);
  const [, force] = useState(0);
  const text: TextStyle = { fontFamily: family, fontSize: size, lineHeight: line, color: color ?? p.ink, fontVariant: ["tabular-nums", "lining-nums"], includeFontPadding: false };

  // Which digits roll: everything right of (and including) the first digit that differs, aligned from the right.
  const before = previous.current.padStart(value.length, " ");
  let firstChange = chars.findIndex((c, i) => c !== before[i]);
  if (firstChange < 0) firstChange = chars.length;
  useEffect(() => {
    previous.current = value;
    force((n) => n + 1);
  }, [value]);

  const digitIndexes = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  return (
    <View style={[{ flexDirection: "row", height: line, overflow: "hidden" }, style]} accessible accessibilityRole="text" accessibilityLabel={value}>
      {chars.map((c, i) => {
        const key = `${chars.length - i}`;
        if (!/\d/.test(c)) return <Text key={key} style={text}>{c}</Text>;
        const order = digitIndexes.indexOf(i);
        const fromRight = digitIndexes.length - 1 - order;
        return <Wheel key={key} digit={Number(c)} line={line} text={text} roll={i >= firstChange} order={Math.max(0, order - digitIndexes.findIndex((d) => d >= firstChange))} spins={fromRight <= 1 ? 2 : 1} />;
      })}
    </View>
  );
}

function Wheel({ digit, line, text, roll, order, spins }: { digit: number; line: number; text: TextStyle; roll: boolean; order: number; spins: number }) {
  const reduced = useReducedMotion();
  const pos = useRef(10 + digit);
  const y = useRef(new Animated.Value(-(10 + digit) * line)).current;
  const speed = useRef(new Animated.Value(0)).current;
  const [spinning, setSpinning] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const rest = 10 + digit;
    if (reduced || !roll) {
      pos.current = rest;
      y.setValue(-rest * line);
      return;
    }
    const from = pos.current;
    let to = from - (from % 10) + 10 * spins + digit;
    if (to <= from) to += 10;
    const duration = 820 + 70 * order;
    const delay = 45 * order;
    setSpinning(true);
    const anim = Animated.parallel([
      Animated.timing(y, { toValue: -to * line, duration, delay, easing: EXPO_OUT, useNativeDriver: native }),
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(speed, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(speed, { toValue: 0, duration: duration - 110, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: native }),
      ]),
    ]);
    anim.start(({ finished }) => {
      // Re-centre on the same glyph one cycle in, so the next roll always has room to spin forward.
      pos.current = rest;
      y.setValue(-rest * line);
      if (finished) setSpinning(false);
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digit]);

  const ghost = (offset: number) => (
    <Animated.Text
      style={[
        text,
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: speed.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] }),
          transform: [{ translateY: Animated.add(y, new Animated.Value(offset * line)) }],
        },
      ]}
    >
      {COLUMN}
    </Animated.Text>
  );

  const webBlur = Platform.OS === "web" && spinning ? ({ filter: speed.interpolate({ inputRange: [0, 1], outputRange: ["blur(0px)", "blur(1.3px)"] }) } as object) : null;

  return (
    <Animated.View style={{ height: line, overflow: "hidden", transform: [{ scaleY: speed.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }] }}>
      {spinning ? ghost(-0.35) : null}
      {spinning ? ghost(0.35) : null}
      <Animated.Text style={[text, { textAlign: "center", opacity: speed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }), transform: [{ translateY: y }] }, webBlur]}>{COLUMN}</Animated.Text>
    </Animated.View>
  );
}
