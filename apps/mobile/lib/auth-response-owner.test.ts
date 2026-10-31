import { act, createElement, useEffect, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Actual AuthProvider response ownership. Only platform, device storage and an allowlisted synthetic fetch are
 * substituted: no mocked auth, provider or real credential access. The three stale-response cases assert the
 * desired product contract, so the uncorrected source is expected to fail them.
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

const { API_URL, AuthProvider, currentSignIn, useAuth } = await import("./auth");
type User = { id: string; email: string };
type Session = { user: User; accessToken: string; refreshToken: string; expiresIn: number };
type Outcome<T> = { kind: "fulfilled"; value: T } | { kind: "rejected"; error: unknown };
type RequestLog = { method: string; path: string; bearer: string | null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const REFRESH_KEY = "dandelist.refresh";
let caseNumber = 0;
let pendingTasks = 0;
const tasks: Promise<unknown>[] = [];
const requests: RequestLog[] = [];
const unknown: string[] = [];
const accessSessions = new Map<string, Session>();
const verifies = new Map<string, Session>();
const refreshes = new Map<string, Session>();
const expired = new Set<string>();
type Hold = { entered: ReturnType<typeof deferred<void>>; response: ReturnType<typeof deferred<Response>>; used: boolean; released: boolean; release(): void };
const holds = new Map<string, Hold>();

function session(label: string, generation = 1): Session {
  const id = label + "-case-" + caseNumber;
  const result: Session = {
    user: { id, email: id + "@example.invalid" },
    accessToken: "synthetic-access-" + id + "-" + generation,
    refreshToken: "synthetic-refresh-" + id + "-" + generation,
    expiresIn: 900,
  };
  accessSessions.set(result.accessToken, result);
  if (!verifies.has(result.user.email)) verifies.set(result.user.email, result);
  return result;
}
/** The actual refresh route returns tokens without a user (API auth.ts issueSession/refresh). */
function tokenBody(s: Session) {
  return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn };
}
function holdResponse(key: string, body: unknown): Hold {
  if (holds.has(key)) throw new Error("Duplicate synthetic hold: " + key);
  const h: Hold = {
    entered: deferred<void>(), response: deferred<Response>(), used: false, released: false,
    release() {
      if (h.released) return;
      h.released = true;
      h.response.resolve(respond(body));
    },
  };
  holds.set(key, h);
  return h;
}
function reply(key: string, body: unknown): Response | Promise<Response> {
  const h = holds.get(key);
  if (!h) return respond(body);
  if (h.used) return unexpected("Repeated held request: " + key);
  h.used = true;
  h.entered.resolve(undefined);
  return h.response.promise;
}
function unexpected(detail: string): never {
  unknown.push(detail);
  throw new Error("Unexpected synthetic request: " + detail);
}
function jsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") return unexpected("non-JSON request body");
  const body: unknown = JSON.parse(init.body);
  if (!body || typeof body !== "object" || Array.isArray(body)) return unexpected("non-object request body");
  return body as Record<string, unknown>;
}
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method ?? "GET";
  const authorization = new Headers(init.headers).get("Authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) || null : null;
  const path = url.pathname;
  requests.push({ method, path, bearer });
  if (url.origin !== new URL(API_URL).origin || url.search || url.hash) return unexpected(method + " " + path + ": origin/query");
  if (method === "POST" && path === "/auth/email/verify") {
    const body = jsonBody(init);
    const s = typeof body.email === "string" ? verifies.get(body.email) : undefined;
    if (!s || body.code !== "123456") return unexpected(method + " " + path + ": unknown synthetic identity/code");
    return reply("verify:" + s.user.email, s);
  }
  if (method === "POST" && path === "/auth/refresh") {
    const body = jsonBody(init);
    const next = typeof body.refreshToken === "string" ? refreshes.get(body.refreshToken) : undefined;
    if (!next) return unexpected(method + " " + path + ": unregistered synthetic refresh");
    return reply("refresh:" + String(body.refreshToken), tokenBody(next));
  }
  if (method === "POST" && path === "/auth/logout") {
    if (!bearer || !accessSessions.has(bearer)) return unexpected(method + " " + path + ": unknown bearer");
    if (Object.keys(jsonBody(init)).length) return unexpected(method + " " + path + ": nonempty body");
    return respond({});
  }
  if (method === "GET" && path === "/me") {
    if (!bearer || expired.has(bearer)) return respond({ error: "Synthetic session expired." }, 401);
    const s = accessSessions.get(bearer);
    if (!s) return unexpected(method + " " + path + ": unknown bearer");
    return respond({ user: s.user });
  }
  return unexpected(method + " " + path);
}
/** Reflect stale-operation rejection so valid cancellation is allowed without an unhandled promise. */
function track<T>(promise: Promise<T>): Promise<Outcome<T>> {
  pendingTasks += 1;
  const task: Promise<Outcome<T>> = promise.then(
    (value): Outcome<T> => { pendingTasks -= 1; return { kind: "fulfilled", value }; },
    (error): Outcome<T> => { pendingTasks -= 1; return { kind: "rejected", error }; },
  );
  tasks.push(task);
  return task;
}
async function entered(h: Hold, task: Promise<unknown>) {
  await Promise.race([h.entered.promise, task]);
  expect(h.used, "operation must reach its explicit deferred response before the account changes").toBe(true);
}

