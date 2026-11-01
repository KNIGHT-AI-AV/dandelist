import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Keyboard, PanResponder, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { noteDrag } from "../../lib/drag-guard";
import { haptic, native, useReducedMotion } from "../../lib/motion";
import { PAGES, PAGE_COUNT, inView, landing, mod, nearestIn, type PageId } from "../../lib/pager";
import { spreadOf } from "../../lib/spread";
import { PageSizeProvider } from "../../lib/page-size";
import { pagesStill } from "../../lib/swipe-intent";

/** Critically damped, about a third of a second: the page arrives without bouncing (Apple: damping 1, response 0.35). */
const SETTLE = { mass: 1, stiffness: 322, damping: 35.9 };
/** A sideways move this long, and clearly more sideways than down, is a page swipe. */
const SLOP = 12;
const SIDEWAYS = 1.4;

export interface Pager {
  /** The page in front (or on its way to the front); in a spread, the one on the left. */
  page: PageId;
  /** Position in pages; never wraps, so motion is continuous all the way round. */
  pos: Animated.Value;
  /** One page's width: the window's, or half of it in a spread. */
  width: number;
  /** Pages side by side: 1, or 2 on a wide touch screen held sideways (lib/spread.ts). */
  span: 1 | 2;
  /** Whether a page is in view: the one in front, and in a spread the one beside it. */
  shows(page: PageId): boolean;
  go(page: PageId): void;
  next(step: 1 | -1): void;
}

const Ctx = createContext<Pager | null>(null);
const Grab = createContext<{ grab(): number; release(target: number, velocity: number): void } | null>(null);
/** For a card that takes its own sideways swipe inside the ring (lib/swipe-intent.ts). */
export interface PageSwipe {
  /** Whether the pages have been still long enough for a card to take a sideways drag. */
  still(): boolean;
  /** Turns the page the way a finger moving in `dir` (1 right, -1 left) would. */
  turn(dir: 1 | -1): void;
}
const Swipe = createContext<PageSwipe | null>(null);

export function usePager(): Pager {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePager must be used inside PagerProvider");
  return ctx;
}

/** Whether a page of the ring is in view, or null outside the ring (a pushed screen such as New wish). */
export function usePageShown(page: PageId): boolean | null {
  const ctx = useContext(Ctx);
  return ctx ? ctx.shows(page) : null;
}

/** In a browser, whether its main pointer is a finger (an iPhone, an iPad) rather than a mouse or a trackpad. */
const coarse = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null);

/** Whether the screen is worked with fingers: always in the app, and in a browser when coarse() says so. */
function useTouchScreen(): boolean {
  const [touch, setTouch] = useState(() => (Platform.OS === "web" ? !!coarse()?.matches : true));
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const query = coarse();
    if (!query) return;
    const on = () => setTouch(query.matches);
    on();
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, []);
  return touch;
}

/** The ring's side of a card's own swipe, or null outside the ring. */
export function usePageSwipe(): PageSwipe | null {
  return useContext(Swipe);
}

/**
 * Holds the ring's position. Everything that follows the swipe (the pages, the dots, the dock) reads `pos`, so
 * they move together frame by frame.
 */
