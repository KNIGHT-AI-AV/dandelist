import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Dimensions, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout } from "../../lib/theme";
import { EdgeFade } from "../lux";
import { RevealContext, type Reveal, type RevealTarget } from "./reveal";
import { DOCK_FADE, DOCK_KEYBOARD_GAP, DOCK_REST_GAP, REVEAL_MARGIN } from "./tokens";
import { useKeyboard, useKeyboardLift } from "./use-keyboard";
import { usePageSize } from "../../lib/page-size";

/** Runs `fn` once layout has caught up (two frames: the commit, then the native mount); returns a cancel. */
function afterLayout(fn: () => void): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

export interface KeyboardScrollProps extends ScrollViewProps {
  /** Height of this screen's KeyboardDock content (its `onHeight`); focused fields are kept above it. */
  dock?: number;
  /**
   * Add the keyboard's height to the bottom padding and scroll focused fields into view (the default). Off inside a
   * KeyboardLift, which moves the whole view and so keeps bottom-anchored fields in sight itself.
   */
  inset?: boolean;
  /** When the keyboard shows and no field in here has focus, scroll to the end: a chat whose composer is docked. */
  keepEnd?: boolean;
}

/**
 * The scroll view for any screen with inputs. Taps on buttons land while typing and taps on empty space put the
 * keyboard away; a drag dismisses it (interactively on iOS). The content gains the keyboard's height as room
 * underneath, and a focused field scrolls into view above the keyboard and the dock.
 */
export const KeyboardScroll = forwardRef<ScrollView, KeyboardScrollProps>(function KeyboardScroll({ dock = 0, inset = true, keepEnd = false, contentContainerStyle, onScroll, children, ...props }, ref) {
  const kb = useKeyboard();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroll.current as ScrollView, []);
  const offset = useRef(0);
  const target = useRef<RevealTarget | null>(null);
  const live = useRef({ end: kb.end, dock, top: insets.top, bottom: insets.bottom });
  live.current = { end: kb.end, dock, top: insets.top, bottom: insets.bottom };

  const bringIntoView = useCallback((t: RevealTarget) => {
    t.measureInWindow((_x, top, _w, h) => {
      const { end, dock: d, top: safeTop, bottom } = live.current;
      // What covers the bottom: the keyboard and the dock riding on it, or at rest the home indicator and the dock.
      const covered = end > 0 ? end + (d ? d + DOCK_KEYBOARD_GAP : 0) : bottom + (d ? d + DOCK_REST_GAP : 0);
      const floor = Dimensions.get("window").height - covered - REVEAL_MARGIN;
      const ceiling = safeTop + layout.headerBar + REVEAL_MARGIN;
      const dy = top + h > floor ? top + h - floor : top < ceiling ? top - ceiling : 0;
      if (Math.abs(dy) >= 1) scroll.current?.scrollTo({ y: Math.max(0, offset.current + dy), animated: true });
    });
  }, []);

  const reveal = useMemo<Reveal>(
    () => ({
      reveal(t) {
        target.current = t;
        if (t && Platform.OS !== "web") afterLayout(() => bringIntoView(t));
      },
      release(t) {
        if (target.current === t) target.current = null;
      },
    }),
    [bringIntoView],
  );

  // The keyboard came up or grew: keep the focused field in view, or the end of a chat.
  const lastEnd = useRef(kb.end);
  useEffect(() => {
    const grew = kb.end > lastEnd.current;
    lastEnd.current = kb.end;
    if (!grew || !inset || Platform.OS === "web") return;
    return afterLayout(() => {
      if (target.current) bringIntoView(target.current);
      else if (keepEnd) scroll.current?.scrollToEnd({ animated: true });
    });
  }, [kb.end, keepEnd, inset, bringIntoView]);

  const base = StyleSheet.flatten(contentContainerStyle)?.paddingBottom;
  const room = inset && kb.inset ? { paddingBottom: (typeof base === "number" ? base : 0) + kb.inset } : null;
  return (
    <RevealContext.Provider value={inset ? reveal : null}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        scrollEventThrottle={16}
        {...props}
        contentContainerStyle={[contentContainerStyle, room]}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
      >
        {children}
      </ScrollView>
    </RevealContext.Provider>
  );
});

/**
 * Lifts its children with the keyboard: whatever rests `rest` pt above the bottom of the window ends up `gap` pt
 * above the keyboard, on the keyboard's own duration and curve. For bottom-anchored screens and sheets.
 */
export function KeyboardLift({ rest, gap, style, children }: { rest: number; gap: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const lift = useKeyboardLift(rest, gap);
  return <Animated.View style={[style, { transform: [{ translateY: lift }] }]}>{children}</Animated.View>;
}

/**
 * Docks the screen's primary action (or a composer) to the bottom: resting 20 pt above the home indicator, riding
 * 16 pt above the keyboard on its own duration and curve. Content scrolling beneath dissolves into the page.
 * `onHeight` reports the docked content's height for KeyboardScroll's `dock` and the scroll's bottom room.
 */
export function KeyboardDock({ children, onHeight, fade = true, maxWidth = layout.list }: { children: ReactNode; onHeight?(height: number): void; fade?: boolean; maxWidth?: number }) {
  const insets = useSafeAreaInsets();
  const { width } = usePageSize();
  const rest = insets.bottom + DOCK_REST_GAP;
  const lift = useKeyboardLift(rest, DOCK_KEYBOARD_GAP);
  const [h, setH] = useState(0);
  return (
    <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: [{ translateY: lift }] }}>
      {fade ? <EdgeFade height={rest + h + DOCK_FADE} /> : null}
      <View pointerEvents="box-none" style={{ paddingHorizontal: layout.gutter(width), paddingBottom: rest, alignItems: "center" }}>
        <View
          pointerEvents="box-none"
          style={{ width: "100%", maxWidth }}
          onLayout={(e) => {
            const next = e.nativeEvent.layout.height;
            setH(next);
            onHeight?.(next);
          }}
        >
          {children}
        </View>
      </View>
    </Animated.View>
  );
}

/** The bottom room a scroll needs under a KeyboardDock holding content `height` tall: the dock, its rest gap and its fade. */
export function dockRoom(height: number, bottomInset: number): number {
  return bottomInset + DOCK_REST_GAP + height + DOCK_FADE;
}

/** Taps on empty space inside put the keyboard away, for surfaces that aren't a KeyboardScroll (a sheet). */
export function DismissKeyboard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessible={false} focusable={false} onPress={Keyboard.dismiss} style={[style, Platform.OS === "web" ? ({ cursor: "auto" } as object) : null]}>
      {children}
    </Pressable>
  );
}
