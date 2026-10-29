import { afterEach, describe, expect, it, vi } from "vitest";
import { cataloguePool, emptyWelcome, fetchPool, type PoolItem, type WelcomeState } from "./welcome";
import { startWelcome } from "./welcome-start";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({ getSecret: vi.fn(), setSecret: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const item = (id: string): PoolItem => ({
  id, name: id, kind: "buy", category: "capture", group: "things", upfrontCents: 100_000,
  recurring: [], status: "estimate", seller: "Synthetic seller", url: "https://seller.example/" + id,
  checkedAt: "2026-10-29T21:00:00Z",
});
afterEach(() => vi.unstubAllGlobals());

describe("welcome startup", () => {
  it("starts the locally chosen title while the pool request remains unresolved", async () => {
    const remote = deferred<PoolItem[]>();
    const saved: WelcomeState = { ...emptyWelcome(), items: [item("saved")], when: "soon", incomeCents: 12_000_000 };
    const onLocal = vi.fn();
    const onPool = vi.fn();
    const stop = startWelcome({
      seenTitle: async () => true,
      loadWelcome: async () => saved,
      fetchPool: () => remote.promise,
      onLocal, onPool,
    });
    await flush();
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal).toHaveBeenCalledWith(true, saved);
    expect(onPool).not.toHaveBeenCalled();
    stop();
  });

  it("waits for local history even if the pool finishes first", async () => {
    const history = deferred<boolean>();
    const saved = deferred<WelcomeState | null>();
    const onLocal = vi.fn();
    const onPool = vi.fn();
    const stop = startWelcome({
      seenTitle: () => history.promise,
      loadWelcome: () => saved.promise,
      fetchPool: async () => [item("remote")],
      onLocal, onPool,
    });
    await flush();
    expect(onPool).toHaveBeenCalledTimes(1);
    expect(onPool).toHaveBeenCalledWith([item("remote")]);
    expect(onLocal).not.toHaveBeenCalled();
    history.resolve(true);
    await flush();
    expect(onLocal).not.toHaveBeenCalled();
    saved.resolve(null);
    await flush();
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal).toHaveBeenCalledWith(true, null);
    stop();
  });

  it("a late pool refresh cannot replay local hydration over a person's new choices", async () => {
    const remote = deferred<PoolItem[]>();
    const saved: WelcomeState = { ...emptyWelcome(), items: [item("saved")], when: "soon", last: "saved" };
    let state = emptyWelcome();
    let pool = cataloguePool();
    const onLocal = vi.fn((_seen: boolean, value: WelcomeState | null) => { if (value) state = value; });
    const stop = startWelcome({
      seenTitle: async () => true,
      loadWelcome: async () => saved,
      fetchPool: () => remote.promise,
      onLocal,
      onPool: (items) => { pool = items; },
    });
    await flush();
    expect(state).toEqual(saved);
    state = { ...state, items: [...state.items, item("new-pick")], when: "now", last: "new-pick", incomeCents: 18_000_000 };
    const chosen = state;
    remote.resolve([item("new-pool")]);
    await flush();
    expect(pool).toEqual([item("new-pool")]);
    expect(state).toBe(chosen);
    expect(state.items.map((pick) => pick.id)).toEqual(["saved", "new-pick"]);
    expect(onLocal).toHaveBeenCalledTimes(1);
    stop();
  });

  it("aborts pool work and suppresses both callbacks after unmount", async () => {
    const history = deferred<boolean>();
    const saved = deferred<WelcomeState | null>();
    const remote = deferred<PoolItem[]>();
    const onLocal = vi.fn();
    const onPool = vi.fn();
    let signal!: AbortSignal;
    const stop = startWelcome({
      seenTitle: () => history.promise,
      loadWelcome: () => saved.promise,
      fetchPool: (value) => { signal = value; return remote.promise; },
      onLocal, onPool,
    });
    stop();
    expect(signal.aborted).toBe(true);
    history.resolve(true);
    saved.resolve(emptyWelcome());
    remote.resolve([item("remote")]);
    await flush();
    expect(onLocal).not.toHaveBeenCalled();
    expect(onPool).not.toHaveBeenCalled();
  });

  it("keeps the initial catalogue when pool loading rejects", async () => {
    let pool = cataloguePool();
    const initial = pool;
    const onLocal = vi.fn();
    const stop = startWelcome({
      seenTitle: async () => false,
      loadWelcome: async () => null,
      fetchPool: async () => { throw new Error("offline"); },
      onLocal,
      onPool: (items) => { pool = items; },
    });
    await flush();
    expect(initial.length).toBeGreaterThan(0);
    expect(pool).toBe(initial);
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal).toHaveBeenCalledWith(false, null);
    stop();
  });

  it("still starts if local storage is unavailable without waiting for the pool", async () => {
    const remote = deferred<PoolItem[]>();
    const onLocal = vi.fn();
    const stop = startWelcome({
      seenTitle: async () => { throw new Error("unavailable"); },
      loadWelcome: async () => { throw new Error("unavailable"); },
      fetchPool: () => remote.promise,
      onLocal,
      onPool: vi.fn(),
    });
    await flush();
    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal).toHaveBeenCalledWith(false, null);
    stop();
  });
});

describe("pool refresh transport", () => {
  it("passes cancellation to the request and returns the existing catalogue on failure", async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", request);
    expect(await fetchPool(controller.signal)).toEqual(cataloguePool());
    expect(request).toHaveBeenCalledWith("https://api.example.test/guest/pool", { signal: controller.signal });
  });

  it("keeps a successful enriched pool and falls back on an empty response", async () => {
    const items = [item("archive-entry")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ items })).mockResolvedValueOnce(Response.json({ items: [] })));
    expect(await fetchPool()).toEqual(items);
    expect(await fetchPool()).toEqual(cataloguePool());
  });
});

