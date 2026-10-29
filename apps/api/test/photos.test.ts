import { describe, expect, it, vi } from "vitest";

// Image hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import type { Draft, Meta, PriceOption } from "../src/agent/agent";
import { mergeFast } from "../src/agent/find";
import { checkPhoto, findPhoto, wikipediaLeadPhotos, type FoundPhoto } from "../src/agent/photos";
import { imageResponse, jpegHeader, pngHeader } from "./images";

/**
 * Photos always come (owner, 2026-10-29): a photo check, a photo search the model plans with the wish's context, and a
 * retake that never offers a photo already shown.
 */

const BIG = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Leica_Q3.jpg";
const SMALL = "https://upload.wikimedia.org/wikipedia/commons/s/sm/Leica_Q3_small.jpg";
const MAP = "https://upload.wikimedia.org/wikipedia/commons/m/mp/Malta_location_map.jpg";
const GENERAL = "https://upload.wikimedia.org/wikipedia/commons/c/ca/Digital_camera.jpg";
const MAKER = "https://leica-camera.com/media/q3-front.jpg";

/** A web where these images open at these sizes; anything else is not an image. */
const imagesAt = (sizes: Record<string, [number, number]>, api?: (u: string) => Response | null) =>
  (async (input: string | URL) => {
    const u = String(input);
    const viaApi = api?.(u);
    if (viaApi) return viaApi;
    const size = sizes[u];
    return size ? imageResponse(jpegHeader(size[0], size[1]), "image/jpeg") : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

/** Wikipedia's API answering the lead photo of each article it knows, through a redirect and a normalised title. */
const wikipedia = (leads: Record<string, { source: string; width: number; height: number }>) => (u: string) => {
  if (!u.startsWith("https://en.wikipedia.org/w/api.php")) return null;
  const titles = (new URL(u).searchParams.get("titles") ?? "").split("|");
  const normalized = titles.filter((t) => t[0] !== t[0]!.toUpperCase()).map((t) => ({ from: t, to: t[0]!.toUpperCase() + t.slice(1) }));
  const redirects = titles.includes("Q3 (camera)") ? [{ from: "Q3 (camera)", to: "Leica Q3" }] : [];
  const pages: Record<string, unknown> = {};
  let i = 1;
  for (const [title, original] of Object.entries(leads)) pages[String(i++)] = { title, original };
  return Response.json({ query: { normalized, redirects, pages } });
};

const planMeta = (plan: object, calls: Record<string, unknown>[] = []): Meta => ({
  responses: async (body) => {
    calls.push(body);
    return { id: "r1", text: JSON.stringify(plan), citations: [], functionCalls: [], searchQueries: [], usage: { model: "muse-spark-1.3", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, searches: 0 }, costUsd: 0, raw: {} } as never;
  },
});

const leica = { title: "Leica Q3", kind: "buy" as const, summary: "A Leica Q3 camera." };

describe("the photo check", () => {
  it("passes a large photograph and says why anything else fails", async () => {
    const web = imagesAt({ [BIG]: [3000, 2000], [SMALL]: [320, 240], [MAP]: [2000, 2000] });
    expect(await checkPhoto(BIG, web)).toMatchObject({ ok: true, width: 3000, height: 2000, reasons: [] });
    expect((await checkPhoto(SMALL, web)).reasons).toEqual(["too small (320 x 240)"]);
    // A map is refused by its name, before anything is fetched.
    expect((await checkPhoto(MAP, web)).reasons).toEqual(["named like a logo, map, flag or diagram"]);
    expect((await checkPhoto("https://example.com/brand-logo.png", web)).ok).toBe(false);
    expect((await checkPhoto(BIG, web, { exclude: [`${BIG}?width=800`] })).reasons).toEqual(["already shown"]);
    expect((await checkPhoto("https://example.com/missing.jpg", web)).reasons).toEqual(["didn't open as an image"]);
    const strip = imagesAt({ "https://example.com/banner-wide.jpg": [3000, 600], "https://example.com/strip.jpg": [3000, 900] });
    expect((await checkPhoto("https://example.com/strip.jpg", strip)).reasons).toEqual(["a strip, not a photo"]);
  });

  it("refuses an animation even when it is large", async () => {
    const gif = (async () => new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]), { status: 200, headers: { "content-type": "image/gif" } })) as unknown as typeof fetch;
    expect((await checkPhoto("https://example.com/spin.jpg", gif)).reasons).toContain("an animation, not a photo");
  });

  it("lets a large cut-out PNG through", async () => {
    const png = (async () => imageResponse(pngHeader(1600, 1600), "image/png")) as unknown as typeof fetch;
    expect((await checkPhoto("https://example.com/q3-cutout.png", png)).ok).toBe(true);
  });
});

describe("Wikipedia's lead photos", () => {
  it("keeps the order asked for, through redirects and normalised titles", async () => {
    const api = imagesAt({}, wikipedia({ "Digital camera": { source: GENERAL, width: 2000, height: 1500 }, "Leica Q3": { source: `${BIG}?utm_source=en.wikipedia.org`, width: 5184, height: 3456 } }));
    const leads = await wikipediaLeadPhotos(["Q3 (camera)", "digital camera"], api);
    expect(leads.map((l) => [l.title, l.url])).toEqual([
      ["Leica Q3", BIG],
      ["Digital camera", GENERAL],
    ]);
  });
});