export function PagerProvider({ initial, onPage, children }: { initial: PageId; onPage?(page: PageId): void; children: ReactNode }) {
  const win = useWindowDimensions();
  const span = spreadOf(win.width, win.height, useTouchScreen());
  const width = win.width / span;
  const reduced = useReducedMotion();
  const start = PAGES.indexOf(initial);
  const pos = useRef(new Animated.Value(start)).current;
  // Where it is right now (followed through a listener, so a grab mid-flight starts from the true place) and where
  // it is heading.
  const live = useRef(start);
  const target = useRef(start);
  const [page, setPage] = useState<PageId>(initial);
  // When the pages last started moving (a swipe taken, a page set going), so a card can leave the next swipe to them.
  const movedAt = useRef(0);
  useEffect(() => {
    const id = pos.addListener(({ value }) => (live.current = value));
    return () => pos.removeListener(id);
  }, [pos]);

  const settle = useCallback(
    (to: number, velocity = 0) => {
      const changed = Math.round(to) !== Math.round(target.current);
      target.current = to;
      movedAt.current = Date.now();
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
      // In a spread a page already in view stays where it is: the list's "Talk" with the Dandy beside it turns nothing.
      const to = nearestIn(target.current, id, span);
      if (to === target.current) return;
      Keyboard.dismiss();
      settle(to);
    },
    [settle, span],
  );
  // One page along, whatever is in view: a spread's arrow keys and swipes turn it a page at a time too.
  const next = useCallback(
    (step: 1 | -1) => {
      Keyboard.dismiss();
      settle(Math.round(target.current) + step);
    },
    [settle],
  );

  const grab = useCallback(() => {
    movedAt.current = Date.now();
    pos.stopAnimation();
    return live.current;
  }, [pos]);

  const shows = useCallback((id: PageId) => inView(PAGES.indexOf(id), PAGES.indexOf(page), span), [page, span]);
  const value = useMemo<Pager>(() => ({ page, pos, width, span, shows, go, next }), [page, pos, width, span, shows, go, next]);
  const grabber = useMemo(() => ({ grab, release: settle }), [grab, settle]);
  // A finger moving left brings the next page, as the ring's own swipe does.
  const swipe = useMemo<PageSwipe>(() => ({ still: () => pagesStill(movedAt.current, Date.now()), turn: (dir) => next(dir === 1 ? -1 : 1) }), [next]);
  return (
    <Ctx.Provider value={value}>
      <Grab.Provider value={grabber}>
        <Swipe.Provider value={swipe}>{children}</Swipe.Provider>
      </Grab.Provider>
    </Ctx.Provider>
  );
}

/** Where page `i` sits, in pages from the front, as an animated value wrapped into [-n/2, n/2). */
export function offsetNode(pos: Animated.Value, i: number): Animated.AnimatedAddition<number> {
  return Animated.add(Animated.modulo(Animated.add(Animated.multiply(pos, -1), i + PAGE_COUNT / 2), PAGE_COUNT), -PAGE_COUNT / 2);
}

/**
 * The pages, side by side on a ring. A sideways swipe anywhere turns them, unless something under the finger claims
 * the swipe first (a wish card's own swipe to remove, which it leaves to the ring for a moment after the pages move),
 * the way a photo carousel inside a feed does. On the web a
 * trackpad's sideways scroll and the arrow keys turn them too.
 */
export function PagerView({ pages }: { pages: Record<PageId, ReactNode> }) {
  const { pos, width, span, shows, next } = usePager();
  const { height } = useWindowDimensions();
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
          noteDrag();
        },
        onPanResponderMove: (_e, g) => {
          noteDrag();
          pos.setValue(base.current - g.dx / width);
        },
        onPanResponderRelease: (_e, g) => {
          noteDrag();
          grabber.release(landing(base.current, -g.dx / width, -g.vx / width), (-g.vx / width) * 1000);
        },
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
        // Pages recede a little as they leave, so the one arriving reads as in front. In a spread both pages in view
        // stand full size, side by side.
        const inputRange = span === 2 ? [-1, 0, 1, 2] : [-1, 0, 1];
        const full = span === 2 ? [1, 1] : [1];
        return {
          id,
          translateX: Animated.multiply(off, width),
          scale: off.interpolate({ inputRange, outputRange: [0.94, ...full, 0.94], extrapolate: "clamp" }),
          opacity: off.interpolate({ inputRange, outputRange: [0.5, ...full, 0.5], extrapolate: "clamp" }),
        };
      }),
    [pos, width, span],
  );

  return (
    // On the web a drag that starts selecting text ends the gesture, so the ring doesn't select (fields still do).
    <View ref={box} style={[StyleSheet.absoluteFill, Platform.OS === "web" ? ({ overflow: "hidden", touchAction: "pan-y", userSelect: "none" } as object) : { overflow: "hidden" }]} {...pan.panHandlers}>
      {layers.map((l) => {
        const front = shows(l.id);
        return (
          <Animated.View
            key={l.id}
            pointerEvents={front ? "auto" : "none"}
            accessibilityElementsHidden={!front}
            importantForAccessibility={front ? "auto" : "no-hide-descendants"}
            aria-hidden={!front}
            // On the web a page out of view also leaves the Tab order: with aria-hidden alone, Tab from the list went
            // through 33 unseen controls on the other pages (Sign out and Delete account among them) before the tabs.
            {...(Platform.OS === "web" ? { inert: !front } : null)}
            // One page wide from the left edge: the whole window, or its half of a spread, which lays out at that width.
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, opacity: l.opacity, transform: [{ translateX: l.translateX }, { scale: l.scale }] }}
          >
            <PageSizeProvider width={width} height={height}>
              {pages[l.id]}
            </PageSizeProvider>
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
