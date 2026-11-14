import { act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("react-native", () => ({ Text: "Text", StyleSheet: { hairlineWidth: 1 } }));
vi.mock("../../lib/motion", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("../../lib/theme", () => ({}));
vi.mock("../dandy-avatar", () => ({}));
vi.mock("../lux", () => ({}));

const { StreamText } = await import("./working");
let root: ReactTestRenderer | null = null;
const reply = (words: number) => Array.from({ length: words }, (_, i) => `word${i + 1}`).join(" ");
const outer = () => root!.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Text")[0]!;
const visible = () => outer().children.filter((n): n is string => typeof n === "string").join("");
const allText = (node: ReactTestInstance): string => node.children.map((n) => (typeof n === "string" ? n : allText(n))).join("");
const render = async (text: string, fresh = true) => {
  await act(async () => {
    const next = createElement(StreamText, { text, fresh });
    if (root) root.update(next);
    else root = create(next);
  });
};
const advance = async (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  motion.reduced = false;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe("received reply reveal", () => {
  it("leaves an empty reply empty without scheduling animation", async () => {
    await render("");
    expect(visible()).toBe("");
    expect(allText(outer())).toBe("");
    expect(outer().props.accessibilityLabel).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a running reveal when emptied and can reveal the next reply", async () => {
    await render(reply(200));
    await advance(100);
    expect(vi.getTimerCount()).toBe(1);
    await render("");
    expect(visible()).toBe("");
    expect(allText(outer())).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(vi.getTimerCount()).toBe(0);
    const next = reply(500);
    await render(next);
    await advance(1500);
    expect(visible()).toBe(next);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])("fully reveals %i words within 1.5 seconds, retaining every word and the accessible label", async (words) => {
    const text = reply(words);
    await render(text);
    expect(visible()).toBe("");
    expect(allText(outer())).toBe(text);
    expect(outer().props.accessibilityLabel).toBe(text);
    const start = Date.now();
    while (visible() !== text && Date.now() - start < 13_000) {
      await act(async () => vi.advanceTimersToNextTimer());
      expect(allText(outer())).toBe(text);
    }
    const elapsed = Date.now() - start;
    console.info(`StreamText: ${words} words fully visible after ${elapsed} ms`);
    expect(visible()).toBe(text);
    expect(elapsed).toBeLessThanOrEqual(1500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps short replies quicker than the maximum", async () => {
    const text = reply(10);
    await render(text);
    await advance(760);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reveals progressively while retaining punctuation, whitespace and Unicode", async () => {
    const text = "A wish — café ☕.\n\n  One\tmore idea, please!";
    await render(text);
    await advance(100);
    expect(visible().length).toBeGreaterThan(0);
    expect(visible().length).toBeLessThan(text.length);
    expect(allText(outer())).toBe(text);
    await advance(1500);
    expect(visible()).toBe(text);
    expect(outer().props.accessibilityLabel).toBe(text);
  });

  it.each([false, true])("shows history immediately with reduced motion %s", async (reduced) => {
    motion.reduced = reduced;
    const text = reply(500);
    await render(text, false);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows fresh replies immediately when reduced motion is enabled", async () => {
    motion.reduced = true;
    const text = reply(500);
    await render(text);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes immediately if reduced motion is enabled during the reveal", async () => {
    const text = reply(500);
    await render(text);
    await advance(100);
    motion.reduced = true;
    await render(text);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes and cancels the timer when a fresh reply becomes history", async () => {
    const text = reply(500);
    await render(text);
    await advance(100);
    await render(text, false);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches up after a delayed timer instead of extending the reveal", async () => {
    const text = reply(500);
    await render(text);
    vi.setSystemTime(5000);
    await advance(100);
    expect(visible()).toBe(text);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a replacement reply afresh even when its word count is unchanged", async () => {
    const first = reply(200);
    const next = first.replaceAll("word", "idea");
    await render(first);
    await advance(1500);
    await render(next);
    expect(visible()).toBe("");
    expect(allText(outer())).toBe(next);
    expect(outer().props.accessibilityLabel).toBe(next);
    await advance(1500);
    expect(visible()).toBe(next);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending work when unmounted", async () => {
    await render(reply(500));
    await advance(100);
    await act(async () => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
