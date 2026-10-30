import { describe, expect, it } from "vitest";
import { FALLBACK_LINE, INTERPRET_EFFORT, asPriced, bookable, cleanLine, interpret, settleWorth, unpriced, type Draft, type Meta } from "../src/agent/agent";
import { MISS_MS, namedCents, worthCard } from "../src/agent/worth";

const base: Draft = { title: "Money", kind: "buy", summary: "Money.", specifics: [], region: "US", currency: "USD", unknowns: [] };

/** A Meta whose wish reading answers with `draft`, recording what it was asked. */
function reading(draft: Record<string, unknown>) {
  const asked: Record<string, any>[] = [];
  const meta: Meta = {
    responses: async (body) => {
      asked.push(body);
      return { id: "r1", text: JSON.stringify(draft), citations: [], functionCalls: [], searchQueries: [], usage: { model: "muse-spark-1.3", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, searches: 0 }, costUsd: 0, raw: {} };
    },
  };
  return { meta, asked };
}

/** Exchange rates as frankfurter.dev answers them: a pound is 1.25 dollars. */
const rates = (async (url: string | URL) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.frankfurter.dev") return new Response("no", { status: 404 });
  return Response.json({ date: "2026-10-30", rates: { [u.searchParams.get("symbols")!]: u.searchParams.get("base") === "GBP" ? 1.25 : 0.5 } });
}) as unknown as typeof fetch;

