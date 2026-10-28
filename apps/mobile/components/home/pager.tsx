import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Keyboard, PanResponder, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { haptic, native, useReducedMotion } from "../../lib/motion";
import { PAGES, PAGE_COUNT, landing, mod, nearest, type PageId } from "../../lib/pager";

/** Critically damped, about a third of a second: the page arrives without bouncing (Apple: damping 1, response 0.35). */
const SETTLE = { mass: 1, stiffness: 322, damping: 35.9 };
/** A sideways move this long, and clearly more sideways than down, is a page swipe. */
const SLOP = 12;
const SIDEWAYS = 1.4;

export interface Pager {
  /** The page in front (or on its way to the front). */
  page: PageId;
  /** Position in pages; never wraps, so motion is continuous all the way round. */
  pos: Animated.Value;
  width: number;
  go(page: PageId): void;
  next(step: 1 | -1): void;
}

const Ctx = createContext<Pager | null>(null);
const Grab = createContext<{ grab(): number; release(target: number, velocity: number): void } | null>(null);

export function usePager(): Pager {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePager must be used inside PagerProvider");
  return ctx;
}

/**
 * Holds the ring's position. Everything that follows the swipe (the pages, the dots, the dock) reads `pos`, so
 * they move together frame by frame.
 */
export function PagerProvider({ initial, onPage, children }: { initial: PageId; onPage?(page: PageId): void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const start = PAGES.indexOf(initial);
  const pos = useRef(new Animated.Value(start)).current;
  // Where it is right now (followed through a listener, so a grab mid-flight starts from the true place) and where
  // it is heading.
  const live = useRef(start);
  const target = useRef(start);
  const [page, setPage] = useState<PageId>(initial);
  useEffect(() => {
    const id = pos.addListener(({ value }) => (live.current = value));
    return () => pos.removeListener(id);
  }, [pos]);

  const settle = useCallback(
    (to: number, velocity = 0) => {
      const changed = Math.round(to) !== Math.round(target.current);
      target.current = to;
      const id = PAGES[mod(to)]!;
      setPage(id);
      if (changed) {
        haptic.select();
        onPage?.(id);
      }
      if (reduced) {
        pos.setValue(to);
        return;
      }
      Animated.spring(pos, { toValue: to, velocity, ...SETTLE, useNativeDriver: native }).start();
    },
    [pos, reduced, onPage],
  );

  const go = useCallback(
    (id: PageId) => {
      const to = nearest(target.current, id);
      if (to === target.current) return;
      Keyboard.dismiss();
      settle(to);
    },
    [settle],
  );
  const next = useCallback((step: 1 | -1) => go(PAGES[mod(Math.round(target.current) + step)]!), [go]);

  const grab = useCallback(() => {
    pos.stopAnimation();
    return live.current;
  }, [pos]);

  const value = useMemo<Pager>(() => ({ page, pos, width, go, next }), [page, pos, width, go, next]);
  const grabber = useMemo(() => ({ grab, release: settle }), [grab, settle]);
  return (
    <Ctx.Provider value={value}>
      <Grab.Provider value={grabber}>{children}</Grab.Provider>
    </Ctx.Provider>
  );
}

/** Where page `i` sits, in pages from the front, as an animated value wrapped into [-n/2, n/2). */
export function offsetNode(pos: Animated.Value, i: number): Animated.AnimatedAddition<number> {
  return Animated.add(Animated.modulo(Animated.add(Animated.multiply(pos, -1), i + PAGE_COUNT / 2), PAGE_COUNT), -PAGE_COUNT / 2);
}

/**
 * The pages, side by side on a ring. A sideways swipe anywhere turns them, unless something under the finger claims
 * the swipe first (a wish card's own swipe to remove), the way a photo carousel inside a feed does. On the web a
 * trackpad's sideways scroll and the arrow keys turn them too.
 */
export function PagerView({ pages }: { pages: Record<PageId, ReactNode> }) {
  const { pos, width, page, next } = usePager();
  const grabber = useContext(Grab)!;
  const base = useRef(0);
  const box = useRef<View>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > SLOP && Math.abs(g.dx) > Math.abs(g.dy) * SIDEWAYS,
        onPanResponderGrant: () => {
          base.current = grabber.grab();
          Keyboard.dismiss();
        },
        onPanResponderMove: (_e, g) => pos.setValue(base.current - g.dx / width),
        onPanResponderRelease: (_e, g) => grabber.release(landing(base.current, -g.dx / width, -g.vx / width), (-g.vx / width) * 1000),
        onPanResponderTerminate: (_e, g) => grabber.release(landing(base.current, -g.dx / width, 0), 0),
        onPanResponderTerminationRequest: () => false,
      }),
    [pos, width, grabber],
  );

  // The web: two-finger sideways scrolls on a trackpad, and the arrow keys when no field has focus.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = box.current as unknown as HTMLElement | null;
    let acc = 0;
    let quietAt = 0;
    let lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
      const now = Date.now();
      if (now < lockedUntil) return;
      if (now - quietAt > 220) acc = 0;
      quietAt = now;
      acc += e.deltaX;
      if (Math.abs(acc) > 80) {
        next(acc > 0 ? 1 : -1);
        acc = 0;
        lockedUntil = now + 650;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") next(1);
      else if (e.key === "ArrowLeft") next(-1);
    };
    el?.addEventListener?.("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener?.("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [next]);

  const layers = useMemo(
    () =>
      PAGES.map((id, i) => {
        const off = offsetNode(pos, i);
        return {
          id,
          translateX: Animated.multiply(off, width),
          // Pages recede a little as they leave, so the one arriving reads as in front.
          scale: off.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.94, 1, 0.94], extrapolate: "clamp" }),
          opacity: off.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.5, 1, 0.5], extrapolate: "clamp" }),
        };
      }),
    [pos, width],
  );

  return (
    <View ref={box} style={[StyleSheet.absoluteFill, Platform.OS === "web" ? ({ overflow: "hidden", touchAction: "pan-y" } as object) : { overflow: "hidden" }]} {...pan.panHandlers}>
      {layers.map((l) => {
        const front = l.id === page;
        return (
          <Animated.View
            key={l.id}
            pointerEvents={front ? "auto" : "none"}
            accessibilityElementsHidden={!front}
            importantForAccessibility={front ? "auto" : "no-hide-descendants"}
            aria-hidden={!front}
            style={[StyleSheet.absoluteFill, { opacity: l.opacity, transform: [{ translateX: l.translateX }, { scale: l.scale }] }]}
          >
            {pages[l.id]}
          </Animated.View>
        );
      })}
    </View>
  );
}

/** The same 0 to 1 closeness for anything that belongs to one page: 1 in front, 0 a page or more away. */
export function useNearness(id: PageId): Animated.AnimatedInterpolation<number> {
  const { pos } = usePager();
  return useMemo(() => offsetNode(pos, PAGES.indexOf(id)).interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0], extrapolate: "clamp" }), [pos, id]);
}
