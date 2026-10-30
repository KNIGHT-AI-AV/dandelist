import { describe, expect, it, vi } from "vitest";

// Image hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import type { Draft, Meta, PriceOption } from "../src/agent/agent";
import { mergeFast } from "../src/agent/find";
import { wikimediaRendering } from "../src/agent/media";
import { checkPhoto, findPhoto, gradeOf, openversePhotos, verifyPhoto, wikipediaLeadPhotos, type FoundPhoto, type PhotoPlan, type PhotoVerdict } from "../src/agent/photos";
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

/** A plan the photo search would get from the model for the Leica. */
const leicaPlan = (o: Partial<PhotoPlan> = {}): PhotoPlan => ({ identity: "Leica Q3 camera", lookalikes: ["Leica Q2 camera", "Leica M11 camera"], exact: true, official: "leica-camera.com", articles: ["Leica Q3"], commons: "", web: "Leica Q3 maker photo", kind: "product", ...o });
/** Looks that pass exactly the photos named, and record what they were asked. */
const passing = (good: string[], asked: string[] = []) => async (url: string) => {
  asked.push(url);
  const ok = good.includes(url);
  const fits = [ok ? "Leica Q3 camera" : "None of these, or can't tell"];
  return { seen: ok ? "Leica Q3" : "another camera", fits: [fits, fits], quality: "studio", clean: true, ok } as PhotoVerdict;
};

