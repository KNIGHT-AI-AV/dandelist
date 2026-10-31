import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wish } from "./wishes";

/**
 * A look's requests at the real credential boundary (review of #131): the real AuthProvider, its real transport (the
 * bearer is read when each request is sent, and again for the retry after a refresh), the real agent requests and a
 * server that says which bearer each request carried. The other account's sign-in lands through the actual ticket
 * path; the test lets the held request go the moment the new bearer is in place, before React has heard of it.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// The device's secure storage, with a hook to act at the moment a sign-in stores its refresh token.
const store = vi.hoisted(() => ({ map: new Map<string, string>(), onSet: null as null | ((key: string, value: string | null) => Promise<void> | void) }));
vi.mock("./storage", () => ({
  getSecret: async (key: string) => store.map.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => {
    if (value === null) store.map.delete(key);
    else store.map.set(key, value);
    await store.onSet?.(key, value);
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));

/** The API as far as this needs it, logging each request with the bearer it carried. */
const server = vi.hoisted(() => ({
  log: [] as string[],
  interpret: [] as ((title: string) => void)[],
  expired: new Set<string>(),
}));
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const option = { label: "Leica Q3 43", seller: "Leica Store", url: "https://leica-camera.com/q3-43", upfrontCents: 699_500, recurring: [], checkedAt: "2026-10-31T05:00:00.000Z", totals: { monthlyCents: 0, horizonCents: 699_500, spreadMonthlyCents: 11_658 } };
const run = { id: "run-1", status: "done", steps: [], result: { options: [option], explanation: "", note: "", horizonYears: 5 } };
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  const bearer = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "") || "none";
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
  server.log.push(`${init.method ?? "GET"} ${path} as ${bearer}`);
  if (path === "/auth/refresh") {
    // Like the real API: new tokens for the same account, without the user.
    const n = body.refreshToken === "refresh-ada-1" ? 2 : 3;
    return respond({ accessToken: `tok-ada-${n}`, refreshToken: `refresh-ada-${n}` });
  }
  if (path === "/auth/oauth/redeem") return respond({ user: { id: "bob", email: "bob@example.com" }, accessToken: "tok-bob", refreshToken: "refresh-bob" });
  if (server.expired.has(bearer)) return respond({ error: "Sign in again." }, 401);
  if (path === "/me") return respond({ user: bearer.startsWith("tok-ada") ? { id: "ada", email: "ada@example.com" } : { id: "bob", email: "bob@example.com" } });
  if (path === "/wishes") return respond({ wishes: [] });
  if (path === "/agent/interpret") return new Promise((resolve) => server.interpret.push((title) => resolve(respond({ draft: { title }, questions: [] }))));
  if (path === "/agent/runs" || path.startsWith("/agent/runs/")) return respond({ run });
  return respond({});
}

const { AuthProvider, SignInChanged, bindToSignIn, currentSignIn, useAuth } = await import("./auth");
const { WishProvider } = await import("./wishes");
const { amendWish, currentRechecks } = await import("./rechecks");

const wish = { id: "w1", name: "Leica Q3", kind: "buy", tier: "nice", item: { id: "w1", upfrontCents: 587_000, recurring: [] }, details: {}, createdAt: "2026-10-30T00:00:00.000Z" } as unknown as Wish;
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
const sentAs = (path: string) => server.log.filter((l) => l.startsWith(`POST ${path} `) || l.startsWith(`GET ${path} `)).map((l) => l.slice(l.lastIndexOf(" as ") + 4));

