import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Today's pick across a change of account (Codex's review of #182, R50-PICK-OWNER): the real AuthProvider and its
 * sign-in generation, the real picks store, the real list card and the real pick page, a synthetic server that holds
 * chosen answers and refuses anything it doesn't know, and only the platform, storage, router and views stood in for.
 * A pick shows, opens and is answered only for the sign-in that asked for it: Ada's cached pick never shows on Bob's
 * route or card, a late answer to Ada's request changes nothing once Bob is in, and Ada's own path stays fast.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

type Pick = { id: string; day: string; status: string; title: string; kind: string; why: string; summary: string; photo: null; createdAt: string };
const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  params: {} as Record<string, string>,
  moves: [] as unknown[],
  /** Who is signed in at each render, as the probe saw it, so every text can be told apart by whose screen it was on. */
  who: "-",
  /** Every text rendered, as "account | text". */
  rendered: [] as string[],
  log: [] as string[],
  unknown: [] as string[],
  hold: new Set<string>(),
  held: [] as { key: string; go: () => void }[],
  picks: {} as Record<string, Pick>,
}));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("../../lib/storage", () => ({
  getSecret: async (key: string) => h.store.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => void (value === null ? h.store.delete(key) : h.store.set(key, value)),
}));
vi.mock("react-native", () => ({
  Animated: {
    Value: class {
      interpolate() {
        return 0;
      }
    },
    event: () => () => {},
    ScrollView: passThrough("ScrollView"),
    View: passThrough("AnimatedView"),
  },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  Pressable: ({ children, ...props }: { children?: ReactNode }) => createElement("Pressable", props, children),
  ScrollView: passThrough("ScrollView"),
  StyleSheet: { absoluteFill: {}, hairlineWidth: 1 },
  Text: ({ children, ...props }: { children?: ReactNode }) => {
    h.rendered.push(`${h.who} | ${[children].flat().join("")}`);
    return createElement("Text", props, children);
  },
  View: "View",
  useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => createElement("Redirect", { href }),
  router: { push: (to: unknown) => void h.moves.push(["push", to]), replace: (to: unknown) => void h.moves.push(["replace", to]), back: () => void h.moves.push(["back"]), canGoBack: () => true },
  useLocalSearchParams: () => h.params,
}));
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("../atmosphere", () => ({ Atmosphere: "Atmosphere" }));
vi.mock("../detail/metrics", () => ({ CONTROL_TOP: 4, HERO_SHADE: 0.2 }));
vi.mock("../photo-credit", () => ({ PhotoCredit: "PhotoCredit" }));
vi.mock("./presence", () => ({ Presence: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? createElement("Presence", null, children) : null) }));
vi.mock("../lux", () => ({
  AgentDot: "AgentDot",
  EdgeFade: "EdgeFade",
  Eyebrow: passThrough("Eyebrow"),
  Glass: passThrough("Glass"),
  Grain: "Grain",
  IconButton: "IconButton",
  Photo: "Photo",
  PrimaryButton: "PrimaryButton",
  Protect: "Protect",
  QuietButton: "QuietButton",
  Shade: "Shade",
}));
vi.mock("../../lib/activity", () => ({ startTask: () => "task", endTask() {} }));
vi.mock("../../lib/dandy", () => ({ useDandy: () => ({ persona: undefined }) }));
vi.mock("../../lib/motion", () => ({ haptic: { select() {}, success() {} }, native: true, usePress: () => ({ scale: 1, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/notifications", () => ({ notifier: { available: false } }));
vi.mock("../../lib/reminder-state", () => ({ isFirstLaunch: () => false, updateReminders: async () => {}, useReminderState: () => ({ ask: null }) }));
vi.mock("../../lib/reminders", () => ({ shouldAsk: () => false }));
vi.mock("../../lib/theme", () => ({
  layout: { cardPad: 20, gutter: () => 20, list: 520, headerBar: 44, stack: { tight: 8, base: 16, section: 32, sectionLg: 48 } },
  radius: { lg: 24 },
  space: { 4: 4, 8: 8, 12: 12 },
  type: { body: {}, callout: {}, footnote: {}, figure: {} },
  usePalette: () => ({ bg: "#000", ink: "#fff", ink2: "#ccc", ink3: "#999", hair: "#333" }),
  useType: () => ({ title1: {}, title2: {} }),
}));
vi.mock("../../lib/wishes", () => {
  const list = { wishes: [{ id: "w1" }], status: "ready" };
  return { useWishes: () => list };
});

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const accountOf = (bearer: string) => (bearer.startsWith("tok-ada") ? "ada" : bearer.startsWith("tok-bob") ? "bob" : null);
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  const method = init.method ?? "GET";
  const bearer = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "") || "none";
  const key = `${method} ${path} as ${bearer}`;
  h.log.push(key);
  const answer = (): Response => {
    if (path === "/auth/refresh") return respond({ accessToken: "tok-ada", refreshToken: "refresh-ada-2" });
    if (path === "/auth/email/verify") return respond({ user: { id: "bob", email: "bob@example.com" }, accessToken: "tok-bob", refreshToken: "refresh-bob" });
    const who = accountOf(bearer);
    if (path === "/me" && who) return respond({ user: { id: who, email: `${who}@example.com` } });
    if (path === "/picks/today" && who && method === "POST") return respond({ pick: h.picks[who] ?? null, pending: false });
    const one = /^\/picks\/([\w-]+)$/.exec(path);
    if (one && who && method === "PATCH" && h.picks[who]?.id === one[1]) return respond({ pick: { ...h.picks[who], status: "skipped" } });
    h.unknown.push(key);
    return respond({ error: "Unknown." }, 404);
  };
  if (h.hold.has(key)) return new Promise((resolve) => h.held.push({ key, go: () => resolve(answer()) }));
  return answer();
}

const { AuthProvider, useAuth } = await import("../../lib/auth");
const { TodayCards } = await import("./today-cards");
const { default: PickDetail } = await import("../../app/picks/[id]");
const { localDay } = await import("../../lib/picks");

const pick = (id: string, who: string, title: string): Pick => ({
  id,
  day: localDay(),
  status: "ready",
  title,
  kind: "buy",
  why: `Picked for ${who}, from what ${who} wrote.`,
  summary: `What ${title} is.`,
  photo: null,
  createdAt: "2026-11-01T08:00:00.000Z",
});

const ADA_PICK = pick("pick-ada-1", "Ada", "Leica M11-P");

let auth!: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  h.who = auth.user?.id ?? "-";
  return null;
}
let root: ReactTestRenderer | null = null;
const tree = (parts: { card?: boolean; page?: boolean }) =>
  createElement(AuthProvider, null, createElement(Probe), parts.card ? createElement(TodayCards) : null, parts.page ? createElement(PickDetail) : null);
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await settle();
  expect(done()).toBe(true);
}
const release = (key: string) => {
  const i = h.held.findIndex((x) => x.key === key);
  expect(i).toBeGreaterThan(-1);
  h.held.splice(i, 1)[0]!.go();
};
const onBobsScreen = (text: string) => h.rendered.some((r) => r === `bob | ${text}`);
const redirected = () => root!.root.findAll((n) => (n.type as unknown as string) === "Redirect").map((n) => n.props.href as string);

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  Object.assign(h, { params: {}, moves: [], who: "-", rendered: [], log: [], unknown: [], held: [], picks: {} });
  h.hold.clear();
  h.store.clear();
  h.store.set("dandelist.refresh", "refresh-ada-1");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  expect(h.unknown).toEqual([]);
});

