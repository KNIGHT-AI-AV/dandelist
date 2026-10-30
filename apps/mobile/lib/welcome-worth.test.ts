import { describe, expect, it, vi } from "vitest";
import { adoptionKeys } from "./adopt";
import { emptyWelcome, listTotal, listed, previewExtra, settled, streamPreview, toWishes, wishCard, type FirstWish, type PoolItem, type PreviewEvent, type WelcomeState } from "./welcome";
import { amountSteps } from "./worth";

const fetched = vi.hoisted(() => ({ calls: 0 }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn(async () => { fetched.calls++; throw new Error("no network in tests"); }) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./auth", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./storage", () => ({ getSecret: async () => null, setSecret: async () => {} }));

const GOLD = "https://upload.wikimedia.org/gold.jpg";
const money: FirstWish = { text: "money", title: "Money", kind: "buy", worth: "money", amountCents: 1_000_000_000, photo: { imageUrl: GOLD, media: { kind: "product", images: [{ url: GOLD, source: "commons.wikimedia.org" }] } } };
const love: FirstWish = { text: "love", title: "Love", kind: "do", worth: "priceless", line: "Free to give, impossible to buy." };
const pick: PoolItem = { id: "leica-q3", name: "Leica Q3", kind: "buy", category: "capture", group: "things", upfrontCents: 600_000, recurring: [], status: "verified", seller: "Leica", url: "https://leica-camera.com/q3", checkedAt: "2026-10-29T16:00:00Z" };
const state = (wish: FirstWish | null, items: PoolItem[] = [pick]): WelcomeState => ({ ...emptyWelcome(), kept: true, wish, items });

describe("a first wish no shop prices", () => {
  it("is on the list once it has landed: money with its amount, or priceless", () => {
    expect(settled(money)).toBe(true);
    expect(settled(love)).toBe(true);
    expect(settled({ text: "money", worth: "money" })).toBe(false);
    expect(settled({ text: "a unicorn", failed: "Couldn't find a price for that just now." })).toBe(false);
  });

  it("puts money on the list at the amount picked, with its photo", () => {
    expect(wishCard(money)).toMatchObject({ id: "wish", name: "Money", upfrontCents: 1_000_000_000, worth: "money", imageUrl: GOLD });
    expect(listTotal(state(money))).toBe(1_000_600_000);
    expect(previewExtra(money)).toEqual({ name: "Money", upfrontCents: 1_000_000_000, recurring: [] });
    const [first] = toWishes({ ...state(money), last: "wish" });
    expect(first).toMatchObject({ name: "Money", tier: "dream", upfrontCents: 1_000_000_000, recurring: [], details: { worth: "money", agent: { imageUrl: GOLD, media: money.photo!.media } } });
  });

  it("saves whole US cents for an amount picked in euros or yen, which the API requires", () => {
    for (const [rate, unit] of [[0.92, 1], [152, 100]] as const) {
      const stop = amountSteps(rate, unit)[9]!; // a round figure there, a fraction of a US cent here
      expect(Number.isInteger(stop)).toBe(false);
      const picked: FirstWish = { ...money, amountCents: stop };
      const [first] = toWishes(state(picked));
      expect(Number.isInteger(first!.upfrontCents)).toBe(true);
      expect(first!.upfrontCents).toBe(Math.round(stop));
      expect(Number.isInteger(wishCard(picked)!.upfrontCents)).toBe(true);
      expect(Number.isInteger(previewExtra(picked)!.upfrontCents)).toBe(true);
    }
  });

  it("puts something priceless on the list at infinity: in the count, never in a total", () => {
    const s = state(love);
    expect(listed(s).map((e) => e.id)).toEqual(["wish", "leica-q3"]);
    expect(wishCard(love)).toMatchObject({ upfrontCents: 0, worth: "priceless" });
    expect(listTotal(s)).toBe(600_000);
    expect(previewExtra(love)).toBeNull();
    const [first, second] = toWishes(s);
    expect(first).toEqual({ name: "Love", kind: "do", tier: "must", upfrontCents: 0, recurringCents: 0, period: "month", recurring: [], details: { worth: "priceless", line: "Free to give, impossible to buy." } });
    expect(second).toMatchObject({ name: "Leica Q3", upfrontCents: 600_000 });
  });

  it("adds up to nothing without asking the server when nothing on the list has a price", async () => {
    const events: PreviewEvent[] = [];
    await streamPreview(state(love, []), (e) => events.push(e));
    expect(events).toEqual([{ type: "result", upfrontCents: 0, monthlyRunningCents: 0, everythingBy: "", largest: null }]);
    expect(fetched.calls).toBe(0);
  });

  it("is saved after sign-in like a priced first wish, never hunted again", () => {
    expect(adoptionKeys(state(money))).toEqual(["wish", "leica-q3"]);
    expect(adoptionKeys(state(love, []))).toEqual(["wish"]);
    expect(adoptionKeys(state({ text: "money", worth: "money" }, []))).toEqual([]);
  });
});
