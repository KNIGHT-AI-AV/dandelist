import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { research, type Draft, type Meta, type PriceOption, type Step } from "../src/agent/agent";
import { headcount, partyOf, personPrice } from "../src/agent/person-price";
import { quickFind } from "../src/agent/quick";

const isolation = vi.hoisted(() => ({
  unexpected: [] as string[],
  dns: [] as string[],
  huntMedia: vi.fn(async () => undefined),
  shareImageFits: vi.fn(() => false),
}));

// Keep the real URL/private-address checks, but never resolve a fixture on the network.
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<object>()),
  lookup: async (host: string) => {
    isolation.dns.push(host);
    if (host !== "atlastable.example") {
      isolation.unexpected.push(`DNS: ${host}`);
      throw new Error("Unexpected DNS lookup in the party fixture");
    }
    return [{ address: "93.184.215.14", family: 4 }];
  },
}));
vi.mock("node:dns", async (original) => ({
  ...(await original<object>()),
  lookup: () => {
    isolation.unexpected.push("callback DNS");
    throw new Error("Unexpected transport DNS in the party fixture");
  },
}));
// tools.ts has an Undici transport as well as fetch defaults. Block both escape routes.
vi.mock("undici", async (original) => ({
  ...(await original<object>()),
  fetch: async () => {
    isolation.unexpected.push("Undici fetch");
    throw new Error("Unexpected Undici request in the party fixture");
  },
}));
vi.mock("../src/agent/hunt", () => ({
  huntMedia: isolation.huntMedia,
  shareImageFits: isolation.shareImageFits,
}));

const PAGE = "https://atlastable.example/private-tasting-dinner";
const SELLER = "Atlas Table";
const LABEL = "Private tasting dinner for eight adults";
const UNIT_QUOTE = "Private tasting dinner costs USD 150 per adult guest. This fixed menu applies to each adult, with no other charges.";
const PARTY_QUOTE = "Private tasting dinner costs USD 1200 for the entire party of up to eight adults, with no other charges.";
const draft: Draft = {
  title: "Private tasting dinner",
  kind: "do",
  summary: "A private tasting dinner for eight adults.",
  specifics: [{ name: "guests", value: "8 adults" }],
  region: "US",
  currency: "USD",
  unknowns: [],
};

type ModelResult = Awaited<ReturnType<Meta["responses"]>>;
type ToolOutput = { type?: string; call_id?: string; output?: string };
const formatName = (body: Record<string, unknown>) => (body.text as { format?: { name?: string } } | undefined)?.format?.name;
const reply = (text: string, extra: Partial<ModelResult> = {}): ModelResult => ({
  id: "party-fixture",
  text,
  citations: [],
  functionCalls: [],
  searchQueries: [],
  usage: { model: "muse-spark-1.3", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 },
  costUsd: 0,
  raw: {},
  ...extra,
});
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const offerMarkup = (price: number) => ld({ "@type": "Service", name: draft.title, offers: { "@type": "Offer", price, priceCurrency: "USD" } });
const metaMarkup = (price: number) => `<meta property="product:price:amount" content="${price}"><meta property="product:price:currency" content="USD">`;
const pageHtml = (quote: string, head = "") => `<html><head><title>Atlas Table private tasting dinner</title>${head}</head><body><h1>Private tasting dinner</h1><p>${quote}</p></body></html>`;

function pageFetcher(html: string, status = 200) {
  const fetched: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    if (url !== PAGE || (init?.method && init.method !== "GET")) {
      isolation.unexpected.push(`page fetch: ${url}`);
      throw new Error("Unexpected page request in the party fixture");
    }
    return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  return { fetched, fetcher };
}

type ResearchFixture = {
  quote: string;
  price: number;
  head?: string;
  /** 0: nothing says how many people. */
  guests?: 0 | 1 | 8;
  evidence?: string;
  parts?: Record<string, unknown>[];
  recurring?: { label: string; amount: number; period: "week" | "month" | "year" }[];
};

