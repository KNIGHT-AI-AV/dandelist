import { useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { layout, radius, type, usePalette } from "../../lib/theme";
import { Eyebrow, Glass, Hairline, Icon } from "../lux";

/**
 * The settings page's pieces: a titled section, a glass card, and rows inside it, after the grouped lists of iOS
 * Settings set in the house kit. Hairlines between rows start at the text, never at the card's edge.
 */

export function Section({ title, hint, children }: { title: string; hint?: string | null; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ gap: 12 }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
      {hint ? <Text style={[type.footnote, { color: p.ink3 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Glass style={[{ borderRadius: radius.lg, borderCurve: "continuous", paddingVertical: 4 }, style]}>{children}</Glass>;
}

/** A divider between rows, inset to the text. */
export function RowRule() {
  return <Hairline style={{ marginLeft: layout.cardPad }} />;
}

/**
 * One row: a label with an optional line under it, a value or an accessory on the right, and a chevron when it opens
 * something. `danger` sets the label in the theme's warning colour.
 */
export function Row({
  label,
  detail,
  value,
  accessory,
  leading,
  onPress,
  danger = false,
  first = false,
  hint,
}: {
  label: string;
  detail?: string | null;
  value?: string | null;
  accessory?: ReactNode;
  leading?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
  /** What a screen reader says the row does, when the label alone doesn't. */
  hint?: string;
}) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);
  const body = (pressed: boolean) => (
    <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: layout.cardPad, paddingVertical: 10, borderRadius: radius.md, backgroundColor: pressed || hovered ? p.track : "transparent" }}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: danger ? p.danger : p.ink }]}>{label}</Text>
        {detail ? <Text style={[type.footnote, { color: p.ink3 }]}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text style={[type.callout, { color: p.ink2, maxWidth: "50%", textAlign: "right" }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {onPress && !accessory ? <Icon name="forward" size={14} color={p.ink3} /> : null}
    </View>
  );
  return (
    <>
      {first ? null : <RowRule />}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}, ${value}` : label}
          accessibilityHint={hint}
          onPress={onPress}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={Platform.OS === "web" ? ({ cursor: "pointer" } as object) : undefined}
        >
          {({ pressed }) => body(pressed)}
        </Pressable>
      ) : (
        body(false)
      )}
    </>
  );
}

/** A small text action for the right of a row: Link, Unlink, Remove. */
export function RowAction({ label, onPress, busy = false, tone = "ink", accessibilityLabel }: { label: string; onPress(): void; busy?: boolean; tone?: "ink" | "quiet" | "danger"; accessibilityLabel?: string }) {
  const p = usePalette();
  const color = tone === "danger" ? p.danger : tone === "quiet" ? p.ink2 : p.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: busy }}
      onPress={busy ? undefined : onPress}
      hitSlop={8}
      style={({ pressed }) => [{ minHeight: 44, minWidth: 64, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.control, borderCurve: "continuous", borderWidth: 1, borderColor: p.line, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      <Text style={[type.label, { color }]}>{busy ? "..." : label}</Text>
    </Pressable>
  );
}
