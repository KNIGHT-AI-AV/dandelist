import { beforeEach, describe, expect, it, vi } from "vitest";

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { WRAP_UP_MS, research, tidyQuestions, type Draft, type Meta, type PriceOption, type Step } from "../src/agent/agent";
import { huntWish, mergeFast, type HuntResult } from "../src/agent/find";
import { lineFor } from "../src/agent/lines";
import { mediaKindOf, namesWish, parseAmount, photoCandidates, quickFind, readCandidates, wishWords, type ProductPage } from "../src/agent/quick";
import { imageResponse, jpegHeader, pngHeader } from "./images";

/**
 * The fast first card (owner, 2026-10-29): the person's own wish, priced from a real page with that page's own photo,
 * in about 10 to 15 s, while the full research goes on; and nothing past the hunt's deadline.
 */

const clock = new Date("2026-10-29T08:00:00Z");
const ROLEX = "https://www.rolex.com/watches/submariner/m126610ln-0001";
const DAYTONA = "https://www.watchshop.example/rolex-daytona";
const JEWELLER = "https://www.jeweller.example/rolex-submariner-date";
const CHRONO = "https://www.chrono.example/rolex-submariner-date-126610ln";
const VAGUE = "https://www.watchblog.example/submariner";
const LISBON = "https://www.trips.example/lisbon-week";
const VILLA = "https://www.agency.example/property/villa-santa-lucija-75967";
const CHEF = "https://www.chefs.example/private-chef-dinner";
const PROVIDER = "https://www.cook.example/private-chef-services-denver";
const OLDCARS = "https://oldcarsdata.com/aston-martin/db11/price-history";
const KBB = "https://www.kbb.com/aston-martin/db11/2020/";
const DEALER = "https://www.dealer.example/aston-martin-db11";

