import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boundaries the round40 ownership fix changed, beside the five cases in auth-response-owner.test.ts: stored tokens
 * written one at a time with the newest owner's value last, a sign-out's revoke and a failed refresh that come back
 * after another sign-in, the stored session restored at startup against a sign-in made meanwhile, one refresh for two
 * 401s of the same session, and one redemption per ticket. The real AuthProvider; only storage, the platform and a
 * synthetic API stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// Device storage; a test can hold one refresh-token write before it lands, as a slow keychain would.
const store = vi.hoisted(() => ({ map: new Map<string, string>(), slow: null as null | { value: string | null; entered: () => void; gate: Promise<void> } }));
vi.mock("./storage", () => ({
  getSecret: async (key: string) => store.map.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => {
    const slow = store.slow;
    if (slow && key === "dandelist.refresh" && slow.value === value) {
      store.slow = null;
      slow.entered();
      await slow.gate;
    }
    if (value === null) store.map.delete(key);
    else store.map.set(key, value);
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));

const { AuthProvider, useAuth } = await import("./auth");
type User = { id: string; email: string };
const REFRESH = "dandelist.refresh";
const VERIFIER = "dandelist.oauth.verifier";
const ada: User = { id: "ada", email: "ada@example.com" };
const bob: User = { id: "bob", email: "bob@example.com" };
const signIns: Record<string, { accessToken: string; refreshToken: string; user: User }> = {
  "ada@example.com": { accessToken: "tok-ada-1", refreshToken: "ref-ada-1", user: ada },
  "bob@example.com": { accessToken: "tok-bob-1", refreshToken: "ref-bob-1", user: bob },
};
const owners: Record<string, User> = { "tok-ada-1": ada, "tok-ada-2": ada, "tok-bob-1": bob };
const tickets: Record<string, string> = { "ticket-1": "bob@example.com", "ticket-2": "bob@example.com" };

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
      const next = refreshes[body.refreshToken!];
      return next ? respond(next) : respond({ error: "Sign in again." }, 401);
    }
    case "/auth/logout":
      await gate(`logout:${bearer}`);
      return respond({});
    case "/auth/oauth/redeem":
      await gate(`redeem:${body.ticket}`);
      return respond(signIns[tickets[body.ticket!]!]);
    case "/me":
      if (!bearer || expired.has(bearer) || !owners[bearer]) return respond({ error: "Sign in again." }, 401);
      return respond({ user: owners[bearer] });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
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
async function mount() {
  await act(async () => {
    root = create(createElement(AuthProvider, null, createElement(Probe)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
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
const asBob = { status: "signedIn", user: "bob", sentAs: "tok-bob-1", answered: 200, stored: "ref-bob-1" };

beforeEach(() => {
  store.map.clear();
  store.slow = null;
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
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((r) => (entered = r));
    store.slow = { value: "ref-bob-1", entered, gate: new Promise<void>((r) => (release = r)) };
    let signing!: Promise<void>;
    await act(async () => {
      signing = now().verifyEmail(bob.email, "123456");
      await writing;
    });
    // Bob is in place while his token is still being written, and signs out meanwhile.
    expect(now().status).toBe("signedIn");
    let out!: Promise<void>;
    await act(async () => void (out = now().signOut()));
    expect(now().status).toBe("signedOut");
    await act(async () => {
      release();
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

  it("doesn't restore the stored session over a sign-in made while it was being restored", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    const restoring = hold("refresh:ref-ada-1");
    await mount();
    expect(now().status).toBe("loading");
    await act(async () => void (await restoring.entered));
    await signInAs(bob);
    await act(async () => {
      restoring.release();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(await state()).toEqual(asBob);
  });

  it("ends signed out, not still loading, when a sign-in that started during the restore fails", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    refreshes["ref-ada-1"] = { accessToken: "tok-ada-2", refreshToken: "ref-ada-2" };
    const restoring = hold("refresh:ref-ada-1");
    await mount();
    await act(async () => void (await restoring.entered));
    await act(async () => void (await now().verifyEmail("nobody@example.com", "000000").catch(() => undefined)));
    await act(async () => {
      restoring.release();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(now().status).toBe("signedOut");
    expect(now().user).toBeNull();
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

  it("redeems a ticket once when it arrives twice, and signs in with it (control)", async () => {
    await mount();
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold("redeem:ticket-1");
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = now().redeemTicket("ticket-1");
      second = now().redeemTicket("ticket-1");
      await redeeming.entered;
    });
    await act(async () => {
      redeeming.release();
      await Promise.all([first, second]);
    });
    expect(log.filter((l) => l.path === "/auth/oauth/redeem")).toHaveLength(1);
    expect(store.map.has(VERIFIER)).toBe(false);
    expect(await state()).toEqual(asBob);
  });

  it("ends a ticket redeemed after a newer sign-in quietly, leaving that sign-in and the verifier", async () => {
    await mount();
    store.map.set(VERIFIER, "verifier-1");
    const redeeming = hold("redeem:ticket-2");
    let late!: Promise<void>;
    await act(async () => {
      late = now().redeemTicket("ticket-2");
      await redeeming.entered;
    });
    await signInAs(ada);
    await act(async () => {
      redeeming.release();
      await late;
    });
    expect(now().user?.id).toBe("ada");
    expect(store.map.get(VERIFIER)).toBe("verifier-1");
    expect(store.map.get(REFRESH)).toBe("ref-ada-1");
  });
});
