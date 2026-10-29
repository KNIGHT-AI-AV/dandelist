import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, PanResponder, Text, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "../lux";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { space, type, usePalette } from "../../lib/theme";

/** Past this share of the row's width, letting go removes it. */
export const REMOVE_AT = 0.4;
/** A flick this fast (px per ms), in the direction it travels, removes from a shorter drag. */
export const FLICK_X = 0.5;
/** ...but only once the row has moved this share of its width, so a twitch never removes anything. */
const FLICK_MIN = 0.12;
/** A drag only becomes a swipe past this many px, and only when clearly sideways. */
const SLOP = 10;
const SIDEWAYS = 1.6;
/** Critically damped (damping = 2 * sqrt(stiffness * mass)): back into place without a bounce. */
const HOME = { mass: 1, stiffness: 322, damping: 35.9 };
/** If the row is still here this long after it flew off (the removal was undone or refused), it comes back. */
const RETURN_AFTER_MS = 700;

type A11yChild = ReactElement<{ accessibilityActions?: readonly AccessibilityActionInfo[]; onAccessibilityAction?: (e: AccessibilityActionEvent) => void }>;

/** "#B4402C" as "180, 64, 44", for a tint of the danger colour. */
function rgbOf(hex: string): string {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");
}

/**
 * Swipe a row left or right to remove it (owner, recording 03). The row follows the finger one to one and a removal
 * mark shows underneath on the side it moves away from. Past REMOVE_AT of the width, or on a fast flick, it flies off
 * and `onRemove` runs (the caller takes it from there, with its undo); otherwise it springs back, critically damped.
 * A haptic marks the threshold each way. Screen readers get a "Remove" action on the row.
 *
 * It claims only clearly sideways drags, below anything else, so vertical scrolling and the pager's swipes beside
 * the row still work. Visuals stay neutral: `style` sets the shape it clips to (pass the row's corner radius),
 * `label` the word on the mark and the action (default "Remove"). `children` is the row: give it a single element that takes accessibility props (a
 * Pressable) and the Remove action joins its own actions; anything else is wrapped in one accessible view.
 */