let auth: ReturnType<typeof useAuth> | null = null;
let root: ReactTestRenderer | null = null;
let mounts = 0;
const commits: { status: string; userId: string | null }[] = [];
function currentAuth() {
  if (!auth) throw new Error("Actual AuthProvider probe has not mounted.");
  return auth;
}
function Probe() {
  auth = useAuth();
  useEffect(() => void (mounts += 1), []);
  useLayoutEffect(() => void commits.push({ status: currentAuth().status, userId: currentAuth().user?.id ?? null }));
  return null;
}
async function signIn(s: Session) {
  await act(async () => currentAuth().verifyEmail(s.user.email, "123456"));
  expect(currentAuth().status).toBe("signedIn");
  expect(currentAuth().user?.id).toBe(s.user.id);
}
/** Observe the actual transport, not only the React user that stale userless tokens can leave unchanged. */
async function observe() {
  let response!: Response;
  await act(async () => { response = await currentAuth().api("/me"); });
  const body = await response.json() as { user?: User };
  const request = requests.at(-1);
  expect(request?.path).toBe("/me");
  return {
    status: currentAuth().status,
    userId: currentAuth().user?.id ?? null,
    bearer: request?.bearer ?? null,
    responseUserId: body.user?.id ?? null,
    refreshToken: store.get(REFRESH_KEY) ?? null,
    signInMarker: currentSignIn(),
  };
}
function expected(s: Session, marker: number) {
  return { status: "signedIn", userId: s.user.id, bearer: s.accessToken, responseUserId: s.user.id, refreshToken: s.refreshToken, signInMarker: marker };
}

