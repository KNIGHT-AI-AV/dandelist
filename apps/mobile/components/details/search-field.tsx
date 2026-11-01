import { useRef, useState } from "react";
import { Animated, Platform, Pressable, TextInput, View } from "react-native";
import { usePress } from "../../lib/motion";
import { layout, radius, space, type, usePalette } from "../../lib/theme";
import { Glass, Icon } from "../lux";

/** The row's 16 pt slot for the magnifier, which is drawn at 18 so it keeps the size of the drawn glyph before it. */
const SLOT = 16;

/** The search bar on the Details page: glass, the control radius, a clear button once there is something to clear. */
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText(v: string): void; placeholder: string }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const press = usePress(0.94);
  return (
    <Glass style={{ borderRadius: radius.control, borderWidth: 1, borderColor: focused ? p.ink2 : p.line }}>
      <View style={{ minHeight: layout.control.field, flexDirection: "row", alignItems: "center", paddingLeft: layout.stack.base, gap: space[12] }}>
        <View style={{ width: SLOT, height: SLOT, alignItems: "center", justifyContent: "center" }}>
          <Icon name="search" color={p.ink3} size={18} />
        </View>
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.ink3}
          accessibilityLabel="Search your wishes"
          // "searchbox", not "search": on the web "search" is a landmark role and isn't allowed on a field.
          role="searchbox"
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