describe("the photo search (owner, 2026-10-29: 'Not any photo will do!!', 'right 99% of time')", () => {
  const leads = { "Leica Q3": { source: BIG, width: 5184, height: 3456 } };

  it("shows a photo only when the vision checks pass it, and no photo rather than a wrong one", async () => {
    const web = imagesAt({ [BIG]: [5184, 3456], [MAKER]: [2400, 1600] }, wikipedia(leads));
    const webPhotos = vi.fn(async () => [MAKER]);
    const found = await findPhoto(planMeta(leicaPlan()), leica, { fetcher: web, webPhotos, verify: passing([BIG]) });
    expect(found).toMatchObject({ how: "wikipedia", image: { url: BIG, credit: "Wikipedia: Leica Q3" }, verdict: { ok: true } });
    expect(await findPhoto(planMeta(leicaPlan()), leica, { fetcher: web, webPhotos, verify: passing([]) })).toBeNull();
  });

  it("looks first, for a thing, at the page it was priced on and then the maker's photo, every time", async () => {
    const PAGE = "https://dealer.example/leica-q3";
    const SHOT = "https://dealer.example/img/leica-q3-front.jpg";
    const html = `<html><head><title>Leica Q3</title><meta property="og:image" content="${SHOT}"><script type="application/ld+json">{"@type":"Product","name":"Leica Q3","image":"${SHOT}","offers":{"price":"5995","priceCurrency":"USD"}}</script></head><body>Leica Q3</body></html>`;
    const web = imagesAt({ [BIG]: [5184, 3456], [MAKER]: [2400, 1600], [SHOT]: [2000, 2000] }, (u) => (u === PAGE ? new Response(html, { headers: { "content-type": "text/html" } }) : wikipedia(leads)(u)));
    const webPhotos = vi.fn(async () => [MAKER]);
    const asked: string[] = [];
    const found = await findPhoto(planMeta(leicaPlan()), leica, { fetcher: web, webPhotos, pages: [PAGE], verify: passing([SHOT, MAKER, BIG], asked) });
    // All three passed; the page's own photo wins by its place in the order.
    expect(found).toMatchObject({ how: "page", image: { url: SHOT } });
    expect([...asked].sort()).toEqual([SHOT, MAKER, BIG].sort());
    // The maker's photo when the page has none that passes; the web is searched on every hunt for a thing.
    const maker = await findPhoto(planMeta(leicaPlan()), leica, { fetcher: web, webPhotos, verify: passing([MAKER, BIG]) });
    expect(maker).toMatchObject({ how: "web", image: { url: MAKER, source: "leica-camera.com" } });
    expect(webPhotos).toHaveBeenCalledWith("Leica Q3 maker photo", leica, expect.objectContaining({ identity: "Leica Q3 camera" }));
  });

  it("starts a place with Commons and Wikipedia, with the web searched beside them for a venue's own photos", async () => {
    const lisbon = { title: "A week in Lisbon", kind: "visit" as const, place: "Lisbon" };
    const LISBON = "https://upload.wikimedia.org/wikipedia/commons/l/li/Lisbon_view.jpg";
    const web = imagesAt({ [LISBON]: [4000, 2600], [MAKER]: [2400, 1600] }, wikipedia({ Lisbon: { source: LISBON, width: 4000, height: 2600 } }));
    const webPhotos = vi.fn(async () => [MAKER]);
    const plan = leicaPlan({ identity: "Lisbon", exact: false, official: "", articles: ["Lisbon"], web: "Lisbon view", kind: "place" });
    // Both pass; for a place the encyclopedia's photo comes first.
    expect(await findPhoto(planMeta(plan), lisbon, { fetcher: web, webPhotos, verify: passing([LISBON, MAKER]) })).toMatchObject({ how: "wikipedia", kind: "place" });
    expect(webPhotos).toHaveBeenCalledOnce();
    // With nothing on Commons or Wikipedia, the web's photo stands.
    expect(await findPhoto(planMeta(plan), lisbon, { fetcher: web, webPhotos, verify: passing([MAKER]) })).toMatchObject({ how: "web" });
  });

  it("on a retake, looks at the photo turned down beside the search, and holds every new photo up against it", async () => {
    const calls: Record<string, unknown>[] = [];
    const web = imagesAt({ [BIG]: [5184, 3456], [MAKER]: [2400, 1600] }, wikipedia(leads));
    const asked: string[] = [];
    const lineUps: PhotoPlan[] = [];
    const looks = passing([MAKER], asked);
    const verify = async (url: string, plan: PhotoPlan) => (lineUps.push(plan), looks(url));
    const found = await findPhoto(planMeta(leicaPlan(), calls), leica, { fetcher: web, deep: true, exclude: [BIG], webPhotos: async () => [MAKER], verify });
    expect(asked[0]).toBe(BIG);
    expect(found?.image.url).toBe(MAKER);
    // The new photo's line-up leads with what the turned-down one showed.
    expect(lineUps.at(-1)!.lookalikes[0]).toBe("What the photo turned down showed: another camera");
    // The plan doesn't wait for those looks, and thinks low like every other call.
    const plan = calls.find((c) => (c.text as { format?: { name?: string } } | undefined)?.format?.name === "photo_plan")!;
    expect(plan.model).toBeUndefined();
    expect((plan.reasoning as { effort?: string }).effort).toBe("low");
  });

  it("plans from the wish's own title when the model can't, and gives up with null when nothing passes", async () => {
    const broken: Meta = { responses: async () => ({ text: "not json", citations: [], functionCalls: [], searchQueries: [], raw: {} }) as never };
    const web = imagesAt({ [BIG]: [5184, 3456] }, wikipedia({ "Leica Q3": { source: BIG, width: 5184, height: 3456 } }));
    expect((await findPhoto(broken, leica, { fetcher: web, webPhotos: async () => [], verify: passing([BIG]) }))?.image.url).toBe(BIG);
    expect(await findPhoto(broken, { ...leica, title: "Nothing known" }, { fetcher: imagesAt({}, () => Response.json({ query: {} })), webPhotos: async () => [], verify: passing([]) })).toBeNull();
  });
});

