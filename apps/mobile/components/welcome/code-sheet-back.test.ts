import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Android's Back with the save sheet up (#210's review, 2026-11-02): it closes the sheet, the way a drag down does, and
 * the welcome underneath stays where it was. Before, the sheet had no Back of its own, so the welcome's listener stepped
 * the page back from the reveal while the sheet stayed on screen. The real CodeSheet; React Native's Back registry,
 * animations and the views stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  os: "android",
  /** Back listeners as Android keeps them: the newest is asked first. */
  back: [] as (() => boolean)[],
  /** Where each sheet animation was sent. */
  moves: [] as number[],
}));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("react-native", () => {
  class Value {
    constructor(public v: number) {}
    setValue(v: number) {
      this.v = v;
    }
    interpolate(config: unknown) {
      return config;
    }
  }
  const run = (_v: unknown, config: { toValue: number }) => ({
    start: (done?: (r: { finished: boolean }) => void) => {
      h.moves.push(config.toValue);
      done?.({ finished: true });
    },
  });
  return {
    Animated: { Value, timing: run, spring: run, View: passThrough("AnimatedView"), add: () => 0 },
    BackHandler: {
      addEventListener: (_e: string, fn: () => boolean) => {
        h.back.push(fn);
        return { remove: () => void (h.back = h.back.filter((f) => f !== fn)) };
      },
    },
    Keyboard: { dismiss: () => {} },
    Linking: { openURL: async () => {} },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: {
      get OS() {
        return h.os;
      },
      select: (o: Record<string, unknown>) => o[h.os] ?? o.default,
    },
    Pressable: passThrough("Pressable"),
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (s: unknown) => s },
    Text: "Text",
    View: passThrough("View"),
    useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("../../lib/motion", () => ({
  FLICK: 0.11,
  ease: { sheet: () => 0, out: () => 0, cinema: () => 0 },
  haptic: { error() {}, select() {}, success() {} },
  native: true,
  spring: { snap: {}, settle: {} },
  useReducedMotion: () => false,
}));
vi.mock("../../lib/theme", () => ({
  fonts: {},
  layout: { gutter: () => 20, list: 520, stack: { tight: 8, base: 16, section: 32 } },
  radius: { sheet: 28, pill: 999 },
  shadow: { sheet: {} },
  space: { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24 },
  type: { body: {}, callout: {}, footnote: {}, label: {} },
  usePalette: () => ({ bg: "#000", ink: "#fff", ink2: "#ccc", ink3: "#999", hair: "#333", accent: "#c90", bgRgb: "0,0,0" }),
  useType: () => ({ title1: {}, display: {} }),
}));
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ name: "Dandy" }) }));
vi.mock("../dandy-avatar", () => ({ DandyAvatar: "DandyAvatar" }));
vi.mock("./kit", () => ({ Chip: "Chip", Rise: passThrough("Rise") }));
vi.mock("../inputs", () => ({
  CodeField: "CodeField",
  DismissKeyboard: passThrough("DismissKeyboard"),
  Field: "Field",
  isEmail: () => false,
  useKeyboardLift: () => 0,
}));
vi.mock("../lux", () => ({ Eyebrow: passThrough("Eyebrow"), Glass: passThrough("Glass"), Money: "Money", PrimaryButton: "PrimaryButton", QuietButton: "QuietButton" }));
vi.mock("../odometer", () => ({ Odometer: "Odometer", dollars: () => "" }));
vi.mock("../reveal", () => ({ GlassReveal: "GlassReveal" }));

const { CodeSheet } = await import("./finale");
const { welcomeBack } = await import("../../lib/back-target");

let root: ReactTestRenderer | null = null;
const open = async (onClose: () => void) => {
  await act(async () => {
    root = create(createElement(CodeSheet, { startEmail: async () => {}, verifyEmail: async () => {}, onClose }));
  });
};
const pressBack = () => {
  for (const fn of [...h.back].reverse()) if (fn()) return true;
  return false;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  h.os = "android";
  h.back = [];
  h.moves = [];
});

describe("the save sheet and Android's Back", () => {
  it("closes the sheet as a drag down does, and keeps Back from reaching the welcome under it", async () => {
    // The welcome's own Back listener, registered before the sheet opened: it would step the page back.
    const underneath = vi.fn(() => true);
    h.back.push(underneath);
    const onClose = vi.fn();
    await open(onClose);
    h.moves = [];
    await act(async () => void expect(pressBack()).toBe(true));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.moves).toEqual([0]);
    expect(underneath).not.toHaveBeenCalled();
  });

  it("still closes the sheet when the welcome's listener was registered after it (a sign-in attempt from the sheet that came back)", async () => {
    const onClose = vi.fn();
    await open(onClose);
    // The welcome lost and regained focus while the sheet stayed up, so its listener is now the newest. It decides as
    // app/welcome.tsx does, through welcomeBack, on the reveal step where the page could step back.
    const stepped = vi.fn();
    h.back.push(() => {
      if (welcomeBack({ sheet: true, canGoBack: true }) !== "step") return false;
      stepped();
      return true;
    });
    h.moves = [];
    await act(async () => void expect(pressBack()).toBe(true));
    expect(stepped).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.moves).toEqual([0]);
  });

  it("lets Back through again once the sheet is gone", async () => {
    await open(() => {});
    expect(h.back).toHaveLength(1);
    await act(async () => root?.unmount());
    root = null;
    expect(h.back).toHaveLength(0);
  });

  it("adds nothing on iOS, which has no Back button", async () => {
    h.os = "ios";
    await open(() => {});
    expect(h.back).toHaveLength(0);
  });
});
