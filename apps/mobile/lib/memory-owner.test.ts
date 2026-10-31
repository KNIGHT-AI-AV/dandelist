import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The memory list in Settings across a change of account (Codex's review of #147, U1 and U2): the real AuthProvider and
 * the real useMemories under one persistent probe, a synthetic server that holds chosen answers, refuses expired bearers
 * with a 401 and rejects anything it doesn't know, and only platform, storage and expo modules stood in for.
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

type Line = { id: string; text: string; createdAt: string };
const server = vi.hoisted(() => ({
  log: [] as string[],
  unknown: [] as string[],
  /** Requests ("METHOD path as bearer") held until the test lets them go. */
  hold: new Set<string>(),
  held: [] as { key: string; go: () => void }[],
  /** Bearers the server no longer takes. */
  expired: new Set<string>(),
  lines: {} as Record<string, Line[]>,
}));
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const line = (id: string, text: string): Line => ({ id, text, createdAt: "2026-10-31T08:00:00.000Z" });
const accountOf = (bearer: string) => (bearer.startsWith("tok-ada") ? "ada" : bearer.startsWith("tok-bob") ? "bob" : null);
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  const method = init.method ?? "GET";
  const bearer = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "") || "none";
  const key = `${method} ${path} as ${bearer}`;
  server.log.push(key);
  const answer = (): Response => {
    if (path === "/auth/refresh") {
      const { refreshToken } = JSON.parse(String(init.body)) as { refreshToken: string };
      return refreshToken.startsWith("refresh-bob") ? respond({ accessToken: "tok-bob-2", refreshToken: "refresh-bob-2" }) : respond({ accessToken: refreshToken === "refresh-ada-1" ? "tok-ada" : "tok-ada-2", refreshToken: "refresh-ada-2" });
    }
    if (path === "/auth/email/verify") return respond({ user: { id: "bob", email: "bob@example.com" }, accessToken: "tok-bob", refreshToken: "refresh-bob" });
    if (path === "/auth/logout") return respond({});
    if (server.expired.has(bearer)) return respond({ error: "Sign in again." }, 401);
    const who = accountOf(bearer);
    if (path === "/me" && who) return respond({ user: { id: who, email: `${who}@example.com` } });
    if (path === "/me/memories" && who && method === "GET") return respond({ memories: server.lines[who] ?? [] });
    if (path === "/me/memories" && who && method === "DELETE") return respond({ memories: (server.lines[who] = []) });
    const one = /^\/me\/memories\/([\w-]+)$/.exec(path);
    if (one && who && method === "DELETE") return respond({ memories: (server.lines[who] = (server.lines[who] ?? []).filter((l) => l.id !== one[1])) });
    server.unknown.push(key);
    return respond({ error: "Unknown." }, 404);
  };
  if (server.hold.has(key)) return new Promise((resolve) => server.held.push({ key, go: () => resolve(answer()) }));
  return answer();
}

const { AuthProvider, useAuth } = await import("./auth");
const { useMemories } = await import("./memory");

/** Every commit of the probe: who is signed in, the lines on screen, and busy or error when there is one. */
const shown: string[] = [];
let auth!: ReturnType<typeof useAuth>;
let memory!: ReturnType<typeof useMemories>;
function Probe() {
  auth = useAuth();
  memory = useMemories(true);
  useLayoutEffect(() => void shown.push(`${auth.user?.id ?? "-"}: ${memory.memories.map((m) => m.text).join(" | ") || "none"}${memory.busy ? ` [busy ${memory.busy}]` : ""}${memory.error ? " [error]" : ""}`));
  return null;
}
let root: ReactTestRenderer | null = null;
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await settle();
  expect(done()).toBe(true);
}
const release = (key: string) => {
  const i = server.held.findIndex((h) => h.key === key);
  expect(i).toBeGreaterThan(-1);
  server.held.splice(i, 1)[0]!.go();
};
const sentAsBob = () => server.log.filter((l) => / \/me\/memories.* as tok-bob/.test(l) && !l.startsWith("GET "));