const html = (head: string, body: string) => `<html><head>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const PAGES: Record<string, string> = {
  [ROLEX]: html(
    `<title>Submariner Date - Oystersteel | Rolex</title><meta property="og:site_name" content="Rolex"><meta property="og:image" content="/static/rolex-share.jpg">${ld({ "@type": "Product", name: "Rolex Submariner Date", image: ["/img/m126610ln-0001.jpg"], offers: { "@type": "Offer", price: "10250", priceCurrency: "USD" } })}`,
    "<h1>Submariner Date</h1><p>Oystersteel, black dial, Oyster bracelet. $10,250</p>",
  ),
  [DAYTONA]: html(`<title>Rolex Daytona | Watch Shop</title>${ld({ "@type": "Product", name: "Rolex Cosmograph Daytona", image: "/daytona.jpg", offers: { price: 15100, priceCurrency: "USD" } })}`, "<p>Daytona $15,100</p>"),
  [JEWELLER]: html(`<title>Rolex Submariner Date | Fine Jeweller</title><meta property="og:image" content="/static/logo.png">`, "<p>Rolex Submariner Date, new. Our price: $10,500.</p>"),
  [CHRONO]: html(
    `<title>Rolex Submariner Date 126610LN | Chrono</title><meta property="og:site_name" content="Chrono">${ld({ "@type": "Product", name: "Rolex Submariner Date 126610LN", image: "https://img.chrono.example/sub-126610ln.jpg", offers: { price: 9500, priceCurrency: "EUR" } })}`,
    "<p>Rolex Submariner Date in Oystersteel. 9.500 €</p>",
  ),
  [VAGUE]: html(`<title>Rolex Submariner Date review | Watch Blog</title>`, "<p>The Submariner Date is a classic. Prices vary.</p>"),
  [LISBON]: html(`<title>A week in Lisbon | Trips</title><meta property="og:image" content="/img/share-default.jpg">`, "<p>Seven nights in Lisbon for two, flights included, from $2,190.</p>"),
  [PROVIDER]: html(
    `<title>Private Chef Services in Denver | Mile High Cook</title>${ld({ "@type": "Service", name: "Cherry Hills Village", offers: { price: 1200, priceCurrency: "USD" } })}`,
    "<p>Your private chef cooks a dinner party at home for up to twelve guests. From $1,200.</p>",
  ),
  [VILLA]: html(`<title>Villa in Santa Lucija | Agency</title><meta property="og:image" content="/photos/villa-santa-lucija-1.jpg">`, "<p>Detached villa in Santa Lucija, Malta. 3 bedrooms, pool. Price: €1,950,000</p>"),
};

let web: string[];
const fakeWeb = (async (input: string | URL) => {
  const u = String(input);
  web.push(u);
  if (u === "https://www.rolex.com/img/m126610ln-0001.jpg") return imageResponse(jpegHeader(2000, 2000), "image/jpeg");
  if (u === "https://img.chrono.example/sub-126610ln.jpg") return imageResponse(jpegHeader(1600, 1200), "image/jpeg");
  if (u === "https://www.watchshop.example/daytona.jpg") return imageResponse(jpegHeader(1600, 1200), "image/jpeg");
  if (u === "https://www.agency.example/photos/villa-santa-lucija-1.jpg") return imageResponse(jpegHeader(2048, 1365), "image/jpeg");
  if (u === CHEF || u === OLDCARS || u === KBB || u === DEALER) return new Response("denied", { status: 403, headers: { "content-type": "text/html" } });
  if (u.endsWith("/static/logo.png")) return imageResponse(pngHeader(600, 200), "image/png");
  if (u.startsWith("https://api.frankfurter.dev/")) return Response.json({ date: "2026-10-28", rates: { USD: 1.08 } });
  if (u.startsWith("https://commons.wikimedia.org/") && (new URL(u).searchParams.get("gsrsearch") ?? "").includes("Aston Martin DB11")) {
    return Response.json({
      query: {
        pages: {
          9: { pageid: 9, index: 1, title: "File:Aston Martin DB11 V12 IMG 0306.jpg", imageinfo: [{ width: 4000, height: 2667, mime: "image/jpeg", url: "https://upload.wikimedia.org/db11.jpg", thumburl: "https://upload.wikimedia.org/thumb/db11.jpg", extmetadata: { Artist: { value: "A. Photographer" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }] },
        },
      },
    });
  }
  if (u.startsWith("https://commons.wikimedia.org/")) {
    return Response.json({
      query: {
        pages: {
          7: { pageid: 7, index: 1, title: "File:Lisbon skyline from Sao Jorge.jpg", imageinfo: [{ width: 4000, height: 2600, mime: "image/jpeg", url: "https://upload.wikimedia.org/lisbon.jpg", thumburl: "https://upload.wikimedia.org/thumb/lisbon.jpg", extmetadata: { Artist: { value: "A. Photographer" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }] },
        },
      },
    });
  }
  const page = PAGES[u];
  return page ? new Response(page, { status: 200, headers: { "content-type": "text/html" } }) : new Response("gone", { status: 404, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

type Body = Record<string, any>;
const result = (text: string, extra: Partial<{ raw: unknown; searchQueries: string[]; functionCalls: { callId: string; name: string; arguments: string }[] }> = {}) => ({
  id: `r${Math.random().toString(36).slice(2, 8)}`,
  text,
  citations: [],
  functionCalls: extra.functionCalls ?? [],
  searchQueries: extra.searchQueries ?? [],
  usage: { model: "muse-spark-1.3", inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, searches: 0 },
  costUsd: 0.001,
  raw: extra.raw ?? {},
});
/** The search the fast find runs: the pages the model names, and what the search itself returned. */
const searched = (lines: string[], returned: { url: string; title: string }[]) =>
  result(lines.join("\n"), { searchQueries: ["rolex submariner date price"], raw: { output: [{ type: "web_search_call", action: { query: "rolex submariner date price" }, results: returned }] } });

const DRAFT: Draft = {
  title: "Rolex Submariner Date",
  kind: "buy",
  summary: "A Rolex Submariner Date in steel.",
  specifics: [{ name: "metal", value: "steel" }],
  region: "US",
  currency: "USD",
  unknowns: ["bracelet"],
  questions: [{ id: "bracelet", label: "Which bracelet?", options: ["Oyster", "Jubilee"], picked: "Oyster" }],
};

let steps: Step[];
beforeEach(() => {
  web = [];
  steps = [];
});
const ctx = (by = Date.now() + 10_000) => ({ fetcher: fakeWeb, now: () => clock, onStep: (s: Step) => void steps.push(s), by });
const metaOf = (fn: (body: Body) => unknown): Meta => ({ responses: async (body) => fn(body) as never });

describe("the fast card", () => {
  it("prices the wish from its maker's page, with that page's own product photo", async () => {
    const calls: Body[] = [];
    const meta = metaOf((b) => (calls.push(b), searched([`${ROLEX} | $10,250 | USD`], [{ url: ROLEX, title: "Submariner Date | Rolex" }])));
    const started = Date.now();
    const card = await quickFind(meta, { words: "A Rolex Submariner date in steel", draft: DRAFT, homeCurrency: "USD" }, ctx());
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(card).toMatchObject({
      label: "Rolex Submariner Date",
      seller: "Rolex",
      url: ROLEX,
      upfrontCents: 1_025_000,
      status: "verified",
      statusLabel: "Checked on rolex.com",
      imageUrl: "https://www.rolex.com/img/m126610ln-0001.jpg",
      media: { kind: "product", images: [{ url: "https://www.rolex.com/img/m126610ln-0001.jpg", width: 2000, height: 2000, source: "rolex.com", credit: "Rolex" }] },
      source: { currency: "USD", price: 10250, rate: 1 },
    });
    // One model call with a bounded web search, and the person's words are what it searches.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tools: [{ type: "web_search" }], max_tool_calls: 1 });
    expect(calls[0]!.input).toContain("Wish: A Rolex Submariner date in steel");
    // The working row gets a short line for every step.
    expect(steps.map((s) => s.line)).toEqual(["Hunting for A Rolex Submariner date in steel", "Searching for rolex submariner date price", "Reading rolex.com", "Found it on rolex.com"]);
  });

  it("skips a page about another model, and goes without a photo rather than show a logo", async () => {
    const meta = metaOf(() =>
      searched(
        [`${DAYTONA} | $15,100 | USD`, `${JEWELLER} | $10,500 | USD`],
        [
          { url: DAYTONA, title: "Rolex Daytona" },
          { url: JEWELLER, title: "Rolex Submariner Date | Fine Jeweller" },
        ],
      ),
    );
    const card = await quickFind(meta, { words: "a rolex submariner date", draft: DRAFT, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({ url: JEWELLER, upfrontCents: 1_050_000, status: "estimate", statusLabel: "Estimate: seen on jeweller.example" });
    expect(card!.imageUrl).toBeUndefined();
    expect(card!.media).toBeUndefined();
    // The logo was never even fetched as a candidate, and the Daytona's photo never came near the card.
    expect(web.some((u) => u.endsWith("/static/logo.png") || u.endsWith("/daytona.jpg"))).toBe(false);
  });

  it("converts a price in another currency at today's rate", async () => {
    const meta = metaOf(() => searched([`${CHRONO} | 9.500 € | EUR`], [{ url: CHRONO, title: "Rolex Submariner Date 126610LN" }]));
    const card = await quickFind(meta, { words: "rolex submariner date", draft: DRAFT, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({ upfrontCents: 1_026_000, source: { currency: "EUR", price: 9500, rate: 1.08, rateDate: "2026-10-28" }, imageUrl: "https://img.chrono.example/sub-126610ln.jpg", status: "verified" });
  });

  it("takes a price only from a page that shows it", async () => {
    const meta = metaOf(() => searched([`${VAGUE} | $9,999 | USD`], [{ url: VAGUE, title: "Rolex Submariner Date review" }]));
    expect(await quickFind(meta, { words: "rolex submariner date", draft: DRAFT, homeCurrency: "USD" }, ctx())).toBeNull();
  });

  it("gives up quietly at its deadline", async () => {
    const meta: Meta = { responses: () => new Promise(() => undefined) };
    const started = Date.now();
    expect(await quickFind(meta, { words: "rolex submariner date", draft: DRAFT, homeCurrency: "USD" }, ctx(Date.now() + 80))).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("finds a home by its listing: the name says villa, the page says Malta and three bedrooms, and its photo is the listing's", async () => {
    const home: Draft = { title: "Three-Bedroom Villa in Malta", kind: "own", summary: "A three bedroom villa with a pool in Malta.", specifics: [], region: "MT", currency: "EUR", unknowns: [] };
    const meta = metaOf(() => searched([`${VILLA} | €1,950,000 | EUR`], [{ url: VILLA, title: "Villa in Santa Lucija" }]));
    const card = await quickFind(meta, { words: "a three bedroom villa with a pool in malta", draft: home, homeCurrency: "USD" }, { ...ctx(), api: fakeWeb });
    expect(card).toMatchObject({ url: VILLA, upfrontCents: 210_600_000, status: "estimate", statusLabel: "Estimate: seen on agency.example", imageUrl: "https://www.agency.example/photos/villa-santa-lucija-1.jpg", media: { kind: "place" } });
  });

  it("prices from the search result itself when the page refuses a server", async () => {
    const chef: Draft = { title: "Private Chef Dinner Party", kind: "do", summary: "A private chef for a dinner party of eight.", specifics: [], region: "US", currency: "USD", unknowns: [] };
    const meta = metaOf(() => searched([`${CHEF} | $1,200 | USD`], [{ url: CHEF, title: "Private chef dinner for 8 guests, from $1,200 | Chefs" }]));
    const card = await quickFind(meta, { words: "a private chef for a dinner party of eight", draft: chef, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({ url: CHEF, upfrontCents: 120_000, status: "estimate", statusLabel: "Estimate: from search results for chefs.example", label: "Private chef dinner for 8 guests, from $1,200" });
    expect(card!.imageUrl).toBeUndefined();
  });

  it("names the card for the wish, not for a business area the page's data happens to name", async () => {
    const chef: Draft = { title: "Private Chef Dinner Party", kind: "do", summary: "A private chef for a dinner party of eight.", specifics: [], region: "US", currency: "USD", unknowns: [] };
    const meta = metaOf(() => searched([`${PROVIDER} | $1,200 | USD`], [{ url: PROVIDER, title: "Private chef services in Denver" }]));
    const card = await quickFind(meta, { words: "a private chef for a dinner party of eight", draft: chef, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({ url: PROVIDER, upfrontCents: 120_000, label: "Private Chef Services in Denver" });
  });

  it("shows a trip's place from Wikimedia Commons when no page photo fits", async () => {
    const trip: Draft = { title: "A week in Lisbon", kind: "visit", summary: "Seven nights in Lisbon for two.", specifics: [], region: "US", currency: "USD", unknowns: [] };
    const meta = metaOf(() => searched([`${LISBON} | $2,190 | USD`], [{ url: LISBON, title: "A week in Lisbon | Trips" }]));
    const card = await quickFind(meta, { words: "a week in lisbon for two", draft: trip, homeCurrency: "USD" }, { ...ctx(), api: fakeWeb });
    expect(card).toMatchObject({ upfrontCents: 219_000, imageUrl: "https://upload.wikimedia.org/thumb/lisbon.jpg", media: { kind: "place", images: [{ source: "commons.wikimedia.org", license: "CC BY-SA 4.0" }] } });
  });
});

describe("the fast card when every page turns the server away", () => {
  const car: Draft = { title: "Aston Martin DB11", kind: "own", summary: "An Aston Martin DB11.", specifics: [], region: "US", currency: "USD", unknowns: [] };
  const titles = [
    { url: OLDCARS, title: "Aston Martin DB11 Price History" },
    { url: KBB, title: "2020 Aston Martin DB11 Price, Value & Reviews | Kelley Blue Book" },
    { url: DEALER, title: "Aston Martin DB11 for sale | Dealer" },
  ];

  it("stands on the search's own figure as an estimate, named for the wish, with a photo of the car itself", async () => {
    // The model named the bare site; the search had returned that site's page about the car.
    const meta = metaOf(() => searched(["https://oldcarsdata.com | $110,500 | USD", `${KBB} | $128,000 | USD`], titles));
    const card = await quickFind(meta, { words: "aston martin db11", draft: car, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({
      label: "Aston Martin DB11",
      url: OLDCARS,
      upfrontCents: 11_050_000,
      status: "estimate",
      statusLabel: "Estimate: from search results for oldcarsdata.com",
      confidence: "low",
      imageUrl: "https://upload.wikimedia.org/thumb/db11.jpg",
      media: { kind: "vehicle", images: [{ source: "commons.wikimedia.org" }] },
    });
  });

  it("passes over a figure far from the search's others", async () => {
    const meta = metaOf(() => searched([`${OLDCARS} | $9 | USD`, `${KBB} | $128,000 | USD`, `${DEALER} | $119,000 | USD`], titles));
    const card = await quickFind(meta, { words: "aston martin db11", draft: car, homeCurrency: "USD" }, ctx());
    expect(card).toMatchObject({ url: KBB, upfrontCents: 12_800_000 });
  });

  it("never takes the search's figure for a page the search didn't return, or one about something else", async () => {
    const meta = metaOf(() => searched([`https://www.elsewhere.example/db11 | $110,500 | USD`, `${DEALER} | $119,000 | USD`], [{ url: DEALER, title: "Vantage V8 for sale | Dealer" }]));
    expect(await quickFind(meta, { words: "aston martin db11", draft: car, homeCurrency: "USD" }, ctx())).toBeNull();
  });
});

