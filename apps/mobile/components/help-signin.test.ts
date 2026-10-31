import { act, createElement, Fragment, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A help report's request at the real credential boundary (review of #140, H2): the real AuthProvider and its transport
 * (the bearer is read when each request is sent, and again for the retry after a refresh), the real HelpHost, sheet
 * store and sendHelp, and a server that records which bearer each request carried and holds the answers the test
 * picks. The other account's sign-in lands through the actual ticket path. Only the views and the screen capture are
 * stand-ins.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// The device's secure storage, with a hook to act at the moment a sign-in stores its refresh token.
const store = vi.hoisted(() => ({ map: new Map<string, string>(), onSet: null as null | ((key: string, value: string | null) => Promise<void> | void) }));
vi.mock("../lib/storage", () => ({
  getSecret: async (key: string) => store.map.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => {
    if (value === null) store.map.delete(key);
    else store.map.set(key, value);
    await store.onSet?.(key, value);
  },
}));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  class Value {
    interpolate() {
      return 1;
    }
  }
  return {
    Platform: { OS: "ios", Version: "26.0", select: (o: Record<string, unknown>) => o.ios ?? o.default },
    Dimensions: { get: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) },
    Animated: { View: "AnimatedView", Value, timing: () => ({ start: (done?: () => void) => done?.() }) },
    Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? h("Modal", null, children) : null),
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {} },
    Text: "Text",
    View: "View",
  };
});
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.0.0", nativeBuildVersion: "28" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ usePathname: () => "/list" }));
vi.mock("../lib/screen-shot", () => ({ screenShot: async () => "ADA-SCREEN" }));
vi.mock("../lib/motion", () => ({ haptic: { select() {}, success() {}, error() {} }, ease: { out: 0, inOut: 0 }, useReducedMotion: () => true }));
vi.mock("../lib/theme", () => ({
  layout: { control: { icon: 44 } },
  radius: { lg: 16, sm: 8 },
  space: { 12: 12, 16: 16, 24: 24 },
  type: { title3: {}, callout: {}, footnote: {} },
  usePalette: () => ({ ink: "#000", ink2: "#111", accentText: "#222", surface: "#333", danger: "#f00" }),
}));
vi.mock("./lux", () => ({ Eyebrow: "Eyebrow", Glass: "Glass", Icon: "Icon", PrimaryButton: "PrimaryButton", QuietButton: "QuietButton" }));

/** The API as far as this needs it: each request logged with the bearer it carried, and /help answers held on request. */
const server = vi.hoisted(() => ({
  log: [] as { path: string; bearer: string; screenshot?: string }[],
  expired: new Set<string>(),
  held: null as null | { arrived: boolean; answer: (r: Response) => void; reply: Promise<Response> },
}));
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  const bearer = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "") || "none";
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
  server.log.push({ path, bearer, ...(path === "/help" ? { screenshot: body.screenshot } : {}) });
  if (path === "/auth/refresh") {
    // Like the real API: new tokens for the account the refresh token belongs to, without the user.
    if (body.refreshToken?.startsWith("refresh-bob")) return respond({ accessToken: "tok-bob-2", refreshToken: "refresh-bob-2" });
    const n = body.refreshToken === "refresh-ada-1" ? 2 : 3;
    return respond({ accessToken: `tok-ada-${n}`, refreshToken: `refresh-ada-${n}` });
  }
  if (path === "/auth/oauth/redeem") return respond({ user: { id: "bob", email: "bob@example.com" }, accessToken: "tok-bob", refreshToken: "refresh-bob" });
  if (path === "/help" && server.held && !server.held.arrived) {
    server.held.arrived = true;
    return server.held.reply;
  }
  if (server.expired.has(bearer)) return respond({ error: "Sign in again." }, 401);
  if (path === "/me") return respond({ user: bearer.startsWith("tok-ada") ? { id: "ada", email: "ada@example.com" } : { id: "bob", email: "bob@example.com" } });
  if (path === "/help") return respond({ id: "6f1c2d3e-0000-4000-8000-000000000000", code: "6F1C2D", stored: "complete", screen: true }, 201);
  return respond({});
}
/** Holds the next /help request's answer until the test gives it. */
function holdNextHelp() {
  let answer!: (r: Response) => void;
  const reply = new Promise<Response>((r) => (answer = r));
  server.held = { arrived: false, answer, reply };
  return server.held;
}

const { AuthProvider, currentSignIn, useAuth } = await import("../lib/auth");
const { HelpButton, HelpHost } = await import("./help");
const { currentSheet } = await import("../lib/help-sheet");

