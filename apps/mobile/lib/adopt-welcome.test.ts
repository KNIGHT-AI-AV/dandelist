import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptWelcome, priceFirstWish } from "./adopt";
import { emptyWelcome, loadWelcome, saveWelcome, toWishes, type FirstWish, type GuestOption, type PoolItem, type WelcomeState } from "./welcome";
import type { NewWish } from "./wishes";

const local = vi.hoisted(() => new Map<string, string>());
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({
  getSecret: async (key: string) => local.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => { if (value === null) local.delete(key); else local.set(key, value); },
}));

const option: GuestOption = {
  label: "Alder X camera", seller: "Alder", url: "https://seller.example/camera", upfrontCents: 240_000,
  recurring: [{ label: "Care", amountCents: 4_000, period: "year" }],
  status: "estimate", statusLabel: "Estimate", checkedAt: "2026-10-29T16:00:00Z",
  source: { currency: "EUR", price: 2_000, rate: 1.2, rateDate: "2026-10-28" },
  imageUrl: "https://images.example/camera.jpg",
  media: { kind: "product", images: [{ url: "https://images.example/camera.jpg", source: "Alder", credit: "Alder photographer" }] },
};
const prepared: FirstWish = { text: "a good camera", title: "Alder X camera", kind: "buy", option, runId: "run-123", explanation: "Body and lens; care is separate." };
const unpriced = (): WelcomeState => ({ ...emptyWelcome(), kept: true, last: "wish", wish: { text: prepared.text, failed: "The guest search could not finish." } });
const pick = (id: string): PoolItem => ({ id, name: id, kind: "buy", category: "capture", group: "things", upfrontCents: 50_000, recurring: [], status: "verified", seller: "Seller", url: `https://seller.example/${id}`, checkedAt: option.checkedAt });

function dependencies() {
  return { have: () => [], add: vi.fn(async (_wish: NewWish) => {}), save: saveWelcome, toWishes, price: vi.fn(async (_text: string): Promise<FirstWish | null> => prepared) };
}

beforeEach(() => local.clear());
afterEach(() => vi.useRealTimers());

