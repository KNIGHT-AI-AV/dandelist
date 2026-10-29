import { useRef, useState } from "react";
import { Animated, Platform, Pressable, TextInput, View } from "react-native";
import { usePress } from "../../lib/motion";
import { layout, radius, space, type, usePalette } from "../../lib/theme";
import { Glass, Icon } from "../lux";

/** A drawn magnifier, like lux's icons: a 1.5 px ring and a short handle. */
function SearchGlyph({ color, size = 16 }: { color: string; size?: number }) {
  const ring = size * 0.66;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", left: 0, top: 0, width: ring, height: ring, borderRadius: ring / 2, borderWidth: 1.5, borderColor: color }} />
      <View style={{ position: "absolute", left: ring * 0.86, top: ring * 0.98, width: size * 0.36, height: 1.5, borderRadius: 1, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
    </View>
  );
}

/** The search bar on the Details page: glass, the control radius, a clear button once there is something to clear. */
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText(v: string): void; placeholder: string }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const press = usePress(0.94);
  return (
    <Glass style={{ borderRadius: radius.control, borderWidth: 1, borderColor: focused ? p.ink2 : p.line }}>
      <View style={{ minHeight: layout.control.field, flexDirection: "row", alignItems: "center", paddingLeft: layout.stack.base, gap: space[12] }}>
        <SearchGlyph color={p.ink3} />
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.ink3}
          accessibilityLabel="Search your wishes"
          accessibilityRole="search"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          maxLength={200}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[type.body, { flex: 1, minHeight: layout.control.field, color: p.ink }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null]}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => {
              onChangeText("");
              input.current?.focus();
            }}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            style={{ width: layout.control.icon, height: layout.control.field, alignItems: "center", justifyContent: "center" }}
          >
            <Animated.View style={{ transform: [{ scale: press.scale }] }}>
              <Icon name="close" color={p.ink2} size={14} />
            </Animated.View>
          </Pressable>
        ) : (
          <View style={{ width: space[4] }} />
        )}
      </View>
    </Glass>
  );
}
