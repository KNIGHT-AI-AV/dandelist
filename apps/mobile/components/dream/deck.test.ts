import type { Listing } from "@dandelist/catalogue/dream";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The swipe deck in the chat, mounted (Codex, round 44): its responder is made once, and it used to keep the first
 * card, so every swipe after the first was sent as the first card again. The real SwipeDeck; the views, the motion
 * and the responder's factory stand in, and the factory hands back the config it was given, so a test can let go of
 * a drag the way the finger does.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

type Release = (e: unknown, g: { dx: number; dy: number; vx: number }) => void;
const pans = vi.hoisted(() => [] as { onPanResponderRelease: Release }[]);
vi.mock("react-native", () => {
  class Value {
    setValue() {}
    interpolate() {
      return 0;
    }
  }
  const run = () => ({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }) });
  return {
    Animated: { View: "AnimatedView", Value, timing: run, spring: run, parallel: run },
    PanResponder: {
      create: (config: { onPanResponderRelease: Release }) => {
        pans.push(config);
        return { panHandlers: {} };
      },
    },
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1 },
    Text: "Text",
    View: "View",
    useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
  };
});
vi.mock("../../lib/motion", () => ({ ease: { out: 0 }, haptic: { select() {} }, native: false, spring: { snap: {}, press: {} }, useReducedMotion: () => true }));
vi.mock("../../lib/dream", () => ({ moneyIn: () => (cents: number) => `$${cents / 100}` }));
vi.mock("../../lib/theme", () => ({ fonts: {}, radius: {}, type: { title2: {}, title3: {}, cardPrice: {}, figure: { lineHeight: 16 }, footnote: {}, button: {} }, usePalette: () => ({}) }));
vi.mock("../../lib/welcome", () => ({ hostOf: (u: string) => u }));
vi.mock("../lux", () => ({ Eyebrow: "Eyebrow", Icon: "Icon", Shade: "Shade" }));
vi.mock("../media", () => ({ Slideshow: "Slideshow" }));
vi.mock("../reveal", () => ({ GlassReveal: "GlassReveal" }));
// The card requires its standby photo, which Metro turns into a number; Node would read the .jpg as code.
(require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions[".jpg"] = (m) => {
  m.exports = 1;
};

const { SwipeDeck } = await import("./deck");
const card = (id: string): Listing => ({ id, title: `Car ${id}`, priceCents: 9_890_000, currency: "USD", url: `https://example.com/${id}`, source: "example.com", facts: [], images: [], status: "verified" }) as unknown as Listing;

let root: ReactTestRenderer | null = null;
const swiped: string[] = [];
async function mount(ids: string[]) {
  swiped.length = 0;
  pans.length = 0;
  await act(async () => {
    root = create(createElement(SwipeDeck, { cards: ids.map(card), onSwipe: (l: Listing, v: "yes" | "no") => void swiped.push(`${l.id}:${v}`), onPick: () => {}, onSearchNow: () => {}, onEnough: () => {} }));
  });
}
const press = (label: string) => act(async () => root!.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function").props.onPress());
// useRef keeps the responder from the first render (the factory runs on every render, only the first is kept).
const letGo = (dx: number) => act(async () => pans[0]!.onPanResponderRelease({}, { dx, dy: 0, vx: Math.sign(dx) }));
const said = () => root!.root.findAll((n) => (n.type as unknown) === "Text" && typeof n.props.children === "string").map((n) => n.props.children as string);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("the chat's swipe deck (round 44)", () => {
  it("sends each swipe as the card on top when it is let go, not the first card", async () => {
    await mount(["a", "b", "c"]);
    await letGo(400);
    await letGo(-400);
    expect(swiped).toEqual(["a:yes", "b:no"]);
  });

  it("sends Yes and Pass for the card on top (control)", async () => {
    await mount(["a", "b"]);
    await press("Yes");
    await press("Pass");
    expect(swiped).toEqual(["a:yes", "b:no"]);
  });

  it("says the best match is being priced once the last card goes after a yes, and that it's finding more after none", async () => {
    await mount(["a", "b"]);
    await letGo(400);
    await letGo(-400);
    expect(said()).toContain("Pricing your best match.");
    await mount(["a"]);
    await letGo(-400);
    expect(said()).toContain("None of those. Finding more.");
  });
});
