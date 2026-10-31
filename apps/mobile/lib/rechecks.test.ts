import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceOption, Run } from "./agent";
import type { Wish } from "./wishes";

vi.mock("./activity", () => ({ startTask: () => "task", updateTask: () => undefined, endTask: () => undefined }));
vi.mock("./auth", () => ({ useAuth: () => ({ status: "signedOut", user: null }) }));
const agent = vi.hoisted(() => ({ interpretWish: vi.fn(), startResearch: vi.fn(), getRun: vi.fn() }));
vi.mock("./agent", () => agent);

const { adoptAmend, amendWish, currentRechecks: readStore, dismissRecheck, setRecheckOwner } = await import("./rechecks");

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
const gate = () => {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

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

  it("stops before its next request when someone else signs in, and shows them nothing", async () => {
    const wait = gate();
    agent.interpretWish.mockImplementation(async () => (await wait.shut, { draft: { title: "Leica Q3 43" } }));
    const look = amendWish(async () => new Response("{}"), wish, "the 43mm one");
    setRecheckOwner("bob:1");
    wait.open();
    await look;
    expect(agent.startResearch).not.toHaveBeenCalled();
    expect(readStore()).toEqual([]);
  });

  it("carries on for the same sign-in (control)", async () => {
    agent.interpretWish.mockResolvedValue({ draft: { title: "Leica Q3 43" } });
    await amendWish(async () => new Response("{}"), wish, "the 43mm one");
    expect(agent.startResearch).toHaveBeenCalledTimes(1);
    expect(readStore().map((c) => c.outcome.kind)).toEqual(["amended"]);
  });

  it("forgets results when the same person signs out and back in", async () => {
    agent.interpretWish.mockResolvedValue({ draft: { title: "Leica Q3 43" } });
    await amendWish(async () => new Response("{}"), wish, "the 43mm one");
    setRecheckOwner(null);
    setRecheckOwner("ada:2");
    expect(readStore()).toEqual([]);
  });
});

describe("taking or leaving a result answers that look only", () => {
  beforeEach(async () => {
    agent.interpretWish.mockReset().mockResolvedValue({ draft: { title: "Leica Q3 43" } });
    agent.startResearch.mockReset().mockResolvedValue(run);
    setRecheckOwner(null);
    setRecheckOwner("ada:1");
    await amendWish(async () => new Response("{}"), wish, "the 43mm one");
  });

  it("saves once while Use is pressed twice, and Keep can't clear it mid-save", async () => {
    const wait = gate();
    const api = vi.fn(async () => (await wait.shut, new Response("{}", { status: 200 })));
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

  it("never clears a newer look when an older answer lands", async () => {
    const wait = gate();
    const api = vi.fn(async () => (await wait.shut, new Response("{}", { status: 200 })));
    const older = readStore()[0]!.attempt;
    const saving = adoptAmend(api, wish, async () => undefined, older);
    await flush();
    // A newer look starts for the same wish while the older one saves (it replaces it on screen).
    agent.interpretWish.mockResolvedValue({ draft: { title: "Leica Q3 Monochrom" } });
    const pending = gate();
    agent.startResearch.mockImplementation(async () => (await pending.shut, run));
    const newer = amendWish(async () => new Response("{}"), wish, "the monochrom");
    await flush();
    wait.open();
    await saving;
    expect(readStore().map((c) => c.outcome.kind)).toEqual(["running"]);
    expect(readStore()[0]!.attempt).not.toBe(older);
    dismissRecheck(wish.id, older);
    expect(readStore()).toHaveLength(1);
    pending.open();
    await newer;
  });

  it("leaves the result in place to try again when the save fails (control)", async () => {
    const attempt = readStore()[0]!.attempt;
    await expect(adoptAmend(async () => new Response(JSON.stringify({ error: "No." }), { status: 500 }), wish, async () => undefined, attempt)).rejects.toThrow("No.");
    expect(readStore().map((c) => [c.outcome.kind, c.saving])).toEqual([["amended", false]]);
  });
});