async function openAsAda(parts: { card?: boolean; page?: boolean }) {
  await act(async () => {
    root = create(tree(parts), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
  await act(() => until(() => auth.user?.id === "ada"));
}

describe("today's pick belongs to the sign-in that asked for it (review R50-PICK-OWNER)", () => {
  it("never shows Ada's cached pick on Bob's screen, on the card or on its own route", async () => {
    h.picks = { ada: ADA_PICK, bob: pick("pick-bob-1", "Bob", "Porsche 911 GT3") };
    // Ada's list fetches and caches her pick.
    await openAsAda({ card: true });
    await act(() => until(() => h.rendered.includes("ada | Leica M11-P")));
    // Bob signs in over Ada, with no sign-out between, and opens Ada's pick's route.
    h.params = { id: "pick-ada-1" };
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(async () => root!.update(tree({ card: true, page: true })));
    await act(() => until(() => h.rendered.includes("bob | Porsche 911 GT3") && redirected().length > 0));
    // Nothing of Ada's was ever on Bob's screen; the page asked for today's pick as Bob, found it isn't that one, went home.
    expect(onBobsScreen("Leica M11-P")).toBe(false);
    expect(onBobsScreen("Picked for Ada, from what Ada wrote.")).toBe(false);
    expect(redirected()).toEqual(["/"]);
    expect(h.log.filter((l) => l.startsWith("POST /picks/today"))).toEqual(["POST /picks/today as tok-ada", "POST /picks/today as tok-bob", "POST /picks/today as tok-bob"]);
  });

  it("changes nothing on Bob's screen when the answer to Ada's request lands after he signed in", async () => {
    h.picks = { ada: pick("pick-ada-2", "Ada", "Riva Aquariva Super"), bob: pick("pick-bob-2", "Bob", "A week in Kyoto in April") };
    // Ada opens her pick's route straight away (no card this run); her request and, later, Bob's are both held.
    h.params = { id: "pick-ada-2" };
    h.hold.add("POST /picks/today as tok-ada");
    h.hold.add("POST /picks/today as tok-bob");
    await openAsAda({ page: true });
    await act(() => until(() => h.held.length === 1));
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(() => until(() => auth.user?.id === "bob" && h.held.length === 2));
    // Ada's answer comes back first, with her pick under the very id the page was opened for: Bob's page stays empty.
    await act(async () => {
      release("POST /picks/today as tok-ada");
      await settle();
    });
    expect(onBobsScreen("Riva Aquariva Super")).toBe(false);
    expect(onBobsScreen("Picked for Ada, from what Ada wrote.")).toBe(false);
    expect(redirected()).toEqual([]);
    // Then Bob's own answer: today's pick for him is another one, so the page goes home.
    await act(async () => {
      release("POST /picks/today as tok-bob");
      await settle();
    });
    await act(() => until(() => redirected().length > 0));
    expect(redirected()).toEqual(["/"]);
    expect(onBobsScreen("Riva Aquariva Super")).toBe(false);
  });

  it("opens Ada's own pick at once from her card, and turns it down as her (control)", async () => {
    // Ada's pick for today: the list keeps it for this run of the app (by person and day), as a list opening again would.
    h.picks = { ada: ADA_PICK };
    await openAsAda({ card: true });
    await act(() => until(() => h.rendered.includes("ada | Leica M11-P")));
    const before = h.log.length;
    h.params = { id: "pick-ada-1" };
    await act(async () => root!.update(tree({ card: true, page: true })));
    // From the cache: the page asked for nothing.
    expect(h.log.slice(before)).toEqual([]);
    expect(h.rendered).toContain("ada | What Leica M11-P is.");
    // The page's own "Not for me", after the card's.
    const no = root!.root.findAll((n) => (n.type as unknown as string) === "QuietButton" && n.props.label === "Not for me").at(-1)!;
    await act(async () => no.props.onPress());
    await act(() => until(() => h.log.includes("PATCH /picks/pick-ada-1 as tok-ada")));
    expect(h.rendered).toContain("ada | Noted. Tomorrow's pick will learn from this.");
  });
});