describe("the memory list belongs to the sign-in that loaded it (review of #147)", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    Object.assign(server, { log: [], unknown: [], held: [], lines: { ada: [line("a1", "prefers vintage cars to new ones"), line("a2", "avoids long-haul flights")], bob: [line("b1", "loves Porsches")] } });
    server.hold.clear();
    server.expired.clear();
    store.clear();
    store.set("dandelist.refresh", "refresh-ada-1");
    shown.length = 0;
    await act(async () => {
      root = create(createElement(AuthProvider, null, createElement(Probe)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
    await act(() => until(() => shown.at(-1) === "ada: prefers vintage cars to new ones | avoids long-haul flights"));
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
    expect(server.unknown).toEqual([]);
  });

  it("never sends Ada's Forget everything as Bob, when its refresh comes after Bob signed in", async () => {
    // Ada's bearer has expired; her Forget everything is refused with a 401 that the test holds.
    server.expired.add("tok-ada");
    server.hold.add("DELETE /me/memories as tok-ada");
    let forgetting!: Promise<boolean>;
    await act(async () => void (forgetting = memory.forget(null)));
    await act(async () => auth.signOut());
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(() => until(() => shown.at(-1) === "bob: loves Porsches"));
    // Now Ada's 401 comes back: the refresh renews Bob's session, and the retry must not go out as him.
    await act(async () => {
      release("DELETE /me/memories as tok-ada");
      expect(await forgetting).toBe(false);
      await settle();
    });
    expect(sentAsBob()).toEqual([]);
    expect(server.lines.bob).toEqual([line("b1", "loves Porsches")]);
    expect(shown.at(-1)).toBe("bob: loves Porsches");
  });

  it("finishes Ada's Forget everything through a refresh of her own session (control)", async () => {
    server.expired.add("tok-ada");
    let forgetting!: Promise<boolean>;
    await act(async () => {
      forgetting = memory.forget(null);
      expect(await forgetting).toBe(true);
    });
    expect(server.log.filter((l) => l.startsWith("DELETE /me/memories "))).toEqual(["DELETE /me/memories as tok-ada", "DELETE /me/memories as tok-ada-2"]);
    expect(shown.at(-1)).toBe("ada: none");
  });

  it("reports no success into a Settings page that has gone (review of #147, nonblocking)", async () => {
    server.hold.add("DELETE /me/memories/a1 as tok-ada");
    let forgetting!: Promise<boolean>;
    await act(async () => void (forgetting = memory.forget("a1")));
    await act(async () => root?.unmount());
    root = null;
    release("DELETE /me/memories/a1 as tok-ada");
    // The line was forgotten on the server, as she asked; nothing is told it succeeded, so no haptic plays.
    expect(await forgetting).toBe(false);
    expect(server.lines.ada!.map((l) => l.id)).toEqual(["a2"]);
  });

  it("shows none of Ada's lines from the first commit after Bob replaces her, and her late answers change nothing", async () => {
    // Ada forgets one line; its answer is held. Bob signs in over her (no sign-out between), and his list is held too.
    server.hold.add("DELETE /me/memories/a1 as tok-ada");
    server.hold.add("GET /me/memories as tok-bob");
    let forgetting!: Promise<boolean>;
    await act(async () => void (forgetting = memory.forget("a1")));
    expect(shown.at(-1)).toBe("ada: prefers vintage cars to new ones | avoids long-haul flights [busy a1]");
    const from = shown.length;
    await act(async () => auth.verifyEmail("bob@example.com", "123456"));
    await act(() => until(() => auth.user?.id === "bob"));
    // Every commit since Bob replaced her is Bob's, empty while his list loads.
    expect(shown.slice(from).every((s) => s === "bob: none")).toBe(true);
    await act(async () => {
      release("GET /me/memories as tok-bob");
      await settle();
    });
    expect(shown.at(-1)).toBe("bob: loves Porsches");
    // Ada's held answer lands now: it was hers to send, and it changes nothing on Bob's screen.
    await act(async () => {
      release("DELETE /me/memories/a1 as tok-ada");
      expect(await forgetting).toBe(false);
      await settle();
    });
    expect(shown.at(-1)).toBe("bob: loves Porsches");
    expect(sentAsBob()).toEqual([]);
  });
});
