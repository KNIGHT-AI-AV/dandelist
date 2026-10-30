import { Dimensions, PanResponder, Platform, UIManager, type PanResponderGestureState, type ScaledSize } from "react-native";

/**
 * Window-size scaling on the web (owner, 2026-10-29: "super amazing intelligence for scaling depending on the size of
 * the window so that anyone on any device can use it"). A large window zooms the whole page by S, the way browser zoom
 * would, so the phone-sized column grows with the screen instead of filling a fifth of it: S is 1 up to 900 x 780 and
 * at most 1.75. Phones and the native apps never zoom.
 *
 * Under html { zoom } the page lays out in a window divided by S (measured in Chromium and WebKit: the root fits
 * exactly, fixed bars stay on the bottom edge), but visualViewport and pointer positions stay in screen pixels, and so
 * does getBoundingClientRect in today's engines. React Native Web reads those for Dimensions, measureInWindow and every
 * gesture, so they are divided here, once, where it reads them (a rectangle by what a probe box shows it needs). Code
 * that reads nativeEvent.pageX or pageY itself divides by zoom().
 */
export const ZOOM_FROM = { width: 900, height: 780 };
export const MAX_ZOOM = 1.75;

/** The zoom for a window: none below 5%, where it would only blur the type. */
export function zoomFor(width: number, height: number): number {
  const s = Math.min(MAX_ZOOM, width / ZOOM_FROM.width, height / ZOOM_FROM.height);
  return s >= 1.05 ? Math.round(s * 100) / 100 : 1;
}

let S = 1;
/** The page's zoom now: 1 on phones and in the native apps. */
export const zoom = () => S;

/**
 * What a measured rectangle is divided by to be in the page's units: the zoom in today's engines, which answer in
 * screen pixels, but 1 where getBoundingClientRect already answers in the page's units (WebKit before its fix for bug
 * 300474, late 2025, and Chrome before 128; independent review of #106). Measured on a probe box, never assumed.
 */
let rectScale = 1;
export function rectScaleOf(measure: () => number, s: number): number {
  if (s === 1) return 1;
  const r = measure() / 100;
  // Anything but the two known answers is read as today's behaviour.
  return Math.abs(r - 1) < 0.02 ? 1 : s;
}

const GESTURE_KEYS = ["moveX", "moveY", "x0", "y0", "dx", "dy", "vx", "vy"] as const;

/** A gesture's distances and speeds in the page's own units. */
export function scaledGesture(g: PanResponderGestureState, s: number): PanResponderGestureState {
  if (s === 1) return g;
  const out = { ...g };
  for (const k of GESTURE_KEYS) out[k] = g[k] / s;
  return out;
}

export function scaledSize(d: ScaledSize, s: number): ScaledSize {
  return s === 1 ? d : { ...d, width: Math.round(d.width / s), height: Math.round(d.height / s) };
}

type Handler = (...args: unknown[]) => unknown;

/** A PanResponder's config whose handlers see the gesture in the page's units. */
export function scaledConfig<T extends object>(config: T, s: () => number): T {
  const out: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const [key, fn] of Object.entries(config)) {
    if (typeof fn !== "function" || !key.startsWith("on")) continue;
    out[key] = (e: unknown, g: PanResponderGestureState, ...rest: unknown[]) => (fn as Handler)(e, g ? scaledGesture(g, s()) : g, ...rest);
  }
  return out as T;
}

let installed = false;

/** Zooms the page for this window and keeps React Native Web's measurements in the page's units. Web only, once. */
export function installZoom() {
  if (Platform.OS !== "web" || installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  // A browser without CSS zoom (Firefox before 126) keeps the phone-sized column rather than half a correction.
  const canZoom = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "2");
  const probe = () => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none";
    (document.body ?? document.documentElement).appendChild(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
  };
  const apply = () => {
    const next = canZoom ? zoomFor(window.innerWidth, window.innerHeight) : 1;
    if (next === S) return;
    S = next;
    document.documentElement.style.setProperty("zoom", S === 1 ? "" : String(S));
    rectScale = rectScaleOf(probe, S);
  };
  apply();

  // Dimensions reads visualViewport. The same scaled object comes back while nothing changed, so a hook that
  // re-reads it on mount doesn't render again for nothing.
  const cache = new WeakMap<ScaledSize, { s: number; size: ScaledSize }>();
  const scaled = (d: ScaledSize) => {
    const hit = cache.get(d);
    if (hit && hit.s === S) return hit.size;
    const size = scaledSize(d, S);
    cache.set(d, { s: S, size });
    return size;
  };
  const get = Dimensions.get.bind(Dimensions);
  Dimensions.get = ((dim: "window" | "screen") => (dim === "window" ? scaled(get(dim)) : get(dim))) as typeof Dimensions.get;
  // A resize is read before it is passed on, so the zoom for the new window is in place when listeners see it.
  const wrapped = new WeakMap<Handler, Handler>();
  const add = Dimensions.addEventListener.bind(Dimensions);
  const remove = (Dimensions as unknown as { removeEventListener?: (type: string, h: Handler) => void }).removeEventListener?.bind(Dimensions);
  Dimensions.addEventListener = ((type: "change", handler: Handler) => {
    const w: Handler = (d) => {
      apply();
      const dims = d as { window: ScaledSize; screen: ScaledSize };
      return handler({ ...dims, window: scaled(dims.window) });
    };
    wrapped.set(handler, w);
    const sub = add(type, w as never);
    return { remove: () => sub.remove() };
  }) as typeof Dimensions.addEventListener;
  if (remove) {
    (Dimensions as unknown as { removeEventListener: (type: string, h: Handler) => void }).removeEventListener = (type, h) => remove(type, wrapped.get(h) ?? h);
  }
  window.visualViewport?.addEventListener("resize", apply);
  window.addEventListener("resize", apply);

  // measureInWindow reads getBoundingClientRect: screen pixels in today's engines, the page's units in older ones.
  const ui = UIManager as unknown as { measureInWindow?: (node: unknown, cb: (x: number, y: number, w: number, h: number) => void) => void };
  const measureInWindow = ui.measureInWindow?.bind(UIManager);
  if (measureInWindow) ui.measureInWindow = (node, cb) => measureInWindow(node, (x, y, w, h) => cb(x / rectScale, y / rectScale, w / rectScale, h / rectScale));

  // Every gesture's distances and speeds, in the page's units.
  const create = PanResponder.create.bind(PanResponder);
  PanResponder.create = ((config: Parameters<typeof PanResponder.create>[0]) => create(scaledConfig(config, zoom))) as typeof PanResponder.create;
}

installZoom();
