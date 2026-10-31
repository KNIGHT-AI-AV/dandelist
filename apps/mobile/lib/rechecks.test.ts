import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceOption, Run } from "./agent";
import type { Wish } from "./wishes";

// The sign-in binding itself is tested at the real transport in rechecks-signin.test.ts.
vi.mock("./auth", () => ({ useAuth: () => ({ status: "signedOut", user: null }), currentSignIn: () => 0, bindToSignIn: <T>(api: T) => api }));
const agent = vi.hoisted(() => ({ interpretWish: vi.fn(), startResearch: vi.fn(), getRun: vi.fn() }));
vi.mock("./agent", () => agent);

const { adoptAmend, amendWish, currentRechecks: readStore, dismissRecheck, holdWish, recheckWish, setRecheckOwner } = await import("./rechecks");
// The real live-task store the Dandy area shows (review of #131), not a stand-in.
const { currentTasks, endTask, startTask } = await import("./activity");

const option: PriceOption = {
  label: "Leica Q3 43",
  seller: "Leica Store",
  url: "https://leica-camera.com/q3-43",
  upfrontCents: 699_500,
  recurring: [],
  source: { currency: "USD", price: 6995, rate: 1, rateDate: "2026-10-31" },
  status: "verified",
  statusLabel: "Checked on leica-camera.com",
  evidence: "",
  confidence: "high",
  checkedAt: "2026-10-31T05:00:00.000Z",
  totals: { monthlyCents: 0, horizonCents: 699_500, spreadMonthlyCents: 11_658 },
};
const run = { id: "run-1", status: "done", steps: [], result: { options: [option], explanation: "", note: "", horizonYears: 5 } } as unknown as Run;
const wish = { id: "w1", name: "Leica Q3", kind: "buy", tier: "nice", item: { id: "w1", upfrontCents: 587_000, recurring: [] }, details: {}, createdAt: "2026-10-30T00:00:00.000Z" } as unknown as Wish;
const other = { ...wish, id: "w2", name: "Omega Speedmaster", item: { ...wish.item, id: "w2" } } as Wish;
const gate = () => {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = () => new Response("{}", { status: 200 });
const lines = () => currentTasks().map((t) => t.text);
const shown = () => readStore().map((c) => `${c.name}: ${c.outcome.kind}${c.saving ? " (saving)" : ""}`);

/** A server whose saves land only when the test says, in any order; each landed body becomes its wish. */
function slowServer() {
  const saved: Record<string, string> = {};
  const waiting: { wishId: string; land: () => void }[] = [];
  const most: Record<string, number> = {};
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    const wishId = path.slice(path.lastIndexOf("/") + 1);
    const body = JSON.parse(String(init?.body)) as { name?: string };
    await new Promise<void>((resolve) => {
      waiting.push({ wishId, land: () => ((saved[wishId] = body.name ?? "price only"), resolve()) });
      most[wishId] = Math.max(most[wishId] ?? 0, waiting.filter((w) => w.wishId === wishId).length);
    });
    return ok();
  });
  const land = (i: number) => waiting.splice(i, 1)[0]!.land();
  return { api, saved, waiting, most, landNewest: () => land(waiting.length - 1), landOldest: () => land(0) };
}

