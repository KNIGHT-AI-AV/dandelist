import { describe, expect, it, vi } from "vitest";

// Image hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import type { Meta } from "../src/agent/agent";
import { LOOKS_MS, brandPhotos, findPhoto, photoTally, siteOf, webPhotoUrls, type PhotoPlan, type PhotoVerdict } from "../src/agent/photos";
import { imageResponse, jpegHeader, pngHeader } from "./images";

/**
 * A wish whose maker's site turns our server away (owner, 2026-11-01: a Louis Vuitton Christopher MM in green came back
 * with no photo, then "No better photo turned up this time" on its retake). louisvuitton.com answers our server 403 on
 * every product page, but its image server gives the product's photo by the code its address ends in; and when the
 * pages named all turned us away, a second search leaves those sites out for other shops' and resale listings.
 */

const LV_PAGE = "https://us.louisvuitton.com/eng-us/products/christopher-mm-damier-other-N40564";
const LV_SHOT = "https://us.louisvuitton.com/images/is/image/lv/1/PP_VP_L/N40564_PM2_Front%20view.png?wid=1090&hei=1090";
const lv = { title: "Louis Vuitton Christopher MM in green", kind: "buy" as const };
const lvPlan: PhotoPlan = { identity: "Louis Vuitton Christopher MM backpack in green", broad: "Louis Vuitton Christopher MM backpack", lookalikes: ["Louis Vuitton Christopher MM in black"], exact: true, official: "louisvuitton.com", articles: [], commons: "", web: "Louis Vuitton Christopher MM green", kind: "product" };

const HERMES = "https://www.hermes.com/us/en/product/birkin-30-bag-H043403CC18/";
const HERMES_FR = "https://www.hermes.com/fr/fr/product/sac-birkin-30-H043403CC18/";
const RESALE = "https://www.fashionphile.com/products/hermes-togo-birkin-30-etoupe-1839283";
const RESALE_SHOT = "https://www.fashionphile.com/cdn/shop/files/hermes-togo-birkin-30-etoupe.jpg";
const birkin = { title: "Hermès Birkin 30 in Etoupe Togo", kind: "buy" as const };
const resaleHtml = `<html><head><title>Hermes Togo Birkin 30 Etoupe</title><meta property="og:image" content="${RESALE_SHOT}"><script type="application/ld+json">{"@type":"Product","name":"Hermes Togo Birkin 30 Etoupe","image":"${RESALE_SHOT}","offers":{"price":"24000","priceCurrency":"USD"}}</script></head><body>Hermes Togo Birkin 30 Etoupe</body></html>`;

const LV_OTHER_PAGE = "https://en.louisvuitton.com/eng-e1/products/christopher-mm-taurillon-monogram-nvprod5170035v/M24428";
const LV_OTHER_SHOT = LV_SHOT.replace("N40564", "M24428");