describe("the photo search", () => {
  const leads = { "Leica Q3": { source: BIG, width: 5184, height: 3456 }, "Digital camera": { source: GENERAL, width: 2000, height: 1500 } };

  it("takes the most specific article's photo that passes the check, with no web search", async () => {
    const calls: Record<string, unknown>[] = [];
    const web = imagesAt({ [BIG]: [5184, 3456], [GENERAL]: [2000, 1500] }, wikipedia(leads));
    const found = await findPhoto(planMeta({ articles: ["Leica Q3", "Digital camera"], commons: "Leica Q3", web: "Leica Q3 official photo", kind: "product" }, calls), leica, { fetcher: web });
    expect(found).toMatchObject({ how: "wikipedia", kind: "product", image: { url: BIG, source: "wikipedia.org", credit: "Wikipedia: Leica Q3" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tools).toBeUndefined();
    expect(String(calls[0]!.input)).toContain("Leica Q3");
  });

  it("falls back to the general article when the specific photo fails the check, and never re-offers one shown", async () => {
    const web = imagesAt({ [BIG]: [320, 200], [GENERAL]: [2000, 1500] }, wikipedia(leads));
    const plan = { articles: ["Leica Q3", "Digital camera"], commons: "", web: "", kind: "product" };
    expect((await findPhoto(planMeta(plan), leica, { fetcher: web }))?.image.url).toBe(GENERAL);
    const big = imagesAt({ [BIG]: [5184, 3456], [GENERAL]: [2000, 1500] }, wikipedia(leads));
    expect((await findPhoto(planMeta(plan), leica, { fetcher: big, exclude: [BIG] }))?.image.url).toBe(GENERAL);
  });

  it("looks on the web first for a thing on a retake, and Commons first for a place", async () => {
    const web = imagesAt({ [BIG]: [5184, 3456], [MAKER]: [2400, 1600] }, wikipedia(leads));
    const webPhotos = vi.fn(async () => [MAKER]);
    const retake = await findPhoto(planMeta({ articles: ["Leica Q3"], commons: "", web: "Leica Q3 maker photo", kind: "product" }), leica, { fetcher: web, deep: true, webPhotos });
    expect(retake).toMatchObject({ how: "web", image: { url: MAKER, source: "leica-camera.com" } });
    expect(webPhotos).toHaveBeenCalledWith("Leica Q3 maker photo", leica);
    // Without deep, the web is never searched.
    const everyday = await findPhoto(planMeta({ articles: ["Leica Q3"], commons: "", web: "x", kind: "product" }), leica, { fetcher: web, webPhotos });
    expect(everyday?.how).toBe("wikipedia");
    expect(webPhotos).toHaveBeenCalledTimes(1);
  });

  it("reads the wish's own title when the model can't plan, and gives up with null when nothing passes", async () => {
    const broken: Meta = { responses: async () => ({ text: "not json", citations: [], functionCalls: [], searchQueries: [], raw: {} }) as never };
    const web = imagesAt({ [BIG]: [5184, 3456] }, wikipedia({ "Leica Q3": { source: BIG, width: 5184, height: 3456 } }));
    expect((await findPhoto(broken, leica, { fetcher: web }))?.image.url).toBe(BIG);
    expect(await findPhoto(broken, { ...leica, title: "Nothing known" }, { fetcher: imagesAt({}, () => Response.json({ query: {} })) })).toBeNull();
  });
});

describe("a card always carries a photo", () => {
  const home: Draft = { title: "A sea-view villa in Malta", kind: "own", summary: "A villa with a pool.", specifics: [{ name: "location", value: "Malta" }], region: "MT", currency: "EUR", unknowns: [] };
  const option = (o: Partial<PriceOption> = {}): PriceOption =>
    ({ label: "Villa", seller: "Agency", url: "https://agency.example/villa", upfrontCents: 195_000_000, recurring: [], status: "estimate", statusLabel: "Estimate", evidence: "", confidence: "medium", checkedAt: "2026-10-29T08:00:00Z", totals: { monthlyCents: 0, horizonCents: 195_000_000, spreadMonthlyCents: 0 }, ...o }) as PriceOption;
  const found: FoundPhoto = { image: { url: "https://upload.wikimedia.org/malta.jpg", width: 3840, height: 2560, source: "commons.wikimedia.org" }, kind: "place", how: "commons" };

  it("gives a home or a service the photo search's pick when nothing else has a photo", () => {
    const merged = mergeFast(home, { options: [option()], explanation: "", note: "", horizonYears: 5 }, null, null, found);
    expect(merged.options[0]).toMatchObject({ imageUrl: found.image.url, media: { kind: "place", images: [found.image] } });
  });

  it("keeps an option's own photo, and the fast card's or the stand-in before the search's", () => {
    const own = mergeFast(home, { options: [option({ imageUrl: "https://agency.example/villa.jpg" })], explanation: "", note: "", horizonYears: 5 }, null, null, found);
    expect(own.options[0]!.imageUrl).toBe("https://agency.example/villa.jpg");
    const watch: Draft = { ...home, title: "A Rolex Submariner", kind: "buy" };
    const stand = { url: "https://archive.example/sub.jpg", source: "archive" };
    expect(mergeFast(watch, { options: [option()], explanation: "", note: "", horizonYears: 5 }, null, stand, found).options[0]!.imageUrl).toBe(stand.url);
  });
});