describe("reading the fast find's answer and the pages", () => {
  it("reads amounts however they are written", () => {
    expect(parseAmount("$10,250")).toBe(10250);
    expect(parseAmount("10.250,00 €")).toBe(10250);
    expect(parseAmount("From $1,299 pp")).toBe(1299);
    expect(parseAmount("1 299")).toBe(1299);
    expect(parseAmount("44,50")).toBe(44.5);
    // A villa shown as "$3M" is three million dollars, never three.
    expect(parseAmount("$3M")).toBe(3_000_000);
    expect(parseAmount("$2.5M")).toBe(2_500_000);
    expect(parseAmount("€3 million")).toBe(3_000_000);
    expect(parseAmount("£85k")).toBe(85_000);
    expect(parseAmount("$1.2bn")).toBe(1_200_000_000);
    expect(parseAmount("$450/mo")).toBe(450);
    expect(parseAmount("$12,500 MSRP")).toBe(12500);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("none")).toBe(0);
  });

  it("reads the model's lines, links in its own order", () => {
    expect(readCandidates(`1. ${ROLEX} | $10,250 | USD\n- [Chrono](${CHRONO}) | 9.500 € | eur\nno link here\n${JEWELLER}`)).toEqual([
      { url: ROLEX, amount: 10250, currency: "USD" },
      { url: CHRONO, amount: 9500, currency: "EUR" },
      { url: JEWELLER, amount: 0, currency: "" },
    ]);
  });

  it("asks a thing to buy to be named in full, and a listing to name one word and show two thirds of them", () => {
    const page = (name: string, text = "") => ({ name, title: "", text });
    const watch = wishWords("A Rolex Submariner date in steel");
    expect(watch).toEqual(["rolex", "submariner", "date", "steel"]);
    expect(namesWish(page("Rolex Submariner Date Oystersteel"), watch, false)).toBe(true);
    expect(namesWish(page("Rolex Submariner Date", "Oystersteel case"), watch, false)).toBe(true);
    expect(namesWish(page("Rolex Cosmograph Daytona", "steel"), watch, false)).toBe(false);
    expect(namesWish(page("Sky-Dweller"), wishWords("Rolex Skydweller"), false)).toBe(false);
    expect(namesWish(page("Rolex Sky-Dweller"), wishWords("Rolex Skydweller"), false)).toBe(true);
    const chef = wishWords("Private chef for a dinner party");
    expect(namesWish(page("Hire a private chef | Take a Chef", "Your own chef cooks a dinner party at home."), chef, true)).toBe(true);
    expect(namesWish(page("Hire a private chef | Take a Chef"), chef, true)).toBe(false);
    expect(namesWish(page("Restaurants near you", "A private chef for your dinner party"), chef, true)).toBe(false);
    const villa = wishWords("Three-Bedroom Villa in Malta");
    expect(namesWish(page("Villa in Santa Lucija", "3 bedrooms, pool, Malta"), villa, true)).toBe(true);
    expect(namesWish(page("Apartment in Sliema", "3 bedrooms, Malta"), villa, true)).toBe(false);
  });

  it("lets only the page's own product picture, or a share picture named for the wish, stand for it", () => {
    const base: ProductPage = { ok: true, url: "https://shop.example/p", status: 200, name: "Rolex Submariner Date", title: "", siteName: "", text: "", prices: [], productImages: [], product: false };
    const words = wishWords("Rolex Submariner Date");
    expect(photoCandidates({ ...base, productImages: ["https://shop.example/a.jpg", "https://shop.example/logo-dark.png"] }, words)).toEqual(["https://shop.example/a.jpg"]);
    expect(photoCandidates({ ...base, shareImage: "https://shop.example/img/share-default.jpg" }, words)).toEqual([]);
    expect(photoCandidates({ ...base, product: true, shareImage: "https://shop.example/img/share-default.jpg" }, words)).toEqual([]);
    expect(photoCandidates({ ...base, product: true, shareImage: "https://shop.example/img/126610ln-front.jpg" }, words)).toEqual(["https://shop.example/img/126610ln-front.jpg"]);
    expect(photoCandidates({ ...base, shareImage: "https://shop.example/img/rolex-submariner-date.jpg" }, words)).toEqual(["https://shop.example/img/rolex-submariner-date.jpg"]);
  });

  it("knows what a wish's photos show", () => {
    expect(mediaKindOf({ kind: "own", title: "Three bedroom villa in Malta", summary: "" })).toEqual(["place"]);
    expect(mediaKindOf({ kind: "own", title: "Porsche 911 Carrera S", summary: "" })).toEqual(["vehicle", "product"]);
    expect(mediaKindOf({ kind: "visit", title: "A week in Lisbon", summary: "" })).toEqual(["place"]);
  });

  it("keeps only well-formed questions, each with a pick from its own choices", () => {
    expect(
      tidyQuestions([
        { id: "Bracelet", label: "Which bracelet?", options: ["Oyster", "Jubilee", "Oyster"], picked: "jubilee" },
        { id: "x", label: "Only one choice?", options: ["Yes"], picked: "Yes" },
        { id: "condition", label: "New or pre-owned?", options: ["New", "Pre-owned"], picked: "Something else" },
        "nonsense",
      ]),
    ).toEqual([
      { id: "bracelet", label: "Which bracelet?", options: ["Oyster", "Jubilee"], picked: "Jubilee" },
      { id: "condition", label: "New or pre-owned?", options: ["New", "Pre-owned"], picked: "New" },
    ]);
  });

  it("writes one short line for every kind of step", () => {
    expect(lineFor({ type: "open", url: "https://www.rolex.com/x", ok: true, at: "" })).toBe("Reading rolex.com");
    expect(lineFor({ type: "check", url: "https://www.rolex.com/x", verified: true, at: "" })).toBe("Price confirmed on rolex.com");
    expect(lineFor({ type: "search", query: "a very long query about the rolex submariner date in oystersteel with a black dial and more", at: "" }).length).toBeLessThanOrEqual(64);
    expect(lineFor({ type: "explain", at: "" })).toBe("Weighing the options");
  });
});