describe("first-wish research checkpoint", () => {
  it("keeps the completed result when account saving fails, then retries the same wish without another hunt", async () => {
    await saveWelcome(unpriced());
    const first = dependencies();
    first.add.mockRejectedValueOnce(new Error("connection dropped"));
    await adoptWelcome((await loadWelcome())!, first);

    const checkpoint = (await loadWelcome())!;
    expect(checkpoint.wish).toEqual(prepared);
    expect(checkpoint.last).toBe("wish");
    expect(first.price).toHaveBeenCalledTimes(1);
    expect(first.add).toHaveBeenCalledTimes(1);

    const retry = dependencies();
    retry.price.mockRejectedValue(new Error("research is now unavailable"));
    await adoptWelcome(checkpoint, retry);
    expect(retry.price).not.toHaveBeenCalled();
    expect(retry.add).toHaveBeenCalledTimes(1);
    expect(retry.add).toHaveBeenCalledWith(first.add.mock.calls[0]![0]);
    expect(retry.add.mock.calls[0]![0]).toMatchObject({
      name: prepared.title, kind: prepared.kind, tier: "dream", upfrontCents: option.upfrontCents, recurring: option.recurring,
      details: { agent: { runId: prepared.runId, explanation: prepared.explanation, checkedAt: option.checkedAt, source: option.source, imageUrl: option.imageUrl, media: option.media } },
    });
    expect(await loadWelcome()).toBeNull();
  });

  it("does not send the account write until the result checkpoint is acknowledged", async () => {
    await saveWelcome(unpriced());
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies();
    const save = vi.fn(async (state: WelcomeState | null) => { if (state?.wish?.option) await waiting; await saveWelcome(state); });
    const task = adoptWelcome((await loadWelcome())!, { ...deps, save });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(deps.add).not.toHaveBeenCalled();
    expect((await loadWelcome())!.wish?.option).toBeUndefined();
    release();
    await task;
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(await loadWelcome()).toBeNull();
  });

  it("leaves the original state and does not add when the checkpoint write rejects", async () => {
    const state = unpriced();
    await saveWelcome(state);
    const deps = dependencies();
    const save = vi.fn(async () => { throw new Error("storage unavailable"); });
    await expect(adoptWelcome(state, { ...deps, save })).rejects.toThrow("storage unavailable");
    expect(deps.add).not.toHaveBeenCalled();
    expect(await loadWelcome()).toEqual(state);
  });

  it("keeps the checkpoint if an account write commits but its response is lost, then reconciles the loaded wish", async () => {
    await saveWelcome(unpriced());
    const first = dependencies();
    first.add.mockRejectedValueOnce(new Error("response lost"));
    await adoptWelcome((await loadWelcome())!, first);
    const saved = first.add.mock.calls[0]![0];
    const retry = dependencies();
    await adoptWelcome((await loadWelcome())!, { ...retry, have: () => [{ name: saved.name, details: saved.details! }] });
    expect(retry.price).not.toHaveBeenCalled();
    expect(retry.add).not.toHaveBeenCalled();
    expect(await loadWelcome()).toBeNull();
  });

  it.each(["no result", "rejected research"])("preserves an unpriced first wish after %s", async (mode) => {
    const state = unpriced();
    await saveWelcome(state);
    const deps = dependencies();
    if (mode === "no result") deps.price.mockResolvedValueOnce(null);
    else deps.price.mockRejectedValueOnce(new Error("unavailable"));
    await adoptWelcome(state, deps);
    expect(deps.add).not.toHaveBeenCalled();
    expect(await loadWelcome()).toEqual(state);
  });

  it("still checkpoints acknowledged picks and retains failed and unattempted picks", async () => {
    const state: WelcomeState = { ...unpriced(), wish: null, items: [pick("A"), pick("B"), pick("C")] };
    await saveWelcome(state);
    const first = dependencies();
    first.add.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("B unavailable"));
    await adoptWelcome(state, first);
    expect(first.add.mock.calls.map(([wish]) => wish.name)).toEqual(["A", "B"]);
    expect((await loadWelcome())!.items.map((item) => item.id)).toEqual(["B", "C"]);
    const retry = dependencies();
    await adoptWelcome((await loadWelcome())!, retry);
    expect(retry.add.mock.calls.map(([wish]) => wish.name)).toEqual(["B", "C"]);
    expect(retry.price).not.toHaveBeenCalled();
    expect(await loadWelcome()).toBeNull();
  });

  it("retains an unpriced first wish when picked items save but research cannot finish", async () => {
    const state = { ...unpriced(), items: [pick("A")] };
    await saveWelcome(state);
    const deps = dependencies();
    deps.price.mockResolvedValueOnce(null);
    await adoptWelcome(state, deps);
    expect((await loadWelcome())!).toEqual({ ...state, items: [] });
    expect(deps.add).toHaveBeenCalledTimes(1);
  });

  it("does not adopt a list the person has not kept", async () => {
    const state = { ...unpriced(), kept: false };
    const deps = dependencies();
    await adoptWelcome(state, deps);
    expect(deps.price).not.toHaveBeenCalled();
    expect(deps.add).not.toHaveBeenCalled();
  });

  it("keeps old guest checkpoints compatible and leaves legitimate zero-upfront pricing intact", async () => {
    const state: WelcomeState = { ...unpriced(), last: undefined, wish: { text: "a membership", option: { ...option, upfrontCents: 0, recurring: [{ label: "Membership", amountCents: 4_000, period: "month" }] } } };
    await saveWelcome(state);
    const deps = dependencies();
    await adoptWelcome((await loadWelcome())!, deps);
    expect(deps.add.mock.calls[0]![0]).toMatchObject({ name: "a membership", kind: "buy", tier: "must", upfrontCents: 0, recurring: state.wish!.option!.recurring, details: { agent: { runId: "guest", explanation: "" } } });
    expect(deps.price).not.toHaveBeenCalled();
    expect(await loadWelcome()).toBeNull();
  });
});

describe("preparing the signed-in first wish", () => {
  const run = { id: prepared.runId, status: "done", draft: { title: prepared.title, kind: prepared.kind }, result: { options: [option], explanation: prepared.explanation } };

  it("retains the original request, returned title/kind, option and research context", async () => {
    const api = vi.fn(async () => Response.json({ run }));
    expect(await priceFirstWish(api, prepared.text)).toEqual(prepared);
    expect(api).toHaveBeenCalledWith("/agent/runs", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: prepared.text }) }));
  });

  it("polls an in-progress run before preparing its result", async () => {
    vi.useFakeTimers();
    const api = vi.fn().mockResolvedValueOnce(Response.json({ run: { ...run, status: "running", result: null } })).mockResolvedValueOnce(Response.json({ run }));
    const task = priceFirstWish(api, prepared.text);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await task).toEqual(prepared);
    expect(api.mock.calls.map(([path]) => path)).toEqual(["/agent/runs", "/agent/runs/run-123"]);
  });

  it("does not manufacture a price when the research has no option", async () => {
    const api = vi.fn(async () => Response.json({ run: { ...run, result: { options: [], explanation: "No price" } } }));
    expect(await priceFirstWish(api, prepared.text)).toBeNull();
  });
});