async function researchDinner(fixture: ResearchFixture) {
  const modelCalls: Record<string, unknown>[] = [];
  const steps: Step[] = [];
  const guests = fixture.guests ?? 8;
  const guestText = guests === 1 ? "1 adult" : "8 adults";
  const label = guests === 1 ? "Private tasting dinner for one adult" : guests === 0 ? draft.title : LABEL;
  const requested: Draft = guests === 8 ? draft : guests === 0 ? { ...draft, summary: "A private tasting dinner.", specifics: [] } : {
    ...draft, summary: "A private tasting dinner for one adult.", specifics: [{ name: "guests", value: guestText }],
  };
  const meta: Meta = {
    responses: async (body) => {
      modelCalls.push(body);
      if (formatName(body) === "price_options") {
        return reply(JSON.stringify({
          options: [{
            label, seller: SELLER, url: PAGE, currency: "USD", price: fixture.price,
            recurring: fixture.recurring ?? [], parts: fixture.parts ?? [], evidence: fixture.evidence ?? fixture.quote, confidence: "high",
          }],
          note: "",
          media: { kind: "experience", subject: draft.title, generation: "", noun: "" },
        }));
      }
      if (String(body.instructions ?? "").startsWith("You are Dandelist's price researcher")) {
        return reply("", { functionCalls: [{
          callId: "dinner-page", name: "get_page", arguments: JSON.stringify({
            url: PAGE, thought: "Read the dinner price on the provider's page.",
          }),
        }] });
      }
      const outputs = Array.isArray(body.input) ? body.input as ToolOutput[] : [];
      if (outputs.some((entry) => entry.type === "function_call_output" && entry.call_id === "dinner-page")) return reply("Page read.");
      if (String(body.input ?? "").startsWith("FACTS:")) return reply("An option for the requested dinner.");
      isolation.unexpected.push("model response stage");
      throw new Error("Unexpected model call in the party fixture");
    },
  };
  const { fetched, fetcher } = pageFetcher(pageHtml(fixture.quote, fixture.head));
  const result = await research(meta, {
    draft: requested,
    answers: guests ? [{ question: "Guests", answer: guestText }] : [],
    homeCurrency: "USD",
    now: () => new Date("2026-10-29T08:00:00Z"),
    fetcher,
    onStep: (step) => { steps.push(step); },
  });

  expect(modelCalls).toHaveLength(result.options.length ? 4 : 3);
  if (guests) {
    expect(modelCalls[0]!.input).toContain(`The person answered: Guests ${guestText}`);
    expect(modelCalls[0]!.input).toContain(`guests: ${guestText}`);
  }
  const toolTurn = modelCalls.find((body) => Array.isArray(body.input) && (body.input as ToolOutput[]).some((entry) => entry.call_id === "dinner-page"));
  const pageOutput = (toolTurn!.input as ToolOutput[]).find((entry) => entry.call_id === "dinner-page")!;
  const observedPage = JSON.parse(pageOutput.output!) as { title: string; text: string };
  expect(observedPage.title).toBe("Atlas Table private tasting dinner");
  expect(observedPage.text).toContain(fixture.quote);
  if (fixture.quote === UNIT_QUOTE) expect(observedPage.text).not.toContain("1200");
  expect(fetched).toEqual([PAGE]);
  expect(isolation.dns.length).toBeGreaterThan(0);
  expect(new Set(isolation.dns)).toEqual(new Set(["atlastable.example"]));
  expect(isolation.huntMedia).toHaveBeenCalledTimes(result.options.length ? 1 : 0);
  expect(steps).toContainEqual(expect.objectContaining({ type: "open", url: PAGE, ok: true }));
  return { result, steps };
}