describe("what a wish is worth", () => {
  it("reads money, priceless and an ordinary priced wish in the one reading call, at low effort", async () => {
    const money = reading({ ...base, title: "A million dollars", worth: "money", amount: 1_000_000, line: "" });
    expect(await interpret(money.meta, "a million dollars")).toMatchObject({ worth: "money", amount: 1_000_000 });
    expect(money.asked).toHaveLength(1);
    expect(money.asked[0]!.reasoning).toEqual({ effort: INTERPRET_EFFORT });
    expect(INTERPRET_EFFORT).toBe("low");
    expect(money.asked[0]!.text.format.schema.required).toEqual(expect.arrayContaining(["worth", "amount", "line"]));

    const love = reading({ ...base, title: "Love", kind: "do", worth: "priceless", amount: 0, line: "Free to give, impossible to buy." });
    const read = await interpret(love.meta, "love");
    expect(read).toMatchObject({ worth: "priceless", line: "Free to give, impossible to buy." });
    expect(read.amount).toBeUndefined();

    const bike = reading({ ...base, title: "Peloton Bike+", worth: "priced", amount: 2495, line: "Sweat now, glow later." });
    const priced = await interpret(bike.meta, "a peloton bike");
    expect(priced.worth).toBe("priced");
    expect(priced.amount).toBeUndefined();
    expect(priced.line).toBeUndefined();
    expect(unpriced(priced)).toBe(false);
  });

  it("prices anything with a trip, a place or time off, whoever it is with, even when a reading calls it priceless", async () => {
    // The model is told the rule in the one reading call.
    const told = reading({ ...base, title: "A week in Bali with my wife", kind: "visit", worth: "priced", amount: 0, line: "" });
    expect((await interpret(told.meta, "a week in Bali with my wife")).worth).toBe("priced");
    expect(told.asked[0]!.instructions).toContain("time off");
    expect(told.asked[0]!.text.format.schema.properties.worth.description).toContain("'a week in Bali with my wife', 'a year off to travel' and 'dinner with my mom in Paris' are priced");

    // Readings that call these priceless anyway are overruled by what they say about the wish itself.
    const misread = [
      { said: "a week in Bali with my wife", kind: "visit", specifics: [{ name: "destination", value: "Bali" }, { name: "duration", value: "one week" }, { name: "travellers", value: "2 adults" }] },
      { said: "a year off to travel", kind: "do", specifics: [{ name: "duration", value: "one year" }, { name: "activity", value: "travel" }] },
      { said: "dinner with my mom in Paris", kind: "do", specifics: [{ name: "city", value: "Paris" }, { name: "who", value: "mom" }] },
    ] as const;
    for (const m of misread) {
      const r = reading({ ...base, title: m.said, kind: m.kind, specifics: m.specifics, worth: "priceless", amount: 0, line: "Worth every second." });
      const read = await interpret(r.meta, m.said);
      expect(read.worth, m.said).toBe("priced");
      expect(read.line, m.said).toBeUndefined();
    }

    // What nothing can buy or book stays priceless.
    for (const [said, specifics] of [["love", []], ["time with my dad", [{ name: "who", value: "dad" }]]] as const) {
      const r = reading({ ...base, title: said, kind: "do", specifics, worth: "priceless", amount: 0, line: "Free to give, impossible to buy." });
      expect((await interpret(r.meta, said)).worth, said).toBe("priceless");
    }
    expect(bookable({ kind: "do", specifics: [{ name: "feeling", value: "calm" }] })).toBe(false);
  });

  it("never fails a wish over a reading's amount or line out of bounds", async () => {
    const huge = await interpret(reading({ ...base, worth: "money", amount: 1e17, line: "" }).meta, "all the money");
    expect(huge).toMatchObject({ worth: "money", amount: 1e13 });
    const negative = await interpret(reading({ ...base, worth: "money", amount: -5, line: "" }).meta, "money");
    expect(negative.amount).toBeUndefined();
    const words = await interpret(reading({ ...base, worth: "money", amount: "lots", line: "" }).meta, "money");
    expect(words).toMatchObject({ worth: "money" });
    const long = await interpret(reading({ ...base, title: "Love", worth: "priceless", amount: 0, line: "x ".repeat(300) }).meta, "love");
    expect(long).toMatchObject({ worth: "priceless", line: FALLBACK_LINE });
    const odd = await interpret(reading({ ...base, worth: "free", amount: 0, line: "" }).meta, "a bike");
    expect(odd.worth).toBe("priced");
  });

  it("prices it anyway when asked, whatever the reading said", () => {
    expect(asPriced({ ...base, worth: "money", amount: 5 })).toEqual({ ...base, worth: "priced" });
    expect(asPriced({ ...base, worth: "priceless", line: "Free to give, impossible to buy." })).toEqual({ ...base, worth: "priced" });
    expect(unpriced(asPriced({ ...base, worth: "money" }))).toBe(false);
  });

  it("looks for a money photo again soon after one couldn't be found", () => {
    expect(MISS_MS).toBeLessThanOrEqual(2 * 60_000);
  });

  it("is priced whenever the model says nothing about it", () => {
    expect(settleWorth(base).worth).toBe("priced");
    expect(unpriced({ worth: undefined })).toBe(false);
    expect(unpriced({ worth: "money" })).toBe(true);
    expect(unpriced({ worth: "priceless" })).toBe(true);
  });

  it("keeps only a real amount on money", () => {
    expect(settleWorth({ ...base, worth: "money", amount: 0 }).amount).toBeUndefined();
    expect(settleWorth({ ...base, worth: "money", amount: 50_000, line: "x" })).toEqual({ ...base, worth: "money", amount: 50_000 });
  });

  it("shows the model's priceless line only when it reads as one line of plain words", () => {
    expect(cleanLine("  Free to give,\n impossible to buy.  ")).toBe("Free to give, impossible to buy.");
    expect(cleanLine('"A spark no store can stock."')).toBe("A spark no store can stock.");
    expect(cleanLine("Worth 1,000,000 hugs")).toBeNull();
    expect(cleanLine("Love you 💛")).toBeNull();
    expect(cleanLine("See https://example.com")).toBeNull();
    expect(cleanLine("#blessed and grateful")).toBeNull();
    expect(cleanLine("short")).toBeNull();
    expect(cleanLine("x".repeat(71))).toBeNull();
    expect(cleanLine(42)).toBeNull();
    expect(settleWorth({ ...base, worth: "priceless", line: "Love you 💛" }).line).toBe(FALLBACK_LINE);
    expect(settleWorth({ ...base, worth: "priceless" }).line).toBe(FALLBACK_LINE);
  });

  it("turns the amount a money wish names into US cents at today's rate", async () => {
    expect(await namedCents({ amount: 1_000_000, currency: "USD" }, rates)).toBe(100_000_000);
    expect(await namedCents({ amount: 2_000_000, currency: "GBP" }, rates)).toBe(250_000_000);
    expect(await namedCents({ amount: 0, currency: "USD" }, rates)).toBeUndefined();
    expect(await namedCents({ amount: 5, currency: "XYZ" }, (async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).toBeUndefined();
    // Never past the wishes API's ceiling of ten billion dollars.
    expect(await namedCents({ amount: 1e13, currency: "USD" }, rates)).toBe(1_000_000_000_000);
  });

  it("makes the card from the draft: money with its amount, priceless with its line, nothing for a priced wish", async () => {
    expect(await worthCard({ ...base, title: "£2 million", currency: "GBP", worth: "money", amount: 2_000_000 }, rates)).toEqual({ worth: "money", title: "£2 million", kind: "buy", amountCents: 250_000_000 });
    expect(await worthCard({ ...base, worth: "money" }, rates)).toEqual({ worth: "money", title: "Money", kind: "buy" });
    expect(await worthCard({ ...base, title: "Love", kind: "do", worth: "priceless", line: "Free to give, impossible to buy." }, rates)).toEqual({ worth: "priceless", title: "Love", kind: "do", line: "Free to give, impossible to buy." });
    // A draft an app sends back without its line still gets one, and never a price hunt.
    expect(await worthCard({ ...base, title: "Love", worth: "priceless" }, rates)).toMatchObject({ worth: "priceless", line: FALLBACK_LINE });
    expect(await worthCard({ ...base, worth: "priced" }, rates)).toBeNull();
    expect(await worthCard(base, rates)).toBeNull();
  });
});