describe("the whole hunt", () => {
  const FINAL_OPTIONS = [{ label: "Submariner Date at Chrono", seller: "Chrono", url: CHRONO, currency: "EUR", price: 9500, recurring: [], evidence: "9.500 €", confidence: "high", parts: [] }];
  /** A fake model for every call of a hunt; `slow` holds the research's final answer back until released. */
  function huntMeta(opts: { slow?: Promise<void>; failResearch?: boolean; lines?: string[] } = {}) {
    const calls: Body[] = [];
    const meta = metaOf(async (b) => {
      calls.push(b);
      const format = b.text?.format?.name;
      if (format === "wish_draft") return result(JSON.stringify({ ...DRAFT, questions: undefined }));
      if (format === "wish_questions") return result(JSON.stringify({ questions: DRAFT.questions }));
      if (String(b.instructions ?? "").startsWith("You find, fast")) return searched(opts.lines ?? [`${ROLEX} | $10,250 | USD`], [{ url: ROLEX, title: "Submariner Date | Rolex" }, { url: CHRONO, title: "Rolex Submariner Date 126610LN" }]);
      if (String(b.instructions ?? "").startsWith("You are Dandelist's price researcher")) {
        if (opts.failResearch) throw new Error("research went down");
        return result("Done.");
      }
      if (format === "price_options") {
        await opts.slow;
        return result(JSON.stringify({ options: FINAL_OPTIONS, note: "", media: { kind: "product", subject: "Rolex Submariner Date", generation: "", noun: "watch" } }));
      }
      return result("The Chrono listing is the one to pick.");
    });
    return { meta, calls };
  }
  const base = () => ({ onStep: (s: Step) => void steps.push(s), now: () => clock, fetcher: fakeWeb, homeCurrency: "USD" });

  it("sends the fast card first, while the research goes on, then the research's best, with the answers it assumed", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const { meta, calls } = huntMeta({ slow });
    const sent: HuntResult[] = [];
    const drafts: Draft[] = [];
    const hunt = huntWish(meta, { ...base(), text: "A Rolex Submariner date in steel", onDraft: (d) => void drafts.push(d), onProvisional: (r) => void sent.push(r) });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ provisional: true, options: [{ url: ROLEX, status: "verified", imageUrl: "https://www.rolex.com/img/m126610ln-0001.jpg" }], questions: [{ id: "bracelet", picked: "Oyster", answered: false }] });
    release();
    const done = await hunt;
    expect(done.provisional).toBe(false);
    // The draft goes out as soon as it is read, then again with its questions once their own call answers.
    expect(drafts[0]).toMatchObject({ title: "Rolex Submariner Date" });
    expect(drafts.at(-1)).toMatchObject({ questions: [{ id: "bracelet", picked: "Oyster", answered: false }] });
    expect(done.questions).toEqual([{ id: "bracelet", label: "Which bracelet?", options: ["Oyster", "Jubilee"], picked: "Oyster", answered: false }]);
    // Both are checked on their own pages, so the research's cheaper find leads, and the fast card stays an option.
    expect(done.options.map((o) => o.url)).toEqual([CHRONO, ROLEX]);
    expect(done.options[0]).toMatchObject({ status: "verified", upfrontCents: 1_026_000 });
    // Nothing waited on the questions: the research started from the draft alone, beside the questions' own call.
    const brief = calls.find((c) => String(c.instructions ?? "").startsWith("You are Dandelist's price researcher"))!;
    expect(brief.input).not.toContain("The person answered");
    expect(calls.some((c) => c.text?.format?.name === "wish_questions")).toBe(true);
    // The research no longer looks for 3D models.
    expect(brief.tools.map((t: { name?: string; type: string }) => t.name ?? t.type)).toEqual(["web_search", "get_page", "fx_rate"]);
  });

  it("hunts again with the person's own answer, free text included, without reading the wish again", async () => {
    const { meta, calls } = huntMeta();
    const done = await huntWish(meta, { ...base(), text: "A Rolex Submariner date in steel", draft: DRAFT, answers: [{ question: "bracelet", answer: "Jubilee, two-tone" }] });
    expect(calls.some((c) => c.text?.format?.name === "wish_draft")).toBe(false);
    expect(calls.find((c) => String(c.instructions ?? "").startsWith("You find, fast"))!.input).toContain("Details: Which bracelet? Jubilee, two-tone");
    expect(calls.find((c) => String(c.instructions ?? "").startsWith("You are Dandelist's price researcher"))!.input).toContain("The person answered: Which bracelet? Jubilee, two-tone");
    expect(done.questions).toEqual([{ id: "bracelet", label: "Which bracelet?", options: ["Oyster", "Jubilee"], picked: "Jubilee, two-tone", answered: true }]);
  });

  it("keeps the fast card when the research fails", async () => {
    const { meta } = huntMeta({ failResearch: true });
    const done = await huntWish(meta, { ...base(), text: "A Rolex Submariner date in steel" });
    expect(done).toMatchObject({ provisional: false, options: [{ url: ROLEX, upfrontCents: 1_025_000 }] });
  });

  it("puts the fast card first when the research only has estimates, and lends its photo only to the same thing", () => {
    const opt = (o: Partial<PriceOption>): PriceOption => ({
      label: "Submariner Date",
      seller: "A seller",
      url: CHRONO,
      upfrontCents: 1_000_000,
      recurring: [],
      source: { currency: "USD", price: 10000, rate: 1, rateDate: "2026-10-29" },
      status: "estimate",
      statusLabel: "Estimate",
      evidence: "",
      confidence: "medium",
      checkedAt: clock.toISOString(),
      totals: { monthlyCents: 0, horizonCents: 1_000_000, spreadMonthlyCents: 16_667 },
      ...o,
    });
    const fast = opt({ url: ROLEX, status: "verified", statusLabel: "Checked on rolex.com", imageUrl: "https://www.rolex.com/img/a.jpg", media: { kind: "product", images: [] } });
    const ahead = mergeFast(DRAFT, { options: [opt({})], explanation: "", note: "", horizonYears: 5 }, fast);
    expect(ahead.options[0]).toBe(fast);
    expect(ahead.explanation).toMatch(/asks the least upfront/);
    expect(mergeFast(DRAFT, { options: [opt({ status: "verified" })], explanation: "e", note: "", horizonYears: 5 }, fast).options[0]!.imageUrl).toBe("https://www.rolex.com/img/a.jpg");
    const villa: Draft = { ...DRAFT, kind: "own", title: "Villa in Malta" };
    expect(mergeFast(villa, { options: [opt({ status: "verified" })], explanation: "e", note: "", horizonYears: 5 }, { ...fast, media: { kind: "place", images: [] } }).options[0]!.imageUrl).toBeUndefined();
    // A trip's card without a photo shows its place, when one is known; a home never borrows one.
    const trip: Draft = { ...DRAFT, kind: "visit", title: "A week in Lisbon" };
    const place = { url: "https://upload.wikimedia.org/lisbon.jpg", width: 3840, height: 2560, source: "commons.wikimedia.org" };
    expect(mergeFast(trip, { options: [opt({})], explanation: "e", note: "", horizonYears: 5 }, null, place).options[0]).toMatchObject({ imageUrl: place.url, media: { kind: "place", images: [place] } });
    expect(mergeFast(villa, { options: [opt({})], explanation: "e", note: "", horizonYears: 5 }, null, place).options[0]!.imageUrl).toBeUndefined();
  });
});