async function quickDinner(fixture: { quote: string; price: number; head?: string; status?: number; snippet?: string; modelPicksPage?: boolean; shown?: string; party?: false }) {
  const asked: Draft = fixture.party === false ? { ...draft, summary: "A private tasting dinner.", specifics: [] } : draft;
  const calls: Record<string, unknown>[] = [];
  const steps: Step[] = [];
  const meta: Meta = {
    responses: async (body) => {
      calls.push(body);
      if (!String(body.instructions ?? "").startsWith("You find, fast,")) {
        isolation.unexpected.push("quick model response stage");
        throw new Error("Unexpected quick model call in the party fixture");
      }
      return reply(fixture.modelPicksPage === false ? "" : `${PAGE} | ${fixture.shown ?? fixture.price} | USD`, {
        searchQueries: ["private tasting dinner price"],
        raw: { output: [{
          type: "web_search_call",
          action: { query: "private tasting dinner price" },
          results: [{ url: PAGE, title: draft.title, snippet: fixture.snippet ?? `${draft.title} costs USD ${fixture.price}.` }],
        }] },
      });
    },
  };
  const { fetched, fetcher } = pageFetcher(pageHtml(fixture.quote, fixture.head), fixture.status);
  const result = await quickFind(meta, {
    words: asked.summary, draft: asked, details: fixture.party === false ? [] : ["Guests: 8 adults"], homeCurrency: "USD",
  }, {
    fetcher,
    api: fetcher,
    now: () => new Date("2026-10-29T08:00:00Z"),
    by: Date.now() + 30_000,
    onStep: (step) => { steps.push(step); },
  });
  expect(calls).toHaveLength(1);
  if (fixture.party !== false) expect(calls[0]!.input).toContain("Guests: 8 adults");
  expect(fetched).toEqual([PAGE]);
  expect(isolation.dns.length).toBeGreaterThan(0);
  expect(new Set(isolation.dns)).toEqual(new Set(["atlastable.example"]));
  expect(steps).toContainEqual(expect.objectContaining({ type: "open", url: PAGE, ok: !fixture.status || fixture.status === 200 }));
  if (result === null) expect(steps.filter((step) => step.type === "price")).toEqual([]);
  return result;
}

/** One option: eight guests at USD 150 each, as one per-person part; never one person's 150 as the whole price. */
function expectEightGuests(options: (PriceOption | null)[]) {
  expect(options).toHaveLength(1);
  const option = options[0]!;
  expect(option).toMatchObject({
    upfrontCents: 120_000,
    source: { currency: "USD", price: 1200, rate: 1 },
    totals: { monthlyCents: 0, horizonCents: 120_000 },
    parts: [{ kind: "other", unit: "person", unitCents: 15_000, quantity: 8, totalCents: 120_000 }],
  });
  expect(option.statusLabel).toMatch(/, 8 people at the per-person price$/);
}

