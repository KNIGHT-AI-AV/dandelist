import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, Animated, Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { ease, native, spring, useReducedMotion } from "../../lib/motion";
import { layout, radius, type, usePalette, type Palette } from "../../lib/theme";
import { Eyebrow, Glass } from "../lux";
import { useReveal } from "./reveal";
import { ERROR, FOCUS } from "./tokens";

/** Return keys a field can show; each is also sent as the web's `enterkeyhint`. */
export type ReturnKey = "done" | "go" | "next" | "search" | "send";

/** The caret and selection handles in the accent, per platform (Android keeps its own highlight colour). */
export function caretColors(p: Palette): Partial<TextInputProps> {
  return Platform.select<Partial<TextInputProps>>({ ios: { selectionColor: p.accentText }, android: { cursorColor: p.accentText, selectionHandleColor: p.accentText }, default: {} });
}

/** The web draws focus with our border, not the browser's outline; the caret takes the accent. */
export function webInput(p: Palette): StyleProp<TextStyle> {
  return Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none", caretColor: p.accentText } as object) : null;
}

/** A border drawn over a field's own, faded in by opacity so it can run on the native driver. */
export function Ring({ color, opacity, radius: r = radius.sm }: { color: string; opacity: Animated.Value | Animated.AnimatedInterpolation<number>; radius?: number }) {
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, borderCurve: "continuous", borderWidth: 1, borderColor: color, opacity }]} />;
}

/** Animates `value` to 1 or 0 on ease.out: `inMs` going on, the faster `outMs` going off. Interrupts from where it is. */
export function useToggle(on: boolean, inMs = FOCUS.inMs, outMs = FOCUS.outMs): Animated.Value {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: on ? inMs : outMs, easing: ease.out, useNativeDriver: native }).start();
  }, [on, v, inMs, outMs]);
  return v;
}

/**
 * The line under a field that explains what's wrong, in one plain sentence. It opens on spring.snap with a 4 pt
 * rise and closes faster (120 ms); under reduced motion it only fades. Screen readers hear it as it appears.
 */
export function FieldError({ message, style }: { message?: string | null; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [text, setText] = useState<string | null>(message || null);
  const [h, setH] = useState(0);
  // Height can't run on the native driver, so this one value stays in JS for height, fade and rise together.
  const open = useRef(new Animated.Value(message ? 1 : 0)).current;
  useEffect(() => {
    if (message) {
      setText(message);
      if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
      if (reduced) Animated.timing(open, { toValue: 1, duration: FOCUS.inMs, easing: ease.out, useNativeDriver: false }).start();
      else Animated.spring(open, { toValue: 1, ...spring.snap, useNativeDriver: false }).start();
    } else {
      Animated.timing(open, { toValue: 0, duration: ERROR.outMs, easing: ease.out, useNativeDriver: false }).start(({ finished }) => finished && setText(null));
    }
  }, [message, reduced, open]);
  if (!text) return null;
  // Reduced motion: the space opens at once and only the words fade.
  const height = reduced ? open.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, h, h] }) : open.interpolate({ inputRange: [0, 1], outputRange: [0, h] });
  return (
    <Animated.View style={[{ height, overflow: "hidden" }, style]}>
      <Animated.Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={[
          type.footnote,
          { position: "absolute", top: 0, left: 0, right: 0, paddingTop: layout.stack.tight, color: p.danger, opacity: open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }) },
          reduced ? null : { transform: [{ translateY: open.interpolate({ inputRange: [0, 1], outputRange: [-ERROR.rise, 0] }) }] },
        ]}
      >
        {text}
      </Animated.Text>
    </Animated.View>
  );
}

export interface FieldProps extends Omit<TextInputProps, "style" | "returnKeyType" | "enterKeyHint"> {
  /** Drawn above the field as an eyebrow and read by screen readers. */
  label: string;
  /** Screen readers only: nothing is drawn above the field. */
  labelHidden?: boolean;
  /** What's wrong, as a plain sentence, or null. Shown once the field has been edited and left, or once `submitted`. */
  error?: string | null;
  /** The form was submitted: show `error` now, edited or not. */
  submitted?: boolean;
  /** Return moves focus to this field and the key reads "next". Without it, return submits (`onSubmitEditing`). */
  next?: RefObject<TextInput | null>;
  /** Defaults to "next" with `next`, otherwise "done". */
  returnKeyType?: ReturnKey;
  /** "glass" on the page and over photographs; "plain" inside a glass card, so glass never stacks on glass. */
  surface?: "glass" | "plain";
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * The one text field. Label above, a 52 pt box whose border warms from `line` to `ink` on focus (150 ms in, 100 ms
 * out), the error below it in `danger` once it's fair to show. Return chains to `next`; a single-line field never
 * takes a newline. Inside a KeyboardScroll, focus scrolls the field into view above the keyboard and any dock.
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, labelHidden = false, error, submitted = false, next, returnKeyType, submitBehavior, surface = "glass", style, inputStyle, onFocus, onBlur, onChangeText, onSubmitEditing, ...props },
  ref,
) {
  const p = usePalette();
  const reveal = useReveal();
  const input = useRef<TextInput>(null);
  const box = useRef<View>(null);
  useImperativeHandle(ref, () => input.current as TextInput, []);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState(false);
  const shown = error && (touched || submitted) ? error : null;
  const focus = useToggle(focused);
  const bad = useToggle(!!shown);

  const key: ReturnKey = returnKeyType ?? (next ? "next" : "done");
  // Moving on or sending keeps the keyboard up; "done" puts it away.
  const submit = submitBehavior ?? (next || key !== "done" ? "submit" : "blurAndSubmit");
  const border = { borderRadius: radius.sm, borderCurve: "continuous" as const, borderWidth: 1, borderColor: p.line };
  const field = (
    <TextInput
      ref={input}
      accessibilityLabel={label}
      accessibilityHint={shown ?? undefined}
      placeholderTextColor={p.ink3}
      returnKeyType={key}
      enterKeyHint={key}
      submitBehavior={submit}
      // The web reads only blurOnSubmit; phones read submitBehavior.
      blurOnSubmit={submit === "blurAndSubmit"}
      {...caretColors(p)}
      {...props}
      style={[type.body, { minHeight: layout.control.field, paddingHorizontal: layout.stack.base, color: p.ink }, webInput(p), inputStyle]}
      onFocus={(e) => {
        setFocused(true);
        reveal?.reveal(box.current);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        if (dirty) setTouched(true);
        reveal?.release(box.current);
        onBlur?.(e);
      }}
      onChangeText={(t) => {
        setDirty(true);
        onChangeText?.(t);
      }}
      onSubmitEditing={(e) => {
        onSubmitEditing?.(e);
        next?.current?.focus();
      }}
    />
  );
  return (
    <View ref={box} collapsable={false} style={style}>
      <View style={{ gap: layout.stack.tight }}>
        {labelHidden ? null : <Eyebrow>{label}</Eyebrow>}
        <View>
          {surface === "glass" ? <Glass style={border}>{field}</Glass> : <View style={border}>{field}</View>}
          <Ring color={p.ink} opacity={focus} />
          <Ring color={p.danger} opacity={bad} />
        </View>
      </View>
      <FieldError message={shown} />
    </View>
  );
});