describe("a look's requests go as the sign-in that started it (review of #131)", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    server.log.length = 0;
    server.interpret.length = 0;
    server.expired.clear();
    store.map.clear();
    store.onSet = null;
    // Ada was signed in when the app last ran; a sign-in with another account is on its way back.
    store.map.set("dandelist.refresh", "refresh-ada-1");
    store.map.set("dandelist.oauth.verifier", "verifier-1");
    await act(async () => {
      root = create(createElement(AuthProvider, null, createElement(WishProvider, null, createElement(Probe))), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await act(() => until(() => auth.status === "signedIn"));
    expect(auth.user?.id).toBe("ada");
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it("sends no research as Bob for Ada's look when Bob's bearer lands while her request is out", async () => {
    let look!: Promise<void>;
    await act(async () => void (look = amendWish(auth.api, wish, "the 43mm one")));
    expect(server.interpret).toHaveLength(1);
    const before = currentSignIn();
    // The moment Bob's sign-in stores its refresh token, his bearer is already the one requests read, and React still
    // says Ada. Ada's interpretation answers right then; the storage write (and so the screen) waits.
    const stored = later();
    store.onSet = (key, value) => {
      if (key !== "dandelist.refresh" || value !== "refresh-bob") return;
      expect(currentSignIn()).toBe(before + 1);
      expect(auth.user?.id).toBe("ada");
      server.interpret.shift()!("Leica Q3 43");
      return stored.promise;
    };
    const swap = auth.redeemTicket("ticket-bob");
    await look;
    expect(sentAs("/agent/runs")).toEqual([]);
    expect(currentRechecks().map((c) => c.outcome.kind)).not.toContain("amended");
    stored.resolve();
    await act(async () => {
      await swap;
      await settle();
    });
    expect(auth.user?.id).toBe("bob");
    expect(currentRechecks()).toEqual([]);
  });

  it("refuses a bound request's retry when the sign-in moves during its refresh", async () => {
    const bound = bindToSignIn(auth.api, currentSignIn());
    server.expired.add("tok-ada-2");
    // Ada's bearer has expired: the request is refused, the refresh renews her bearer, and Bob's sign-in lands just as
    // that refresh stores its token, before the retry goes out. Bob's sign-in is in place the moment his bearer is, which
    // is before his own token is stored: stored tokens are written one at a time (round40), so his waits behind Ada's.
    let landed: Promise<boolean> | null = null;
    store.onSet = async (key, value) => {
      if (key !== "dandelist.refresh" || value !== "refresh-ada-3") return;
      const before = currentSignIn();
      landed = auth.redeemTicket("ticket-bob");
      await until(() => currentSignIn() !== before);
    };
    await expect(bound("/agent/runs", { method: "POST", body: JSON.stringify({ draft: { title: "Leica Q3 43" } }) })).rejects.toBeInstanceOf(SignInChanged);
    await act(async () => {
      await landed;
      await settle();
    });
    // The first try went as Ada and was refused; the retry never went, as anyone.
    expect(sentAs("/agent/runs")).toEqual(["tok-ada-2"]);
    expect(auth.user?.id).toBe("bob");
  });

  it("carries on through a refresh of the same sign-in (control)", async () => {
    // Ada's bearer expires while her look's request is out; the refresh keeps her signed in and the look goes on.
    server.expired.add("tok-ada-2");
    let look!: Promise<void>;
    await act(async () => void (look = amendWish(auth.api, wish, "the 43mm one")));
    await act(async () => {
      await until(() => server.interpret.length === 1);
      server.interpret.shift()!("Leica Q3 43");
      await look;
    });
    expect(sentAs("/agent/interpret")).toEqual(["tok-ada-2", "tok-ada-3"]);
    expect(sentAs("/agent/runs")).toEqual(["tok-ada-3"]);
    expect(currentRechecks().map((c) => c.outcome.kind)).toEqual(["amended"]);
  });

  it("refuses a request bound to a sign-in that has ended, sending nothing", async () => {
    const bound = bindToSignIn(auth.api, currentSignIn());
    await act(async () => auth.signOut());
    const n = server.log.length;
    await expect(bound("/agent/runs", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(SignInChanged);
    expect(server.log.slice(n)).toEqual([]);
  });
});