beforeEach(() => {
  isolation.unexpected.length = 0;
  isolation.dns.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("fetch", async () => {
    isolation.unexpected.push("global fetch");
    throw new Error("Unexpected global network request in the party fixture");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Production intentionally catches some fetch/media errors; swallowed attempts must still fail this fixture.
  expect(isolation.unexpected).toEqual([]);
});

describe("person-unit evidence belongs to its adjacent amount", () => {
  it.each([
    ["Dinner USD 150 per adult guest.", 150],
    ["Dinner USD 150 per guest.", 150],
    ["Dinner USD 150 per person.", 150],
    ["Per adult: USD 150", 150],
    ["Menu from 150. Dinner USD 150 per adult guest.", 150],
  ] as const)("recognizes %s", (text, amount) => {
    expect(personPrice(text, amount)).toBe(true);
  });

  it.each([
    ["Party total USD 1200. Per adult USD 150.", 1200],
    ["Per adult USD 150. Party total USD 1200.", 1200],
    ["Party total USD 1200. Per adult information follows.", 1200],
    ["An adult chooses the menu with the chef. The quoted party price is USD 1200.", 1200],
    ["Party total USD 1150. Extra guest USD 150.", 1150],
    ["A bottle costs USD 150 per 100 ml.", 150],
    ["Membership USD 150 per month.", 150],
    ["Membership USD 150/mo.", 150],
  ] as const)("does not infer person scope from %s", (text, amount) => {
    expect(personPrice(text, amount)).toBe(false);
  });

  it.each([
    { text: "Dinner EUR 150 per person. Whole-party offer USD 150.", currency: "USD", unit: false },
    { text: "Dinner EUR 150 per person. Whole-party offer USD 150.", currency: "EUR", unit: true },
    { text: "Whole-party offer USD 150. Dinner 150 EUR per adult.", currency: "USD", unit: false },
  ])("keeps the adjacent currency for $currency in $text", ({ text, currency, unit }) => {
    expect(personPrice(text, 150, currency)).toBe(unit);
  });

  it("does not treat a conjunction as a currency token between the total and unrelated person wording", () => {
    expect(personPrice("Whole party USD 1200 and each person receives a drink.", 1200, "USD")).toBe(false);
  });

  it("does not extract a currency code from the end of an ordinary word", () => {
    expect(personPrice("Overall 150 per adult", 150, "USD")).toBe(true);
  });
});

describe("how many people a wish is for", () => {
  it.each([
    ["2 adults", 2],
    ["2 adults, 2 children", 4],
    ["Who's going: two adults and one child", 3],
    ["a couple", 2],
    ["for two", 2],
    ["dinner for 4", 4],
    ["family of five", 5],
    ["Just me", 1],
    ["Solo", 1],
    ["8 guests", 8],
  ])("reads %s as %i", (text, n) => {
    expect(headcount(text)).toBe(n);
  });

  it.each(["for 4 nights", "a 2 hour class", "the Leica Q3", "3 courses"])("finds no party in %s", (text) => {
    expect(headcount(text)).toBeNull();
  });

  it("takes the people question's answer first, then a named detail, then the wish's words", () => {
    const base = { specifics: [], summary: "" };
    expect(partyOf({ ...base, questions: [{ id: "travellers", label: "Who's going?", picked: "2 adults" }] })).toBe(2);
    expect(partyOf({ ...base, questions: [{ id: "format", label: "Which class?", picked: "Pasta for 6" }] }, "for two")).toBe(2);
    expect(partyOf({ ...base, specifics: [{ name: "guests", value: "8 adults" }] })).toBe(8);
    expect(partyOf({ ...base, specifics: [{ name: "people", value: "3" }] })).toBe(3);
    expect(partyOf({ ...base, specifics: [{ name: "model", value: "2 door" }] }, "A balloon ride over Cappadocia for two")).toBe(2);
    expect(partyOf({ ...base, summary: "A private tasting dinner." })).toBeNull();
    expect(partyOf(null, "a pasta class")).toBeNull();
  });
});

describe("party prices through actual research", () => {
  // Keep scalar calls separate from the parts control: the existing research pipeline filters scalar
  // siblings when any option has parts. The original diagnostic A/B/C receipt is preserved outside the repo.
  it.each([
    { name: "A: a bare unit quote", head: "" },
    { name: "a generic Offer beside the unit quote", head: offerMarkup(150) },
    { name: "a product meta price beside the unit quote", head: metaMarkup(150) },
  ])("prices $name for the eight guests, never as the whole amount", async ({ head }) => {
    const { result, steps } = await researchDinner({ quote: UNIT_QUOTE, price: 150, head });
    expectEightGuests(result.options);
    expect(steps.filter((step) => step.type === "price")).toEqual([expect.objectContaining({ upfrontCents: 120_000 })]);
  });

  it("prices the page's unit figure for the eight guests when the model omits its qualification from evidence", async () => {
    const { result } = await researchDinner({
      quote: UNIT_QUOTE, price: 150, evidence: "A private tasting dinner quote from Atlas Table.",
    });
    expectEightGuests(result.options);
  });

  it.each([
    { name: "a bare unit quote", evidence: undefined },
    { name: "a unit figure the model wrote without its qualification", evidence: "A private tasting dinner quote from Atlas Table." },
  ])("holds $name when nothing says how many people", async ({ evidence }) => {
    const { result, steps } = await researchDinner({ quote: UNIT_QUOTE, price: 150, guests: 0, evidence });
    expect(result.options).toEqual([]);
    expect(steps.filter((step) => step.type === "price")).toEqual([]);
    expect(steps.filter((step) => step.type === "check" && step.verified)).toEqual([]);
  });

  it("B: preserves an already calculated 1200 party total as an estimate", async () => {
    const { result, steps } = await researchDinner({ quote: UNIT_QUOTE, price: 1200 });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      label: LABEL, seller: SELLER, upfrontCents: 120_000, status: "estimate", statusLabel: "Estimate",
      source: { currency: "USD", price: 1200, rate: 1 }, recurring: [],
      totals: { monthlyCents: 0, horizonCents: 120_000 },
    });
    expect(result.options[0]!.parts).toBeUndefined();
    expect(steps).toContainEqual(expect.objectContaining({ type: "check", url: PAGE, verified: false }));
    expect(steps).toContainEqual(expect.objectContaining({ type: "price", upfrontCents: 120_000 }));
  });

  it.each([
    { name: "C: the quoted whole-party package", quote: PARTY_QUOTE },
    { name: "a package beside a different per-adult amount", quote: `${PARTY_QUOTE} ${UNIT_QUOTE}` },
  ])("preserves $name", async ({ quote }) => {
    const { result, steps } = await researchDinner({ quote, price: 1200 });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      upfrontCents: 120_000, status: "verified", statusLabel: "Checked on atlastable.example",
      source: { currency: "USD", price: 1200, rate: 1 }, recurring: [],
      totals: { monthlyCents: 0, horizonCents: 120_000 },
    });
    expect(result.options[0]!.parts).toBeUndefined();
    expect(steps).toContainEqual(expect.objectContaining({ type: "check", url: PAGE, verified: true }));
  });

  it("D: keeps explicit per-person parts and actual quantity arithmetic", async () => {
    const { result } = await researchDinner({
      quote: UNIT_QUOTE,
      price: 0,
      parts: [{ label: LABEL, seller: SELLER, url: PAGE, currency: "USD", kind: "other", unit: "person", unit_price: 150, quantity: 8, evidence: UNIT_QUOTE }],
    });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      upfrontCents: 120_000, status: "verified", recurring: [],
      source: { currency: "USD", price: 1200, rate: 1 },
      totals: { monthlyCents: 0, horizonCents: 120_000 },
      parts: [{ kind: "other", unit: "person", unitCents: 15_000, quantity: 8, totalCents: 120_000, status: "verified" }],
    });
  });

  it("preserves an explicit one-person part for a one-adult request", async () => {
    const label = "Private tasting dinner for one adult";
    const { result } = await researchDinner({
      quote: UNIT_QUOTE,
      price: 0,
      guests: 1,
      parts: [{ label, seller: SELLER, url: PAGE, currency: "USD", kind: "other", unit: "person", unit_price: 150, quantity: 1, evidence: UNIT_QUOTE }],
    });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      label, upfrontCents: 15_000, status: "verified", recurring: [],
      source: { currency: "USD", price: 150, rate: 1 },
      totals: { monthlyCents: 0, horizonCents: 15_000 },
      parts: [{ kind: "other", unit: "person", unitCents: 15_000, quantity: 1, totalCents: 15_000, status: "verified" }],
    });
  });

  it("preserves a recurring-only option without treating its charge as a whole upfront price", async () => {
    const { result } = await researchDinner({
      quote: "Private tasting dinner club membership costs USD 44.50 per month.",
      price: 0,
      recurring: [{ label: "Membership", amount: 44.5, period: "month" }],
    });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      upfrontCents: 0, status: "verified",
      recurring: [{ label: "Membership", amountCents: 4450, period: "month" }],
      totals: { monthlyCents: 4450, horizonCents: 267_000 },
    });
  });
});

