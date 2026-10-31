import { act, createElement, useEffect, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceOption, Run } from "./agent";
import type { Wish } from "./wishes";

/**
 * The owner hook as the app mounts it (review of #131): the real WishProvider over a screen that reads the looks and
 * the Dandy's task lines, while the auth session changes the way signing in and out changes it.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
// The renderer React Native's own test setup uses; this flag is how that setup says so.
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

type Session = { status: "signedIn" | "signedOut"; user: { id: string; name?: string } | null };
const auth = vi.hoisted(() => {
  let session: Session = { status: "signedIn", user: { id: "ada" } };
  const listeners = new Set<() => void>();
  return {
    get: () => session,
    set(next: Session) {
      session = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
});
vi.mock("./auth", async () => {
  const { useSyncExternalStore } = await import("react");
  const api = async (path: string) => new Response(JSON.stringify(path === "/wishes" ? { wishes: [] } : {}), { status: 200 });
  return { useAuth: () => ({ ...useSyncExternalStore(auth.subscribe, auth.get), api }) };
});
const agent = vi.hoisted(() => ({ interpretWish: vi.fn(), startResearch: vi.fn(), getRun: vi.fn() }));
vi.mock("./agent", () => agent);

const { amendWish, currentRechecks, setRecheckOwner, useAccount, useRechecks } = await import("./rechecks");
const { currentTasks, useTasks } = await import("./activity");
const { WishProvider } = await import("./wishes");

const option = { label: "Leica Q3 43", seller: "Leica Store", url: "https://leica-camera.com/q3-43", upfrontCents: 699_500, recurring: [], checkedAt: "2026-10-31T05:00:00.000Z" } as unknown as PriceOption;
const run = { id: "run-1", status: "done", steps: [], result: { options: [option], explanation: "", note: "", horizonYears: 5 } } as unknown as Run;
const wish = { id: "w1", name: "Leica Q3", kind: "buy", tier: "nice", item: { id: "w1", upfrontCents: 587_000, recurring: [] }, details: {}, createdAt: "2026-10-30T00:00:00.000Z" } as unknown as Wish;
const other = { ...wish, id: "w2", name: "Omega Speedmaster", item: { ...wish.item, id: "w2" } } as Wish;
const api = async () => new Response("{}", { status: 200 });
const gate = () => {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open };
};

/** Every commit of the screen, as it would be put on screen: who is signed in, the looks and the task lines. */
const commits: { who: string | null; looks: string[]; lines: string[] }[] = [];
let mounts = 0;
function Screen() {
  const who = useAccount();
  const looks = useRechecks();
  const lines = useTasks(who);
  useEffect(() => void (mounts += 1), []);
  useLayoutEffect(() => {
    commits.push({ who, looks: looks.map((c) => `${c.name}: ${c.outcome.kind}`), lines: lines.map((t) => t.text) });
  });
  return null;
}

let root: ReactTestRenderer | null = null;
const signIn = (id: string, name?: string) => act(async () => auth.set({ status: "signedIn", user: { id, ...(name ? { name } : {}) } }));
const signOut = () => act(async () => auth.set({ status: "signedOut", user: null }));
/** The commits from `from` on: there is at least one, and none shows anything of the old sign-in. */
const clean = (from: number) => {
  const after = commits.slice(from);
  expect(after.length).toBeGreaterThan(0);
  for (const c of after) expect([...c.looks, ...c.lines]).toEqual([]);
};

describe("the owner hook, mounted in the real provider (review of #131)", () => {
  beforeEach(async () => {
    agent.interpretWish.mockReset().mockResolvedValue({ draft: { title: "Leica Q3 43" } });
    agent.startResearch.mockReset().mockResolvedValue(run);
    auth.set({ status: "signedIn", user: { id: "ada" } });
    setRecheckOwner(null);
    commits.length = 0;
    mounts = 0;
    await act(async () => {
      // A concurrent root, as React Native's new architecture runs; the types don't list the option.
      root = create(createElement(WishProvider, null, createElement(Screen)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
  });

  it("shows none of one account's look from the first commit after someone else signs in, and stops its work", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementationOnce(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    let look!: Promise<void>;
    await act(async () => void (look = amendWish(api, wish, "the 43mm one")));
    expect(commits.at(-1)).toEqual({ who: "ada", looks: ["Leica Q3: running"], lines: ["Looking again at Leica Q3"] });
    const from = commits.length;
    await signOut();
    await signIn("bob");
    clean(from);
    expect(commits.at(-1)!.who).toBe("bob");
    // The stores themselves, not only the screen.
    expect(currentRechecks()).toEqual([]);
    expect(currentTasks()).toEqual([]);
    await act(async () => {
      wait.open();
      await look;
    });
    expect(agent.startResearch).not.toHaveBeenCalled();
    expect(currentRechecks()).toEqual([]);
    clean(from);
    // The screen under the provider stayed mounted throughout.
    expect(mounts).toBe(1);
  });

  it("starts afresh when the same person signs out and back in", async () => {
    await act(async () => amendWish(api, wish, "the 43mm one"));
    const wait = gate();
    agent.interpretWish.mockImplementationOnce(async () => (await wait.shut, { draft: { title: "Speedmaster Professional" } }));
    let look!: Promise<void>;
    await act(async () => void (look = amendWish(api, other, "the moonwatch")));
    expect(commits.at(-1)!.looks).toEqual(["Leica Q3: amended", "Omega Speedmaster: running"]);
    const from = commits.length;
    await signOut();
    await signIn("ada");
    clean(from);
    await act(async () => {
      wait.open();
      await look;
    });
    expect(agent.startResearch).toHaveBeenCalledTimes(1);
    expect(currentRechecks()).toEqual([]);
    clean(from);
    expect(mounts).toBe(1);
  });

  it("keeps everything through a refresh of the same sign-in (control)", async () => {
    await act(async () => amendWish(api, wish, "the 43mm one"));
    const wait = gate();
    agent.interpretWish.mockImplementationOnce(async () => (await wait.shut, { draft: { title: "Speedmaster Professional" } }));
    let look!: Promise<void>;
    await act(async () => void (look = amendWish(api, other, "the moonwatch")));
    // A new user object for the same account, as a profile refresh gives.
    await signIn("ada", "Ada Lovelace");
    expect(commits.at(-1)).toEqual({ who: "ada", looks: ["Leica Q3: amended", "Omega Speedmaster: running"], lines: ["Looking again at Omega Speedmaster"] });
    await act(async () => {
      wait.open();
      await look;
    });
    expect(agent.startResearch).toHaveBeenCalledTimes(2);
    expect(commits.at(-1)).toEqual({ who: "ada", looks: ["Leica Q3: amended", "Omega Speedmaster: amended"], lines: [] });
    expect(mounts).toBe(1);
  });
});