describe("a look at a saved wish belongs to the sign-in that started it (review of #131)", () => {
  beforeEach(() => {
    agent.interpretWish.mockReset();
    agent.startResearch.mockReset();
    agent.getRun.mockReset();
    agent.startResearch.mockResolvedValue(run);
    setRecheckOwner(null);
    setRecheckOwner("ada:1");
  });
  afterEach(() => setRecheckOwner(null));

  it("takes its task line off the moment someone else signs in, while its request is still pending", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementation(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    // Something else the app is doing, not about anyone's wish: it stays (current-session control).
    const today = startTask("Finding today's pick");
    const look = amendWish(async () => ok(), wish, "the 43mm one");
    expect(currentTasks().find((t) => t.text === "Looking again at Leica Q3")?.account).toBe("ada");
    setRecheckOwner(null);
    setRecheckOwner("bob:1");
    expect(lines()).toEqual(["Finding today's pick"]);
    expect(readStore()).toEqual([]);
    wait.open();
    await look;
    expect(agent.startResearch).not.toHaveBeenCalled();
    expect(readStore()).toEqual([]);
    expect(lines()).toEqual(["Finding today's pick"]);
    endTask(today);
  });

  it("does the same when the same person signs out and back in", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementation(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    const look = amendWish(async () => ok(), wish, "the 43mm one");
    setRecheckOwner(null);
    setRecheckOwner("ada:2");
    expect(lines()).toEqual([]);
    wait.open();
    await look;
    expect(agent.startResearch).not.toHaveBeenCalled();
    expect(readStore()).toEqual([]);
    expect(lines()).toEqual([]);
  });

  it("never ends a line the new sign-in started, when the old look finally settles", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementationOnce(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    const old = amendWish(async () => ok(), wish, "the 43mm one");
    setRecheckOwner(null);
    setRecheckOwner("bob:1");
    const bobs = gate();
    agent.interpretWish.mockImplementationOnce(async () => (await bobs.shut, { draft: { title: "Speedmaster Professional" } }));
    const mine = amendWish(async () => ok(), other, "the moonwatch");
    wait.open();
    await old;
    expect(currentTasks().map((t) => [t.text, t.account])).toEqual([["Looking again at Omega Speedmaster", "bob"]]);
    bobs.open();
    await mine;
    expect(lines()).toEqual([]);
    expect(shown()).toEqual(["Omega Speedmaster: amended"]);
  });

  it("carries on for the same sign-in, its line shown while it runs (control)", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementation(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    const look = amendWish(async () => ok(), wish, "the 43mm one");
    expect(lines()).toEqual(["Looking again at Leica Q3"]);
    wait.open();
    await look;
    expect(agent.startResearch).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(["Leica Q3: amended"]);
    expect(lines()).toEqual([]);
  });
});

