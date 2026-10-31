import { act, createElement, useEffect, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared profile across a change of account (Codex's 35-profile-owner-backlog): the real AuthProvider and the real
 * useProfile store under one persistent probe, a synthetic server that holds chosen answers and refuses anything it
 * doesn't know, and only platform, storage and expo modules stood in for.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("./storage", () => ({
  getSecret: async (key: string) => store.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => void (value === null ? store.delete(key) : store.set(key, value)),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock("expo/fetch", () => ({ fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));

type Held = { as: string; answer: (name?: string) => void };
const server = vi.hoisted(() => ({ log: [] as string[], held: [] as Held[], hold: new Set<string>(), unknown: [] as string[] }));
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const profileOf = (who: string, name = who === "tok-ada" ? "Ada Lovelace" : "Bob Marley") => ({ email: `${who}@example.com`, name, avatarKey: null, avatarUrl: null, createdAt: "2026-10-01T00:00:00.000Z" });
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  const method = init.method ?? "GET";
  const bearer = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "") || "none";
  server.log.push(`${method} ${path} as ${bearer}`);
  if (path === "/auth/refresh") return respond({ accessToken: "tok-ada", refreshToken: "refresh-ada-2" });
  if (path === "/auth/email/verify") {
    const { email } = JSON.parse(String(init.body)) as { email: string };
    return email.startsWith("ada") ? respond({ user: { id: "ada", email }, accessToken: "tok-ada", refreshToken: "refresh-ada-3" }) : respond({ user: { id: "bob", email }, accessToken: "tok-bob", refreshToken: "refresh-bob" });
  }
  if (path === "/auth/logout") return respond({});
  if (path === "/me") return respond({ user: bearer === "tok-ada" ? { id: "ada", email: "ada@example.com" } : { id: "bob", email: "bob@example.com" } });
  if (path === "/me/profile") {
    const body = method === "PATCH" ? profileOf(bearer, (JSON.parse(String(init.body)) as { name: string }).name) : profileOf(bearer);
    // Held for the test to answer when it says: an answer already on its way when the account changes.
    if (server.hold.has(`${method} ${bearer}`)) return new Promise((resolve) => server.held.push({ as: `${method} ${bearer}`, answer: (name) => resolve(respond({ profile: name ? { ...body, name } : body })) }));
    return respond({ profile: body });
  }
  server.unknown.push(`${method} ${path}`);
  return respond({ error: "Unknown." }, 404);
}

const { AuthProvider, useAuth } = await import("./auth");
const { useProfile } = await import("./profile");

/** What the probe showed at every commit: the account signed in and the name its profile shows. */
const shown: string[] = [];
let mounts = 0;
let auth!: ReturnType<typeof useAuth>;
let profile!: ReturnType<typeof useProfile>;
function Probe() {
  auth = useAuth();
  profile = useProfile();
  useEffect(() => void (mounts += 1), []);
  useLayoutEffect(() => void shown.push(`${auth.user?.id ?? "-"}: ${profile.profile?.name ?? "none"}`));
  return null;
}
let root: ReactTestRenderer | null = null;
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await settle();
  expect(done()).toBe(true);
}
/** Lets a held answer go, with another name than the account's own when `name` is given. */
const answer = (as: string, name?: string) => {
  const i = server.held.findIndex((h) => h.as === as);
  expect(i).toBeGreaterThan(-1);
  server.held.splice(i, 1)[0]!.answer(name);
};

describe("the shared profile belongs to the sign-in that asked for it (Codex's 35-profile-owner-backlog)", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    Object.assign(server, { log: [], held: [], unknown: [] });
    server.hold.clear();
    store.clear();
    store.set("dandelist.refresh", "refresh-ada-1");
    shown.length = 0;
    mounts = 0;
    // Ada's own profile load is on its way and held.
    server.hold.add("GET tok-ada");
    await act(async () => {
      root = create(createElement(AuthProvider, null, createElement(Probe)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await act(() => until(() => auth.status === "signedIn" && server.held.length === 1));
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
    expect(server.unknown).toEqual([]);
  });

  it("keeps Bob's profile when Ada's late answer lands after Bob signed in and loaded his", async () => {
    await act(async () => auth.signOut());
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(() => until(() => auth.user?.id === "bob" && shown.at(-1) === "bob: Bob Marley"));
    const from = shown.length;
    // Ada's answer, asked for under her sign-in, comes back now.
    await act(async () => {
      answer("GET tok-ada");
      await settle();
    });
    expect(shown.slice(from).every((s) => s === "bob: Bob Marley")).toBe(true);
    expect(profile.profile?.name).toBe("Bob Marley");
    expect(server.log.filter((l) => l.startsWith("GET /me/profile"))).toEqual(["GET /me/profile as tok-ada", "GET /me/profile as tok-bob"]);
    expect(mounts).toBe(1);
  });

  it("drops Ada's late name change once Bob is signed in, and keeps Bob's own (control)", async () => {
    answer("GET tok-ada");
    await act(() => until(() => shown.at(-1) === "ada: Ada Lovelace"));
    server.hold.add("PATCH tok-ada");
    let saving!: Promise<void>;
    await act(async () => void (saving = profile.saveName("Countess Ada")));
    await act(async () => auth.signOut());
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(() => until(() => shown.at(-1) === "bob: Bob Marley"));
    const from = shown.length;
    await act(async () => {
      answer("PATCH tok-ada");
      await saving;
      await settle();
    });
    expect(shown.slice(from).every((s) => s === "bob: Bob Marley")).toBe(true);
    // Bob's own change lands (control).
    await act(async () => profile.saveName("Bob M."));
    expect(shown.at(-1)).toBe("bob: Bob M.");
    expect(mounts).toBe(1);
  });

  it("loads afresh when the same person signs out and back in, never waiting on the old sign-in's load", async () => {
    await act(async () => auth.signOut());
    server.hold.delete("GET tok-ada");
    await act(async () => auth.verifyEmail("ada@example.com", "123456"));
    await act(() => until(() => shown.at(-1) === "ada: Ada Lovelace"));
    // A second load went out for the new sign-in rather than waiting on the first, which is still held.
    expect(server.log.filter((l) => l.startsWith("GET /me/profile"))).toEqual(["GET /me/profile as tok-ada", "GET /me/profile as tok-ada"]);
    const from = shown.length;
    // The old sign-in's answer carries a name of its own (review of #146), so showing it would show.
    await act(async () => {
      answer("GET tok-ada", "Ada Byron");
      await settle();
    });
    expect(shown.slice(from).every((x) => x === "ada: Ada Lovelace")).toBe(true);
    expect(shown.some((x) => x.includes("Ada Byron"))).toBe(false);
    expect(mounts).toBe(1);
  });
});
