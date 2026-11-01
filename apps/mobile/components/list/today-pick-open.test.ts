import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayPick } from "../../lib/picks";

/**
 * The card for today's pick on the list (owner, 2026-11-01): its photo, title and why open the pick's own page, its
 * answers keep their own buttons, and a pick turned down on its page leaves the list at once. The real TodayCards and
 * picks store; the router, the network, the list and the views stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ moves: [] as unknown[], today: null as TodayPick | null }));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("react-native", () => ({
  Animated: { View: passThrough("AnimatedView") },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Pressable: ({ children, ...props }: { children?: ReactNode }) => createElement("Pressable", props, children),
  Text: "Text",
  View: "View",
}));
vi.mock("expo-router", () => ({ router: { push: (to: unknown) => void h.moves.push(["push", to]) } }));
vi.mock("./presence", () => ({ Presence: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? createElement("Presence", null, children) : null) }));
vi.mock("../lux", () => ({
  AgentDot: "AgentDot",
  Eyebrow: passThrough("Eyebrow"),
  Glass: passThrough("Glass"),
  IconButton: "IconButton",
  Photo: "Photo",
  PrimaryButton: "PrimaryButton",
  QuietButton: "QuietButton",
  Shade: "Shade",
}));
vi.mock("../../lib/activity", () => ({ startTask: () => "task", endTask() {} }));
vi.mock("../../lib/auth", () => {
  const api = async (path: string) => {
    if (path === "/picks/today") return new Response(JSON.stringify({ pick: h.today, pending: false }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const auth = { status: "signedIn", api, user: { id: "user-1", email: "ada@example.com" } };
  // One sign-in throughout: the change of account has its own mounted test (pick-owner.test.ts).
  return { useAuth: () => auth, currentSignIn: () => 1, bindToSignIn: (call: typeof api) => call };
});
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ persona: undefined }) }));
vi.mock("../../lib/motion", () => ({ haptic: { select() {}, success() {} }, usePress: () => ({ scale: 1, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/notifications", () => ({ notifier: { available: false } }));
vi.mock("../../lib/reminder-state", () => ({ isFirstLaunch: () => false, updateReminders: async () => {}, useReminderState: () => ({ ask: null }) }));
vi.mock("../../lib/reminders", () => ({ shouldAsk: () => false }));
vi.mock("../../lib/storage", () => ({ getSecret: async () => null, setSecret: async () => {} }));
vi.mock("../../lib/theme", () => ({
  layout: { cardPad: 20, stack: { tight: 8, base: 16 } },
  radius: { lg: 24 },
  space: { 4: 4, 8: 8, 12: 12 },
  type: { callout: {}, footnote: {}, figure: {} },
  usePalette: () => ({ ink: "#fff", ink2: "#ccc", ink3: "#999" }),
  useType: () => ({ title2: {} }),
}));
vi.mock("../../lib/wishes", () => {
  const list = { wishes: [{ id: "w1" }], status: "ready" };
  return { useWishes: () => list };
});

const { TodayCards } = await import("./today-cards");
const picks = await import("../../lib/picks");

const pick: TodayPick = {
  id: "pick-1",
  day: picks.localDay(),
  status: "ready",
  title: "A week in Kyoto in April",
  kind: "visit",
  why: "You wrote about the cherry trees, and April is when they flower.",
  summary: "A spring week in Japan's old capital.",
  photo: { url: "https://images.example/kyoto.jpg", source: "wikipedia.org" },
  createdAt: "2026-11-01T08:00:00.000Z",
};

let root: ReactTestRenderer | null = null;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
/** A view stand-in by its name (the mocks render strings as host types). */
const is = (n: ReactTestInstance, ...names: string[]) => names.includes(n.type as unknown as string);
const card = () => root!.root.find((n: ReactTestInstance) => is(n, "Pressable") && n.props.accessibilityRole === "button");

beforeEach(() => {
  h.moves = [];
  h.today = pick;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("today's pick on the list", () => {
  it("opens the pick's own page from its photo, title and why, and remembers the pick for it", async () => {
    await act(async () => {
      root = create(createElement(TodayCards), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await settle();
    const press = card();
    expect(press.props.accessibilityLabel).toBe("Today's pick: A week in Kyoto in April");
    // The photo, the title and the why are inside what opens it; the answers are not.
    expect(press.findByType("Photo" as never).props.uri).toBe(pick.photo!.url);
    expect(press.findAll((n: ReactTestInstance) => is(n, "PrimaryButton", "QuietButton"))).toEqual([]);
    await act(async () => press.props.onPress());
    expect(h.moves).toEqual([["push", { pathname: "/picks/[id]", params: { id: "pick-1" } }]]);
    expect(picks.knownPick("pick-1", { account: "user-1", at: 1 })?.title).toBe("A week in Kyoto in April");
  });

  it("leaves the list as soon as it is turned down on its own page", async () => {
    // The same person and day as above: the list shows the pick it already has this run.
    await act(async () => {
      root = create(createElement(TodayCards), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await settle();
    expect(root!.root.findAllByType("Presence" as never)).toHaveLength(1);
    await act(async () => picks.pickSkipped("pick-1"));
    expect(root!.root.findAllByType("Presence" as never)).toHaveLength(0);
  });
});
