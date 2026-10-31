import { Fragment, act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The list's ideas while typing, across a fold (review R45-DUO-FOCUS-1). The real PagerProvider, HomeProvider and Dock;
 * the composer stands in and reports what it was given. Typing on the list on one page, then unfolding to a spread
 * without the field losing focus: the field moves under the chat and the list's ideas must go with it, the words kept.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

type ComposerProps = { value: string; onChangeText(t: string): void; onFocusChange?(on: boolean): void };
const h = vi.hoisted(() => ({ win: { width: 393, height: 852 }, composer: null as ComposerProps | null }));

vi.mock("react-native", () => {
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
    Platform: { OS: "ios" },
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {} },
    View: "View",
    useWindowDimensions: () => ({ ...h.win, scale: 3, fontScale: 1 }),
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("expo-router", () => ({ router: { push() {} } }));
vi.mock("../../lib/agent", () => ({ transcribeWish: async () => "" }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ api: async () => null }) }));
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ name: "Dandy" }) }));
vi.mock("../../lib/motion", () => ({ haptic: { select() {} }, native: false, useReducedMotion: () => false, usePress: () => ({ scale: 1, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/drag-guard", () => ({ noteDrag() {} }));
vi.mock("../../lib/theme", () => ({ layout: { gutter: () => 20, column: 560, list: 520, control: { primary: 56, chip: 50, icon: 44 }, headerBar: 44 }, space: { 24: 24 }, usePalette: () => ({ ink: "#fff", bgRgb: "0,0,0" }) }));
vi.mock("../inputs", () => ({
  KeyboardDock: ({ children }: { children: ReactNode }) => createElement("KeyboardDock", null, children),
  // The field: what it shows and whom it tells about focus.
  Composer: (props: ComposerProps) => {
    h.composer = props;
    return createElement("Composer", { value: props.value });
  },
  dockRoom: () => 100,
}));
vi.mock("../lux", () => ({ Icon: "Icon", Wordmark: "Wordmark" }));
vi.mock("../voice/say-wish", () => ({ ListeningStrip: "ListeningStrip", MicButton: "MicButton", useVoiceWish: () => ({ supported: false, phase: "idle" }) }));
vi.mock("../sound-button", () => ({ SoundButton: "SoundButton" }));
vi.mock("../help", () => ({ HelpButton: "HelpButton" }));
vi.mock("./profile-avatar", () => ({ ProfileAvatar: "ProfileAvatar" }));

const { PagerProvider, usePager } = await import("./pager");
const { HomeProvider, useHome } = await import("./bridge");
const { Dock } = await import("./chrome");

let root: ReactTestRenderer | null = null;
let home: ReturnType<typeof useHome> | null = null;
let pager: ReturnType<typeof usePager> | null = null;
function Probe() {
  home = useHome();
  pager = usePager();
  return null;
}
const tree = () => createElement(PagerProvider, { initial: "list", children: createElement(HomeProvider, { children: createElement(Fragment, null, createElement(Dock), createElement(Probe)) }) });
async function mount(width: number, height: number) {
  h.win = { width, height };
  await act(async () => {
    root = create(tree());
  });
}
async function resize(width: number, height: number) {
  h.win = { width, height };
  await act(async () => root!.update(tree()));
}
const focus = (on: boolean) => act(async () => h.composer!.onFocusChange!(on));
const type = (text: string) => act(async () => h.composer!.onChangeText(text));

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  home = null;
  pager = null;
  h.composer = null;
});

describe("the list's ideas while typing (review R45-DUO-FOCUS-1)", () => {
  it("show on a phone while the field has focus on the list, and go when it blurs", async () => {
    await mount(393, 852);
    await focus(true);
    expect(home!.focused).toBe(true);
    await focus(false);
    expect(home!.focused).toBe(false);
  });

  it("go when the screen unfolds mid-typing, keep the words, and come back when it folds", async () => {
    await mount(393, 852);
    await focus(true);
    await type("a vintage Rolex");
    expect(home!.focused).toBe(true);
    // Unfolded with the field still focused: no blur comes.
    await resize(951, 669);
    expect(pager!.span).toBe(2);
    expect(home!.focused).toBe(false);
    expect(home!.draft).toBe("a vintage Rolex");
    expect(h.composer!.value).toBe("a vintage Rolex");
    await resize(393, 852);
    expect(home!.focused).toBe(true);
    expect(h.composer!.value).toBe("a vintage Rolex");
  });

  it("never show in a spread, where the field sits under the chat", async () => {
    await mount(951, 669);
    await focus(true);
    expect(home!.focused).toBe(false);
  });

  it("don't show while typing over the chat", async () => {
    await mount(393, 852);
    await act(async () => pager!.go("chat"));
    await focus(true);
    expect(home!.focused).toBe(false);
  });
});
