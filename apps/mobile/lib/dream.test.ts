import { describe, expect, it } from "vitest";
import { askingChoices, askingWidget, cleanSuggestions, dayPart, feedFromSession, greeting, idleTooLong, moneyIn, nameForApi, shouldResume, taskFor, webOnly, whenLabel, wishFrom, type FeedItem } from "./dream";

const base = { name: "Sea-view villa", kind: "own" as const, status: "verified" as const, images: [{ url: "https://example.com/v.jpg", source: "example.com" }], url: "https://example.com/villa", checkedAt: "2026-10-27T10:00:00Z" };

describe("dream wishes", () => {
  it("stores a euro find in dollars at the rate sent with it", () => {
    const w = wishFrom({ ...base, upfrontCents: 372_000_000, currency: "EUR", toUsd: { rate: 1.08, date: "2026-10-27" }, keep: [{ label: "Maintenance", amountCents: 5_580_000, period: "year", basis: "1.5%", estimate: true }] });
    expect(w.upfrontCents).toBe(401_760_000);
    expect(w.recurring?.[0]).toMatchObject({ amountCents: 6_026_400, period: "year" });
    expect(w.details?.agent?.source).toEqual({ currency: "EUR", price: 3_720_000, rate: 1.08, rateDate: "2026-10-27" });
  });

  it("refuses a foreign find with no rate rather than storing euros as dollars", () => {
    expect(() => wishFrom({ ...base, upfrontCents: 100, currency: "EUR", keep: [] })).toThrow(/exchange rate/);
  });

  it("formats in the find's own currency and keeps only web links", () => {
    expect(moneyIn("EUR")(372_000_000)).toBe("€3,720,000");
    expect(webOnly("javascript:alert(1)")).toBe("");
  });
});

