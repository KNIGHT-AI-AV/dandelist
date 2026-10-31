import { act, createElement, Profiler, useState, type ReactNode } from "react";
import { create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Actual AuthProvider + AgentKeys, with presentation primitives and platform/storage boundaries replaced.
 * Every request is handled here or recorded as unknown. No provider, account, real key or clipboard is touched.
 */
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
environment.IS_REACT_ACT_ENVIRONMENT = true;
environment.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const store = vi.hoisted(() => new Map<string, string>());
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../../lib/storage", () => ({
  getSecret: async (key: string) => store.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => void (value === null ? store.delete(key) : store.set(key, value)),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (options: Record<string, unknown>) => options.ios ?? options.default },
  Text: "text",
  View: "view",
}));
vi.mock("expo/fetch", () => ({ fetch: (...args: Parameters<typeof fetch>) => fetch(...args) }));
vi.mock("expo-constants", () => ({ default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" } }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("../../lib/motion", () => ({ haptic: feedback }));
vi.mock("../../lib/theme", () => ({
  fonts: { figure: "synthetic" },
  layout: { stack: { tight: 4, base: 8 } },
  type: { body: {}, footnote: {} },
  usePalette: () => ({ ink: "black", ink3: "grey", track: "white", danger: "red" }),
}));
vi.mock("../inputs", () => ({ Field: (props: Record<string, unknown>) => createElement("input", props) }));
vi.mock("../lux", () => ({
  ErrorLine: ({ children }: { children?: ReactNode }) => createElement("output", null, children),
  PrimaryButton: (props: Record<string, unknown>) => createElement("button", props, String(props.label)),
  QuietButton: (props: Record<string, unknown>) => createElement("button", props, String(props.label)),
}));
vi.mock("./kit", () => ({
  Card: ({ children }: { children?: ReactNode }) => createElement("card", null, children),
  Row: ({ label, detail, accessory }: { label: string; detail?: string; accessory?: ReactNode }) => createElement("row", null, label, detail, accessory),
}));

const { AuthProvider, useAuth, currentSignIn } = await import("../../lib/auth");
const { AgentKeys } = await import("./agent-keys");

type KeyRecord = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: null };
type RequestLog = { method: string; path: string; account: string | null; bearer: string; body: unknown };
type Held = { selector: string; release(): void };
const records = new Map<string, KeyRecord[]>();
const accessOwners = new Map<string, string>();
const refreshOwners = new Map<string, string>();
const versions = new Map<string, number>();
const hold = new Set<string>();
const held: Held[] = [];
const requests: RequestLog[] = [];
const unknown: string[] = [];
const listErrors = new Map<string, string>();
const expireOnce = new Set<string>();
const commits: { account: string | null; text: string }[] = [];
let serial = 0;
let ada = "";
let bob = "";
let root: ReactTestRenderer | null = null;
let auth: ReturnType<typeof useAuth> | undefined;
let outsideMounts = 0;

function syntheticRecord(account: string, name = "Current agent"): KeyRecord {
  return { id: account + "-record", name, prefix: "synthetic", createdAt: "2026-10-31T12:00:00.000Z", lastUsedAt: null };
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const selector = (method: string, path: string, account: string | null) => method + " " + path + " as " + (account ?? "none");
function issue(account: string) {
  const version = (versions.get(account) ?? 0) + 1;
  versions.set(account, version);
  const accessToken = account + "-synthetic-access-" + version;
  const refreshToken = account + "-synthetic-refresh-" + version;
  accessOwners.set(accessToken, account);
  refreshOwners.set(refreshToken, account);
  return { accessToken, refreshToken, expiresIn: 900 };
}
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const path = new URL(String(input)).pathname;
  const method = init.method ?? "GET";
  const bearer = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const account = accessOwners.get(bearer) ?? null;
  const body = init.body ? JSON.parse(String(init.body)) as { email?: string; refreshToken?: string; name?: string } : null;
  requests.push({ method, path, account, bearer, body });
  const key = selector(method, path, account);
  let answer: Response;
  if (method === "POST" && path === "/auth/refresh" && body?.refreshToken && refreshOwners.has(body.refreshToken)) {
    // The actual refresh route returns tokens without user; startup separately requests /me.
    answer = respond(issue(refreshOwners.get(body.refreshToken)!));
  } else if (method === "POST" && path === "/auth/email/verify" && [ada + "@example.test", bob + "@example.test"].includes(body?.email ?? "")) {
    const id = body!.email!.split("@")[0]!;
    answer = respond({ ...issue(id), user: { id, email: body!.email } });
  } else if (method === "POST" && path === "/auth/logout" && account) {
    answer = respond({});
  } else if (method === "GET" && path === "/me" && account) {
    answer = respond({ user: { id: account, email: account + "@example.test" } });
  } else if (path === "/me/agent-keys" && method === "GET" && account) {
    if (expireOnce.delete(account)) answer = respond({ error: "Synthetic bearer expired." }, 401);
    else if (listErrors.has(account)) answer = respond({ error: listErrors.get(account) }, 503);
    else answer = respond({ keys: records.get(account) ?? [] });
  } else if (path === "/me/agent-keys" && method === "POST" && account && body?.name) {
    const record = syntheticRecord(account, body.name);
    records.set(account, [record, ...(records.get(account) ?? [])]);
    // Deliberately not a usable key or credential. The component's one-time display is tested only in memory.
    answer = respond({ key: "synthetic-only-display", record });
  } else if (method === "DELETE" && account && path === "/me/agent-keys/" + account + "-record") {
    records.set(account, []);
    answer = new Response(null, { status: 204 });
  } else {
    unknown.push(method + " " + path);
    answer = respond({ error: "Unexpected synthetic request." }, 404);
  }
  // Freeze the answer at request time; later account changes cannot alter the held response.
  if (hold.has(key)) return new Promise((resolve) => held.push({ selector: key, release: () => resolve(answer) }));
  return answer;
}

function textOf(value: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  return (value.children ?? []).map(textOf).join(" ");
}
const shown = () => textOf(root?.toJSON() ?? null);
const calls = (method: string, path = "/me/agent-keys") => requests.filter((r) => r.method === method && r.path === path);
function capture() {
  commits.push({ account: auth?.user?.id ?? null, text: shown() });
}
function Probe() {
  auth = useAuth();
  return createElement(Profiler, { id: "agent-keys", onRender: capture }, createElement(AgentKeys));
}
function Outside() {
  // A sibling sentinel: only the key panel may remount when its owner changes.
  const [identity] = useState(() => ++outsideMounts);
  return createElement("sentinel", { identity }, createElement(Probe));
}
async function mount() {
  await act(async () => { root = create(createElement(AuthProvider, null, createElement(Outside))); });
  expect(auth).toBeDefined();
}
async function signIn(account: string) {
  await act(async () => { await auth!.verifyEmail(account + "@example.test", "synthetic-code"); });
  expect(auth!.status).toBe("signedIn");
  expect(auth!.user?.id).toBe(account);
}
async function release(key: string) {
  const index = held.findIndex((item) => item.selector === key);
  expect(index).toBeGreaterThanOrEqual(0);
  await act(async () => { held.splice(index, 1)[0]!.release(); });
}
const field = () => root!.root.findByType("input");
const button = (label: string) => root!.root.findAllByType("button").find((node) => node.props.label === label)!;
async function name(value: string) {
  await act(async () => { field().props.onChangeText(value); });
}
async function press(label: string) {
  const target = button(label);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  await act(async () => { target.props.onPress(); });
}

describe("AgentKeys waits for and belongs to its signed-in owner", () => {
  beforeEach(() => {
    serial++;
    ada = "keys-ada-" + serial;
    bob = "keys-bob-" + serial;
    for (const map of [records, accessOwners, refreshOwners, versions, listErrors]) map.clear();
    hold.clear(); held.length = 0; requests.length = 0; unknown.length = 0; expireOnce.clear(); commits.length = 0;
    store.clear(); feedback.success.mockClear(); outsideMounts = 0; auth = undefined;
    const stored = ada + "-synthetic-stored";
    store.set("dandelist.refresh", stored);
    refreshOwners.set(stored, ada);
    records.set(ada, [syntheticRecord(ada, "Ada agent")]);
    records.set(bob, [syntheticRecord(bob, "Bob agent")]);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  afterEach(async () => {
    try {
      if (root) {
        await act(async () => { await auth!.signOut(); });
        await act(async () => { root!.unmount(); });
        root = null;
      }
      // Drain every held response before removing transport/storage mocks, including after an assertion failure.
      await act(async () => { while (held.length) held.shift()!.release(); });
      expect(held).toEqual([]);
      expect(unknown).toEqual([]);
    } finally {
      root = null;
      vi.unstubAllGlobals();
    }
  });

  it("sends no GET while startup auth is held, then loads the signed-in account", async () => {
    const startup = selector("POST", "/auth/refresh", null);
    hold.add(startup);
    await mount();
    expect(auth!.status).toBe("loading");
    expect(held.map((item) => item.selector)).toEqual([startup]);
    expect(calls("GET")).toEqual([]);
    expect(shown()).not.toContain("Make a key");
    expect(shown()).not.toContain("Couldn't");
    await release(startup);
    expect(auth!.user?.id).toBe(ada);
    expect(calls("GET").map((request) => request.account)).toEqual([ada]);
    expect(shown()).toContain("Ada agent");
    expect(shown()).not.toContain("Couldn't");
  });

  it("keeps an empty current-owner response as a valid empty list", async () => {
    records.set(ada, []);
    await mount();
    expect(auth!.status).toBe("signedIn");
    expect(calls("GET")).toHaveLength(1);
    expect(shown()).toContain("MCP server");
    expect(shown()).toContain("Make a key");
    expect(shown()).not.toContain("Ada agent");
    expect(root!.root.findByType("output").props.children).toBeNull();
  });

  it("still displays an actual current-owner list failure", async () => {
    listErrors.set(ada, "Current keys unavailable.");
    await mount();
    expect(auth!.user?.id).toBe(ada);
    expect(root!.root.findByType("output").props.children).toBe("Current keys unavailable.");
  });

  it.each(["success", "error"] as const)("drops an old GET %s after another account replaces it", async (outcome) => {
    const old = selector("GET", "/me/agent-keys", ada);
    hold.add(old);
    if (outcome === "error") listErrors.set(ada, "Old account error.");
    await mount();
    expect(held.map((item) => item.selector)).toContain(old);
    await name("Unsent old name");
    const next = selector("GET", "/me/agent-keys", bob);
    hold.add(next);
    const from = commits.length;
    await signIn(bob);
    expect(field().props.value).toBe("");
    expect(shown()).not.toContain("Ada agent");
    await release(old);
    expect(shown()).not.toContain("Old account error.");
    expect(commits.slice(from).filter((c) => c.account === bob).every((c) => !c.text.includes("Ada agent") && !c.text.includes("Old account error."))).toBe(true);
    await release(next);
    expect(shown()).toContain("Bob agent");
    expect(outsideMounts).toBe(1);
  });

  it.each(["success", "error"] as const)("drops the first A GET %s after A signs out and back in", async (outcome) => {
    const old = selector("GET", "/me/agent-keys", ada);
    hold.add(old);
    if (outcome === "error") listErrors.set(ada, "Previous sign-in error.");
    await mount();
    const generation = currentSignIn();
    await act(async () => { await auth!.signOut(); });
    expect(shown()).not.toContain("Make a key");
    hold.delete(old); listErrors.delete(ada);
    records.set(ada, [syntheticRecord(ada, "New sign-in agent")]);
    await signIn(ada);
    expect(currentSignIn()).not.toBe(generation);
    expect(shown()).toContain("New sign-in agent");
    await release(old);
    expect(shown()).toContain("New sign-in agent");
    expect(shown()).not.toContain("Ada agent");
    expect(shown()).not.toContain("Previous sign-in error.");
    expect(calls("GET").map((request) => request.account)).toEqual([ada, ada]);
  });

  it("keeps the ordinary same-owner refresh and retry working", async () => {
    expireOnce.add(ada);
    const first = selector("GET", "/me/agent-keys", ada);
    hold.add(first);
    await mount();
    const generation = currentSignIn();
    hold.delete(first);
    await release(first);
    expect(calls("GET").map((request) => request.account)).toEqual([ada, ada]);
    expect(calls("GET")[0]!.bearer).not.toBe(calls("GET")[1]!.bearer);
    expect(calls("POST", "/auth/refresh")).toHaveLength(2);
    expect(currentSignIn()).toBe(generation);
    expect(auth!.user?.id).toBe(ada);
    expect(shown()).toContain("Ada agent");
    expect(root!.root.findByType("output").props.children).toBeNull();
  });

  it("does not retry an old owner's held 401 as the replacement account", async () => {
    expireOnce.add(ada);
    const old = selector("GET", "/me/agent-keys", ada);
    hold.add(old);
    await mount();
    await signIn(bob);
    await release(old);
    expect(calls("GET").map((request) => request.account)).toEqual([ada, bob]);
    expect(calls("POST", "/auth/refresh")).toHaveLength(1);
    expect(shown()).toContain("Bob agent");
    expect(root!.root.findByType("output").props.children).toBeNull();
  });

  it("does not reset a current panel or reload it for a same-account sign-in", async () => {
    await mount();
    await name("Current draft");
    const generation = currentSignIn();
    await signIn(ada);
    expect(currentSignIn()).toBe(generation);
    expect(field().props.value).toBe("Current draft");
    expect(calls("GET")).toHaveLength(1);
    expect(outsideMounts).toBe(1);
  });

  it("refuses retained old make and armed-revoke callbacks after the account changes", async () => {
    await mount();
    await name("Old draft");
    const oldMake = button("Make a key").props.onPress as () => void;
    await press("Revoke");
    const oldRevoke = button("Tap again to revoke").props.onPress as () => void;
    const next = selector("GET", "/me/agent-keys", bob);
    hold.add(next);
    const from = commits.length;
    await signIn(bob);
    expect(shown()).not.toContain("Ada agent");
    expect(field().props.value).toBe("");
    await act(async () => { oldMake(); oldRevoke(); });
    expect(commits.slice(from).filter((c) => c.account === bob).every((c) => !c.text.includes("Ada agent"))).toBe(true);
    await release(next);
    expect(calls("POST")).toEqual([]);
    expect(requests.filter((r) => r.method === "DELETE")).toEqual([]);
    expect(shown()).toContain("Bob agent");
    expect(shown()).not.toContain("Tap again to revoke");
    expect(feedback.success).not.toHaveBeenCalled();
  });

  it("preserves ordinary synthetic make, one-time display and two-tap revoke behavior", async () => {
    records.set(ada, []);
    await mount();
    await name("  My agent  ");
    await press("Make a key");
    expect(calls("POST").map((request) => request.body)).toEqual([{ name: "My agent" }]);
    expect(shown()).toContain("Your new key");
    expect(shown()).toContain("My agent");
    expect(feedback.success).toHaveBeenCalledTimes(1);
    await press("Done");
    expect(shown()).not.toContain("Your new key");
    await press("Revoke");
    expect(requests.filter((r) => r.method === "DELETE")).toEqual([]);
    await press("Tap again to revoke");
    expect(requests.filter((r) => r.method === "DELETE").map((r) => r.account)).toEqual([ada]);
    expect(shown()).not.toContain("My agent");
    expect(feedback.success).toHaveBeenCalledTimes(2);
  });

  it("clears an already displayed one-time value in the first new-owner panel", async () => {
    records.set(ada, []);
    await mount();
    await name("Ada created agent");
    await press("Make a key");
    expect(shown()).toContain("Your new key");
    const next = selector("GET", "/me/agent-keys", bob);
    hold.add(next);
    const from = commits.length;
    await signIn(bob);
    expect(shown()).not.toContain("Your new key");
    expect(shown()).not.toContain("Ada created agent");
    expect(field().props.value).toBe("");
    expect(commits.slice(from).filter((c) => c.account === bob).every((c) => !c.text.includes("Your new key") && !c.text.includes("Ada created agent"))).toBe(true);
    await release(next);
    expect(shown()).toContain("Bob agent");
  });

  it("ignores a synthetic make response and feedback after its panel is replaced", async () => {
    await mount();
    const old = selector("POST", "/me/agent-keys", ada);
    hold.add(old);
    await name("Retired operation");
    await press("Make a key");
    expect(held.map((item) => item.selector)).toContain(old);
    await signIn(bob);
    await release(old);
    expect(shown()).toContain("Bob agent");
    expect(shown()).not.toContain("Your new key");
    expect(shown()).not.toContain("Retired operation");
    expect(button("Make a key").props.busy).toBe(false);
    expect(feedback.success).not.toHaveBeenCalled();
    expect(calls("POST").map((r) => r.account)).toEqual([ada]);
  });

  it("does not publish a held GET after the actual panel unmounts", async () => {
    const old = selector("GET", "/me/agent-keys", ada);
    hold.add(old);
    await mount();
    await act(async () => { root!.unmount(); });
    root = null;
    const count = commits.length;
    await release(old);
    expect(commits).toHaveLength(count);
    expect(feedback.success).not.toHaveBeenCalled();
  });
});
