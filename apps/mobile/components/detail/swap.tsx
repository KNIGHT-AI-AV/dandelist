import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { ease, native, spring, step, useReducedMotion } from "../../lib/motion";
import { layout } from "../../lib/theme";

const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

/** One state's content with its own opacity clock. A leaving layer keeps its React instance, so nothing remounts. */
interface Layer {
  key: number;
  id: string;
  node: ReactNode;
  v: Animated.Value;
  leaving: boolean;
  entered: boolean;
  exited: boolean;
}

let seq = 0;
const layer = (id: string, node: ReactNode, start: 0 | 1): Layer => ({ key: ++seq, id, node, v: new Animated.Value(start), leaving: false, entered: start === 1, exited: false });

/**
 * One slot whose content changes state (a button becoming live progress, progress becoming a result). When `id`
 * changes, the old content leaves fast (step.outMs, ease.out) while the new rises in a beat behind it (step.inMs
 * after step.staggerMs), and the slot's height springs to fit, so nothing below it jumps. Each state gets a fresh
 * clock that starts at 0, so new content never shows a frame at full strength; a state caught mid-entrance leaves
 * from wherever it had reached. Reduced motion keeps a short cross-fade with no rise.
 */
export function Swap({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const height = useRef(new Animated.Value(0)).current;
  const [fixed, setFixed] = useState(false);
  const layers = useRef<Layer[]>([]);
  const [, bump] = useState(0);
  // Clipped only while something moves (a layer leaving, the height springing), so at rest nothing is cut, such as
  // the agent dot's soft halo at the column's edge.
  const [clip, setClip] = useState(false);
  const sizing = useRef(false);
  const settle = () => {
    if (!sizing.current && !layers.current.some((l) => l.leaving)) setClip(false);
  };

  let live = layers.current[layers.current.length - 1];
  if (!live) {
    live = layer(id, children, 1);
    layers.current.push(live);
  } else if (live.id !== id) {
    live.leaving = true;
    live = layer(id, children, 0);
    layers.current.push(live);
  } else live.node = children;

  useLayoutEffect(() => {
    for (const l of layers.current) {
      if (l.leaving && !l.exited) {
        l.exited = true;
        setClip(true);
        // Starts from the layer's current opacity, so an entrance caught halfway turns straight round.
        Animated.timing(l.v, { toValue: 0, duration: step.outMs, easing: ease.out, useNativeDriver: native }).start(() => {
          layers.current = layers.current.filter((x) => x !== l);
          bump((n) => n + 1);
          settle();
        });
      } else if (!l.leaving && !l.entered) {
        l.entered = true;
        Animated.timing(l.v, { toValue: 1, duration: reduced ? step.outMs : step.inMs, delay: reduced ? 0 : step.staggerMs, easing: ease.out, useNativeDriver: native }).start();
      }
    }
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (!fixed) {
      height.setValue(h);
      setFixed(true);
      return;
    }
    sizing.current = true;
    setClip(true);
    const done = ({ finished }: { finished: boolean }) => {
      if (!finished) return;
      sizing.current = false;
      settle();
    };
    if (reduced) Animated.timing(height, { toValue: h, duration: step.outMs, easing: ease.out, useNativeDriver: false }).start(done);
    else Animated.spring(height, { toValue: h, ...spring.settle, useNativeDriver: false }).start(done);
  };

  const rise = reduced ? 0 : layout.stack.tight;
  return (
    <Animated.View style={[{ height: fixed ? height : undefined, overflow: clip ? "hidden" : "visible" }, style]}>
      {layers.current.map((l) => {
        const motion = { opacity: l.v, transform: [{ translateY: l.v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] };
        return l === live ? (
          <Animated.View key={l.key} onLayout={onLayout} style={motion}>
            {l.node}
          </Animated.View>
        ) : (
          <Animated.View key={l.key} pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, right: 0 }, motion]} {...HIDDEN}>
            {l.node}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