describe("the two looks: a line-up, twice", () => {
  /** The line-up one look was shown: each option's letter and text, in order. */
  const lineUp = (body: Record<string, unknown>) =>
    String((body.input as { content: { text?: string }[] }[])[0]!.content[0]!.text)
      .split("\n")
      .slice(1)
      .map((line) => /^([A-F])\. (.*)$/.exec(line)!)
      .map((m) => ({ letter: m[1]!, text: m[2]! }));
  /**
   * A model that finds the photo fits what it is told in each look ("|" between options nothing visible tells apart;
   * the last option when none of them is in the line-up), rated as told.
   */
  const looker = (sees: string[], rating: { quality?: string; clean?: boolean; subject?: boolean } = {}, calls: Record<string, unknown>[] = []): Meta => ({
    responses: async (body) => {
      const n = calls.push(body) - 1;
      const options = lineUp(body);
      const seen = sees[n % sees.length]!;
      const fits = options.filter((o) => seen.split("|").includes(o.text)).map((o) => o.letter);
      return { id: "r", text: JSON.stringify({ seen, fits: fits.length ? fits : [options.at(-1)!.letter], subject: rating.subject ?? true, quality: rating.quality ?? "studio", clean: rating.clean ?? true }), citations: [], functionCalls: [], searchQueries: [], raw: {} } as never;
    },
  });
  const plan = { identity: "Rolex Sky-Dweller, mint green dial", exact: true, lookalikes: ["Rolex Oyster Perpetual 41, green dial", "Rolex Sky-Dweller, blue dial"] };
  const WISH = plan.identity;

  it("passes a photo only when both looks pick the wish, never told which option is wanted, thinking low", async () => {
    const calls: Record<string, unknown>[] = [];
    expect(await verifyPhoto(looker([WISH], {}, calls), BIG, plan)).toMatchObject({ ok: true, fits: [[WISH], [WISH]], quality: "studio" });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      // Every option, the wish among its lookalikes, with "none" last; the instructions never name the wish.
      expect(lineUp(c).map((o) => o.text).sort()).toEqual([...plan.lookalikes, WISH, "None of these, or can't tell"].sort());
      expect(lineUp(c).at(-1)!.text).toBe("None of these, or can't tell");
      expect(String(c.instructions)).not.toContain("Sky-Dweller");
      expect(JSON.stringify(c.input)).toContain(BIG);
      expect((c.reasoning as { effort?: string } | undefined)?.effort).toBe("low");
    }
    // The wish sits in a different place in each look.
    expect(lineUp(calls[0]!).findIndex((o) => o.text === WISH)).not.toBe(lineUp(calls[1]!).findIndex((o) => o.text === WISH));
  });

  it("turns down a lookalike, a photo neither look can place, and a photo the two looks disagree on", async () => {
    const op = "Rolex Oyster Perpetual 41, green dial";
    expect(await verifyPhoto(looker([op]), BIG, plan)).toMatchObject({ ok: false, fits: [[op], [op]] });
    expect((await verifyPhoto(looker(["a dive watch"]), BIG, plan)).fits).toEqual([["None of these, or can't tell"], ["None of these, or can't tell"]]);
    expect((await verifyPhoto(looker([WISH, "Rolex Sky-Dweller, blue dial"]), BIG, plan)).ok).toBe(false);
    // "None" beside the wish is no answer.
    expect((await verifyPhoto(looker([`${WISH}|None of these, or can't tell`]), BIG, plan)).ok).toBe(false);
  });

  it("keeps a photo when nothing visible tells the wish from a lookalike (a Leica Q2 and a Q3 face on)", async () => {
    const same = `${WISH}|Rolex Sky-Dweller, blue dial`;
    expect(await verifyPhoto(looker([same]), BIG, plan)).toMatchObject({ ok: true });
  });

  it("holds the broad form beside the wish, so the model in another colour can stand in (owner, 2026-10-30)", async () => {
    const pink = { identity: "Mercedes-Benz G-Class in pink", broad: "Mercedes-Benz G-Class in any colour", exact: true, lookalikes: ["Land Rover Defender 110"] };
    const calls: Record<string, unknown>[] = [];
    const silver = await verifyPhoto(looker([pink.broad], {}, calls), BIG, pink);
    // The broad form is one more unmarked option in each look.
    expect(lineUp(calls[0]!).map((o) => o.text).sort()).toEqual([pink.identity, pink.broad, ...pink.lookalikes, "None of these, or can't tell"].sort());
    expect(silver).toMatchObject({ ok: false, exact: false, near: true });
    expect(await verifyPhoto(looker([`${pink.identity}|${pink.broad}`]), BIG, pink)).toMatchObject({ ok: true, exact: true, near: true });
    expect(await verifyPhoto(looker(["Land Rover Defender 110"]), BIG, pink)).toMatchObject({ exact: false, near: false });
  });

  it("never passes a photo whose subject is something else: a portrait of the owner, the back of a card", async () => {
    expect(await verifyPhoto(looker([WISH], { subject: false }), BIG, plan)).toMatchObject({ ok: false, exact: false, near: false });
  });

  it("turns down an amateur snapshot or a crowded photo even when both looks pick the wish", async () => {
    expect((await verifyPhoto(looker([WISH], { quality: "amateur" }), BIG, plan)).ok).toBe(false);
    expect((await verifyPhoto(looker([WISH], { clean: false }), BIG, plan)).ok).toBe(false);
    expect(await verifyPhoto(looker([WISH], { quality: "editorial" }), BIG, plan)).toMatchObject({ ok: true, quality: "editorial" });
  });

  it("sends the model the photo's bytes, read by our server, asking Wikimedia for its 1280 px rendering first", async () => {
    const RENDERED = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Leica_Q3.jpg/1280px-Leica_Q3.jpg";
    expect(wikimediaRendering(BIG, 1280)).toBe(RENDERED);
    expect(wikimediaRendering("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Leica_Q3.jpg/3840px-Leica_Q3.jpg", 1280)).toBe(RENDERED);
    expect(wikimediaRendering(MAKER, 1280)).toBeNull();
    const asked: string[] = [];
    const sizes = imagesAt({ [RENDERED]: [1280, 853], [BIG]: [5184, 3456] });
    const web = (async (input: string | URL, init?: RequestInit) => (asked.push(String(input)), sizes(input, init))) as unknown as typeof fetch;
    const calls: Record<string, unknown>[] = [];
    expect((await verifyPhoto(looker([WISH], {}, calls), BIG, plan, { fetcher: web })).ok).toBe(true);
    expect(asked[0]).toBe(RENDERED);
    for (const c of calls) {
      expect(JSON.stringify(c.input)).toContain("data:image/jpeg;base64,");
      expect(JSON.stringify(c.input)).not.toContain(BIG);
    }
    // Without a rendering, the photo itself; with nothing readable, the address for the model to fetch.
    expect(await verifyPhoto(looker([WISH]), MAKER, plan, { fetcher: imagesAt({ [MAKER]: [2400, 1600] }) })).toMatchObject({ ok: true });
    const fallback: Record<string, unknown>[] = [];
    await verifyPhoto(looker([WISH], {}, fallback), MAKER, plan, { fetcher: imagesAt({}) });
    expect(JSON.stringify(fallback[0]!.input)).toContain(MAKER);
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

describe("a photo for anything anyone wishes for (owner, 2026-10-30: 'it needs to work for literally anything')", () => {
  const verdict = (o: Partial<PhotoVerdict>): PhotoVerdict => ({ seen: "", fits: [], quality: "editorial", clean: true, ok: false, ...o });

  it("grades the very thing above its broad form, and a small photo below both", () => {
    expect(gradeOf(verdict({ ok: true, exact: true, near: true, quality: "studio" }), 1200)).toBe(1);
    // The very thing, but a snapshot, or 500 px: still shown, below a well-taken one.
    expect(gradeOf(verdict({ exact: true, near: true, quality: "amateur" }), 1200)).toBe(2);
    expect(gradeOf(verdict({ ok: true, exact: true, near: true }), 500)).toBe(2);
    expect(gradeOf(verdict({ near: true }), 1200)).toBe(3);
    expect(gradeOf(verdict({ near: true, quality: "amateur" }), 1200)).toBe(4);
    expect(gradeOf(verdict({ ok: true, exact: true, near: true }), 260)).toBe(5);
    // The wrong thing never shows, however well taken.
    expect(gradeOf(verdict({ quality: "studio" }), 3000)).toBe(0);
  });

  const SILVER = "https://upload.wikimedia.org/wikipedia/commons/g/gc/G-Class_silver.jpg";
  const PINK = "https://dealer.example/img/pink-g63.jpg";
  const BOX = "https://upload.wikimedia.org/wikipedia/en/s/se/Stadium_Events_box.jpg";
  const gClass = { title: "Mercedes-Benz G-Class", kind: "own" as const, summary: "The wish is for a pink Mercedes-Benz G-Class." };
  const pinkPlan = leicaPlan({ identity: "Mercedes-Benz G-Class in pink", broad: "Mercedes-Benz G-Class in any colour", articles: ["Mercedes-Benz G-Class"], web: "pink G-Class", kind: "vehicle" });
  const looks = (grades: Record<string, Partial<PhotoVerdict>>) => async (url: string) => verdict(grades[url] ?? {});

  it("shows the model in another colour when no photo of the colour asked for passes, and the colour when one does", async () => {
    const web = imagesAt({ [SILVER]: [3000, 2000], [PINK]: [1600, 1000] }, wikipedia({ "Mercedes-Benz G-Class": { source: SILVER, width: 3000, height: 2000 } }));
    const silverOnly = await findPhoto(planMeta(pinkPlan), gClass, { fetcher: web, webPhotos: async () => [], verify: looks({ [SILVER]: { near: true } }) });
    expect(silverOnly).toMatchObject({ how: "wikipedia", grade: 3, image: { url: SILVER } });
    const both = await findPhoto(planMeta(pinkPlan), gClass, { fetcher: web, webPhotos: async () => [PINK], verify: looks({ [SILVER]: { near: true }, [PINK]: { ok: true, exact: true, near: true } }) });
    expect(both).toMatchObject({ how: "web", grade: 1, image: { url: PINK } });
  });

  it("shows a game's small box art only when nothing larger passes", async () => {
    const plan = leicaPlan({ identity: "Stadium Events for the NES, sealed", broad: "the Stadium Events NES game, its box or cartridge", articles: ["Stadium Events"], web: "Stadium Events box" });
    const game = { title: "Stadium Events", kind: "buy" as const };
    const web = imagesAt({ [BOX]: [260, 375], [MAKER]: [2400, 1600] }, wikipedia({ "Stadium Events": { source: BOX, width: 260, height: 375 } }));
    expect(await findPhoto(planMeta(plan), game, { fetcher: web, webPhotos: async () => [], verify: looks({ [BOX]: { near: true } }) })).toMatchObject({ grade: 5, image: { url: BOX } });
    expect(await findPhoto(planMeta(plan), game, { fetcher: web, webPhotos: async () => [MAKER], verify: looks({ [BOX]: { near: true }, [MAKER]: { near: true } }) })).toMatchObject({ grade: 3, image: { url: MAKER } });
  });

  it("reads Openverse's openly licensed photos with their credit, and gives nothing when it is down", async () => {
    const api = (async (input: string | URL) => {
      const u = new URL(String(input));
      expect(u.origin + u.pathname).toBe("https://api.openverse.org/v1/images/");
      expect(u.searchParams.get("q")).toBe("tiny house");
      return Response.json({
        results: [
          { url: "https://live.staticflickr.com/1/tiny.jpg", title: "Tiny house", creator: "Ann", license: "by", license_version: "2.0", source: "flickr", foreign_landing_url: "https://flickr.com/p/1", width: 2048, height: 1365 },
          { url: "https://live.staticflickr.com/2/thumb.jpg", width: 240, height: 160 },
          { url: "http://insecure.example/a.jpg" },
        ],
      });
    }) as unknown as typeof fetch;
    expect(await openversePhotos("tiny house", api)).toEqual([{ url: "https://live.staticflickr.com/1/tiny.jpg", title: "Tiny house", credit: "Ann", license: "CC BY 2.0", page: "https://flickr.com/p/1" }]);
    const down = (async () => new Response("<html>Server Error (500)</html>", { status: 500 })) as unknown as typeof fetch;
    expect(await openversePhotos("tiny house", down)).toEqual([]);
  });
});
