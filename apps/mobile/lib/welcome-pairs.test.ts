import { afterEach, describe, expect, it, vi } from "vitest";
import { PAIR_PREFIX, emptyWelcome, madeFromWish, streamGuestWish, streamPreview, type PoolItem, type WelcomeState } from "./welcome";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({ getSecret: vi.fn(), setSecret: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

const item = (id: string, upfrontCents: number): PoolItem => ({
  id, name: id, kind: "buy", category: "capture", group: "things", upfrontCents,
  recurring: [], status: "estimate", seller: "Typical price", url: "", checkedAt: "2026-10-30T12:00:00Z",
});
/** A server-sent stream of these events. */
const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

describe("this or that from the first wish, over the wire", () => {
  it("asks for pairs with the wish only when told to, and hands the pairs event on", async () => {
    const pairs = [{ a: item(`${PAIR_PREFIX}bentley-mulsanne`, 31_000_000), b: item(`${PAIR_PREFIX}maybach`, 19_000_000) }];
    const request = vi.fn(async () => sse([{ type: "pairs", pairs }]));
    vi.stubGlobal("fetch", request);
    const seen: unknown[] = [];
    await streamGuestWish("I want a Rolls Royce", (e) => seen.push(e), undefined, false, true);
    await streamGuestWish("I want a Rolls Royce", () => undefined);
    const bodies = request.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies).toEqual([{ text: "I want a Rolls Royce", pairs: true }, { text: "I want a Rolls Royce" }]);
    expect(seen).toEqual([{ type: "pairs", pairs }]);
  });

  it("sends the cards made from the wish to the preview with their prices, and the pool's by id", async () => {
    const request = vi.fn(async () => sse([{ type: "result", upfrontCents: 1, monthlyRunningCents: 0, everythingBy: "2027-01", largest: null }]));
    vi.stubGlobal("fetch", request);
    const state: WelcomeState = { ...emptyWelcome(), items: [item("leica-q3", 735_000), item(`${PAIR_PREFIX}bentley-mulsanne`, 31_000_000), item("a:maldives", 800_000)] };
    await streamPreview(state, () => undefined);
    const body = JSON.parse(String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.picks).toEqual(["leica-q3", "a:maldives"]);
    expect(body.extras).toEqual([{ name: `${PAIR_PREFIX}bentley-mulsanne`, upfrontCents: 31_000_000, recurring: [] }]);
    expect(madeFromWish({ id: "a:maldives" })).toBe(false);
    expect(madeFromWish({ id: `${PAIR_PREFIX}x` })).toBe(true);
  });

  it("sends no extras when every card is the pool's", async () => {
    const request = vi.fn(async () => sse([]));
    vi.stubGlobal("fetch", request);
    await streamPreview({ ...emptyWelcome(), items: [item("leica-q3", 735_000)] }, () => undefined);
    const body = JSON.parse(String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("extras");
    expect(body.picks).toEqual(["leica-q3"]);
  });
});
