import { act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The comfort line under the income (2026-11-01): in the Money page's card on a 390-wide phone it was one line and
 * cut, "You could comfortably afford …", the line the page opens on. It now wraps to two, and the longest line sits
 * invisibly underneath so the block is as tall as that one needs: the fader below stays put while the line changes.
 * The intro card's compact form keeps its single line.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Text: "Text", View: "View" }));
vi.mock("../../lib/theme", () => ({
  fonts: { titleItalic: "serif-italic" },
  type: { title3: { fontSize: 23, lineHeight: 28 }, callout: { fontSize: 15, lineHeight: 21 } },
  usePalette: () => ({ accentText: "#c9a" }),
}));

const { ComfortLine } = await import("./comfort-line");
const { LONGEST_LINE, stageOf } = await import("../../lib/comfort");

const NEED = 250_000_000;
let root: ReactTestRenderer | null = null;
async function mount(line: string, compact = false) {
  await act(async () => {
    root = create(createElement(ComfortLine, { line, compact }));
  });
}
const texts = () => root!.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Text");
const said = (n: ReactTestInstance) => [n.props.children].flat().join("");
const live = () => texts().find((n) => n.props.accessibilityLiveRegion === "polite")!;
const holder = () => texts().find((n) => n.props["aria-hidden"]);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("the comfort line", () => {
  it("holds its room with the longest line any stage says", () => {
    const lines = new Set<string>();
    for (let income = NEED / 50; income < NEED * 50; income *= 1.1) lines.add(stageOf(income, NEED).line);
    expect(lines.size).toBe(6);
    expect(lines.has(LONGEST_LINE)).toBe(true);
    expect(Math.max(...[...lines].map((l) => l.length))).toBe(LONGEST_LINE.length);
  });

  it("wraps to two even lines rather than cut off", async () => {
    await mount(LONGEST_LINE);
    expect(said(live())).toBe(LONGEST_LINE);
    expect(live().props).toMatchObject({ numberOfLines: 2, lineBreakStrategyIOS: "push-out", textBreakStrategy: "balanced" });
  });

  it("keeps the longest line underneath, unseen and unread, whatever the line says", async () => {
    await mount("A real stretch");
    expect(said(live())).toBe("A real stretch");
    const h = holder()!;
    expect(said(h)).toBe(LONGEST_LINE);
    expect(h.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants", numberOfLines: 2 });
    expect([h.props.style].flat(Infinity)).toContainEqual({ opacity: 0 });
    // In the box's own flow, with the line shown laid over it.
    expect(h.parent).toBe(live().parent!.parent);
    expect(live().parent!.props.style).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("stays one line in the intro card's compact form", async () => {
    await mount(LONGEST_LINE, true);
    expect(live().props.numberOfLines).toBe(1);
    expect(holder()).toBeUndefined();
  });
});
