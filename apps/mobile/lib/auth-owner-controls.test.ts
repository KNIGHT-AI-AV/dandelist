import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boundaries the round40 ownership fix changed, beside the five cases in auth-response-owner.test.ts: stored tokens
 * written one at a time with the newest owner's value last, a sign-out's revoke and a failed refresh that come back
 * after another sign-in, the stored session restored at startup against a sign-in or sign-out made meanwhile, one
 * refresh for two 401s of the same session, and one redemption per ticket. Round41 adds the callers: the provider
 * return screen when a newer sign-in starts or the person leaves it before its ticket finishes, and the Apple sheet for
 * a sign-in that a newer one took over from. The real AuthProvider and return screen; only storage, the platform, the
 * router, the Apple sheet and a synthetic API stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// Device storage; a test can hold one read or one write until it releases it, as a slow keychain would, or make one
// write fail.
const store = vi.hoisted(() => ({
  map: new Map<string, string>(),
  slowRead: null as null | { key: string; entered: () => void; gate: Promise<void> },
  slow: null as null | { key: string; value: string | null; entered: () => void; gate: Promise<void> },
  failing: null as null | { key: string; value: string | null },
}));
vi.mock("./storage", () => ({
  getSecret: async (key: string) => {
    const slow = store.slowRead;
    if (slow?.key === key) {
      store.slowRead = null;
      slow.entered();
      await slow.gate;
    }
    return store.map.get(key) ?? null;
  },
  setSecret: async (key: string, value: string | null) => {
    const slow = store.slow;
    if (slow?.key === key && slow.value === value) {
      store.slow = null;
      slow.entered();
      await slow.gate;
    }
    if (store.failing?.key === key && store.failing.value === value) throw new Error("The keychain refused the write.");
    if (value === null) store.map.delete(key);
    else store.map.set(key, value);
  },
}));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default }, View: "View" }));
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
// The Apple sheet: what it was opened with, and the answer a test plans for it.
const apple = vi.hoisted(() => ({ asked: [] as { nonce?: string }[], answer: null as null | (() => Promise<unknown>) }));
vi.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: async (options: { nonce?: string }) => {
    apple.asked.push(options);
    if (!apple.answer) throw new Error("No Apple answer was planned.");
    return apple.answer();
  },
}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));
// The router as the return screen uses it, and every place it was sent.
const route = vi.hoisted(() => ({ params: {} as Record<string, string>, moves: [] as unknown[] }));
vi.mock("expo-router", () => {
  const router = { replace: (to: unknown) => void route.moves.push(to), back: () => void route.moves.push("back"), canGoBack: () => false };
  return { useLocalSearchParams: () => route.params, useRouter: () => router };
});
vi.mock("./theme", () => ({ usePalette: () => ({ bg: "#000", ink: "#fff", ink2: "#ccc" }) }));
vi.mock("../components/lux", () => ({ Backdrop: "Backdrop", Eyebrow: "Eyebrow", Grain: "Grain", Shade: "Shade" }));
vi.mock("../components/atmosphere", () => ({ Atmosphere: "Atmosphere" }));
// The return screen requires its backdrop photo, which Metro turns into a number; Node would read the .jpg as code.
(require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions[".jpg"] = (m) => {
  m.exports = 1;
};

const { AuthProvider, useAuth } = await import("./auth");
const { default: AuthReturn } = await import("../app/auth/callback");
type User = { id: string; email: string };
const REFRESH = "dandelist.refresh";
const VERIFIER = "dandelist.oauth.verifier";
const ada: User = { id: "ada", email: "ada@example.com" };
const bob: User = { id: "bob", email: "bob@example.com" };
const signIns: Record<string, { accessToken: string; refreshToken: string; user: User }> = {
  "ada@example.com": { accessToken: "tok-ada-1", refreshToken: "ref-ada-1", user: ada },
  "bob@example.com": { accessToken: "tok-bob-1", refreshToken: "ref-bob-1", user: bob },
};
const owners: Record<string, User> = { "tok-ada-1": ada, "tok-ada-2": ada, "tok-ada-3": ada, "tok-bob-1": bob, "tok-bob-2": bob };
const tickets: Record<string, string> = { "ticket-1": "bob@example.com", "ticket-2": "bob@example.com" };
const appleTokens: Record<string, string> = { "apple-bob": "bob@example.com" };

// The API: what each request carried, its answers, and holds that keep one answer back until released.
let log: { method: string; path: string; bearer: string | null }[] = [];
let expired = new Set<string>();
let refreshes: Record<string, { accessToken: string; refreshToken: string } | null> = {};
let holds = new Map<string, { enter: () => void; gate: Promise<void> }>();
let opens: (() => void)[] = [];
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function hold(key: string) {
  let enter!: () => void;
  let open!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const gate = new Promise<void>((r) => (open = r));
  holds.set(key, { enter, gate });
  opens.push(open);
  return { entered, release: open };
}
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  const bearer = (new Headers(init.headers).get("Authorization") ?? "").replace(/^Bearer /, "") || null;
  const body = (typeof init.body === "string" ? JSON.parse(init.body) : {}) as Record<string, string>;
  log.push({ method, path: url.pathname, bearer });
  const gate = async (key: string) => {
    const h = holds.get(key);
    if (!h) return;
    holds.delete(key);
    h.enter();
    await h.gate;
  };
  switch (url.pathname) {
    case "/auth/email/verify":
      await gate(`verify:${body.email}`);
      return signIns[body.email!] ? respond(signIns[body.email!]) : respond({ error: "That code didn't work." }, 400);
    case "/auth/refresh": {
      await gate(`refresh:${body.refreshToken}`);
      // Like the API, a refresh token works once: the session it named is revoked as the new one is issued.
      const next = refreshes[body.refreshToken!];
      delete refreshes[body.refreshToken!];
      return next ? respond(next) : respond({ error: "Sign in again." }, 401);
    }
    case "/auth/logout":
      await gate(`logout:${bearer}`);
      return respond({});
    case "/auth/oauth/redeem": {
      await gate(`redeem:${body.ticket}`);
      const email = tickets[body.ticket!];
      return email ? respond(signIns[email]) : respond({ error: "That sign-in didn't go through." }, 400);
    }
    case "/auth/apple/nonce":
      await gate("nonce");
      return respond({ nonce: "nonce-1" });
    case "/auth/apple/native":
      return respond(signIns[appleTokens[body.identityToken!]!]);
    case "/me":
      if (!bearer || expired.has(bearer) || !owners[bearer]) return respond({ error: "Sign in again." }, 401);
      return respond({ user: owners[bearer] });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
}

/** Holds the next read of `key` until released. */
function slowRead(key: string) {
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((r) => (entered = r));
  store.slowRead = { key, entered, gate: new Promise<void>((r) => (release = r)) };
  opens.push(() => release());
  return { reading, release: () => release() };
}
/** Holds the next write of `value` under `key` until released. */
function slowWrite(key: string, value: string | null) {
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((r) => (entered = r));
  store.slow = { key, value, entered, gate: new Promise<void>((r) => (release = r)) };
  opens.push(() => release());
  return { writing, release: () => release() };
}

let auth: ReturnType<typeof useAuth> | null = null;
let root: ReactTestRenderer | null = null;
function Probe() {
  auth = useAuth();
  return null;
}
const now = () => {
  if (!auth) throw new Error("The AuthProvider hasn't mounted.");
  return auth;
};
const tree = (onReturn: boolean) => createElement(AuthProvider, null, createElement(Probe), onReturn ? createElement(AuthReturn) : null);
/** Opens the app; with a ticket, on the screen a provider sent the person back to with it. */
async function mount(ticket?: string) {
  route.params = ticket ? { ticket } : {};
  await act(async () => {
    root = create(tree(!!ticket), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
}
/** The person leaves the return screen; the app, and its AuthProvider, stay. */
const leave = () => act(async () => root!.update(tree(false)));
/** Lets every answer that isn't held come back. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
/** The app closes and opens again: a new AuthProvider restores whatever this device kept. */
async function restart() {
  await act(async () => root?.unmount());
  await mount();
  await settle();
}
const signInAs = (u: User) => act(async () => now().verifyEmail(u.email, "123456"));
/** Where things stand, and the bearer the next request actually carries. */
async function state() {
  let res!: Response;
  await act(async () => {
    res = await now().api("/me");
  });
  return { status: now().status, user: now().user?.id ?? null, sentAs: log.at(-1)?.bearer ?? null, answered: res.status, stored: store.map.get(REFRESH) ?? null };
}
const asAda = { status: "signedIn", user: "ada", sentAs: "tok-ada-1", answered: 200, stored: "ref-ada-1" };
const asBob = { status: "signedIn", user: "bob", sentAs: "tok-bob-1", answered: 200, stored: "ref-bob-1" };

beforeEach(() => {
  store.map.clear();
  store.slowRead = null;
  store.slow = null;
  store.failing = null;
  apple.asked = [];
  apple.answer = null;
  route.params = {};
  route.moves = [];
  log = [];
  expired = new Set();
  refreshes = {};
  holds = new Map();
  opens = [];
  auth = null;
  root = null;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(async () => {
  await act(async () => {
    opens.forEach((open) => open());
    root?.unmount();
  });
  vi.unstubAllGlobals();
});

describe("auth ownership boundaries (round40)", () => {
  it("leaves a sign-out's empty storage last when the sign-in's own token write lands late", async () => {
    await mount();
    const storing = slowWrite(REFRESH, "ref-bob-1");
    let signing!: Promise<void>;
    await act(async () => {
      signing = now().verifyEmail(bob.email, "123456");
      await storing.writing;
    });
    // Bob is in place while his token is still being written, and signs out meanwhile.
    expect(now().status).toBe("signedIn");
    let out!: Promise<void>;
    await act(async () => void (out = now().signOut()));
    expect(now().status).toBe("signedOut");
    await act(async () => {
      storing.release();
      await signing;
      await out;
    });
    expect(store.map.has(REFRESH)).toBe(false);
    expect(now().status).toBe("signedOut");
    expect(log.filter((l) => l.path === "/auth/logout").map((l) => l.bearer)).toEqual(["tok-bob-1"]);
  });

  it("leaves a sign-in alone when the previous sign-out's revoke comes back after it", async () => {
    await mount();
    await signInAs(ada);
    const logout = hold("logout:tok-ada-1");
    let out!: Promise<void>;
    await act(async () => {
      out = now().signOut();
      await logout.entered;
    });
    expect(now().status).toBe("signedOut");
    await signInAs(bob);
    await act(async () => {
      logout.release();
      await out;
    });
    expect(await state()).toEqual(asBob);
  });

  it("keeps Bob's session and stored token when Ada's refresh fails after he signed in", async () => {
    await mount();
    await signInAs(ada);
    expired.add("tok-ada-1");
    refreshes["ref-ada-1"] = null;
    const refreshing = hold("refresh:ref-ada-1");
    let old!: Promise<Response>;
    await act(async () => {
      old = now().api("/me");
      await refreshing.entered;
    });
    await signInAs(bob);
    let answer!: Response;
    await act(async () => {
      refreshing.release();
      answer = await old;
    });
    // Ada's request ends with its own 401; nothing of Bob's moves.
    expect(answer.status).toBe(401);
    expect(await state()).toEqual(asBob);
  });

  it("doesn't restore the stored session over a sign-in made while it was being restored, then or at the next start", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    const restoring = hold("refresh:ref-ada-1");
    await mount();
    expect(now().status).toBe("loading");
    await act(async () => void (await restoring.entered));
    await signInAs(bob);
    await act(async () => restoring.release());
    await settle();
    expect(await state()).toEqual(asBob);
    // Ada's renewed token was never stored over Bob's, so the next start opens his session, not hers.
    refreshes["ref-ada-2"] = { accessToken: "tok-ada-3", refreshToken: "ref-ada-3" };
    refreshes["ref-bob-1"] = { accessToken: "tok-bob-2", refreshToken: "ref-bob-2" };
    await restart();
    expect(await state()).toEqual({ status: "signedIn", user: "bob", sentAs: "tok-bob-2", answered: 200, stored: "ref-bob-2" });
  });

  it("ends signed out, not still loading, when a sign-in that started during the restore fails, and keeps the renewed token", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    const restoring = hold("refresh:ref-ada-1");
    await mount();
    await act(async () => void (await restoring.entered));
    await act(async () => void (await now().verifyEmail("nobody@example.com", "000000").catch(() => undefined)));
    await act(async () => restoring.release());
    await settle();
    expect(now().status).toBe("signedOut");
    expect(now().user).toBeNull();
    // The server took ref-ada-1 for ref-ada-2. A sign-in that failed didn't sign Ada out of this device, so her renewed
    // token is the one kept, and the next start opens her session with it.
    expect(store.map.get(REFRESH)).toBe("ref-ada-2");
    refreshes["ref-ada-2"] = { accessToken: "tok-ada-3", refreshToken: "ref-ada-3" };
    await restart();
    expect(await state()).toEqual({ status: "signedIn", user: "ada", sentAs: "tok-ada-3", answered: 200, stored: "ref-ada-3" });
  });

  it("keeps nothing of the restore when this device signs out while it is being restored, then or at the next start", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    const restoring = hold("refresh:ref-ada-1");
    await mount();
    await act(async () => void (await restoring.entered));
    await act(async () => now().signOut());
    await act(async () => restoring.release());
    await settle();
    expect(now().status).toBe("signedOut");
    expect(store.map.has(REFRESH)).toBe(false);
    // Had ref-ada-2 been kept, the next start would open Ada's session with it.
    refreshes["ref-ada-2"] = { accessToken: "tok-ada-3", refreshToken: "ref-ada-3" };
    await restart();
    expect(now().status).toBe("signedOut");
    expect(log.filter((l) => l.path === "/auth/refresh")).toHaveLength(1);
  });

  it("makes one refresh for two 401s of the same session, and sends both again renewed (control)", async () => {
    await mount();
    await signInAs(ada);
    expired.add("tok-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    let answers!: Response[];
    await act(async () => {
      answers = await Promise.all([now().api("/me"), now().api("/me")]);
    });
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(log.filter((l) => l.path === "/auth/refresh")).toHaveLength(1);
    expect(log.filter((l) => l.path === "/me").map((l) => l.bearer)).toEqual(["tok-ada-1", "tok-ada-1", "tok-ada-2", "tok-ada-2"]);
    expect(now().user?.id).toBe("ada");
    expect(store.map.get(REFRESH)).toBe("ref-ada-2");
  });

  it("hands a refresh whose new token can't be stored to its caller alone, and stores the next sign-in after it", async () => {
    await mount();
    await signInAs(ada);
    expired.add("tok-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    store.failing = { key: REFRESH, value: "ref-ada-2" };
    const node = globalThis as unknown as { process: { on(e: string, f: (reason: unknown) => void): void; off(e: string, f: (reason: unknown) => void): void } };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    node.process.on("unhandledRejection", onUnhandled);
    let failed: unknown = null;
    try {
      await act(async () => {
        await now()
          .api("/me")
          .catch((e: unknown) => void (failed = e));
      });
      await settle();
    } finally {
      node.process.off("unhandledRejection", onUnhandled);
    }
    expect((failed as Error | null)?.message).toBe("The keychain refused the write.");
    expect(unhandled).toEqual([]);
    // The writes carry on behind it: a sign-out and the next sign-in are stored as usual.
    store.failing = null;
    await act(async () => now().signOut());
    expect(store.map.has(REFRESH)).toBe(false);
    await signInAs(bob);
    expect(await state()).toEqual(asBob);
  });

  it("redeems a ticket once when it arrives twice, and signs in with it (control)", async () => {
    await mount();
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold("redeem:ticket-1");
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = now().redeemTicket("ticket-1");
      second = now().redeemTicket("ticket-1");
      await redeeming.entered;
    });
    let took!: boolean[];
    await act(async () => {
      redeeming.release();
      took = await Promise.all([first, second]);
    });
    expect(took).toEqual([true, true]);
    expect(log.filter((l) => l.path === "/auth/oauth/redeem")).toHaveLength(1);
    expect(store.map.has(VERIFIER)).toBe(false);
    expect(await state()).toEqual(asBob);
  });

  it("ends a ticket redeemed after a newer sign-in quietly, leaving that sign-in and the verifier", async () => {
    await mount();
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold("redeem:ticket-2");
    let late!: Promise<boolean>;
    await act(async () => {
      late = now().redeemTicket("ticket-2");
      await redeeming.entered;
    });
    await signInAs(ada);
    let took!: boolean;
    await act(async () => {
      redeeming.release();
      took = await late;
    });
    expect(took).toBe(false);
    expect(now().user?.id).toBe("ada");
    expect(store.map.get(VERIFIER)).toBe("verifier-1");
    expect(store.map.get(REFRESH)).toBe("ref-ada-1");
  });

  it("doesn't send a ticket whose sign-in a newer one took over from while its verifier was read", async () => {
    await mount();
    store.map.set(VERIFIER, "verifier-1");
    const reading = slowRead(VERIFIER);
    let late!: Promise<boolean>;
    await act(async () => {
      late = now().redeemTicket("ticket-1");
      await reading.reading;
    });
    await signInAs(ada);
    let took!: boolean;
    await act(async () => {
      reading.release();
      took = await late;
    });
    expect(took).toBe(false);
    expect(log.filter((l) => l.path === "/auth/oauth/redeem")).toHaveLength(0);
    expect(await state()).toEqual(asAda);
  });
});

describe("the provider return screen against a newer sign-in (round41)", () => {
  it("opens the list once its ticket signs in (control)", async () => {
    store.map.set(VERIFIER, "verifier-1");
    await mount("ticket-1");
    await settle();
    expect(route.moves).toEqual(["/wishes"]);
    expect(store.map.has(VERIFIER)).toBe(false);
    expect(await state()).toEqual(asBob);
  });

  it("opens the sign-in page with an error when its ticket fails (control)", async () => {
    store.map.set(VERIFIER, "verifier-1");
    await mount("ticket-bad");
    await settle();
    expect(route.moves).toEqual([{ pathname: "/sign-in", params: { error: "failed" } }]);
    expect(now().status).toBe("signedOut");
  });

  it.each([
    ["stays on", "signs in", "ticket-1"],
    ["stays on", "fails", "ticket-bad"],
    ["leaves", "signs in", "ticket-1"],
    ["leaves", "fails", "ticket-bad"],
  ])("moves nothing when the person %s the return screen and signs in another way before its ticket %s", async (where, _, ticket) => {
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold(`redeem:${ticket}`);
    await mount(ticket);
    await act(async () => void (await redeeming.entered));
    if (where === "leaves") await leave();
    await signInAs(ada);
    await act(async () => redeeming.release());
    await settle();
    expect(route.moves).toEqual([]);
    expect(store.map.get(VERIFIER)).toBe("verifier-1");
    expect(await state()).toEqual(asAda);
  });

  it.each([
    ["signs in", "ticket-1", asBob],
    ["fails", "ticket-bad", { status: "signedOut", user: null, answered: 401, stored: null }],
  ])("moves nothing when the person leaves the return screen before its ticket %s, and keeps what it did", async (_, ticket, after) => {
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold(`redeem:${ticket}`);
    await mount(ticket);
    await act(async () => void (await redeeming.entered));
    await leave();
    await act(async () => redeeming.release());
    await settle();
    expect(route.moves).toEqual([]);
    expect(await state()).toMatchObject(after);
  });

  it.each([
    ["its session's token is stored", REFRESH, "ref-bob-1", false],
    ["its verifier is removed", VERIFIER, null, false],
    ["storing its session's token fails", REFRESH, "ref-bob-1", true],
    ["removing its verifier fails", VERIFIER, null, true],
  ])("moves nothing for a ticket a newer sign-in took over from while %s, and keeps its session until that one lands", async (_, key, value, fails) => {
    store.map.set(VERIFIER, "verifier-1");
    const held = slowWrite(key, value);
    // A keychain that refuses this write once it lets it through.
    if (fails) store.failing = { key, value };
    await mount("ticket-1");
    await act(async () => void (await held.writing));
    // Bob's session is in place while that write is still going on, and a newer sign-in starts.
    expect(now().user?.id).toBe("bob");
    const verifying = hold(`verify:${ada.email}`);
    let newer!: Promise<void>;
    await act(async () => {
      newer = now().verifyEmail(ada.email, "123456");
      await verifying.entered;
    });
    await act(async () => held.release());
    await settle();
    expect(route.moves).toEqual([]);
    // Bob's session stays in place; when his token couldn't be stored, nothing of his is stored.
    expect(await state()).toEqual({ ...asBob, stored: fails && key === REFRESH ? null : "ref-bob-1" });
    store.failing = null;
    await act(async () => {
      verifying.release();
      await newer;
    });
    expect(await state()).toEqual(asAda);
    expect(route.moves).toEqual([]);
  });
});

describe("a token write the keychain refuses, with no newer sign-in (round42 controls)", () => {
  it.each([
    ["storing its session's token", REFRESH, "ref-bob-1"],
    ["removing its verifier", VERIFIER, null],
  ])("still reports a failure %s on the return screen, and stores the next sign-in after it", async (_, key, value) => {
    store.map.set(VERIFIER, "verifier-1");
    store.failing = { key, value };
    await mount("ticket-1");
    await settle();
    // Nothing newer started, so the failure is this sign-in's own and the person is told.
    expect(route.moves).toEqual([{ pathname: "/sign-in", params: { error: "failed" } }]);
    // The writes carry on behind it.
    store.failing = null;
    await signInAs(ada);
    expect(await state()).toEqual(asAda);
  });
});

describe("Sign in with Apple against a newer sign-in (round41)", () => {
  it("opens no Apple sheet for a nonce that comes back after a newer sign-in", async () => {
    await mount();
    const nonce = hold("nonce");
    let late!: Promise<boolean>;
    await act(async () => {
      late = now().signInWithApple();
      await nonce.entered;
    });
    await signInAs(bob);
    let took!: boolean;
    await act(async () => {
      nonce.release();
      took = await late;
    });
    expect(took).toBe(false);
    expect(apple.asked).toEqual([]);
    expect(await state()).toEqual(asBob);
  });

  it("signs in through the Apple sheet with the API's nonce (control)", async () => {
    await mount();
    apple.answer = async () => ({ identityToken: "apple-bob", fullName: null });
    let took!: boolean;
    await act(async () => void (took = await now().signInWithApple()));
    expect(took).toBe(true);
    expect(apple.asked.map((o) => o.nonce)).toEqual(["nonce-1"]);
    expect(await state()).toEqual(asBob);
  });

  it("ends quietly when the person closes the Apple sheet (control)", async () => {
    await mount();
    apple.answer = async () => {
      throw Object.assign(new Error("The person closed the sheet."), { code: "ERR_REQUEST_CANCELED" });
    };
    let took!: boolean;
    await act(async () => void (took = await now().signInWithApple()));
    expect(took).toBe(false);
    expect(apple.asked).toHaveLength(1);
    expect(log.filter((l) => l.path === "/auth/apple/native")).toHaveLength(0);
    expect(now().status).toBe("signedOut");
  });

  it("reports an Apple sign-in a newer one took over from while its token was stored, and keeps it until that one lands", async () => {
    await mount();
    apple.answer = async () => ({ identityToken: "apple-bob", fullName: null });
    const storing = slowWrite(REFRESH, "ref-bob-1");
    let late!: Promise<boolean>;
    await act(async () => {
      late = now().signInWithApple();
      await storing.writing;
    });
    const verifying = hold(`verify:${ada.email}`);
    let newer!: Promise<void>;
    await act(async () => {
      newer = now().verifyEmail(ada.email, "123456");
      await verifying.entered;
    });
    let took!: boolean;
    await act(async () => {
      storing.release();
      took = await late;
    });
    expect(took).toBe(false);
    expect(await state()).toEqual(asBob);
    await act(async () => {
      verifying.release();
      await newer;
    });
    expect(await state()).toEqual(asAda);
  });
});