beforeEach(async () => {
  caseNumber += 1;
  auth = null;
  mounts = 0;
  pendingTasks = 0;
  tasks.length = 0;
  requests.length = 0;
  unknown.length = 0;
  commits.length = 0;
  store.clear();
  accessSessions.clear();
  verifies.clear();
  refreshes.clear();
  expired.clear();
  holds.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  await act(async () => {
    root = create(createElement(AuthProvider, null, createElement(Probe)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
  });
  // Empty storage makes the real startup refresh check settle without making a request.
  expect(currentAuth().status).toBe("signedOut");
  expect(currentAuth().user).toBeNull();
  expect(requests).toEqual([]);
  expect(mounts).toBe(1);
});
afterEach(async () => {
  try {
    await act(async () => {
      // Drain even on early assertion failure, before removing the transport or mounted provider.
      holds.forEach((h) => h.release());
      await Promise.all(tasks);
      if (root) {
        await currentAuth().signOut();
        root.unmount();
      }
    });
    expect(pendingTasks).toBe(0);
    expect(unknown).toEqual([]);
  } finally {
    root = null;
    auth = null;
    vi.unstubAllGlobals();
  }
});

describe("actual AuthProvider keeps the current authentication intent when older responses arrive", () => {
  it("does not replace a newer completed sign-in with an older email-verification response", async () => {
    const a = session("older");
    const b = session("newer");
    const held = holdResponse("verify:" + a.user.email, a);
    let older!: Promise<Outcome<void>>;
    await act(async () => {
      older = track(currentAuth().verifyEmail(a.user.email, "123456"));
      await entered(held, older);
    });
    await signIn(b);
    const marker = currentSignIn();
    const from = commits.length;
    await act(async () => { held.release(); await older; });
    expect(await observe()).toEqual(expected(b, marker));
    expect(commits.slice(from).every((c) => c.status === "signedIn" && c.userId === b.user.id)).toBe(true);
    expect(mounts).toBe(1);
  });

  it("stays signed out when a previously pending verification completes after signOut", async () => {
    const a = session("pending");
    const held = holdResponse("verify:" + a.user.email, a);
    let older!: Promise<Outcome<void>>;
    await act(async () => {
      older = track(currentAuth().verifyEmail(a.user.email, "123456"));
      await entered(held, older);
    });
    await act(async () => currentAuth().signOut());
    expect(currentAuth().status).toBe("signedOut");
    const marker = currentSignIn();
    const from = commits.length;
    await act(async () => { held.release(); await older; });
    expect(await observe()).toEqual({ status: "signedOut", userId: null, bearer: null, responseUserId: null, refreshToken: null, signInMarker: marker });
    expect(commits.slice(from).every((c) => c.status === "signedOut" && c.userId === null)).toBe(true);
    expect(mounts).toBe(1);
  });

  it("does not install an older userless refresh over a newer account's bearer, storage or UI", async () => {
    const a = session("refreshing");
    const nextA = session("refreshing", 2);
    const b = session("replacement");
    await signIn(a);
    expired.add(a.accessToken);
    refreshes.set(a.refreshToken, nextA);
    const held = holdResponse("refresh:" + a.refreshToken, tokenBody(nextA));
    let oldRequest!: Promise<Outcome<Response>>;
    await act(async () => {
      oldRequest = track(currentAuth().api("/me"));
      await entered(held, oldRequest);
    });
    expect(requests.filter((q) => q.path === "/me").map((q) => q.bearer)).toEqual([a.accessToken]);
    await signIn(b);
    const marker = currentSignIn();
    expect(await observe()).toEqual(expected(b, marker));
    const from = commits.length;
    await act(async () => { held.release(); await oldRequest; });
    expect(await observe()).toEqual(expected(b, marker));
    expect(commits.slice(from).every((c) => c.status === "signedIn" && c.userId === b.user.id)).toBe(true);
    expect(mounts).toBe(1);
  });

  it("keeps a fresh current sign-in usable (positive control)", async () => {
    const a = session("current");
    await signIn(a);
    const marker = currentSignIn();
    expect(await observe()).toEqual(expected(a, marker));
    expect(requests.map((q) => q.method + " " + q.path)).toEqual(["POST /auth/email/verify", "GET /me"]);
    expect(mounts).toBe(1);
  });

  it("renews the same current account through an ordinary userless refresh (positive control)", async () => {
    const a = session("same-owner");
    const nextA = session("same-owner", 2);
    await signIn(a);
    const marker = currentSignIn();
    expired.add(a.accessToken);
    refreshes.set(a.refreshToken, nextA);
    expect(await observe()).toEqual(expected(nextA, marker));
    expect(requests.filter((q) => q.path === "/me").map((q) => q.bearer)).toEqual([a.accessToken, nextA.accessToken]);
    expect(requests.filter((q) => q.path === "/auth/refresh")).toHaveLength(1);
    expect(mounts).toBe(1);
  });
});
