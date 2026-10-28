import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass } from "../lux";
import { ease, native, spring, useReducedMotion } from "../../lib/motion";
import { layout, radius, shadow, type, usePalette } from "../../lib/theme";
import type { Rect } from "../../lib/zoom";
import { choreo } from "./choreo";
import { SCRIM, SHEET_GAP, SHEET_INNER_RADIUS, SHEET_PAD, SHEET_ROW_INSET } from "./metrics";

interface SheetProps {
  /** Where the pressed card sits on screen; the sheet opens against it and its copy lifts there. */
  anchor: Rect;
  /** False plays the exit, then calls `onClosed`. */
  open: boolean;
  onRequestClose(): void;
  onClosed(): void;
  /** The dialog's name for assistive tech: the wish's name. */
  label: string;
  /** The lifted card, drawn exactly over the card itself. */
  preview: ReactNode;
  children: ReactNode;
}

/**
 * Quick actions anchored to a card, after iOS context menus. The page recedes under a scrim, the card lifts out of
 * it (from its pressed size to full size, with a shadow), and a glass sheet grows out of the card's nearer edge,
 * below the card when there is more room there, otherwise above. Tap the scrim, press Escape, use Android's back or
 * the VoiceOver escape gesture to dismiss.
 *
 * Choreography: scrim fades in over step.inMs; the card lifts on spring.snap at once; the sheet grows on spring.snap
 * one stagger later. All three leave together in step.outMs. Reduced motion: opacity only.
 */
export function ActionSheet({ anchor, open, onRequestClose, onClosed, label, preview, children }: SheetProps) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrim = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  const ready = shown && sheetHeight > 0;

  const roomBelow = height - insets.bottom - (anchor.y + anchor.height);
  const roomAbove = anchor.y - insets.top;
  const below = roomBelow >= roomAbove;
  const ideal = below ? anchor.y + anchor.height + SHEET_GAP : anchor.y - SHEET_GAP - sheetHeight;
  const top = Math.max(insets.top + SHEET_GAP, Math.min(height - insets.bottom - SHEET_GAP - sheetHeight, ideal));

  useEffect(() => {
    if (!ready) {
      if (!open) closed.current();
      return;
    }
    if (open) {
      const pop = (v: Animated.Value, delay: number) =>
        reduced
          ? Animated.timing(v, { toValue: 1, duration: choreo.outMs, easing: ease.out, useNativeDriver: native })
          : Animated.spring(v, { toValue: 1, ...spring.snap, delay, useNativeDriver: native });
      Animated.parallel([
        Animated.timing(scrim, { toValue: 1, duration: reduced ? choreo.outMs : choreo.inMs, easing: ease.out, useNativeDriver: native }),
        pop(lift, 0),
        pop(grow, choreo.stagger),
      ]).start();
      return;
    }
    const leave = (v: Animated.Value) => Animated.timing(v, { toValue: 0, duration: choreo.outMs, easing: ease.out, useNativeDriver: native });
    Animated.parallel([leave(scrim), leave(lift), leave(grow)]).start(({ finished }) => finished && closed.current());
  }, [open, ready, reduced, scrim, lift, grow]);

  // The anchor is a screen position: if the window changes size under the sheet, it no longer points at the card.
  const size = useRef({ width, height });
  useEffect(() => {
    if (size.current.width !== width || size.current.height !== height) onRequestClose();
  }, [width, height, onRequestClose]);

  const still = reduced ? [1, 1] : null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onShow={() => setShown(true)} onRequestClose={onRequestClose} accessibilityLabel={label}>
      <View style={StyleSheet.absoluteFill} onAccessibilityEscape={onRequestClose}>
        {/* The sheet comes first so keyboard focus lands on its first control; zIndex keeps it on top. */}
        <Animated.View
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          style={{
            position: "absolute",
            zIndex: 2,
            left: anchor.x,
            width: anchor.width,
            top,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            boxShadow: shadow.card,
            opacity: grow,
            transformOrigin: below ? "50% 0%" : "50% 100%",
            transform: [
              { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: reduced ? [0, 0] : [below ? -SHEET_GAP : SHEET_GAP, 0] }) },
              { scale: grow.interpolate({ inputRange: [0, 1], outputRange: still ?? [choreo.sheetFrom, 1] }) },
            ],
          }}
        >
          <Glass tint={p.sheet} style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: SHEET_PAD }}>
            {children}
          </Glass>
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            zIndex: 1,
            left: anchor.x,
            top: anchor.y,
            width: anchor.width,
            height: anchor.height,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            boxShadow: shadow.lift,
            opacity: lift,
            transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: still ?? [choreo.pressed, 1] }) }],
          }}
        >
          {preview}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 0, opacity: scrim, backgroundColor: `rgba(${p.bgRgb}, ${SCRIM})` }]}>
          <Pressable aria-hidden focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onRequestClose} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </Modal>
  );
}

/** One action in the sheet: a 44 pt row whose text sits on the card's text column. */
export function SheetRow({ label, onPress, danger = false }: { label: string; onPress(): void; danger?: boolean }) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        minHeight: layout.control.chip,
        justifyContent: "center",
        paddingHorizontal: SHEET_ROW_INSET,
        borderRadius: SHEET_INNER_RADIUS,
        borderCurve: "continuous",
        backgroundColor: pressed || hovered ? p.track : "transparent",
      })}
    >
      <Text style={[type.label, { color: danger ? p.danger : p.ink }]}>{label}</Text>
    </Pressable>
  );
}
