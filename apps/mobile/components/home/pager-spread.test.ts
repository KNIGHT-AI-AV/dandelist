import { Fragment, act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageId } from "../../lib/pager";

/**
 * The home ring, mounted, at the iPhone Duo's sizes (owner, 2026-10-31: "Optimize for the iPhone duo"). The real
 * PagerProvider, PagerView and page sizes; the views and the motion stand in, and the window is whatever a test sets.
 * Open on the inner screen, two pages share it, each laid out at its own half; folded, or on a phone or a desktop, one
 * page fills the window as before.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ win: { width: 951, height: 669 }, os: "ios", coarse: true }));

vi.mock("react-native", () => {
  // Animated nodes that hold their sum, so a test can read where a layer sits.
  class Node {
    constructor(readonly at: () => number) {}
    interpolate() {
      return new Node(() => 0);
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
    Keyboard: { dismiss() {} },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: {
      get OS() {
        return h.os;
      },
    },
    StyleSheet: { absoluteFill: {} },
    View: "View",
    useWindowDimensions: () => ({ ...h.win, scale: 3, fontScale: 1 }),
  };
});
vi.mock("../../lib/motion", () => ({ haptic: { select() {} }, native: false, useReducedMotion: () => false }));
vi.mock("../../lib/drag-guard", () => ({ noteDrag() {} }));

const { PagerProvider, PagerView, usePager, usePageShown } = await import("./pager");
const { usePageSize } = await import("../../lib/page-size");

let root: ReactTestRenderer | null = null;
const ring = () => createElement(PagerProvider, { initial: "list", children: createElement(Fragment, null, createElement(PagerView, { pages }), createElement(Grab)) });
let pager: ReturnType<typeof usePager> | null = null;
function Page({ id }: { id: PageId }) {
  const size = usePageSize();
  return createElement("Page", { id, width: size.width });
}
let chatShown: boolean | null = null;
function Grab() {
  pager = usePager();
  chatShown = usePageShown("chat");
  return null;
}
const pages = { list: createElement(Page, { id: "list" }), chat: createElement(Page, { id: "chat" }), details: createElement(Page, { id: "details" }), money: createElement(Page, { id: "money" }), settings: createElement(Page, { id: "settings" }) };

async function mount(width: number, height: number) {
  h.win = { width, height };
  await act(async () => {
    root = create(ring());
  });
}
async function resize(width: number, height: number) {
  h.win = { width, height };
  await act(async () => root!.update(ring()));
}
/** Each page layer: which page, whether it takes touches, its width and left edge, and the width its page lays out at. */
function layers() {
  return root!.root
    .findAll((n) => (n.type as unknown) === "AnimatedView")
    .map((l: ReactTestInstance) => {
      const page = l.findAll((n) => (n.type as unknown) === "Page")[0]!;
      const x = (l.props.style.transform[0].translateX as { at(): number }).at();
      return { id: page.props.id as PageId, live: l.props.pointerEvents === "auto", width: l.props.style.width as number, x, laysOut: page.props.width as number };
    });
}
const inView = () => layers().filter((l) => l.live);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  pager = null;
  // After the unmount, whose clean-up still reads the browser window.
  vi.unstubAllGlobals();
  h.os = "ios";
});

describe("the iPhone Duo's inner screen, open (951 x 669)", () => {
  it("shows the list and the Dandy side by side, each laid out at its own half", async () => {
    await mount(951, 669);
    expect(pager!.span).toBe(2);
    expect(inView()).toEqual([
      { id: "list", live: true, width: 475.5, x: 0, laysOut: 475.5 },
      { id: "chat", live: true, width: 475.5, x: 475.5, laysOut: 475.5 },
    ]);
    // The rest wait off screen and take no touches.
    for (const l of layers().filter((x) => !x.live)) expect(l.x <= -475.5 || l.x >= 951).toBe(true);
  });

  it("doesn't turn for a page already in view, and brings others in on the near side", async () => {
    await mount(951, 669);
    await act(async () => pager!.go("chat"));
    expect(inView().map((l) => l.id)).toEqual(["list", "chat"]);
    await act(async () => pager!.go("details"));
    expect(inView().map((l) => [l.id, l.x])).toEqual([
      ["chat", 0],
      ["details", 475.5],
    ]);
    await act(async () => pager!.go("settings"));
    expect(inView().map((l) => [l.id, l.x])).toEqual([
      ["list", 475.5],
      ["settings", 0],
    ]);
  });

  it("counts the Dandy in view beside the list, for what waits on it being seen", async () => {
    await mount(951, 669);
    expect(chatShown).toBe(true);
    await act(async () => pager!.go("money"));
    expect(chatShown).toBe(false);
  });

  it("turns one page at a time with the arrow keys and swipes", async () => {
    await mount(951, 669);
    await act(async () => pager!.next(1));
    expect(pager!.page).toBe("chat");
    expect(inView().map((l) => l.id)).toEqual(["chat", "details"]);
    await act(async () => pager!.next(-1));
    await act(async () => pager!.next(-1));
    expect(pager!.page).toBe("settings");
  });

  it("closes to one page when folded to the outer screen, and opens again on the same page", async () => {
    await mount(951, 669);
    await act(async () => pager!.go("details"));
    await resize(466, 678);
    expect(pager!.span).toBe(1);
    expect(inView()).toEqual([{ id: "chat", live: true, width: 466, x: 0, laysOut: 466 }]);
    await resize(951, 669);
    expect(inView().map((l) => l.id)).toEqual(["chat", "details"]);
  });
});

