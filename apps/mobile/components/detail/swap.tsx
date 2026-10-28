import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { ease, native, spring, step, useReducedMotion } from "../../lib/motion";
import { layout } from "../../lib/theme";

const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/**
 * One slot whose content changes state (a button becoming live progress, progress becoming a result). When `id`
 * changes, the old content leaves fast (step.outMs) while the new rises in a beat behind it (step.inMs after
 * step.staggerMs), and the slot's height springs to fit, so nothing below it jumps. A change caught mid-flight
 * carries on from the current opacity. Reduced motion keeps a short cross-fade with no rise.
 */
export function Swap({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(1)).current;
  const leave = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(0)).current;
  const enterNow = useRef(1);
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const [ghost, setGhost] = useState<{ id: string; node: ReactNode } | null>(null);
  const [fixed, setFixed] = useState(false);

  useEffect(() => {
    const sub = enter.addListener(({ value }) => (enterNow.current = value));
    return () => enter.removeListener(sub);
  }, [enter]);

  useLayoutEffect(() => {
    if (last.current.id === id) {
      last.current.node = children;
      return;
    }
    const prev = last.current;
    last.current = { id, node: children };
    setGhost(prev);
    // Start the leaving copy at whatever opacity the content had reached, so an interrupted swap never flashes.
    leave.setValue(enterNow.current);
    enter.setValue(0);
    Animated.parallel([
      Animated.timing(leave, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native }),
      Animated.timing(enter, { toValue: 1, duration: reduced ? step.outMs : step.inMs, delay: reduced ? 0 : step.staggerMs, easing: ease.out, useNativeDriver: native }),
    ]).start(({ finished }) => finished && setGhost(null));
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (!fixed) {
      height.setValue(h);
      setFixed(true);
      return;
    }
    if (reduced) Animated.timing(height, { toValue: h, duration: step.outMs, easing: ease.out, useNativeDriver: false }).start();
    else Animated.spring(height, { toValue: h, ...spring.settle, useNativeDriver: false }).start();
  };

  const rise = reduced ? 0 : layout.stack.tight;
  return (
    <Animated.View style={[{ height: fixed ? height : undefined, overflow: "hidden" }, style]}>
      <View onLayout={onLayout}>
        <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }}>{children}</Animated.View>
      </View>
      {ghost ? (
        <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: leave }} {...HIDDEN}>
          {ghost.node}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