describe("chat history", () => {
  let n = 0;
  const id = () => `t${++n}`;

  it("rebuilds the feed from a saved transcript, leaving out notes and closed widgets", () => {
    const at = "2026-10-28T12:00:00Z";
    const builder = { kind: "region_picker" as const, id: "region_1", current: null };
    const feed = feedFromSession(
      {
        transcript: [
          { role: "user", text: "A villa by the sea", at },
          { role: "agent", text: "Where shall we look?", at },
          { role: "agent", text: "Asked where they live.", at, widget: { kind: "region_picker", id: "region_1" } },
          { role: "user", text: "[living in Malta]", at },
          { role: "agent", text: "Showed deck deck_1", at, widget: { kind: "deck", id: "deck_1" } },
          { role: "agent", text: "  ", at },
        ],
        widgets: [builder],
      },
      id,
    );
    expect(feed.map((f) => f.kind)).toEqual(["you", "agent", "widget"]);
    expect(feed[2]).toMatchObject({ kind: "widget", widget: builder });
    expect(feed.some((f) => f.kind === "agent" && "fresh" in f && f.fresh)).toBe(false);
    expect(feedFromSession({ transcript: undefined as never, widgets: undefined as never }, id)).toEqual([]);
  });

  it("resumes a conversation from the last hour and starts fresh after an hour away", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(shouldResume("2026-10-28T11:05:00Z", now)).toBe(true);
    expect(shouldResume("2026-10-28T11:00:00Z", now)).toBe(false);
    expect(shouldResume(undefined, now)).toBe(false);
    expect(shouldResume("not a date", now)).toBe(false);
    expect(idleTooLong(now - 59 * 60_000, now)).toBe(false);
    expect(idleTooLong(now - 60 * 60_000, now)).toBe(true);
  });

  it("says when a conversation was in plain words", () => {
    const now = new Date(2026, 9, 28, 15, 0);
    expect(whenLabel(new Date(2026, 9, 28, 14, 59, 40).toISOString(), now)).toBe("Just now");
    expect(whenLabel(new Date(2026, 9, 28, 14, 48).toISOString(), now)).toBe("12 min ago");
    expect(whenLabel(new Date(2026, 9, 28, 9, 0).toISOString(), now)).toBe("Today");
    expect(whenLabel(new Date(2026, 9, 27, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(whenLabel(new Date(2026, 9, 26, 10, 0).toISOString(), now)).toBe("Monday");
    expect(whenLabel(new Date(2026, 9, 12, 10, 0).toISOString(), now)).toBe("Oct 12");
    expect(whenLabel(new Date(2025, 11, 31, 10, 0).toISOString(), now)).toBe("Dec 31, 2025");
  });
});

describe("an empty chat", () => {
  it("greets by the time of day in each personality, short, and never with the word life", () => {
    expect(dayPart(6)).toBe("morning");
    expect(dayPart(13)).toBe("afternoon");
    expect(dayPart(19)).toBe("evening");
    expect(dayPart(2)).toBe("night");
    for (const persona of ["heir", "it-girl", "old-money", "mogul", undefined] as const) {
      for (const hour of [3, 8, 14, 20]) {
        const g = greeting(persona, hour, "Ava");
        expect(`${g.hello} ${g.ask} ${g.intro}`).not.toMatch(/\blife\b|\bAI\b|agent|Meta|Muse|—/i);
        expect(g.hello.length + g.ask.length).toBeLessThan(56);
      }
    }
    expect(greeting("mogul", 8, "Ava")).toMatchObject({ hello: "Morning.", ask: "What's the next move?" });
    expect(greeting("heir", 20, "Ava").intro).toMatch(/^I'm Ava\. /);
    expect(greeting("heir", 20, "Dandy").intro).toMatch(/^I'm your Dandy\. /);
  });

  it("keeps three short, distinct suggestions", () => {
    expect(cleanSuggestions(["  A black  G-Wagon ", "a black g-wagon", 4, "", "x".repeat(49), "A weekend in Positano in June", "A chef", "A fourth"])).toEqual(["A black G-Wagon", "A weekend in Positano in June", "A chef"]);
    expect(cleanSuggestions(null)).toEqual([]);
  });

  it("names the work of each kind of turn and sends a clean name", () => {
    expect(taskFor({ type: "message", text: "hi" })).toBe("Reading your message");
    expect(taskFor({ type: "swipe", widgetId: "d", listingId: "l", verdict: "yes" })).toBe("Noting your taste");
    expect(nameForApi("  Ava\n  Rose ")).toBe("Ava Rose");
    expect(nameForApi("x".repeat(30))).toHaveLength(24);
    expect(nameForApi("   ")).toBeUndefined();
  });
});

describe("the tool the Dandy is waiting on", () => {
  const item = { kind: "item" as const, id: "item_2", text: "a Leica Q3" };
  const region = { kind: "region_picker" as const, id: "region_1", current: null };

  it("is the newest tool, until the person says something after it", () => {
    const feed: FeedItem[] = [
      { id: "f1", kind: "you", text: "A villa and a Leica" },
      { id: "f2", kind: "widget", widget: region, live: true },
      { id: "f3", kind: "agent", text: "Where shall we look?" },
      { id: "f4", kind: "step", text: "Reading", state: "done" },
    ];
    expect(askingWidget(feed)).toBe("region_1");
    expect(askingWidget([...feed, { id: "f5", kind: "widget", widget: item }])).toBe("item_2");
    expect(askingWidget([...feed, { id: "f5", kind: "you", text: "Actually, a Porsche" }])).toBeNull();
    expect(askingWidget([])).toBeNull();
  });

  it("keeps a question's answers open beside a tool opened after it, until the person says something", () => {
    const q = { kind: "choices" as const, id: "choice_1", options: ["New", "Used"] };
    const q2 = { kind: "choices" as const, id: "choice_2", options: ["Black", "Silver"] };
    const feed: FeedItem[] = [
      { id: "f1", kind: "you", text: "A Porsche 911 and a Leica" },
      { id: "f2", kind: "agent", text: "New or used?" },
      { id: "f3", kind: "widget", widget: q, live: true },
      { id: "f4", kind: "widget", widget: item, live: true },
    ];
    expect(askingWidget(feed)).toBe("item_2");
    expect(askingChoices(feed)).toBe("choice_1");
    expect(askingChoices([...feed, { id: "f5", kind: "widget", widget: q2 }])).toBe("choice_2");
    expect(askingChoices([...feed, { id: "f5", kind: "you", text: "Used" }])).toBeNull();
    expect(askingChoices([{ id: "f1", kind: "widget", widget: region }])).toBeNull();
  });
});