describe("one page, as before", () => {
  it("in Split View, turned upright and on a phone", async () => {
    for (const [w, ht] of [
      [385, 669],
      [669, 951],
      [393, 852],
    ] as const) {
      await mount(w, ht);
      expect(inView()).toEqual([{ id: "list", live: true, width: w, x: 0, laysOut: w }]);
      await act(async () => root!.unmount());
    }
    root = null;
  });

  it("in a desktop browser, however wide", async () => {
    h.os = "web";
    const matchMedia = vi.fn(() => ({ matches: false, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("window", { matchMedia, addEventListener() {}, removeEventListener() {} });
    await mount(1440, 900);
    expect(pager!.span).toBe(1);
    expect(inView()).toEqual([{ id: "list", live: true, width: 1440, x: 0, laysOut: 1440 }]);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  });

  it("but an iPad or the Duo in a browser opens the spread", async () => {
    h.os = "web";
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
    await mount(951, 669);
    expect(inView().map((l) => [l.id, l.width])).toEqual([
      ["list", 475.5],
      ["chat", 475.5],
    ]);
  });
});

/**
 * The web's Tab order (axe, 2026-11-01): aria-hidden alone left the pages out of view in it, so Tab from the list went
 * through 33 unseen controls, Sign out and Delete account among them, before reaching the tabs. A page out of view is
 * inert there; a page in view never is, and phones get no inert at all.
 */
describe("pages out of view and the keyboard", () => {
  /** Each page and whether its layer is inert. */
  const inert = () =>
    Object.fromEntries(
      root!.root
        .findAll((n) => (n.type as unknown) === "AnimatedView")
        .map((l: ReactTestInstance) => [l.findAll((n) => (n.type as unknown) === "Page")[0]!.props.id as PageId, l.props.inert as boolean | undefined]),
    );

  it("leave the Tab order in a browser, and come back when turned to", async () => {
    h.os = "web";
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
    await mount(1440, 900);
    expect(inert()).toEqual({ list: false, chat: true, details: true, money: true, settings: true });
    await act(async () => pager!.go("money"));
    expect(inert()).toEqual({ list: true, chat: true, details: true, money: false, settings: true });
  });

  it("keep both pages of a spread in it", async () => {
    h.os = "web";
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
    await mount(951, 669);
    expect(inert()).toEqual({ list: false, chat: false, details: true, money: true, settings: true });
  });

  it("don't turn with the arrow keys while another screen covers them (an open wish leaves the list inert)", async () => {
    h.os = "web";
    let onKey: ((e: { key: string; target: unknown }) => void) | null = null;
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }),
      addEventListener: (type: string, fn: (e: { key: string; target: unknown }) => void) => void (type === "keydown" && (onKey = fn)),
      removeEventListener() {},
    });
    let covered = true;
    h.win = { width: 1440, height: 900 };
    await act(async () => {
      root = create(ring(), { createNodeMock: () => ({ closest: (s: string) => (s === "[inert]" && covered ? {} : null), addEventListener() {}, removeEventListener() {} }) });
    });
    await act(async () => onKey!({ key: "ArrowRight", target: null }));
    expect(pager!.page).toBe("list");
    // Uncovered again, the arrows turn the pages as before.
    covered = false;
    await act(async () => onKey!({ key: "ArrowRight", target: null }));
    expect(pager!.page).toBe("chat");
  });

  it("sit in the main landmark on the web, and a phone gets no role", async () => {
    h.os = "web";
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, media: "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
    await mount(1440, 900);
    expect(root!.root.findAll((n) => n.props.role === "main")).toHaveLength(1);
    await act(async () => root!.unmount());
    h.os = "ios";
    await mount(393, 852);
    expect(root!.root.findAll((n) => n.props.role === "main")).toHaveLength(0);
  });

  it("are left to aria-hidden and the screen reader's own rules on a phone", async () => {
    await mount(393, 852);
    expect(Object.values(inert()).every((v) => v === undefined)).toBe(true);
  });
});