describe("person-unit evidence through actual quickFind", () => {
  it.each([
    { name: "a bare scalar", head: "" },
    { name: "a generic Offer", head: offerMarkup(150) },
    { name: "a product meta price", head: metaMarkup(150) },
  ])("prices $name for the eight guests, never as the party total", async ({ head }) => {
    expectEightGuests([await quickDinner({ quote: UNIT_QUOTE, price: 150, head })]);
  });

  it.each([
    { name: "a bare scalar", head: "" },
    { name: "a generic Offer", head: offerMarkup(150) },
  ])("holds $name when nothing says how many people", async ({ head }) => {
    expect(await quickDinner({ quote: UNIT_QUOTE, price: 150, head, party: false })).toBeNull();
  });

  it("does not publish markup the page states per person when the model gives zero", async () => {
    expect(await quickDinner({ quote: UNIT_QUOTE, price: 0, head: offerMarkup(150) })).toBeNull();
  });

  it("keeps the readable page's per-adult qualification over an unqualified search figure", async () => {
    expectEightGuests([await quickDinner({ quote: UNIT_QUOTE, price: 150, snippet: "Private tasting dinner USD 150." })]);
  });

  it("prices a refused page's per-adult search result for the eight guests, as an estimate", async () => {
    const option = await quickDinner({ quote: "Access denied", price: 150, status: 403, snippet: UNIT_QUOTE });
    expectEightGuests([option]);
    expect(option).toMatchObject({ status: "estimate", statusLabel: "Estimate: from search results for atlastable.example, 8 people at the per-person price" });
    expect(await quickDinner({ quote: "Access denied", price: 150, status: 403, snippet: UNIT_QUOTE, party: false })).toBeNull();
  });

  it.each([
    { name: "Offer", head: offerMarkup(150) },
    { name: "product meta", head: metaMarkup(150) },
  ])("does not let readable $name markup erase the same page's qualified search snippet", async ({ head }) => {
    expect(await quickDinner({
      quote: "Private tasting dinner costs USD 150.", price: 150, head, snippet: UNIT_QUOTE,
    })).toBeNull();
  });

  it("retains unit-qualified search evidence for a returned page the model did not pick", async () => {
    expect(await quickDinner({
      quote: "Private tasting dinner costs USD 150.", price: 0, head: offerMarkup(150),
      snippet: UNIT_QUOTE, modelPicksPage: false,
    })).toBeNull();
  });

  it.each(["150/adult", "150 a guest"])("keeps the model's raw qualifier in %s when the page and snippet omit it", async (shown) => {
    expect(await quickDinner({
      quote: "Private tasting dinner costs USD 150.", price: 150, shown, head: offerMarkup(150),
      snippet: "Private tasting dinner USD 150.",
    })).toBeNull();
  });

  it("preserves the valid whole package beside a different unit quote, including bad primary markup", async () => {
    const result = await quickDinner({ quote: `${PARTY_QUOTE} ${UNIT_QUOTE}`, price: 1200, head: offerMarkup(150) });
    expect(result).toMatchObject({ upfrontCents: 120_000, source: { currency: "USD", price: 1200, rate: 1 } });
  });

  it("keeps an ordinary UnitPriceSpecification whole price", async () => {
    const head = ld({ "@type": "Service", name: draft.title, offers: { "@type": "Offer", priceSpecification: {
      "@type": "UnitPriceSpecification", price: 1200, priceCurrency: "USD",
    } } });
    expect(await quickDinner({ quote: PARTY_QUOTE, price: 1200, head })).toMatchObject({
      upfrontCents: 120_000, source: { currency: "USD", price: 1200, rate: 1 },
    });
  });
});
