import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
const { rememberFocus, restoreFocus } = await import("./focus-return");

/**
 * The keyboard's place on the list after a wish closes (review of #199): the list goes inert under the wish, which
 * drops focus to the page; when the list is back, focus returns to where it was, unless something else has it.
 */
const element = (connected = true) => ({ isConnected: connected, focus: vi.fn() });

describe("focus return", () => {
  it("remembers the last element focused inside the screen, and stops when asked", () => {
    let listener: ((e: { target: unknown }) => void) | null = null;
    const screen = { addEventListener: (_t: string, fn: (e: { target: unknown }) => void) => void (listener = fn), removeEventListener: vi.fn() };
    const store = { current: null as ReturnType<typeof element> | null };
    const stop = rememberFocus(screen, store);
    const card = element();
    listener!({ target: card });
    expect(store.current).toBe(card);
    stop();
    expect(screen.removeEventListener).toHaveBeenCalledWith("focusin", listener);
  });

  it("puts focus back on it once nothing else holds focus, without scrolling", () => {
    const body = {};
    const card = element();
    expect(restoreFocus({ current: card }, { activeElement: body, body })).toBe(true);
    expect(card.focus).toHaveBeenCalledWith({ preventScroll: true });
    // Nowhere focused at all counts as nothing.
    expect(restoreFocus({ current: element() }, { activeElement: null, body })).toBe(true);
  });

  it("leaves focus alone when something else has it, the element is gone, or nothing was remembered", () => {
    const body = {};
    const card = element();
    expect(restoreFocus({ current: card }, { activeElement: {}, body })).toBe(false);
    expect(restoreFocus({ current: element(false) }, { activeElement: body, body })).toBe(false);
    expect(restoreFocus({ current: null }, { activeElement: body, body })).toBe(false);
    expect(card.focus).not.toHaveBeenCalled();
  });
});
