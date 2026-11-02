import { describe, expect, it, vi } from "vitest";
import { growProps, measure, sends, type Measured } from "./grow";

// Owner, 2026-11-02: "Text over a single line should expand the box, not just move to the second line ... not showing
// what's on the first line. That's just basic ergonomics."
describe("a text box that grows with its words", () => {
  const base = { min: 44, max: 120, height: 44, onSubmit: () => {} };

  it("wraps onto lines instead of scrolling sideways, and Return still submits rather than adding a line", () => {
    for (const web of [true, false]) {
      const g = growProps({ ...base, web });
      expect(g.multiline).toBe(true);
      expect(g.submitBehavior).toBe("blurAndSubmit");
      expect(g.style).toMatchObject({ textAlignVertical: "top" });
    }
  });

  it("on a phone grows by itself between its first line and its cap", () => {
    const g = growProps({ ...base, web: false });
    expect(g.style).toMatchObject({ minHeight: 44, maxHeight: 120 });
    expect(g.scrollEnabled).toBe(true);
  });

  it("on the web fits its words with no scrollbar below the cap, and scrolls only at the cap", () => {
    const below = growProps({ ...base, web: true, height: 70 });
    expect(below.style).toMatchObject({ height: 70, overflow: "hidden" });
    expect(below.scrollEnabled).toBe(false);
    const capped = growProps({ ...base, web: true, height: 120 });
    expect(capped.style).not.toHaveProperty("overflow");
    expect(capped.scrollEnabled).toBe(true);
  });

  // A textarea's scrollHeight never drops below its own height, so it is read at zero height; the underline is added.
  const textarea = (words: number, border: number, height = "44px"): Measured & { readAt: string[] } => {
    const el = {
      style: { height },
      readAt: [] as string[],
      get scrollHeight() {
        el.readAt.push(el.style.height);
        return el.style.height === "0px" ? words : Math.max(words, parseFloat(el.style.height) - border);
      },
      get clientHeight() {
        return el.style.height === "0px" ? words : parseFloat(el.style.height) - border;
      },
      get offsetHeight() {
        return el.clientHeight + border;
      },
    };
    return el;
  };

  it("on the web shrinks again when words are taken out, measured from zero and put back as it was", () => {
    const el = textarea(43, 0, "120px");
    expect(measure(el, 44, 120)).toBe(44);
    expect(el.readAt).toEqual(["0px"]);
    expect(el.style.height).toBe("120px");
    expect(measure(textarea(70, 0), 44, 120)).toBe(70);
    expect(measure(textarea(400, 0), 44, 120)).toBe(120);
  });

  it("counts an underline, so a one-line answer is never a pixel short", () => {
    expect(measure(textarea(39, 1, "40px"), 40, 86)).toBe(40);
    expect(measure(textarea(62, 1, "40px"), 40, 86)).toBe(63);
  });

  it("on the web sends on Return instead of starting a new line, but not mid-word in an input method", () => {
    const onSubmit = vi.fn();
    const preventDefault = vi.fn();
    const g = growProps({ ...base, web: true, onSubmit });
    g.onKeyPress!({ nativeEvent: { key: "Enter" }, preventDefault } as never);
    g.onKeyPress!({ nativeEvent: { key: "a" }, preventDefault } as never);
    g.onKeyPress!({ nativeEvent: { key: "Enter", isComposing: true }, preventDefault } as never);
    g.onKeyPress!({ nativeEvent: { key: "Enter", keyCode: 229 }, preventDefault } as never);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(sends({ key: "Enter" })).toBe(true);
    expect(sends({ key: "Enter", isComposing: true })).toBe(false);
    expect(growProps({ ...base, web: false, onSubmit }).onKeyPress).toBeUndefined();
  });
});
