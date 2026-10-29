import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SessionSummary } from "../../lib/dream";
import { whenLabel } from "../../lib/dream";
import { ease, haptic, native, spring, usePress, useReducedMotion } from "../../lib/motion";
import { layout, radius, type, usePalette } from "../../lib/theme";
import { AgentDot, ErrorLine, Glass, Icon, IconButton, QuietButton } from "../lux";

export interface HistorySheetProps {
  open: boolean;
  /** Where the sheet hangs from (under the chat's header) and the room to leave above the composer. */
  top: number;
  bottom: number;
  side: number;
  dandyName: string;
  /** Null while the first load is on its way. */
  sessions: SessionSummary[] | null;
  error: string | null;
  currentId: string | null;
  /** A conversation deleted moments ago, still undoable. */
  pending: string | null;
  onPick(id: string): void;
  onDelete(id: string): void;
  onUndo(): void;
  onNew(): void;
  onRetry(): void;
  onClose(): void;
}

function Row({ s, current, now, onPick, onDelete }: { s: SessionSummary; current: boolean; now: Date; onPick(): void; onDelete(): void }) {
  const p = usePalette();
  const press = usePress(0.985);
  return (
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${s.title}, ${whenLabel(s.updatedAt, now)}${current ? ", open now" : ""}`}
        accessibilityHint="Opens this conversation"
        onPress={onPress(onPick)}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{ flex: 1 }}
      >
        <Animated.View style={{ paddingVertical: 12, paddingLeft: 4, gap: 3, transform: [{ scale: press.scale }] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {current ? <AgentDot size={6} /> : null}
            <Text style={[type.headline, { flex: 1, color: p.ink }]} numberOfLines={1}>
              {s.title}
            </Text>
            <Text style={[type.figure, { color: p.ink3 }]}>{whenLabel(s.updatedAt, now)}</Text>
          </View>
          {s.preview && s.preview !== s.title ? (
            <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
              {s.preview}
            </Text>
          ) : null}
        </Animated.View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete "${s.title}"`} onPress={onPress(onDelete)} hitSlop={4} style={{ width: 44, alignItems: "flex-end", justifyContent: "center" }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: `rgba(${p.inkRgb}, ${p.scheme === "dark" ? 0.07 : 0.05})` }}>
          <Icon name="close" size={12} color={p.ink2} />
        </View>
      </Pressable>
    </View>
  );
}

const onPress = (fn: () => void) => () => {
  haptic.select();
  fn();
};

/** The row a deletion leaves for five seconds: what happened, and Undo. */
function Deleted({ onUndo }: { onUndo(): void }) {
  const p = usePalette();
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingLeft: 4 }}>
      <Text style={[type.callout, { color: p.ink2 }]}>Conversation deleted.</Text>
      <QuietButton label="Undo" color={p.accentText} onPress={onUndo} />
    </View>
  );
}

/**
 * Past conversations with the Dandy, newest first, over the chat: each by its first words, its latest line and when
 * it was. Tap one to open it, the cross to delete it (with Undo while the row says so), or start a new chat. It hangs
 * under the chat's header and stops above the composer, so the composer stays in reach.
 */
export function HistorySheet(props: HistorySheetProps) {
  const { open, top, bottom, side, sessions, error, currentId, pending, dandyName, onPick, onDelete, onUndo, onNew, onRetry, onClose } = props;
  const p = usePalette();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (open) {
      setMounted(true);
      setNow(new Date());
      (reduced ? Animated.timing(v, { toValue: 1, duration: 150, easing: ease.out, useNativeDriver: native }) : Animated.spring(v, { toValue: 1, ...spring.snap, useNativeDriver: native })).start();
    } else {
      Animated.timing(v, { toValue: 0, duration: 160, easing: ease.out, useNativeDriver: native }).start(({ finished }) => finished && setMounted(false));
    }
  }, [open, reduced, v]);

  // Escape closes it on the web, like any sheet.
  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <View pointerEvents={open ? "box-none" : "none"} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: v }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close conversations" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, 0.6)` }]} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={{
          position: "absolute",
          top,
          left: side,
          right: side,
          bottom,
          alignItems: "center",
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
        }}
        pointerEvents="box-none"
      >
        <Glass intensity={60} tint={p.sheet} style={{ width: "100%", maxWidth: layout.column, maxHeight: "100%", borderRadius: radius.sheet, boxShadow: "0 18px 40px rgba(0,0,0,0.35)" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 10, paddingTop: 10 }}>
            <Text accessibilityRole="header" style={[type.title3, { color: p.ink }]}>
              Conversations
            </Text>
            <IconButton icon="close" label="Close conversations" onPress={onClose} />
          </View>
          <Pressable accessibilityRole="button" onPress={onPress(onNew)} style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 4 }}>
            <View style={{ minHeight: layout.control.chip, borderRadius: radius.control, borderCurve: "continuous", flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, backgroundColor: `rgba(${p.inkRgb}, ${p.scheme === "dark" ? 0.08 : 0.06})` }}>
              <Icon name="plus" size={14} color={p.accentText} />
              <Text style={[type.label, { color: p.ink }]}>New chat</Text>
            </View>
          </Pressable>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            {error ? (
              <View style={{ gap: 4, paddingVertical: 8 }}>
                <ErrorLine>{error}</ErrorLine>
                <QuietButton label="Try again" onPress={onRetry} style={{ alignSelf: "flex-start" }} />
              </View>
            ) : null}
            {sessions === null && !error ? (
              <View style={{ gap: 10, paddingVertical: 10 }} accessibilityLabel="Loading your conversations">
                {[0.9, 0.7, 0.8].map((w, i) => (
                  <View key={i} style={{ gap: 6, paddingVertical: 6 }}>
                    <View style={{ height: 14, width: `${Math.round(w * 70)}%` as `${number}%`, borderRadius: 7, backgroundColor: p.track }} />
                    <View style={{ height: 10, width: `${Math.round(w * 90)}%` as `${number}%`, borderRadius: 5, backgroundColor: p.track, opacity: 0.6 }} />
                  </View>
                ))}
              </View>
            ) : null}
            {sessions && !sessions.length ? (
              <Text style={[type.callout, { color: p.ink2, paddingVertical: 14, paddingHorizontal: 4 }]}>{`Nothing here yet. Your conversations with ${dandyName} will wait here for you.`}</Text>
            ) : null}
            {(sessions ?? []).map((s, i) => (
              <View key={s.id} style={i ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.hair } : null}>
                {pending === s.id ? <Deleted onUndo={onUndo} /> : <Row s={s} current={s.id === currentId} now={now} onPick={() => onPick(s.id)} onDelete={() => onDelete(s.id)} />}
              </View>
            ))}
          </ScrollView>
        </Glass>
      </Animated.View>
    </View>
  );
}
