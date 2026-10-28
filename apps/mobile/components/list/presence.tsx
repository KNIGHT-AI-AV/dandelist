import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Animated, View, type StyleProp, type ViewStyle } from "react-native";
import { ease, native, spring, useReducedMotion } from "../../lib/motion";
import { choreo } from "./choreo";

/**
 * Appear, disappear and change, choreographed for the wish list. Every animation starts from where the last one
 * left off, so a removal undone mid-exit turns around without a jump.
 */

interface PresenceProps {
  show: boolean;
  /**
   * The first time it shows, rise into place after this delay, where it stands: nothing around it moves (the list
   * arriving). Without it, it is simply there if shown on mount, and opens its space when shown later.
   */
  appear?: number;
  /** A fixed height (cards). Changes spring to the new height. Without it the content is measured. */
  height?: number;
  /** Space after it, which closes with it. */
  gap?: number;
  /** Hiding closes the space it took (default). False: fade only, for overlays. */
  collapse?: boolean;
  /** The first appearance rises (default). False: fade only. */
  rise?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function Presence({ show, appear, height, gap = 0, collapse = true, rise = true, style, children }: PresenceProps) {
  const reduced = useReducedMotion();
  const fixed = height !== undefined;
  const entrance = show && appear !== undefined;
  const [mounted, setMounted] = useState(show);
  // Measured content only takes an animated height while it opens or closes; otherwise it sizes itself.
  const [clamped, setClamped] = useState(false);
  const last = useRef(children);
  if (show) last.current = children;
  const fade = useRef(new Animated.Value(show && !entrance ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(entrance && rise ? 1 : 0)).current;
  const open = useRef(new Animated.Value(show ? 1 : 0)).current;
  const size = useRef(new Animated.Value(height ?? 0)).current;
  const measured = useRef(height ?? 0);
  const seen = useRef(false);
  const first = useRef(true);

  useEffect(() => {
    const onMount = first.current;
    first.current = false;
    if (show) {
      setMounted(true);
      if (!seen.current && appear !== undefined) {
        seen.current = true;
        open.setValue(1);
        lift.setValue(rise ? 1 : 0);
        if (reduced) {
          lift.setValue(0);
          Animated.timing(fade, { toValue: 1, duration: choreo.outMs, easing: ease.out, useNativeDriver: native }).start();
          return;
        }
        const timing = (v: Animated.Value, to: number) => Animated.timing(v, { toValue: to, duration: choreo.inMs, delay: appear, easing: ease.out, useNativeDriver: native });
        Animated.parallel([timing(fade, 1), timing(lift, 0)]).start();
        return;
      }
      seen.current = true;
      if (onMount) return;
      // Coming back: the space opens on a spring and the content fades in just behind it.
      if (!fixed && collapse) setClamped(true);
      const done = ({ finished }: { finished: boolean }) => finished && setClamped(false);
      if (reduced || !collapse) {
        open.setValue(1);
        Animated.timing(fade, { toValue: 1, duration: reduced ? choreo.outMs : choreo.inMs, easing: ease.out, useNativeDriver: native }).start(done);
        return;
      }
      Animated.parallel([
        Animated.spring(open, { toValue: 1, ...spring.snap, useNativeDriver: false }),
        Animated.timing(fade, { toValue: 1, duration: choreo.inMs, delay: choreo.stagger, easing: ease.out, useNativeDriver: native }),
      ]).start(done);
      return;
    }
    if (onMount) return;
    // Leaving: the content fades and sinks fast while the space closes on a spring.
    if (!fixed && collapse) {
      size.setValue(measured.current);
      setClamped(true);
    }
    const out = Animated.timing(fade, { toValue: 0, duration: choreo.outMs, easing: ease.out, useNativeDriver: native });
    const gone = ({ finished }: { finished: boolean }) => {
      if (!finished) return;
      open.setValue(0);
      setMounted(false);
    };
    if (reduced || !collapse) return out.start(gone);
    Animated.parallel([out, Animated.spring(open, { toValue: 0, ...spring.snap, useNativeDriver: false })]).start(gone);
    // Transitions run on `show` alone; the other inputs are read as they stand when it changes.
  }, [show]);

  // A card that changes slot (the one above it left or came back) springs to its new height.
  useEffect(() => {
    if (height === undefined) return;
    measured.current = height;
    if (!show || reduced) size.setValue(height);
    else Animated.spring(size, { toValue: height, ...spring.snap, useNativeDriver: false }).start();
  }, [height]);

  if (!mounted) return null;
  const sized = fixed || clamped;
  return (
    <Animated.View
      aria-hidden={!show}
      style={[
        style,
        { pointerEvents: show ? "auto" : "none" },
        sized ? { height: Animated.multiply(size, open), overflow: fixed ? "visible" : "hidden" } : null,
        gap ? { marginBottom: open.interpolate({ inputRange: [0, 1], outputRange: [0, gap] }) } : null,
      ]}
    >
      <Animated.View
        onLayout={fixed ? undefined : (e) => {
          if (!show) return;
          measured.current = e.nativeEvent.layout.height;
          if (clamped) size.setValue(measured.current);
        }}
        style={{
          flex: fixed ? 1 : undefined,
          opacity: fade,
          transform: [
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, choreo.rise] }) },
            { scale: fade.interpolate({ inputRange: [0, 1], outputRange: [collapse && !reduced ? choreo.goneScale : 1, 1] }) },
          ],
        }}
      >
        {show ? children : last.current}
      </Animated.View>
    </Animated.View>
  );
}

/** Rises into place once, after `delay`: a row in a group that arrives top to bottom. */
export function Rise({ delay, children, style }: { delay: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Presence show appear={delay} collapse={false} style={style}>
      {children}
    </Presence>
  );
}

/**
 * Cross-fades when `k` changes: the old content fades out fast over the new, which fades in a little slower. Text
 * that changes (a count, a label, a button's wording) never snaps.
 */
export function Swap({ k, children, style }: { k: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const values = useRef(new Map<string, Animated.Value>()).current;
  const nodes = useRef(new Map<string, ReactNode>()).current;
  const keys = useRef<string[]>([]);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  if (!values.has(k)) values.set(k, new Animated.Value(keys.current.length ? 0 : 1));
  if (keys.current[keys.current.length - 1] !== k) keys.current = [...keys.current.filter((x) => x !== k), k];
  nodes.set(k, children);

  useEffect(() => {
    Animated.timing(values.get(k)!, { toValue: 1, duration: reduced ? choreo.outMs : choreo.inMs, easing: ease.out, useNativeDriver: native }).start();
    for (const old of keys.current.slice(0, -1)) {
      Animated.timing(values.get(old)!, { toValue: 0, duration: choreo.outMs, easing: ease.out, useNativeDriver: native }).start(({ finished }) => {
        if (!finished) return;
        keys.current = keys.current.filter((x) => x !== old);
        values.delete(old);
        nodes.delete(old);
        bump();
      });
    }
  }, [k]);

  return (
    <View style={style}>
      {keys.current.map((key) => {
        const current = key === k;
        return (
          <Animated.View key={key} aria-hidden={!current} style={[current ? null : { position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none" }, { opacity: values.get(key) }]}>
            {current ? children : nodes.get(key)}
          </Animated.View>
        );
      })}
    </View>
  );
}
