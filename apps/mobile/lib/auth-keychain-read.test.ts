import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A device whose keychain can't be read as the app starts: iOS answers -34018 ("A required entitlement isn't
 * present") without the app's entitlements, and an Android Keystore can no longer decrypt what it saved before a
 * restore. The stored session isn't restored, so the app goes on signed out instead of waiting on its loading state for
 * good, and the stored token is left in place for a later start that can read it. The real AuthProvider; only storage,
 * the platform and the network stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const store = vi.hoisted(() => ({ map: new Map<string, string>(), unreadable: new Set<string>(), writes: [] as [string, string | null][] }));
vi.mock("./storage", () => ({
  getSecret: async (key: string) => {
    if (store.unreadable.has(key)) throw new Error("A required entitlement isn't present.");
    return store.map.get(key) ?? null;
  },
  setSecret: async (key: string, value: string | null) => {
    store.writes.push([key, value]);
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
const REFRESH = "dandelist.refresh";

let auth: ReturnType<typeof useAuth> | null = null;
let root: ReactTestRenderer | null = null;
let requests: string[] = [];
function Probe() {
  auth = useAuth();
  return null;
}
/** Opens the app and lets every answer come back. */
async function open() {
  await act(async () => {
    root = create(createElement(AuthProvider, null, createElement(Probe)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  store.map.clear();
  store.unreadable.clear();
  store.writes = [];
  requests = [];
  auth = null;
  root = null;
  // The API answers the stored session's refresh, so a restore that did go ahead would sign in.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path === "/auth/refresh") return new Response(JSON.stringify({ accessToken: "tok-ada-2", refreshToken: "ref-ada-2" }), { status: 200 });
      if (path === "/me") return new Response(JSON.stringify({ user: { id: "ada", email: "ada@example.com" } }), { status: 200 });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
});

describe("a keychain that can't be read as the app starts", () => {
  it("goes on signed out instead of loading for good, and leaves the stored token for a later start", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    store.unreadable.add(REFRESH);
    await open();
    expect(auth?.status).toBe("signedOut");
    expect(requests).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(store.map.get(REFRESH)).toBe("ref-ada-1");
  });

  it("restores the stored session as before once the keychain reads", async () => {
    store.map.set(REFRESH, "ref-ada-1");
    await open();
    expect(auth?.status).toBe("signedIn");
    expect(auth?.user?.id).toBe("ada");
    expect(store.map.get(REFRESH)).toBe("ref-ada-2");
  });
});
