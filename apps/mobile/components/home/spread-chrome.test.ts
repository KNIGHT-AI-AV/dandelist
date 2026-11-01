import { Fragment, act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What sits over the ring in a spread (owner, 2026-10-31: the iPhone Duo), mounted with the real PagerProvider: the
 * composer belongs to the chat's page, under the chat and laid out at its width, and leaves with it; the undo note
 * sits low in the half that shows the list or Details, never across the fold. On a phone both are as before.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ win: { width: 951, height: 669 }, top: 0, os: "ios" }));

vi.mock("react-native", () => {
  class Node {
    constructor(readonly at: () => number) {}
    interpolate(c: { inputRange: number[]; outputRange: number[] }) {
      // Linear and clamped, enough to read an opacity.
      return new Node(() => {
        const x = this.at();
        const r = c.inputRange;
        const o = c.outputRange;
        if (x <= r[0]!) return o[0]!;
        for (let i = 1; i < r.length; i++) if (x <= r[i]!) return o[i - 1]! + ((o[i]! - o[i - 1]!) * (x - r[i - 1]!)) / (r[i]! - r[i - 1]!);
        return o[o.length - 1]!;
      });
    }
  }
  class Value extends Node {
    v: number;
    constructor(v: number) {
      super(() => this.v);
      this.v = v;
    }
    setValue(v: number) {
      this.v = v;
    }
    addListener() {
      return "l";
    }
    removeListener() {}
    stopAnimation() {}
  }
  const num = (x: unknown) => (x instanceof Node ? x.at() : (x as number));
  return {
    Animated: {
      View: "AnimatedView",
      Value,
      add: (a: unknown, b: unknown) => new Node(() => num(a) + num(b)),
      multiply: (a: unknown, b: unknown) => new Node(() => num(a) * num(b)),
      modulo: (a: unknown, m: number) => new Node(() => ((num(a) % m) + m) % m),
      spring: (v: Value, c: { toValue: number }) => ({ start: () => v.setValue(c.toValue) }),
    },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Keyboard: { dismiss() {} },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: {
      get OS() {
        return h.os;
      },
    },
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {} },
    View: "View",
    useWindowDimensions: () => ({ ...h.win, scale: 3, fontScale: 1 }),
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: h.top, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("expo-router", () => ({ router: { push() {} }, useFocusEffect() {} }));
vi.mock("../../lib/agent", () => ({ transcribeWish: async () => "" }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ api: async () => null }) }));
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ name: "Dandy" }) }));
vi.mock("../../lib/motion", () => ({ haptic: { select() {} }, native: false, useReducedMotion: () => false, usePress: () => ({ scale: 1, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/drag-guard", () => ({ noteDrag() {} }));
vi.mock("../../lib/theme", () => ({ layout: { gutter: (w: number) => (w < 400 ? 20 : w < 744 ? 24 : 32), column: 560, list: 520, control: { primary: 56, chip: 50, icon: 44 }, headerBar: 44 }, space: { 12: 12, 16: 16, 24: 24 }, usePalette: () => ({ ink: "#fff", bgRgb: "0,0,0" }) }));
vi.mock("../../lib/wishes", () => ({ useWishes: () => ({ remove: async () => {} }) }));
vi.mock("../inputs", async () => {
  const { usePageSize } = await import("../../lib/page-size");
  return {
    // The composer's dock reports the width it lays out at.
    KeyboardDock: ({ children }: { children: ReactNode }) => createElement("KeyboardDock", { laysOut: usePageSize().width }, children),
    Composer: "Composer",
    dockRoom: () => 100,
  };
});
vi.mock("../lux", () => ({ Icon: "Icon", Wordmark: "Wordmark" }));
vi.mock("../voice/say-wish", () => ({ ListeningStrip: "ListeningStrip", MicButton: "MicButton", useVoiceWish: () => ({ supported: false, phase: "idle" }) }));
vi.mock("./bridge", () => {
  const home = { dock: 0, setDock() {}, draft: "", setDraft() {}, ask() {}, busy: false, setFocused() {}, composer: { current: null } };
  return { useHome: () => home };
});
vi.mock("../sound-button", () => ({ SoundButton: "SoundButton" }));
vi.mock("../help", () => ({ HelpButton: "HelpButton" }));
vi.mock("./profile-avatar", () => ({ ProfileAvatar: "ProfileAvatar" }));
vi.mock("../list/confirm-remove", () => ({ ConfirmRemove: "ConfirmRemove" }));
vi.mock("../list/undo-toast", () => ({ Toast: "Toast" }));
vi.mock("../list/use-removals", () => ({ useRemovals: () => ({ pending: null, remove() {}, undo() {}, hold() {}, release() {} }) }));

const { PagerProvider, usePager } = await import("./pager");
const { Dock, TopBar } = await import("./chrome");
const { RemovalsProvider } = await import("./removals");

let root: ReactTestRenderer | null = null;
let pager: ReturnType<typeof usePager> | null = null;
function Grab() {
  pager = usePager();
  return null;
}
async function mount(width: number, height: number) {
  h.win = { width, height };
  await act(async () => {
    root = create(createElement(PagerProvider, { initial: "list", children: createElement(RemovalsProvider, { children: createElement(Fragment, null, createElement(Dock), createElement(Grab)) }) }));
  });
}
const go = (id: Parameters<NonNullable<typeof pager>["go"]>[0]) => act(async () => pager!.go(id));
/** The composer's layer: where it sits, how wide, whether it takes touches, and the width the dock lays out at. */
function dock() {
  const layer = root!.root.find((n) => (n.type as unknown) === "AnimatedView" && n.findAll((c) => (c.type as unknown) === "KeyboardDock").length > 0) as ReactTestInstance;
  const style = layer.props.style as { width?: number; transform: { translateX?: { at(): number } }[]; opacity: { at(): number } | number };
  const x = style.transform[0]!.translateX;
  return {
    x: x ? x.at() : 0,
    width: style.width,
    opacity: typeof style.opacity === "number" ? style.opacity : style.opacity.at(),
    live: layer.props.pointerEvents !== "none",
    laysOut: layer.findAll((c) => (c.type as unknown) === "KeyboardDock")[0]!.props.laysOut as number,
  };
}
const toast = () => {
  const t = root!.root.find((n) => (n.type as unknown) === "Toast");
  return { left: t.props.left as number, width: t.props.width as number | undefined, side: t.props.side as number, bottom: t.props.bottom as number };
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  pager = null;
  h.top = 0;
});

/** How much of the page colour the bar's washes lay over a point `y` from the top, together (each a linear gradient). */
function wash(y: number): number {
  const layers = root!.root.findAll((n) => (n.type as unknown) === "LinearGradient");
  let clear = 1;
  for (const l of layers) {
    const height = (l.props.style as { height: number }).height;
    const stops = (l.props.locations as number[]).map((at, i) => ({ at: at * height, a: Number(/,\s*([\d.]+)\)$/.exec((l.props.colors as string[])[i]!)![1]) }));
    if (y >= height) continue;
    const i = stops.findIndex((s) => s.at >= y);
    const a = i <= 0 ? stops[0]!.a : stops[i - 1]!.a + ((stops[i]!.a - stops[i - 1]!.a) * (y - stops[i - 1]!.at)) / (stops[i]!.at - stops[i - 1]!.at);
    clear *= 1 - a;
  }
  return 1 - clear;
}
/** The bar's one wash before 2026-11-01: 0.94, 0.7 at 60% and nothing at the foot of the bar plus 28. */
function before(y: number, edge: number): number {
  const t = y / (edge + 28);
  return t >= 1 ? 0 : t <= 0.6 ? 0.94 - (0.24 * t) / 0.6 : 0.7 * (1 - (t - 0.6) / 0.4);
}

describe("the bar over the pages", () => {
  // Owner's screenshot, 2026-11-01: a quote scrolled under the bar showed at about half brightness behind the wordmark.
  it("lays at least 90% of the page colour under its controls, and below the bar no more than before", async () => {
    for (const top of [0, 59]) {
      h.top = top;
      h.win = { width: 430, height: 932 };
      await act(async () => {
        root = create(createElement(PagerProvider, { initial: "list", children: createElement(TopBar) }));
      });
      const edge = top + 44;
      // The controls: from 5 points below the bar's top to 5 above its foot.
      for (let y = top + 5; y <= edge - 5; y++) expect(wash(y)).toBeGreaterThanOrEqual(0.9);
      // Below the bar, where a page's first line rests, nothing changed.
      for (let y = edge; y <= edge + 30; y++) expect(wash(y)).toBeCloseTo(before(y, edge), 5);
      await act(async () => root?.unmount());
      root = null;
    }
  });
});

/**
 * Landmarks on the web (axe, 2026-11-01: no main region, and content outside any landmark): the bar is the banner and
 * the composer a region named like its field, so a screen reader can jump between them and the page. Web only: on iOS
 * a role would replace the traits the controls already give.
 */
describe("the bar and the composer as landmarks", () => {
  const roles = () => root!.root.findAll((n) => typeof n.props.role === "string").map((n) => [n.props.role, n.props["aria-label"]]);
  it("are a banner and a named region on the web, and nothing new on a phone", async () => {
    for (const os of ["web", "ios"]) {
      h.os = os;
      h.win = { width: 430, height: 932 };
      try {
        await act(async () => {
          root = create(createElement(PagerProvider, { initial: "list", children: createElement(RemovalsProvider, { children: createElement(Fragment, null, createElement(TopBar), createElement(Dock)) }) }));
        });
        const found = roles().filter(([r]) => r === "banner" || r === "region");
        expect([os, found]).toEqual([os, os === "web" ? [["banner", undefined], ["region", "Message Dandy"]] : []]);
      } finally {
        await act(async () => root?.unmount());
        root = null;
        h.os = "ios";
      }
    }
  });
});

describe("the composer in a spread", () => {
  it("sits under the Dandy, at its page's width, and moves with it", async () => {
    await mount(951, 669);
    expect(dock()).toEqual({ x: 475.5, width: 475.5, opacity: 1, live: true, laysOut: 475.5 });
    await go("details");
    expect(dock()).toMatchObject({ x: 0, width: 475.5, opacity: 1, live: true });
  });

  it("leaves with the Dandy: none under the money and settings", async () => {
    await mount(951, 669);
    await go("money");
    expect(pager!.shows("chat")).toBe(false);
    expect(dock()).toMatchObject({ opacity: 0, live: false });
  });

  it("is the whole width under the list on a phone, as before", async () => {
    await mount(393, 852);
    expect(dock()).toMatchObject({ x: 0, width: undefined, live: true, laysOut: 393 });
  });
});

describe("the undo note in a spread", () => {
  it("sits low in the list's half, wherever the list is", async () => {
    await mount(951, 669);
    expect(toast()).toEqual({ left: 0, width: 475.5, side: 24, bottom: 16 });
    await go("settings");
    expect(toast()).toMatchObject({ left: 475.5, width: 475.5 });
  });

  it("follows Details too", async () => {
    await mount(951, 669);
    await go("details");
    expect(pager!.page).toBe("chat");
    expect(toast()).toMatchObject({ left: 475.5, width: 475.5 });
  });

  it("is the whole width above the composer on a phone, as before", async () => {
    await mount(393, 852);
    expect(toast()).toEqual({ left: 0, width: undefined, side: 20, bottom: 100 - 12 });
  });
});
