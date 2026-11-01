import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayPick } from "../../lib/picks";

/**
 * Today's pick opened from its card (owner, 2026-11-01: a person who liked a pick tapped it to see what it was, and
 * couldn't without adding it): the real page (app/picks/[id].tsx) and the real picks store; the router, the network and
 * the views stand in. It shows what was made with the pick at once, adds it through the new wish screen, turns it down
 * once and closes, and finds today's pick again when opened without its card.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  moves: [] as unknown[],
  requests: [] as { method: string; path: string; body: unknown }[],
  /** What POST /picks/today answers. */
  today: null as TodayPick | null,
  /** The safe area's top inset. */
  top: 0,
}));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("react-native", () => ({
  // A scroll position's interpolation is kept as given, so a test reads the range it was asked for.
  Animated: {
    Value: class {
      interpolate(config: unknown) {
        return config;
      }
    },
    event: () => () => {},
    ScrollView: passThrough("ScrollView"),
    View: ({ children, ...props }: { children?: ReactNode }) => createElement("AnimatedView", props, children),
  },
  StyleSheet: { absoluteFill: {}, hairlineWidth: 1 },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: h.top, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => createElement("Redirect", { href }),
  router: {
    push: (to: unknown) => void h.moves.push(["push", to]),
    replace: (to: unknown) => void h.moves.push(["replace", to]),
    back: () => void h.moves.push(["back"]),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => h.params,
}));
vi.mock("../atmosphere", () => ({ Atmosphere: "Atmosphere" }));
vi.mock("../detail/metrics", () => ({ CONTROL_TOP: 4, HERO_SHADE: 0.2 }));
vi.mock("../lux", () => ({
  AgentDot: "AgentDot",
  EdgeFade: "EdgeFade",
  Eyebrow: passThrough("Eyebrow"),
  Grain: "Grain",
  IconButton: "IconButton",
  Photo: "Photo",
  PrimaryButton: "PrimaryButton",
  Protect: "Protect",
  QuietButton: "QuietButton",
  Shade: "Shade",
}));
vi.mock("../photo-credit", () => ({ PhotoCredit: "PhotoCredit" }));
vi.mock("../../lib/auth", () => {
  const api = async (path: string, init: RequestInit = {}) => {
    h.requests.push({ method: init.method ?? "GET", path, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (path === "/picks/today") return new Response(JSON.stringify({ pick: h.today, pending: false }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const auth = { status: "signedIn", user: { id: "ada", email: "ada@example.com" }, api };
  // One sign-in throughout: the change of account has its own mounted test (pick-owner.test.ts).
  return { useAuth: () => auth, currentSignIn: () => 1, bindToSignIn: (call: typeof api) => call };
});
vi.mock("../../lib/motion", () => ({ haptic: { select() {} }, native: true }));
vi.mock("../../lib/storage", () => ({ getSecret: async () => null, setSecret: async () => {} }));
vi.mock("../../lib/theme", () => ({
  layout: { gutter: () => 20, list: 520, headerBar: 44, stack: { tight: 8, base: 16, section: 32, sectionLg: 48 } },
  space: { 4: 4, 8: 8 },
  type: { body: {}, callout: {}, footnote: {} },
  usePalette: () => ({ bg: "#000", ink: "#fff", ink2: "#ccc", ink3: "#999", hair: "#333" }),
  useType: () => ({ title1: {} }),
}));

const { default: PickDetail } = await import("../../app/picks/[id]");
const picks = await import("../../lib/picks");

const pick: TodayPick = {
  id: "pick-1",
  day: "2026-11-01",
  status: "ready",
  title: "Leica M11-P",
  kind: "own",
  why: "You want the Q3 for photographing your kids, and this is the rangefinder that grows with it.",
  summary: "A full-frame digital rangefinder camera made by Leica in Germany.",
  photo: { url: "https://images.example/m11.jpg", source: "leica-camera.com", credit: "Leica Camera AG" },
  createdAt: "2026-11-01T08:00:00.000Z",
};

/** The one sign-in these tests run under. */
const ADA = { account: "ada", at: 1 };
let root: ReactTestRenderer | null = null;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
async function open(id: string) {
  h.params = { id };
  await act(async () => {
    root = create(createElement(PickDetail), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
  await settle();
}
const texts = () => root!.root.findAllByType("Text" as never).map((n: ReactTestInstance) => [n.props.children].flat().join(""));
const eyebrows = () => root!.root.findAllByType("Eyebrow" as never).map((n: ReactTestInstance) => [n.props.children].flat().join(""));
/** A view stand-in by its name (the mocks render strings as host types). */
const is = (n: ReactTestInstance, ...names: string[]) => names.includes(n.type as unknown as string);
const button = (label: string) => root!.root.find((n: ReactTestInstance) => is(n, "PrimaryButton", "QuietButton") && n.props.label === label);
const buttons = () => root!.root.findAll((n: ReactTestInstance) => is(n, "PrimaryButton", "QuietButton"));
/** The scroll edge under the back button. */
const edge = () => root!.root.find((n: ReactTestInstance) => is(n, "AnimatedView") && n.props.pointerEvents === "none");

beforeEach(() => {
  h.params = {};
  h.moves = [];
  h.requests = [];
  h.today = null;
  h.top = 0;
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root?.unmount());
  root = null;
});

describe("today's pick, opened from its card", () => {
  it("shows what was made with the pick at once: its photo, what it is and why, with nothing asked for", async () => {
    picks.rememberPick(pick, ADA);
    await open("pick-1");
    expect(texts()).toContain("Leica M11-P");
    expect(eyebrows()).toEqual(["Today's pick · Own", "What it is", "Why your Dandy picked it"]);
    expect(texts()).toContain(pick.summary);
    expect(texts()).toContain(pick.why);
    expect(root!.root.findByType("Photo" as never).props.uri).toBe(pick.photo!.url);
    expect(h.requests).toEqual([]);
  });

  it("shows the few sentences and the facts made with the pick in place of its one-line summary", async () => {
    const facts = [{ label: "Made by", value: "Leica" }, { label: "Built in", value: "Wetzlar, Germany" }, { label: "", value: "Empty" }, { label: "Sensor" } as never];
    picks.rememberPick({ ...pick, id: "pick-6", about: "A full-frame rangefinder made by Leica in Wetzlar, with a silent shutter.", facts }, ADA);
    await open("pick-6");
    expect(eyebrows()).toEqual(["Today's pick · Own", "What it is", "Why your Dandy picked it"]);
    expect(texts()).toContain("A full-frame rangefinder made by Leica in Wetzlar, with a silent shutter.");
    expect(texts()).not.toContain(pick.summary);
    // Only well-formed facts show, label then value.
    const shown = texts();
    expect(shown.slice(shown.indexOf("Made by"), shown.indexOf("Made by") + 4)).toEqual(["Made by", "Leica", "Built in", "Wetzlar, Germany"]);
    expect(shown).not.toContain("Empty");
    expect(shown).not.toContain("Sensor");
  });

  it("leaves out what it is when the pick came without a summary", async () => {
    picks.rememberPick({ ...pick, id: "pick-2", summary: "" }, ADA);
    await open("pick-2");
    expect(eyebrows()).toEqual(["Today's pick · Own", "Why your Dandy picked it"]);
  });

  it("adds it the usual way: the new wish screen finds the real price and records the pick as added", async () => {
    picks.rememberPick(pick, ADA);
    await open("pick-1");
    await act(async () => button("Add to my list").props.onPress());
    expect(h.moves).toEqual([["replace", { pathname: "/wishes/new", params: { text: "Leica M11-P", pick: "pick-1" } }]]);
    // Nothing is recorded until the wish is saved there.
    expect(h.requests).toEqual([]);
  });

  it("turns it down once: noted, the card's pick is marked, and the page closes", async () => {
    vi.useFakeTimers();
    picks.rememberPick({ ...pick, id: "pick-3" }, ADA);
    h.params = { id: "pick-3" };
    await act(async () => {
      root = create(createElement(PickDetail), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await act(async () => button("Not for me").props.onPress());
    expect(h.requests).toEqual([{ method: "PATCH", path: "/picks/pick-3", body: { outcome: "skipped" } }]);
    expect(picks.wasPickSkipped("pick-3")).toBe(true);
    expect(picks.knownPick("pick-3", ADA)?.status).toBe("skipped");
    expect(texts()).toContain("Noted. Tomorrow's pick will learn from this.");
    expect(buttons()).toEqual([]);
    expect(h.moves).toEqual([]);
    await act(async () => void vi.advanceTimersByTime(1800));
    expect(h.moves).toEqual([["back"]]);
  });

  it("fades the title out under the back button as the page scrolls up, as a wish's page does", async () => {
    picks.rememberPick(pick, ADA);
    await open("pick-1");
    // Over the photo, the title's top (420 - 120) reaches the edge's foot (44 + 16) after 240 points of scroll.
    expect(edge().props.style).toMatchObject({ position: "absolute", top: 0, height: 60, opacity: { inputRange: [180, 240], outputRange: [0, 1], extrapolate: "clamp" }, transform: [{ scaleY: -1 }] });
    expect(edge().findByType("EdgeFade" as never).props.height).toBe(60);
    await act(async () => root?.unmount());
    // Under a status bar the edge reaches further down, so it is in sooner.
    h.top = 59;
    await open("pick-1");
    expect(edge().props.style).toMatchObject({ height: 119, opacity: { inputRange: [121, 181] } });
    await act(async () => root?.unmount());
    // Without a photo the title starts just below the button, so the edge is in within its first few points.
    picks.rememberPick({ ...pick, id: "pick-7", photo: null }, ADA);
    await open("pick-7");
    expect(edge().props.style).toMatchObject({ height: 119, opacity: { inputRange: [0, 4] } });
  });

  it("finds today's pick again when opened without its card, and goes home when that isn't the one", async () => {
    h.today = { ...pick, id: "pick-4" };
    await open("pick-4");
    expect(h.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /picks/today"]);
    expect(texts()).toContain("Leica M11-P");
    await act(async () => root?.unmount());
    h.today = { ...pick, id: "another" };
    await open("pick-5");
    expect(root!.root.findByType("Redirect" as never).props.href).toBe("/");
  });
});