export function SwipeToRemove({ onRemove, label = "Remove", children, style }: { onRemove(): void; label?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  // The width is read by the gesture (a ref, current mid-drag) and by the marks' ranges (state, so they re-render).
  const [measured, setMeasured] = useState(0);
  const width = useRef(0);
  const pos = useRef(0);
  const armed = useRef(false);
  const gone = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => () => clearTimeout(returnTimer.current), []);
  // Where the row really is, followed through a listener (a native animation reports back only to one), so a grab
  // mid-return starts from the true place.
  useEffect(() => {
    const id = x.addListener(({ value }) => (pos.current = value));
    return () => x.removeListener(id);
  }, [x]);

  const pan = useMemo(() => {
    const home = (velocity = 0) => {
      armed.current = false;
      if (reducedRef.current) Animated.timing(x, { toValue: 0, duration: 150, easing: ease.out, useNativeDriver: native }).start();
      else Animated.spring(x, { toValue: 0, velocity, ...HOME, useNativeDriver: native }).start();
    };
    const flyOff = (dir: 1 | -1, vx: number) => {
      gone.current = true;
      const done = ({ finished }: { finished: boolean }) => {
        if (!finished) return;
        removeRef.current();
        // Still on screen a moment later: the removal was undone before the row left, or refused. Bring it back.
        returnTimer.current = setTimeout(() => {
          gone.current = false;
          fade.setValue(1);
          home();
        }, RETURN_AFTER_MS);
      };
      if (reducedRef.current) {
        Animated.timing(fade, { toValue: 0, duration: 150, easing: ease.out, useNativeDriver: native }).start(done);
        return;
      }
      const w = width.current || 400;
      const left = w + space[40] - Math.abs(pos.current);
      const speed = Math.max(Math.abs(vx), 1.2);
      Animated.timing(x, { toValue: dir * (w + space[40]), duration: Math.min(260, Math.max(120, left / speed)), easing: ease.out, useNativeDriver: native }).start(done);
    };
    let base = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => !gone.current && Math.abs(g.dx) > SLOP && Math.abs(g.dx) > Math.abs(g.dy) * SIDEWAYS,
      onPanResponderGrant: () => {
        clearTimeout(returnTimer.current);
        x.stopAnimation();
        base = pos.current;
        armed.current = false;
      },
      onPanResponderMove: (_e, g) => {
        const at = base + g.dx;
        pos.current = at;
        x.setValue(at);
        const over = width.current > 0 && Math.abs(at) >= width.current * REMOVE_AT;
        if (over !== armed.current) {
          armed.current = over;
          if (over) haptic.soft();
          else haptic.select();
        }
      },
      onPanResponderRelease: (_e, g) => {
        const at = base + g.dx;
        const w = width.current;
        const dir: 1 | -1 = at >= 0 ? 1 : -1;
        const far = w > 0 && Math.abs(at) >= w * REMOVE_AT;
        const flick = w > 0 && Math.abs(g.vx) >= FLICK_X && Math.sign(g.vx) === dir && Math.abs(at) >= w * FLICK_MIN;
        if (far || flick) flyOff(dir, g.vx);
        else home(g.vx * 1000);
      },
      onPanResponderTerminate: () => home(),
      // Once a row has the swipe, the pager and the scroll view don't take it back mid-gesture.
      onPanResponderTerminationRequest: () => false,
    });
  }, [x, fade]);

  const actions = (own?: readonly AccessibilityActionInfo[]) => [...(own ?? []).filter((a) => a.name !== "remove"), { name: "remove", label }];
  const onAction = (e: AccessibilityActionEvent, own?: (e: AccessibilityActionEvent) => void) => {
    if (e.nativeEvent.actionName === "remove") removeRef.current();
    else own?.(e);
  };
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as A11yChild) : null;
  const row = only ? (
    cloneElement(only, { accessibilityActions: actions(only.props.accessibilityActions), onAccessibilityAction: (e: AccessibilityActionEvent) => onAction(e, only.props.onAccessibilityAction) })
  ) : (
    <View accessible accessibilityActions={actions()} onAccessibilityAction={(e) => onAction(e)}>
      {children}
    </View>
  );

  const tint = `rgba(${rgbOf(p.danger)}, ${p.scheme === "dark" ? 0.16 : 0.12})`;
  // What the row uncovers, on each side: a panel as wide as the row that travels with the row's edge (so it only
  // ever shows the strip the row has left), its contents held still against it. The mark fades in over the first
  // stretch and reaches full size at the threshold, so the moment it will remove is seen as well as felt.
  const sides = useMemo(() => {
    const w = measured;
    // Ranges must rise: before the row is measured, the threshold sits just past the fade-in.
    const reach = Math.max(space[24] + 1, w * REMOVE_AT);
    return ([1, -1] as const).map((side) => {
      const edge = Animated.add(x, side * -w);
      const range = side === 1 ? [0, space[24], reach] : [-reach, -space[24], 0];
      const out = (a: number, b: number, c: number) => (side === 1 ? [a, b, c] : [c, b, a]);
      return {
        side,
        panel: edge,
        hold: Animated.multiply(edge, -1),
        opacity: x.interpolate({ inputRange: range, outputRange: out(0, 0.6, 1), extrapolate: "clamp" }),
        scale: x.interpolate({ inputRange: range, outputRange: out(0.85, 0.9, 1), extrapolate: "clamp" }),
      };
    });
  }, [x, measured]);

  return (
    <View
      style={[{ overflow: "hidden" }, style]}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        setMeasured(e.nativeEvent.layout.width);
      }}
      {...pan.panHandlers}
    >
      {measured
        ? sides.map((s) => (
            <Animated.View
              key={s.side}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: measured, overflow: "hidden", transform: [{ translateX: s.panel }] }}
            >
              <Animated.View style={{ flex: 1, backgroundColor: tint, transform: [{ translateX: s.hold }] }}>
                <Animated.View
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    [s.side === 1 ? "left" : "right"]: space[16],
                    flexDirection: s.side === 1 ? "row" : "row-reverse",
                    alignItems: "center",
                    gap: space[8],
                    opacity: s.opacity,
                    transform: [{ scale: s.scale }],
                  }}
                >
                  <Icon name="close" color={p.danger} size={15} />
                  <Text style={[type.label, { color: p.danger }]}>{label}</Text>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          ))
        : null}
      <Animated.View style={{ opacity: fade, transform: [{ translateX: x }] }}>{row}</Animated.View>
    </View>
  );
}
