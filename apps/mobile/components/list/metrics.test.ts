import { describe, expect, it } from "vitest";
import { CARD_GAP, CARD_SHORT, CARD_TALL, DOCK_LIFT, DOCK_PILL, DOCK_SEND, EMPTY_HEIGHT, TOAST_GAP, cardHeight, cardHeights, toastBottom } from "./metrics";

describe("wish list rhythm", () => {
  it("runs two tall cards then one short", () => {
    expect([0, 1, 2, 3, 4, 5].map(cardHeight)).toEqual([CARD_TALL, CARD_TALL, CARD_SHORT, CARD_TALL, CARD_TALL, CARD_SHORT]);
  });

  it("gives a wish waiting on undo no slot, so the cards below re-flow at once", () => {
    const ids = ["a", "b", "c", "d"];
    const all = cardHeights(ids, new Set());
    expect([...all.values()]).toEqual([CARD_TALL, CARD_TALL, CARD_SHORT, CARD_TALL]);
    const without = cardHeights(ids, new Set(["a"]));
    // b, c, d move up a slot; a keeps the height it returns to.
    expect(without.get("a")).toBe(CARD_TALL);
    expect([without.get("b"), without.get("c"), without.get("d")]).toEqual([CARD_TALL, CARD_TALL, CARD_SHORT]);
  });

  it("restores the original rhythm when the removal is undone", () => {
    const ids = ["a", "b", "c", "d"];
    const before = cardHeights(ids, new Set());
    const during = cardHeights(ids, new Set(["b"]));
    // While b waits on undo, c takes its tall slot and d becomes the short one.
    expect([during.get("c"), during.get("d")]).toEqual([CARD_TALL, CARD_SHORT]);
    // b is held at the height it returns to, so undo lands every card back where it was.
    expect(during.get("b")).toBe(before.get("b"));
    expect(cardHeights(ids, new Set())).toEqual(before);
  });

  it("sizes the empty state to exactly two tall card slots", () => {
    expect(EMPTY_HEIGHT).toBe(CARD_TALL + CARD_GAP + CARD_TALL);
  });

  it("keeps the send disc concentric with the composer pill", () => {
    expect((DOCK_PILL - DOCK_SEND) / 2).toBe(8);
  });

  it("floats the toast above the composer and the home indicator", () => {
    expect(toastBottom(34)).toBe(34 + DOCK_LIFT + DOCK_PILL + TOAST_GAP);
    expect(toastBottom(0)).toBeGreaterThan(DOCK_LIFT + DOCK_PILL);
  });
});
