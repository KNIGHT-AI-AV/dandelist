import { beforeAll, describe, expect, it, vi } from "vitest";

// React Native Web's pieces as plain objects, so the test sees exactly what the zoom changes about them.
const rn = vi.hoisted(() => {
  type Size = { width: number; height: number; scale: number; fontScale: number };
  type Handler = (d: { window: Size; screen: Size }) => void;
  let listeners: Handler[] = [];
  const dims = { window: { width: 1920, height: 950, scale: 1, fontScale: 1 }, screen: { width: 1920, height: 1080, scale: 1, fontScale: 1 } };
  const Dimensions = {
    get: (d: "window" | "screen") => dims[d],
    addEventListener(_type: string, h: Handler) {
      listeners.push(h);
      return { remove: () => Dimensions.removeEventListener("change", h) };
    },
    removeEventListener(_type: string, h: Handler) {
      listeners = listeners.filter((l) => l !== h);
    },
  };
  const resize = (width: number, height: number) => {
    dims.window = { ...dims.window, width, height };
    for (const l of listeners) l(dims);
  };
  return {
    dims,
    resize,
    listenerCount: () => listeners.length,
    Dimensions,
    PanResponder: { create: (config: object) => config },
    UIManager: { measureInWindow: (_node: unknown, cb: (x: number, y: number, w: number, h: number) => void) => cb(244, 122, 610, 61) },
  };
});
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Dimensions: rn.Dimensions, PanResponder: rn.PanResponder, UIManager: rn.UIManager }));

const win = { innerWidth: 1920, innerHeight: 950, addEventListener: () => {}, visualViewport: { addEventListener: () => {} } };
const style = new Map<string, string>();
vi.stubGlobal("window", win);
vi.stubGlobal("document", { documentElement: { style: { setProperty: (k: string, v: string) => style.set(k, v) } } });

let v: typeof import("./viewport");
beforeAll(async () => {
  v = await import("./viewport");
});

describe("the zoom for a window", () => {
  it("leaves phones, tablets and small laptops alone and grows to at most 1.75 on big screens", () => {
    expect(v.zoomFor(390, 844)).toBe(1);
    expect(v.zoomFor(1024, 768)).toBe(1);
    // 1.01 would only blur the type.
    expect(v.zoomFor(1440, 790)).toBe(1);
    expect(v.zoomFor(1920, 950)).toBe(1.22);
    expect(v.zoomFor(2560, 1300)).toBe(1.67);
    expect(v.zoomFor(3840, 2100)).toBe(1.75);
  });
});

describe("a zoomed page", () => {
  it("zooms the page and reports the window in the page's units, the same object while nothing changes", () => {
    expect(v.zoom()).toBe(1.22);
    expect(style.get("zoom")).toBe("1.22");
    const a = rn.Dimensions.get("window");
    expect(a).toMatchObject({ width: Math.round(1920 / 1.22), height: Math.round(950 / 1.22), scale: 1 });
    expect(rn.Dimensions.get("window")).toBe(a);
    // The screen keeps its own size.
    expect(rn.Dimensions.get("screen")).toMatchObject({ width: 1920, height: 1080 });
  });

  it("takes the new zoom before a resize reaches a listener, and removes a listener by its own handler", () => {
    const seen: number[] = [];
    const h = ({ window }: { window: { width: number } }) => void seen.push(window.width);
    const sub = rn.Dimensions.addEventListener("change", h as never);
    win.innerWidth = 2560;
    win.innerHeight = 1300;
    rn.resize(2560, 1300);
    expect(v.zoom()).toBe(1.67);
    expect(style.get("zoom")).toBe("1.67");
    expect(seen).toEqual([Math.round(2560 / 1.67)]);
    const before = rn.listenerCount();
    rn.Dimensions.removeEventListener("change", h as never);
    expect(rn.listenerCount()).toBe(before - 1);
    sub.remove();
    // Back to a laptop: no zoom at all.
    win.innerWidth = 1440;
    win.innerHeight = 790;
    const again = rn.Dimensions.addEventListener("change", (() => {}) as never);
    rn.resize(1440, 790);
    expect(v.zoom()).toBe(1);
    expect(style.get("zoom")).toBe("");
    win.innerWidth = 1920;
    win.innerHeight = 950;
    rn.resize(1920, 950);
    again.remove();
    expect(v.zoom()).toBe(1.22);
  });

  it("measures in the page's units and gives every gesture its distances and speeds in them", () => {
    const s = v.zoom();
    let measured: number[] = [];
    rn.UIManager.measureInWindow(null, (x, y, w, h) => (measured = [x, y, w, h]));
    expect(measured).toEqual([244 / s, 122 / s, 610 / s, 61 / s]);

    const moves: { dx: number; vx: number; numberActiveTouches: number }[] = [];
    const config = rn.PanResponder.create({ onPanResponderMove: (_e: unknown, g: { dx: number; vx: number; numberActiveTouches: number }) => moves.push(g), decelerationRate: 0.9 }) as {
      onPanResponderMove: (e: unknown, g: object) => void;
      decelerationRate: number;
    };
    config.onPanResponderMove({}, { stateID: 1, moveX: 0, moveY: 0, x0: 0, y0: 0, dx: 122, dy: 0, vx: 2.44, vy: 0, numberActiveTouches: 1 });
    expect(moves[0]).toMatchObject({ dx: 122 / s, vx: 2.44 / s, numberActiveTouches: 1 });
    expect(config.decelerationRate).toBe(0.9);
  });

  it("changes nothing about a gesture at zoom 1", () => {
    const g = { stateID: 1, moveX: 5, moveY: 5, x0: 1, y0: 1, dx: 4, dy: 4, vx: 1, vy: 1, numberActiveTouches: 1, _accountsForMovesUpTo: 0 };
    expect(v.scaledGesture(g, 1)).toBe(g);
    expect(v.scaledGesture(g, 2)).toMatchObject({ dx: 2, vx: 0.5, moveX: 2.5 });
  });
});
