import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { ease, haptic, native, spring, step, useReducedMotion } from "../../lib/motion";
import { layout, radius, type, usePalette } from "../../lib/theme";
import { FieldError, Ring, useToggle } from "./field";
import { CODE_LENGTH, nextCode } from "./logic";
import { useReveal } from "./reveal";
import { CARET, CHECKING_LOW, CLEAR_MS, CODE_BOX, DIGIT, HIDDEN_INPUT_OPACITY, SHAKE } from "./tokens";

export interface CodeFieldHandle {
  focus(): void;
  /** A wrong code: the error haptic, a damped shake (colour only under reduced motion), the digits fade and clear, focus stays. */
  reject(): void;
}

export interface CodeFieldProps {
  value: string;
  onChange(code: string): void;
  /** Called once when the sixth digit lands, typed, pasted or autofilled. */
  onComplete(code: string): void;
  /** The code is being checked: keystrokes wait and the digits breathe. */
  busy?: boolean;
  /** What went wrong, shown under the boxes; the boxes turn `danger` while it shows. */
  error?: string | null;
  autoFocus?: boolean;
  /** Read by screen readers. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** The code caret: a bar in the accent that breathes; steady under reduced motion. */
function Caret() {
  const p = usePalette();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: CARET.low, duration: CARET.halfMs, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: CARET.halfMs, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return <Animated.View style={{ width: CARET.width, height: CARET.height, borderRadius: CARET.width / 2, backgroundColor: p.accentText, opacity: v }} />;
}

/** One digit landing: it fades in and settles from a touch smaller on spring.snap; a paste lands them in a quick run. */
function Digit({ d, delay }: { d: string; delay: number }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(reduced ? 1 : DIGIT.fromScale)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: DIGIT.fadeMs, delay, easing: ease.out, useNativeDriver: native }).start();
    if (!reduced) Animated.spring(scale, { toValue: 1, delay, ...spring.snap, useNativeDriver: native }).start();
    // A digit lands once, when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.Text style={[type.title2, { color: p.ink, fontVariant: ["tabular-nums"], opacity: fade, transform: [{ scale }] }]}>{d}</Animated.Text>;
}

/** One slot: a hairline box whose border warms to ink when the caret is in it, and turns `danger` on an error. */
function Slot({ active, bad, children }: { active: boolean; bad: Animated.Value; children?: ReactNode }) {
  const p = usePalette();
  const ring = useToggle(active);
  return (
    <View style={{ flex: 1, height: CODE_BOX, alignItems: "center", justifyContent: "center" }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: p.line, backgroundColor: p.glassTint }]} />
      <Ring color={p.ink} opacity={ring} />
      <Ring color={p.danger} opacity={bad} />
      {children}
    </View>
  );
}

/**
 * A six-digit code that reads as six boxes but is one real input underneath, so paste, one-time-code autofill
 * (iOS QuickType, Android SMS) and screen readers all work. The caret's box is highlighted and breathes, digits
 * land as they're typed, and the sixth digit submits. `reject()` shakes, clears and keeps focus.
 */
export const CodeField = forwardRef<CodeFieldHandle, CodeFieldProps>(function CodeField({ value, onChange, onComplete, busy = false, error, autoFocus, label = "Six-digit code", style }, ref) {
  const reduced = useReducedMotion();
  const reveal = useReveal();
  const input = useRef<TextInput>(null);
  const box = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const clearing = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(1)).current;
  const digits = useMemo(() => Animated.multiply(clearing, breath), [clearing, breath]);
  const bad = useToggle(!!error);
  const latest = useRef(onChange);
  latest.current = onChange;

  // Digits that arrive together (a paste, autofill) land in a quick run instead of all at once.
  const shownBefore = useRef(value.length);
  const from = shownBefore.current;
  useEffect(() => {
    shownBefore.current = value.length;
  }, [value.length]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      reject: () => {
        haptic.error();
        if (!reduced) Animated.spring(shake, { toValue: 0, ...SHAKE, useNativeDriver: native }).start();
        Animated.timing(clearing, { toValue: 0, duration: CLEAR_MS, easing: ease.out, useNativeDriver: native }).start(() => {
          latest.current("");
          clearing.setValue(1);
        });
        input.current?.focus();
      },
    }),
    [reduced, shake, clearing],
  );

  // While the code is checked the digits breathe; they come back to full quickly when it's done.
  useEffect(() => {
    if (!busy || reduced) {
      Animated.timing(breath, { toValue: 1, duration: CLEAR_MS, easing: ease.out, useNativeDriver: native }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: CHECKING_LOW, duration: CARET.halfMs, easing: ease.inOut, useNativeDriver: native }),
        Animated.timing(breath, { toValue: 1, duration: CARET.halfMs, easing: ease.inOut, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reduced, breath]);

  const at = value.length < CODE_LENGTH ? value.length : -1;
  return (
    <View ref={box} collapsable={false} style={style}>
      <Animated.View style={{ transform: [{ translateX: shake }] }}>
        <View style={{ flexDirection: "row", gap: layout.stack.tight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <Slot key={i} active={focused && i === at} bad={bad}>
              {value[i] ? (
                <Animated.View style={{ opacity: digits }}>
                  <Digit key={`${i}${value[i]}`} d={value[i]!} delay={i >= from ? (i - from) * step.staggerMs : 0} />
                </Animated.View>
              ) : focused && i === at ? (
                <Caret />
              ) : null}
            </Slot>
          ))}
        </View>
        <TextInput
          ref={input}
          value={value}
          // The caret is held at the end, so a tap on any box types into the next empty one and a paste appends.
          selection={{ start: value.length, end: value.length }}
          onChangeText={(raw) => {
            if (busy) return;
            const code = nextCode(value, raw);
            if (code === value) return;
            onChange(code);
            if (code.length === CODE_LENGTH) onComplete(code);
          }}
          onFocus={() => {
            setFocused(true);
            reveal?.reveal(box.current);
          }}
          onBlur={() => {
            setFocused(false);
            reveal?.release(box.current);
          }}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
          importantForAutofill="yes"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          enterKeyHint="done"
          submitBehavior="blurAndSubmit"
          caretHidden
          contextMenuHidden={false}
          selectionHandleColor="transparent"
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          style={[StyleSheet.absoluteFill, type.body, { opacity: HIDDEN_INPUT_OPACITY, color: "transparent" }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null]}
        />
      </Animated.View>
      <FieldError message={error} />
    </View>
  );
});
