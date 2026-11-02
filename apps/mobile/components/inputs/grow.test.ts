import { describe, expect, it, vi } from "vitest";
import { growProps } from "./grow";

// Owner, 2026-11-02: "Text over a single line should expand the box, not just move to the second line ... not showing
// what's on the first line. That's just basic ergonomics."
describe("a text box that grows with its words", () => {
  const base = { min: 44, max: 120, height: 44, onSubmit: () => {}, setHeight: () => {} };

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
    expect(g.onContentSizeChange).toBeUndefined();
    expect(g.scrollEnabled).toBe(true);
  });

  it("on the web takes the height of its words, from one line to the cap, and only then scrolls", () => {
    const setHeight = vi.fn();
    const g = growProps({ ...base, web: true, setHeight });
    expect(g.style).toMatchObject({ height: 44 });
    expect(g.scrollEnabled).toBe(false);
    g.onContentSizeChange!({ nativeEvent: { contentSize: { width: 300, height: 70 } } } as never);
    g.onContentSizeChange!({ nativeEvent: { contentSize: { width: 300, height: 400 } } } as never);
    g.onContentSizeChange!({ nativeEvent: { contentSize: { width: 300, height: 10 } } } as never);
    expect(setHeight.mock.calls.map((c) => c[0])).toEqual([70, 120, 44]);
    expect(growProps({ ...base, web: true, height: 120 }).scrollEnabled).toBe(true);
  });

  it("on the web sends on Return instead of starting a new line", () => {
    const onSubmit = vi.fn();
    const preventDefault = vi.fn();
    const g = growProps({ ...base, web: true, onSubmit });
    g.onKeyPress!({ nativeEvent: { key: "Enter" }, preventDefault } as never);
    g.onKeyPress!({ nativeEvent: { key: "a" }, preventDefault } as never);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(growProps({ ...base, web: false, onSubmit }).onKeyPress).toBeUndefined();
  });
});