/** The web as our server meets it: these makers' pages turn it away; the rest open as given. */
const web = (opened: string[] = [], o: { lvMissing?: boolean } = {}) =>
  (async (input: string | URL) => {
    const u = String(input);
    opened.push(u);
    if (u === LV_SHOT && !o.lvMissing) return imageResponse(pngHeader(1090, 1090), "image/png");
    if (u === LV_OTHER_SHOT) return imageResponse(pngHeader(1090, 1090), "image/png");
    if (u === RESALE_SHOT) return imageResponse(jpegHeader(1946, 1946), "image/jpeg");
    if (u === RESALE) return new Response(resaleHtml, { headers: { "content-type": "text/html" } });
    if (/louisvuitton\.com|hermes\.com/.test(u)) return new Response("Access Denied", { status: 403, headers: { "content-type": "text/html" } });
    if (u.startsWith("https://en.wikipedia.org/")) return Response.json({ query: {} });
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

/** A web search's answer: one address a line. */
const answer = (lines: string[], n = 1) => ({ id: `r${n}`, text: lines.join("\n"), citations: [], functionCalls: [], searchQueries: [], usage: { model: "muse-spark-1.3", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, searches: 1 }, costUsd: 0, raw: {} }) as never;

/** A web search answering each call with its own lines, recording what it was asked. */
const searching = (answers: string[][], calls: Record<string, unknown>[] = []): Meta => ({
  responses: async (body) => {
    calls.push(body);
    return answer(answers[calls.length - 1] ?? [], calls.length);
  },
});

/** Looks that pass exactly the photos named. */
const passing = (good: string[]) => async (url: string) => {
  const ok = good.includes(url);
  const fits = [ok ? "the wish" : "None of these, or can't tell"];
  return { seen: ok ? "the wish" : "something else", fits: [fits, fits], quality: "studio", clean: true, ok } as PhotoVerdict;
};

describe("a maker's own photo when its pages turn our server away", () => {
  it("names Louis Vuitton's product photo from the code its product address ends in, on any country's site", () => {
    expect(brandPhotos(LV_PAGE)).toEqual([LV_SHOT]);
    expect(brandPhotos("https://en.louisvuitton.com/eng-nl/products/christopher-mm-damier-other-nvprod4900059v/N40564?dispatchCountry=NL")).toEqual([LV_SHOT]);
    expect(brandPhotos("https://fr.louisvuitton.com/fra-fr/products/christopher-mm-taurillon-monogram-nvprod5170035v/M24428/")).toEqual([LV_SHOT.replace("N40564", "M24428")]);
    // Not a product page, no code, a lower-case last word, or another site: nothing.
    for (const other of [
      "https://us.louisvuitton.com/eng-us/women/handbags/_/N-tfr7qdp",
      "https://us.louisvuitton.com/eng-us/products/christopher-mm",
      "https://us.louisvuitton.com/eng-us/products/christopher-mm-damier-other-abcdef",
      "https://us.louisvuitton.com/eng-us/products/christopher-mm-100000",
      "https://fake-louisvuitton.com/products/christopher-mm-N40564",
      "https://louisvuitton.example.com/products/christopher-mm-N40564",
      "not an address",
    ])
      expect([other, brandPhotos(other)]).toEqual([other, []]);
  });

  it("puts that photo among the priced page's candidates, where it stands only once the looks pass it", async () => {
    const opts = { fetcher: web(), pages: [LV_PAGE], plan: Promise.resolve(lvPlan), webPhotos: async () => [] };
    expect(await findPhoto(searching([]), lv, { ...opts, verify: passing([LV_SHOT]) })).toMatchObject({ how: "page", image: { url: LV_SHOT, source: "us.louisvuitton.com" } });
    expect(await findPhoto(searching([]), lv, { ...opts, verify: passing([]) })).toBeNull();
  });

  it("takes it from the maker's product pages a web search names, without searching again", async () => {
    const calls: Record<string, unknown>[] = [];
    const meta = searching([[LV_PAGE, "https://en.louisvuitton.com/eng-e1/products/christopher-mm-damier-other-N40564"]], calls);
    expect(await webPhotoUrls(meta, lvPlan.web, lv, web(), Date.now() + 60_000, { identity: lvPlan.identity, official: "louisvuitton.com" })).toEqual([LV_SHOT]);
    expect(calls).toHaveLength(1);
  });
});

describe("a second web search when every page named turned us away", () => {
  it("leaves those sites out, in its words and in what it opens, and keeps what other shops show", async () => {
    const calls: Record<string, unknown>[] = [];
    const opened: string[] = [];
    const tally = photoTally();
    const meta = searching([[HERMES], [HERMES_FR, RESALE]], calls);
    const got = await webPhotoUrls(meta, "Hermes Birkin 30 Etoupe Togo", birkin, web(opened), Date.now() + 60_000, { identity: birkin.title, official: "www.hermes.com", trace: tally.trace });
    expect(got).toEqual([RESALE_SHOT]);
    expect(calls).toHaveLength(2);
    expect(String(calls[1]!.instructions)).toContain("Our server can't read hermes.com, so leave those sites out.");
    expect(calls[1]).toMatchObject({ tools: [{ type: "web_search" }], max_tool_calls: 1 });
    // Hermès' French page from the second answer was never opened.
    expect(opened).not.toContain(HERMES_FR);
    // The log line counts both searches: 1 named + 1 read (refused), then 1 named + 1 read (opened, 1 photo).
    expect(tally.seen.web).toEqual({ said: 2, read: 2, readOk: 1, photos: 1 });
  });

  it("doesn't search again when the first gave a photo, named no page, the wish isn't a thing to buy, or under 25 s are left", async () => {
    const trip = { title: "A week at Amanzoe", kind: "visit" as const };
    for (const [answers, by, subject] of [
      [[[RESALE]], Date.now() + 60_000, birkin],
      [[[]], Date.now() + 60_000, birkin],
      [[[HERMES]], Date.now() + 60_000, trip],
      [[[HERMES]], Date.now() + 22_000, birkin],
    ] as const) {
      const calls: Record<string, unknown>[] = [];
      await webPhotoUrls(searching(answers.map((a) => [...a]), calls), "Hermes Birkin 30", subject, web(), by, { official: "hermes.com" });
      expect([subject.kind, by - Date.now() > 30_000, calls.length]).toEqual([subject.kind, by - Date.now() > 30_000, 1]);
    }
  });

  it("keeps the looks' time free: a second search that never answers is given up with LOOKS_MS still left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const by = Date.now() + 40_000;
      const calls: Record<string, unknown>[] = [];
      const meta: Meta = { responses: async (body) => (calls.push(body) === 1 ? answer([HERMES]) : new Promise(() => undefined)) };
      let doneAt = 0;
      const got = webPhotoUrls(meta, "Hermes Birkin 30", birkin, web(), by, { official: "hermes.com" }).then((r) => ((doneAt = Date.now()), r));
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await got).toEqual([]);
      expect(calls).toHaveLength(2);
      expect(by - doneAt).toBeGreaterThanOrEqual(LOOKS_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the maker's photo when checking it ran out of time rather than failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      // The image takes 7 s; its check gets 6, and the second search still has time to run.
      const slow = (async (input: string | URL, init?: RequestInit) => {
        if (String(input) === LV_SHOT) await new Promise((r) => setTimeout(r, 7_000));
        return web()(input, init);
      }) as unknown as typeof fetch;
      const calls: Record<string, unknown>[] = [];
      const got = webPhotoUrls(searching([[LV_PAGE], []], calls), lvPlan.web, lv, slow, Date.now() + 40_000, { identity: lvPlan.identity, official: "louisvuitton.com" });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await got).toEqual([LV_SHOT]);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches again when the maker's photo doesn't open, keeping the maker's other photos it names", async () => {
    const calls: Record<string, unknown>[] = [];
    const meta = searching([[LV_PAGE], [LV_OTHER_PAGE, RESALE]], calls);
    const got = await webPhotoUrls(meta, lvPlan.web, lv, web([], { lvMissing: true }), Date.now() + 60_000, { identity: lvPlan.identity, official: "louisvuitton.com" });
    expect(calls).toHaveLength(2);
    // The image server's photo from the second answer stays though the site refused us; the one that 404ed doesn't.
    expect(got).toEqual([LV_OTHER_SHOT, RESALE_SHOT]);
  });

  it("knows a site by its name, whatever its country: us. and fr. are one site, two shops on .co.uk are two", () => {
    expect(siteOf("us.louisvuitton.com")).toBe(siteOf("fr.louisvuitton.com"));
    expect(siteOf("www.harrods.co.uk")).toBe("harrods.co.uk");
    expect(siteOf("www.selfridges.co.uk")).not.toBe(siteOf("www.harrods.co.uk"));
  });
});