let auth!: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}
let root: ReactTestRenderer | null = null;
/** Lets every pending promise and timer run. */
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await settle();
  expect(done()).toBe(true);
}
function later() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const is = (n: ReactTestInstance, type: string) => (n.type as unknown) === type;
const all = (pick: (n: ReactTestInstance) => boolean) => root!.root.findAll(pick);
const modal = () => all((n) => is(n, "Modal")).length > 0;
const texts = () => all((n) => is(n, "Text")).map((n) => [n.props.children].flat().join(""));
const sendButton = () => all((n) => is(n, "PrimaryButton") && n.props.label === "Send")[0]!;
/** The help requests sent, as the bearer each carried and the picture it held. */
const helps = () => server.log.filter((l) => l.path === "/help").map((l) => `${l.bearer} ${l.screenshot ?? "-"}`);

describe("a help report's request goes as the sign-in its sheet was made under (review of #140)", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    server.log.length = 0;
    server.expired.clear();
    server.held = null;
    store.map.clear();
    store.onSet = null;
    // Ada was signed in when the app last ran; a sign-in with another account is on its way back.
    store.map.set("dandelist.refresh", "refresh-ada-1");
    store.map.set("dandelist.oauth.verifier", "verifier-1");
    await act(async () => {
      root = create(createElement(AuthProvider, null, createElement(Fragment, null, createElement(HelpHost), createElement(HelpButton), createElement(Probe))), {
        unstable_isConcurrent: true,
      } as unknown as Parameters<typeof create>[1]);
    });
    await act(() => until(() => auth.status === "signedIn"));
    expect(auth.user?.id).toBe("ada");
    // Ada opens help on her screen.
    await act(async () => all((n) => is(n, "Pressable") && n.props.accessibilityLabel === "Help")[0]!.props.onPress());
    await act(() => until(() => modal()));
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it("never resends Ada's report as Bob when her first try's 401 comes back after Bob signed in", async () => {
    const first = holdNextHelp();
    await act(async () => sendButton().props.onPress());
    await act(() => until(() => first.arrived));
    // Ada signs out and Bob signs in, all the way, while her request is still out.
    await act(async () => auth.signOut());
    await act(async () => auth.redeemTicket("ticket-bob"));
    await act(() => until(() => auth.user?.id === "bob"));
    expect(modal()).toBe(false);
    // Only now does Ada's first try come back: 401. It belongs to her session, so it neither refreshes Bob's (round40)
    // nor goes again, as anyone.
    const n = server.log.length;
    await act(async () => first.answer(respond({ error: "Sign in again." }, 401)));
    await act(async () => {
      await settle();
      await settle();
    });
    expect(server.log.slice(n).map((l) => l.path)).not.toContain("/auth/refresh");
    expect(helps()).toEqual(["tok-ada-2 ADA-SCREEN"]);
    // Bob stays signed in, and sees no sheet.
    expect(auth.user?.id).toBe("bob");
    expect(modal()).toBe(false);
    expect(currentSheet()).toBeNull();
  });

  it("sends nothing when Send is pressed after Bob's bearer came in, before the screen heard of it", async () => {
    const press = sendButton().props.onPress as () => void;
    const before = currentSignIn();
    const stored = later();
    store.onSet = (key, value) => {
      if (key !== "dandelist.refresh" || value !== "refresh-bob") return;
      // Bob's bearer is the one requests read now; React still shows Ada's sheet, and Send is pressed right then.
      expect(currentSignIn()).toBe(before + 1);
      expect(auth.user?.id).toBe("ada");
      press();
      return stored.promise;
    };
    const swap = auth.redeemTicket("ticket-bob");
    await act(() => until(() => store.map.get("dandelist.refresh") === "refresh-bob"));
    await act(async () => {
      await settle();
      await settle();
    });
    expect(helps()).toEqual([]);
    stored.resolve();
    await act(async () => {
      await swap;
      await settle();
    });
    await act(() => until(() => auth.user?.id === "bob"));
    expect(helps()).toEqual([]);
    expect(modal()).toBe(false);
  });

  it("goes through a refresh of the same sign-in, and lands (control)", async () => {
    // Ada's bearer has expired: the first try is refused, the refresh keeps her signed in, and the retry goes as her.
    server.expired.add("tok-ada-2");
    await act(async () => sendButton().props.onPress());
    await act(() => until(() => texts().includes("Sent. Your report is 6F1C2D.")));
    expect(helps()).toEqual(["tok-ada-2 ADA-SCREEN", "tok-ada-3 ADA-SCREEN"]);
    expect(auth.user?.id).toBe("ada");
  });
});