describe("the research's deadline", () => {
  it("answers with what it has when only the wrap-up time is left", async () => {
    const calls: Body[] = [];
    const meta = metaOf((b) => {
      calls.push(b);
      if (b.text?.format?.name === "price_options") return result(JSON.stringify({ options: [{ label: "Submariner Date", seller: "Rolex", url: ROLEX, currency: "USD", price: 10250, recurring: [], evidence: "$10,250", confidence: "high", parts: [] }], note: "" }));
      if (b.previous_response_id) return result("Done.");
      if (String(b.instructions ?? "").startsWith("You are Dandelist's price researcher")) return result("", { functionCalls: [{ callId: "g1", name: "get_page", arguments: JSON.stringify({ thought: "Reading Rolex's own page first.", url: ROLEX }) }] });
      return result("Pick the Rolex.");
    });
    const out = await research(meta, { draft: DRAFT, answers: [], onStep: () => undefined, now: () => clock, fetcher: fakeWeb, deadline: Date.now() + WRAP_UP_MS - 1 });
    // No tool round ran: the pending call was answered "out of time" and the model gave its options at once.
    expect(calls.filter((c) => c.previous_response_id)).toHaveLength(1);
    expect(JSON.stringify(calls[1]!.input)).toContain("Out of time. Answer with what you have.");
    expect(out.options[0]).toMatchObject({ url: ROLEX, status: "verified", upfrontCents: 1_025_000 });
  });
});
