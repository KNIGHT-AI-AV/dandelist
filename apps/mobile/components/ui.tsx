import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius, space, type, usePalette } from "../lib/theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const p = usePalette();
  const body = <View style={{ padding: space.xl, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[type.display, { color: p.ink }]} accessibilityRole="header">{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const p = usePalette();
  return <Text style={[type.body, { color: muted ? p.muted : p.ink }]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const p = usePalette();
  if (!children) return null;
  return <Text style={[type.small, { color: p.danger }]} accessibilityLiveRegion="polite">{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.label, { color: p.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        style={[type.body, { minHeight: 48, borderWidth: 1, borderColor: p.line, borderRadius: radius.sm, paddingHorizontal: space.md, color: p.ink, backgroundColor: p.surface }]}
        {...props}
      />
    </View>
  );
}

export function Button({ label, onPress, busy = false, kind = "primary", disabled = false }: { label: string; onPress(): void; busy?: boolean; kind?: "primary" | "quiet"; disabled?: boolean }) {
  const p = usePalette();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={disabled || busy ? undefined : onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.sm,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.lg,
        backgroundColor: primary ? p.accent : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: p.line,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={primary ? p.onAccent : p.ink} /> : <Text style={[type.label, { fontSize: 15, color: primary ? p.onAccent : p.ink }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={{ backgroundColor: p.glass, borderRadius: radius.md, borderWidth: 1, borderColor: p.line, padding: space.lg, gap: space.sm }}>{children}</View>;
}

export function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={[type.body, { color: p.ink }]}>{label}</Text>
        {hint ? <Text style={[type.small, { color: p.muted }]}>{hint}</Text> : null}
      </View>
      <Text style={[type.figure, { color: p.ink }]}>{value}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void; label: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.label, { color: p.muted }]}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={{ minHeight: 44, paddingHorizontal: space.lg, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: on ? p.accent : p.line, backgroundColor: on ? p.accentSoft : "transparent" }}
            >
              <Text style={[type.body, { color: p.ink }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
