import { forwardRef, useEffect, useRef, useState } from "react";
import { Animated, Platform, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { ease, native, step, useReducedMotion } from "../lib/motion";
import { fonts, layout, type, usePalette } from "../lib/theme";

/** The longest wish the agent reads, and where the countdown starts so it never surprises anyone at the limit. */
export const WISH_MAX = 300;
const COUNT_FROM = 60;
/** Three lines of the serif to start; the field grows with the wish to five lines, then scrolls inside itself. */
export const FIELD_MIN = 96;
const FIELD_MAX = 5 * (type.title3.lineHeight ?? 0) + 2 * layout.stack.tight;
// The browser draws its own focus box around text fields; the drawn underline is the focus cue here.
const NO_OUTLINE = Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none" } as object) : null;

/**
 * The wish, written in the app's serif. Return sends it (Shift+Return makes a new line on the web); focus draws a
 * line across from the left; a quiet countdown appears near the limit. The parent owns the text and the submit.
 */
export const WishField = forwardRef<TextInput, { value: string; onChangeText(t: string): void; onSubmit(): void; editable: boolean; placeholder: string; inset?: number }>(
  function WishField({ value, onChangeText, onSubmit, editable, placeholder, inset = 0 }, ref) {
    const p = usePalette();
    const reduced = useReducedMotion();
    const [focused, setFocused] = useState(false);
    const [height, setHeight] = useState(FIELD_MIN);
    const line = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      Animated.timing(line, { toValue: focused ? 1 : 0, duration: focused ? step.inMs : step.outMs, easing: ease.out, useNativeDriver: native }).start();
    }, [focused, line]);
    const left = WISH_MAX - value.length;

    // Multiline fields on the web insert a newline on Return; send instead, and keep Shift+Return for a new line.
    const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
      if (Platform.OS !== "web" || e.nativeEvent.key !== "Enter" || e.nativeEvent.shiftKey) return;
      e.preventDefault();
      onSubmit();
    };

    return (
      <View style={{ gap: layout.stack.tight }}>
        <TextInput
          ref={ref}
          accessibilityLabel="Your wish"
          accessibilityHint="Describe what you want, then press Go"
          value={value}
          onChangeText={(t) => onChangeText(t.slice(0, WISH_MAX))}
          maxLength={WISH_MAX}
          multiline
          autoFocus={Platform.OS !== "web"}
          editable={editable}
          placeholder={placeholder}
          placeholderTextColor={p.ink3}
          autoCapitalize="sentences"
          autoCorrect
          spellCheck
          returnKeyType="go"
          enterKeyHint="go"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onSubmit}
          onKeyPress={onKeyPress}
          // Phones report the text's own height; the web reports the box's scroll height, which already holds the padding.
          onContentSizeChange={(e) => setHeight(Math.min(FIELD_MAX, Math.max(FIELD_MIN, e.nativeEvent.contentSize.height + (Platform.OS === "web" ? 0 : 2 * layout.stack.tight))))}
          scrollEnabled={height >= FIELD_MAX}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink, height, paddingVertical: layout.stack.tight, paddingRight: inset, textAlignVertical: "top" }, NO_OUTLINE]}
        />
        <View style={{ height: 1, backgroundColor: p.line }}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: p.ink2,
              transformOrigin: "left",
              opacity: reduced ? line : 1,
              transform: [{ scaleX: reduced ? 1 : line }],
            }}
          />
        </View>
        {left <= COUNT_FROM ? (
          <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: left <= 10 ? p.ink : p.ink3, alignSelf: "flex-end" }]}>
            {left === 0 ? "That's the limit" : `${left} left`}
          </Text>
        ) : null}
      </View>
    );
  },
);