describe("one save of a wish at a time (review of #131)", () => {
  beforeEach(async () => {
    agent.interpretWish.mockReset().mockResolvedValue({ draft: { title: "Leica Q3 43" } });
    agent.startResearch.mockReset().mockResolvedValue(run);
    setRecheckOwner(null);
    setRecheckOwner("ada:1");
    await amendWish(async () => ok(), wish, "the 43mm one");
  });
  afterEach(() => setRecheckOwner(null));

  it("holds the wish while Use saves it: no look starts from the list or the Dandy, no second answer, no Keep", async () => {
    const server = slowServer();
    const reload = vi.fn(async () => undefined);
    const attempt = readStore()[0]!.attempt;
    const saving = adoptAmend(server.api, wish, reload, attempt);
    // "Check the price again" from the list, and telling the Dandy more, while it saves.
    await recheckWish(server.api, wish, reload);
    await amendWish(server.api, wish, "the monochrom");
    expect(agent.interpretWish).toHaveBeenCalledTimes(1);
    // Use again (the detail page's button), Keep from both surfaces, and the detail page's own price save.
    await adoptAmend(server.api, wish, reload, attempt);
    dismissRecheck(wish.id, attempt);
    dismissRecheck(wish.id);
    expect(await holdWish(wish.id, async () => void (await server.api(`/wishes/${wish.id}`, { body: "{}" })))).toBe(false);
    expect(server.waiting).toHaveLength(1);
    expect(shown()).toEqual(["Leica Q3: amended (saving)"]);
    // Another wish isn't held (control).
    agent.interpretWish.mockResolvedValueOnce({ draft: { title: "Speedmaster Professional" } });
    await amendWish(server.api, other, "the moonwatch");
    expect(shown()).toEqual(["Leica Q3: amended (saving)", "Omega Speedmaster: amended"]);
    server.landOldest();
    await saving;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(["Omega Speedmaster: amended"]);
    // Free again once the list has the saved wish: the list's check starts (control).
    await recheckWish(server.api, wish, reload);
    expect(agent.interpretWish).toHaveBeenCalledTimes(3);
    expect(shown()).toEqual(["Omega Speedmaster: amended", "Leica Q3: changed"]);
  });

  it("lands saves of one wish in the order they were asked for, whatever order the network answers in", async () => {
    const server = slowServer();
    const reload = async () => undefined;
    agent.interpretWish.mockResolvedValueOnce({ draft: { title: "Speedmaster Professional" } });
    await amendWish(server.api, other, "the moonwatch");
    // Use on both: two saves out at once, for two wishes.
    const [one, two] = [wish, other].map((w) => readStore().find((c) => c.wishId === w.id)!.attempt);
    const first = adoptAmend(server.api, wish, reload, one);
    const second = adoptAmend(server.api, other, reload, two);
    expect(server.waiting.map((w) => w.wishId)).toEqual(["w1", "w2"]);
    // A newer look at the first wish, asked for while it saves, doesn't start, so its search can't finish first.
    agent.interpretWish.mockResolvedValueOnce({ draft: { title: "Leica Q3 Monochrom" } });
    await amendWish(server.api, wish, "the monochrom");
    expect(agent.interpretWish).toHaveBeenCalledTimes(2);
    // The network answers newest first.
    server.landNewest();
    server.landOldest();
    await Promise.all([first, second]);
    expect(server.saved).toEqual({ w1: "Leica Q3 43", w2: "Speedmaster Professional" });
    // Now the newer look runs, and its save lands last.
    await amendWish(server.api, wish, "the monochrom");
    const third = adoptAmend(server.api, wish, reload, readStore().find((c) => c.wishId === "w1")!.attempt);
    await recheckWish(server.api, wish, reload);
    expect(server.waiting.map((w) => w.wishId)).toEqual(["w1"]);
    server.landNewest();
    await third;
    expect(server.saved).toEqual({ w1: "Leica Q3 Monochrom", w2: "Speedmaster Professional" });
    expect(server.most).toEqual({ w1: 1, w2: 1 });
  });

  it("drops an older result a newer look replaced: it can't be saved over the newer one", async () => {
    const older = readStore()[0]!.attempt;
    const pending = gate();
    agent.interpretWish.mockResolvedValueOnce({ draft: { title: "Leica Q3 Monochrom" } });
    agent.startResearch.mockImplementationOnce(async () => (await pending.shut, run));
    const newer = amendWish(async () => ok(), wish, "the monochrom");
    await flush();
    const api = vi.fn(async () => ok());
    await adoptAmend(api, wish, async () => undefined, older);
    dismissRecheck(wish.id, older);
    expect(api).not.toHaveBeenCalled();
    expect(shown()).toEqual(["Leica Q3: running"]);
    pending.open();
    await newer;
    await adoptAmend(api, wish, async () => undefined, readStore()[0]!.attempt);
    expect(api).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((api.mock.calls[0] as unknown as [string, RequestInit])[1].body)).name).toBe("Leica Q3 Monochrom");
  });

  it("lets a price check that finds the same price give way to the detail page's save of the wish", async () => {
    const same = { ...wish, item: { ...wish.item, upfrontCents: option.upfrontCents } } as Wish;
    const research = gate();
    agent.startResearch.mockImplementationOnce(async () => (await research.shut, run));
    const api = vi.fn(async () => ok());
    const check = recheckWish(api, same, async () => undefined);
    await flush();
    const detail = gate();
    const held = holdWish(same.id, () => detail.shut);
    research.open();
    await check;
    expect(api).not.toHaveBeenCalled();
    expect(readStore()).toEqual([]);
    expect(lines()).toEqual([]);
    detail.open();
    expect(await held).toBe(true);
  });

  it("saves once while Use is pressed twice, and Keep can't clear it mid-save", async () => {
    const wait = gate();
    const api = vi.fn(async () => (await wait.shut, ok()));
    const reload = vi.fn(async () => undefined);
    const attempt = readStore()[0]!.attempt;
    const first = adoptAmend(api, wish, reload, attempt);
    const second = adoptAmend(api, wish, reload, attempt);
    dismissRecheck(wish.id, attempt);
    await flush();
    expect(readStore().map((c) => c.saving)).toEqual([true]);
    wait.open();
    await Promise.all([first, second]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(readStore()).toEqual([]);
  });

  it("leaves the result in place to try again when the save fails (control)", async () => {
    const attempt = readStore()[0]!.attempt;
    await expect(adoptAmend(async () => new Response(JSON.stringify({ error: "No." }), { status: 500 }), wish, async () => undefined, attempt)).rejects.toThrow("No.");
    expect(readStore().map((c) => [c.outcome.kind, c.saving])).toEqual([["amended", false]]);
    // And the wish is free again: the retry saves.
    const api = vi.fn(async () => ok());
    await adoptAmend(api, wish, async () => undefined, attempt);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
