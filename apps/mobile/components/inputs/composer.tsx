import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ease, haptic, spring, usePress, useReducedMotion } from "../../lib/motion";
import { layout, space, type, usePalette } from "../../lib/theme";
import { Glass } from "../lux";
import { caretColors, useToggle, webInput } from "./field";
import { COMPOSER_INSET, COMPOSER_LINES, COMPOSER_PAD_Y, COMPOSER_SHRINK_MS, ICON, TARGET } from "./tokens";

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/** The chevron's side as a share of the glyph, so the head spans about 60% of it. */
const HEAD = 0.42;

/** An up arrow drawn in the lux icon strokes (no text glyphs). */
function Arrow({ color }: { color: string }) {
  const s = ICON.size;
  const w = ICON.stroke;
  const c = s * HEAD;
  return (
    <View style={{ width: s, height: s }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", left: (s - w) / 2, top: w, width: w, height: s - 2 * w, borderRadius: w / 2, backgroundColor: color }} />
      {/* A square with two borders, turned 45°, is the arrowhead; its corner sits on the stem's top. */}
      <View style={{ position: "absolute", left: (s - c) / 2, top: w + c * Math.SQRT1_2 - c / 2, width: c, height: c, borderTopWidth: w, borderLeftWidth: w, borderColor: color, transform: [{ rotate: "45deg" }] }} />
    </View>
  );
}

/** The 44 pt send button: an outline while there's nothing to send, ink-filled when there is (150 ms in, 100 ms out). */
function SendButton({ enabled, onPress }: { enabled: boolean; onPress(): void }) {
  const p = usePalette();
  const press = usePress(0.94);
  const on = useToggle(enabled);
  const round = { borderRadius: TARGET / 2 };
  const centre = { alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={{ margin: COMPOSER_INSET }}>
      <Animated.View style={{ width: TARGET, height: TARGET, transform: [{ scale: press.scale }] }}>
        <View style={[StyleSheet.absoluteFill, round, { borderWidth: 1, borderColor: p.line }]} />
        <Animated.View style={[StyleSheet.absoluteFill, round, { backgroundColor: p.ink, opacity: on }]} />
        <View style={[StyleSheet.absoluteFill, centre]}>
          <Arrow color={p.ink3} />
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, centre, { opacity: on }]}>
          <Arrow color={p.onAccent} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export interface ComposerProps {
  value: string;
  onChangeText(text: string): void;
  /** Called with the trimmed text; the parent clears `value`. */
  onSend(text: string): void;
  placeholder: string;
  /** Read by screen readers for the input. */
  label: string;
  /** A reply is on its way: sending waits. */
  busy?: boolean;
}

/**
 * The chat composer: a glass capsule whose input grows with its text on spring.snap up to five lines, then scrolls
 * inside itself, and shrinks back faster. Return sends (on the web Shift+Return makes a new line); the send button
 * stays an outline while the text is blank. A send ticks the selection haptic.
 */
export const Composer = forwardRef<TextInput, ComposerProps>(function Composer({ value, onChangeText, onSend, placeholder, label, busy = false }, ref) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => input.current as TextInput, []);
  const line = type.body.lineHeight;
  // Height is layout, so this value runs in JS; it starts from wherever it is, so growth interrupts cleanly.
  const height = useRef(new Animated.Value(line)).current;
  const target = useRef(line);
  const canSend = !busy && value.trim().length > 0;

  const fit = (content: number) => {
    const next = Math.min(line * COMPOSER_LINES, Math.max(line, Math.ceil(content)));
    if (next === target.current) return;
    const growing = next > target.current;
    target.current = next;
    if (reduced) height.setValue(next);
    else if (growing) Animated.spring(height, { toValue: next, ...spring.snap, useNativeDriver: false }).start();
    else Animated.timing(height, { toValue: next, duration: COMPOSER_SHRINK_MS, easing: ease.out, useNativeDriver: false }).start();
  };

  // The web's textarea doesn't report shrinking, so it is measured at zero height after every change.
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const el = input.current as unknown as HTMLTextAreaElement | null;
    if (!el?.style) return;
    const was = el.style.height;
    el.style.height = "0px";
    const content = el.scrollHeight;
    el.style.height = was;
    fit(content);
    // `fit` reads only refs and stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const send = () => {
    const text = value.trim();
    if (!text || busy) return;
    haptic.select();
    onSend(text);
  };

  return (
    <Glass intensity={60} style={{ borderRadius: layout.control.primary / 2, borderCurve: "continuous", flexDirection: "row", alignItems: "flex-end", minHeight: layout.control.primary }}>
      <AnimatedInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.ink3}
        accessibilityLabel={label}
        multiline
        returnKeyType="send"
        enterKeyHint="send"
        submitBehavior="submit"
        blurOnSubmit={false}
        autoCapitalize="sentences"
        autoCorrect
        spellCheck
        autoComplete="off"
        textContentType="none"
        onSubmitEditing={send}
        onKeyPress={(e) => {
          if (Platform.OS !== "web") return;
          const k = e.nativeEvent as unknown as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
          // Enter sends; Shift+Enter and an IME still composing a word keep their newline.
          if (k.key !== "Enter" || k.shiftKey || k.isComposing || k.keyCode === 229) return;
          e.preventDefault();
          send();
        }}
        onContentSizeChange={(e) => Platform.OS !== "web" && fit(e.nativeEvent.contentSize.height)}
        {...caretColors(p)}
        style={[
          type.body,
          { flex: 1, height, marginVertical: COMPOSER_PAD_Y, marginLeft: space[20], marginRight: layout.stack.tight, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, color: p.ink, textAlignVertical: "top" },
          webInput(p),
        ]}
      />
      <SendButton enabled={canSend} onPress={send} />
    </Glass>
  );
});
