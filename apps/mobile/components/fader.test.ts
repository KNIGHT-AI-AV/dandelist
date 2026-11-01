import { act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The fader on the web (axe, 2026-11-01): react-native-web reads none of accessibilityValue, so the income and timeline
 * sliders had no value for a screen reader there, no Tab stop and no keys. Now they carry aria-value*, take focus, and
 * the slider keys move a notch; on a phone they're as before, the screen reader's swipe moving a notch.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ os: "web" }));

vi.mock("react-native", () => {
  class Value {
    constructor(public v: number) {}
    interpolate() {
      return this;
    }
  }
  return {
    Animated: { Value, View: "AnimatedView", spring: () => ({ start() {} }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: {
      get OS() {
        return h.os;
      },
    },
    Text: "Text",
    View: "View",
  };
});
vi.mock("../lib/motion", () => ({ haptic: { select() {}, soft() {} }, native: false, spring: { press: {} } }));
vi.mock("../lib/theme", () => ({ layout: { stack: { tight: 8 } }, shadow: { thumb: "" }, type: { figure: { lineHeight: 16 } }, usePalette: () => ({ track: "#333", accent: "#c9a", ink: "#fff", ink3: "#999" }) }));
vi.mock("../lib/tick", () => ({ tick() {} }));
vi.mock("../lib/viewport", () => ({ zoom: () => 1 }));

const { Fader, nearestNotch, webSlider } = await import("./fader");

const STEPS = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000] as const;
let root: ReactTestRenderer | null = null;
const changes: number[] = [];
async function mount(value: number) {
  changes.length = 0;
  await act(async () => {
    root = create(createElement(Fader, { value, steps: STEPS, onChange: (c: number) => void changes.push(c), label: "Income a year", valueText: "$50,000 a year", labels: [] }));
  });
}
const track = () => root!.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "adjustable");
/** A key as the browser sends it, recording whether the slider kept it. */
function key(name: string) {
  const e = { key: name, kept: false, preventDefault() { this.kept = true; }, stopPropagation() {} };
  return e;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  h.os = "web";
});

describe("nearestNotch", () => {
  it("finds the notch closest to a value, the lower one on a tie", () => {
    expect(nearestNotch(1_000_000, STEPS)).toBe(0);
    expect(nearestNotch(6_000_000, STEPS)).toBe(2);
    expect(nearestNotch(15_000_000, STEPS)).toBe(3);
    expect(nearestNotch(99_000_000, STEPS)).toBe(4);
  });
});

describe("webSlider", () => {
  it("gives a screen reader the slider's place and makes it a Tab stop", () => {
    const s = webSlider(2, 5, () => {});
    expect(s).toMatchObject({ "aria-valuemin": 0, "aria-valuemax": 4, "aria-valuenow": 2, focusable: true });
  });

  it("moves a notch on the arrows and to the ends on Home and End, keeping those keys from the page", () => {
    for (const [name, to] of [["ArrowRight", 3], ["ArrowUp", 3], ["ArrowLeft", 1], ["ArrowDown", 1], ["Home", 0], ["End", 4]] as const) {
      const went: number[] = [];
      const e = key(name);
      webSlider(2, 5, (i) => void went.push(i)).onKeyDown(e);
      expect([name, went, e.kept]).toEqual([name, [to], true]);
    }
  });

  it("leaves every other key alone, Tab first of all", () => {
    for (const name of ["Tab", "Enter", " ", "a", "PageUp"]) {
      const went: number[] = [];
      const e = key(name);
      webSlider(2, 5, (i) => void went.push(i)).onKeyDown(e);
      expect([name, went, e.kept]).toEqual([name, [], false]);
    }
  });
});

describe("the fader", () => {
  it("on the web: says its value, sits in the Tab order, and the keys move it a notch from the nearest", async () => {
    await mount(6_000_000);
    const t = track();
    expect(t.props).toMatchObject({ accessibilityLabel: "Income a year", "aria-valuetext": "$50,000 a year", "aria-valuemin": 0, "aria-valuemax": 4, "aria-valuenow": 2, focusable: true });
    await act(async () => t.props.onKeyDown(key("ArrowRight")));
    expect(changes).toEqual([10_000_000]);
  });

  it("doesn't move at an end, so nothing lands twice", async () => {
    await mount(20_000_000);
    await act(async () => track().props.onKeyDown(key("End")));
    await act(async () => track().props.onKeyDown(key("ArrowRight")));
    expect(changes).toEqual([]);
  });

  it("on a phone: the same words for the screen reader, its swipe moves a notch, and no web props", async () => {
    h.os = "ios";
    await mount(6_000_000);
    const t = track();
    expect(t.props["aria-valuetext"]).toBe("$50,000 a year");
    for (const k of ["aria-valuenow", "focusable", "onKeyDown"]) expect(t.props[k]).toBeUndefined();
    await act(async () => t.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));
    expect(changes).toEqual([2_000_000]);
  });
});
