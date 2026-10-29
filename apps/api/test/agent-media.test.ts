import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Meta, PriceOption, Step } from "../src/agent/agent";
import { findMakerPages, huntMedia, upscaleImage } from "../src/agent/hunt";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { memoryMediaStore } from "../src/media-store";
import { imageResponse, jpegHeader, productJpeg, webpHeader } from "./images";
import { visionReply } from "./vision";

/**
 * The agent with shopping search and media hunting: Apify, Sketchfab, Commons, SAM 3.1 and Muse Image are all
 * fakes that answer the way the real services do.
 */

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));

const SAM_TEXT = readFileSync(new URL("./fixtures/sam-camera.txt", import.meta.url), "utf8");
const BOX = { left: 145, top: 116, right: 1072, bottom: 805 };
const FRONT_JPG = productJpeg(1280, 960, BOX);
const LEICA = "https://leica-camera.com/q3";
const BH = "https://93.184.215.17/bh-q3";
const ADORAMA_LINK = "https://www.google.com/search?ibp=oshop&q=leica+q3&prds=catalogid:1";
const MODEL_UID = "4cef7c1e22ab40fd937507eae9a62cd8";
const FLIGHT = "https://www.flytap.com/en-us/flights/jfk-lis";
const HOTEL = "https://www.avenidapalace.com/rooms";
const FOOD_BLOG = "https://www.lisbon-food-blog.com/where-to-stay";
const HERMAN_MILLER = "https://store.hermanmiller.com/eames-lounge-chair";
const KITCHEN_BLOG = "https://www.thekitchn.com/eames-at-home";
const DWR = "https://93.184.215.18/dwr-eames";

const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });
const call = (id: string, name: string, args: unknown) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const option = (label: string, seller: string, url: string, price: number, parts: unknown[] = []) => ({ label, seller, url, currency: "USD", price, recurring: [], evidence: "", confidence: "high", parts });
const part = (label: string, kind: string, seller: string, url: string, unit_price: number, quantity: number, unit: string) => ({ label, kind, seller, url, currency: "USD", unit_price, quantity, unit, evidence: "" });

/** What the fake model says for each wish: its draft, its tool calls turn by turn, and its final options. */
const SCENARIOS = {
  camera: {
    draft: { title: "Leica Q3", kind: "buy", summary: "A Leica Q3 camera.", specifics: [{ name: "model", value: "Q3" }], region: "US", currency: "USD", unknowns: [] },
    turns: [[call("s1", "shopping_search", { query: "Leica Q3" }), call("m1", "find_3d_model", { query: "Leica Q3" })], [call("g1", "get_page", { url: LEICA })]],
    options: [option("Leica Q3 from Leica", "Leica Camera", LEICA, 6995), option("Leica Q3 at Adorama", "Adorama", ADORAMA_LINK, 6221), option("Leica Q3 at B&H", "B&H", BH, 6500)],
    media: { kind: "product", subject: "Leica Q3", noun: "camera" },
  },
  trip: {
    draft: { title: "A week in Lisbon", kind: "visit", summary: "Seven nights in Lisbon for two.", specifics: [{ name: "nights", value: "7" }], region: "US", currency: "USD", unknowns: [] },
    turns: [[call("g1", "get_page", { url: FLIGHT }), call("g2", "get_page", { url: HOTEL })]],
    options: [
      option("TAP flights and Avenida Palace", "TAP Air Portugal and Hotel Avenida Palace", HOTEL, 2500, [
        part("Return flights New York to Lisbon for 2", "flight", "TAP Air Portugal", FLIGHT, 1240, 1, "trip"),
        part("Hotel Avenida Palace, 7 nights", "lodging", "Hotel Avenida Palace", HOTEL, 180, 7, "night"),
      ]),
      option("TAP flights and a loft", "TAP Air Portugal and Lisbon Lofts", FOOD_BLOG, 1900, [
        part("Return flights New York to Lisbon for 2", "flight", "TAP Air Portugal", FLIGHT, 1240, 1, "trip"),
        part("Lisbon Lofts, 7 nights", "lodging", "Lisbon Lofts", FOOD_BLOG, 95, 7, "night"),
      ]),
      option("A package", "Expedia", "https://www.expedia.com/lisbon", 2000),
    ],
    media: { kind: "place", subject: "Lisbon", noun: "" },
  },
  chair: {
    draft: { title: "Eames Lounge Chair", kind: "buy", summary: "An Eames Lounge Chair.", specifics: [], region: "US", currency: "USD", unknowns: [] },
    turns: [[call("g1", "get_page", { url: KITCHEN_BLOG })]],
    options: [option("Eames Lounge Chair, quoted in a blog", "Herman Miller", KITCHEN_BLOG, 7795), option("Eames Lounge Chair at DWR", "Design Within Reach", DWR, 8000), option("Eames Lounge Chair", "Herman Miller", HERMAN_MILLER, 7795)],
    media: { kind: "product", subject: "Eames Lounge Chair", noun: "chair" },
  },
};
let scenario: keyof typeof SCENARIOS;

let metaCalls: Record<string, any>[];
let apifyCalls: number;
let researchTurn: number;

function reply(output: unknown[], usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 200 }) {
  return new Response(JSON.stringify({ id: `resp_${metaCalls.length}`, output, usage }), { status: 200 });
}

const fakeMeta = (async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, any>;
  metaCalls.push({ url, ...body });
  const s = SCENARIOS[scenario];
  if (url.endsWith("/images/generations")) {
    return new Response(JSON.stringify({ created: 1, output_format: "jpeg", data: [{ b64_json: jpegHeader(1920, 1280).toString("base64") }], usage: { input_tokens: 10, output_tokens: 10 } }));
  }
  if (body.model === "sam-3.1") return reply([message(SAM_TEXT)], { input_tokens: 0, output_tokens: 0, images_processed: 1 });
  const format = body.text?.format?.name;
  const vision = visionReply(body);
  if (vision !== null) return reply([message(vision)]);
  if (format === "wish_draft") return reply([message(JSON.stringify(s.draft))]);
  if ((body.tools ?? []).some((t: { name?: string }) => t.name === "ask_user")) return reply([message("READY")]);
  if (format === "price_options") return reply([message(JSON.stringify({ options: s.options, note: "", media: s.media }))]);
  if (format === "media_pick") return reply([message(JSON.stringify({ photos: [], model3d_uid: MODEL_UID }))]);
  if ((body.tools ?? []).some((t: { name?: string }) => t.name === "get_page")) return reply(s.turns[researchTurn++] ?? [message("Found them.")]);
  return reply([message("The first option is the one to pick.")]);
}) as unknown as typeof fetch;

const LEICA_HTML = `<html><head><title>Leica Q3 | Leica Camera</title>
<script type="application/ld+json">{"@type":"Product","name":"Leica Q3","image":["/img/q3-top.webp","/img/q3-front.jpg"],"offers":{"price":"6995.00","priceCurrency":"USD"}}</script>
</head><body>Leica Q3 $6,995.00</body></html>`;
const html = (title: string, body: string) => new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });

const fakeWeb = (async (url: string | URL) => {
  const u = String(url);
  if (u === LEICA) return new Response(LEICA_HTML, { headers: { "content-type": "text/html" } });
  if (u === FLIGHT) return html("Flights to Lisbon | TAP Air Portugal", "New York to Lisbon, 2 adults, round trip: $1,240.00 total");
  if (u === HOTEL) return html("Rooms | Hotel Avenida Palace", "Deluxe double from $180 per night");
  if (u === FOOD_BLOG) return html("Where to stay in Lisbon | A food blog", "We loved Lisbon Lofts: about $95 a night.");
  if (u === HERMAN_MILLER) return html("Eames Lounge Chair | Herman Miller Store", "Eames Lounge Chair and Ottoman $7,795.00");
  if (u === KITCHEN_BLOG) return html("The chair in our kitchen | The Kitchn", "We splurged: the Eames lounge chair is $7,795 at Herman Miller.");
  if (u.endsWith("/img/q3-front.jpg")) return imageResponse(FRONT_JPG, "image/jpeg");
  if (u.endsWith("/img/q3-top.webp")) return imageResponse(webpHeader("VP8X", 3000, 2000, true), "image/webp");
  if (u.endsWith("/shop/q3.jpg")) return imageResponse(jpegHeader(300, 300), "image/jpeg");
  if (u.startsWith("https://api.sketchfab.com/v3/search")) {
    return new Response(
      JSON.stringify({
        results: [
          { uid: MODEL_UID, name: "Leica Q3", user: { displayName: "Studio" }, license: { label: "CC Attribution" }, likeCount: 120, viewCount: 9000, thumbnails: { images: [{ url: "https://media.sketchfab.com/q3.jpg", width: 1024 }] } },
          { uid: "5ff13db8be984648b391f012a9a0525c", name: "Leica Q2", user: { displayName: "Other" }, likeCount: 12, viewCount: 400 },
        ],
      }),
    );
  }
  if (u.startsWith("https://commons.wikimedia.org/")) return new Response(JSON.stringify({ query: { pages: {} } }));
  return new Response("<html>Forbidden</html>", { status: 403, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

const fakeApify = (async () => {
  apifyCalls++;
  return new Response(
    JSON.stringify([
      { title: "Leica Q3 Digital Camera", source: "Adorama", price: "$6,221.00", imageUrl: "https://93.184.215.16/shop/q3.jpg", link: ADORAMA_LINK },
      { title: "Leica Q3", source: "leicacamerausa.com", price: "$6,995.00" },
    ]),
    { status: 201 },
  );
}) as unknown as typeof fetch;

let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;
let store: ReturnType<typeof memoryMediaStore>;
const clock = new Date("2026-10-27T12:00:00Z");

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  metaCalls = [];
  apifyCalls = 0;
  researchTurn = 0;
  scenario = "camera";
  store = memoryMediaStore("https://api.dandelist.test");
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: { apiKey: "test", fetch: fakeMeta },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: fakeWeb,
    apify: { token: "apify-test", dailyUsd: 0.15, fetch: fakeApify },
    media: { store, cutouts: true, generate: true, upscale: false, cutoutsPerDay: 5, imagesPerDay: 5 },
  });
});

const request = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function signIn(email: string) {
  await app.request("/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const res = await app.request("/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code: mail.at(-1)!.code }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const eventsOf = (steps: Step[]) => steps.flatMap((s) => (s.type === "note" && s.event ? [s.event.kind] : []));

async function runWish(token: string) {
  const { draft } = (await (await request("POST", "/agent/interpret", token, { text: "a leica q3" })).json()) as { draft: unknown };
  const start = await request("POST", "/agent/runs", token, { draft });
  const id = ((await start.json()) as { run: { id: string } }).run.id;
  for (let i = 0; i < 300; i++) {
    const { run } = (await (await request("GET", `/agent/runs/${id}`, token)).json()) as { run: Record<string, any> };
    if (run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("run never finished");
}

describe("shopping search in the agent", () => {
  it("labels a shopping-feed price honestly, keeps 'verified' for page-checked prices and records the Apify spend", async () => {
    const t = await signIn("ada@example.com");
    const run = await runWish(t);
    expect(run.status).toBe("done");
    const [leica, adorama, bh] = run.result.options as PriceOption[];
    expect(leica).toMatchObject({ status: "verified", statusLabel: "Checked on leica-camera.com", upfrontCents: 699500 });
    expect(adorama).toMatchObject({
      status: "estimate",
      statusLabel: "Checked on Adorama via shopping search",
      seller: "Adorama",
      upfrontCents: 622100,
      listing: { merchant: "Adorama", title: "Leica Q3 Digital Camera" },
    });
    expect(bh).toMatchObject({ status: "estimate", statusLabel: "Estimate" });
    expect(bh!.listing).toBeUndefined();
    expect(apifyCalls).toBe(1);

    // New tools leave notes with a structured event, so the app's existing ledger draws them as they are.
    expect(new Set(run.steps.map((s: Step) => s.type))).toEqual(new Set(["open", "check", "price", "explain", "note"]));
    expect(eventsOf(run.steps)).toEqual(expect.arrayContaining(["shop", "imagework", "photos"]));
    // Real photographs only (owner, 2026-10-29): the agent no longer looks for 3D models.
    expect(eventsOf(run.steps).some((k) => k === "search3d" || k === "model3d")).toBe(false);
    expect(run.steps.find((s: Step) => s.type === "note" && s.event?.kind === "shop")).toMatchObject({ text: "Searched shops for Leica Q3: 2 offers", event: { kind: "shop", query: "Leica Q3", offers: 2 } });
    expect(run.steps.find((s: Step) => s.type === "check" && s.listed)).toMatchObject({ verified: false, listed: true });

    const ledger = await db.query<{ model: string; cost_usd: string }>("select model, cost_usd from spend_ledger where kind <> 'interpret' order by id");
    expect(ledger.rows.find((r) => r.model === "apify:damilo~google-shopping-apify")?.cost_usd).toBe("0.007000");
    expect(ledger.rows.filter((r) => r.model === "sam-3.1").map((r) => r.cost_usd)).toEqual(["0.002500"]);
    expect(run.costUsd).toBeGreaterThan(0.0095);
    // The tools the model was offered, and the date it was told
    const first = metaCalls.find((c) => (c.tools ?? []).some((t: { name?: string }) => t.name === "shopping_search"))!;
    expect(first.instructions).toContain("Today is 27 October 2026");
    expect(first.tools.map((t: { name?: string; type: string }) => t.name ?? t.type)).toEqual(["web_search", "get_page", "fx_rate", "shopping_search"]);
  });

  it("stops searching shops at the daily Apify cap and still finishes", async () => {
    const t = await signIn("ada@example.com");
    await db.query("insert into spend_ledger (model, kind, cost_usd, created_at) values ('apify:damilo~google-shopping-apify', 'shopping', 0.14, $1)", [clock.toISOString()]);
    const run = await runWish(t);
    expect(run.status).toBe("done");
    expect(apifyCalls).toBe(0);
    expect(run.steps.find((s: Step) => s.type === "note" && s.event?.kind === "shop")).toMatchObject({ event: { offers: 0 } });
    expect(run.result.options.find((o: PriceOption) => o.seller === "Adorama")).toMatchObject({ status: "estimate", statusLabel: "Estimate" });
  });

  it("keeps Apify spend out of the Meta caps", async () => {
    const t = await signIn("ada@example.com");
    await db.query("insert into spend_ledger (model, kind, cost_usd, created_at) values ('apify:damilo~google-shopping-apify', 'shopping', 500, $1)", [clock.toISOString()]);
    expect((await request("POST", "/agent/interpret", t, { text: "a leica q3" })).status).toBe(200);
  });
});

describe("media hunting in the agent", () => {
  it("gives each option real photos best first and a SAM cutout, looks for no 3D model, and serves the cutout", async () => {
    const t = await signIn("ada@example.com");
    const run = await runWish(t);
    const leica = run.result.options[0] as PriceOption;
    const media = leica.media!;
    expect(media.kind).toBe("product");
    expect(media.images.map((i) => [i.url, i.width, i.height, i.source, !!i.clean, !!i.generated])).toEqual([
      ["https://leica-camera.com/img/q3-top.webp", 3000, 2000, "leica-camera.com", true, false],
      ["https://leica-camera.com/img/q3-front.jpg", 1280, 960, "leica-camera.com", false, false],
      ["https://93.184.215.16/shop/q3.jpg", 300, 300, "Google Shopping", false, false],
    ]);
    expect(media.images[2]!.credit).toBe("Adorama");
    expect(leica.imageUrl).toBe("https://leica-camera.com/img/q3-top.webp");
    expect(media.model3d).toBeUndefined();
    expect(media.cutout).toMatchObject({ width: 1001, height: 763, from: "https://leica-camera.com/img/q3-front.jpg", model: "sam-3.1" });
    // One cutout serves every option that shares the photo; nothing generated, since a real photo passed 2000 px.
    expect(metaCalls.filter((c) => c.model === "sam-3.1")).toHaveLength(1);
    expect(metaCalls.some((c) => String(c.url).includes("/images/"))).toBe(false);
    expect((run.result.options[1] as PriceOption).media!.cutout!.url).toBe(media.cutout!.url);
    // With no Commons photos to choose from and no 3D models, there is nothing for a pick call to choose.
    expect(metaCalls.some((c) => c.text?.format?.name === "media_pick")).toBe(false);

    const key = media.cutout!.url.split("/media/")[1]!;
    const served = await app.request(`/media/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await app.request("/media/../../etc/passwd")).status).toBe(404);
    expect((await app.request(`/media/${"0".repeat(64)}.png`)).status).toBe(404);

    // The app can save the option's media with the wish.
    const saved = await request("POST", "/wishes", t, { name: "Leica Q3", kind: "buy", upfrontCents: 699500, details: { agent: { media } } });
    expect(saved.status).toBe(201);
    // A card saved earlier with a 3D model still saves; a model pointing anywhere but Sketchfab's player never does.
    const model3d = { provider: "sketchfab", uid: MODEL_UID, name: "Leica Q3", author: "Studio", license: "CC Attribution", embedUrl: `https://sketchfab.com/models/${MODEL_UID}/embed?autostart=1&ui_theme=dark&transparent=1&ui_hint=0`, thumbnail: "https://media.sketchfab.com/q3.jpg" };
    expect((await request("POST", "/wishes", t, { name: "Leica Q3", kind: "buy", upfrontCents: 699500, details: { agent: { media: { ...media, model3d } } } })).status).toBe(201);
    const bad = await request("POST", "/wishes", t, { name: "Leica Q3", kind: "buy", upfrontCents: 1, details: { agent: { media: { ...media, model3d: { ...model3d, embedUrl: "javascript:alert(1)" } } } } });
    expect(bad.status).toBe(400);
  });
});

describe("whose page a price is on", () => {
  it("counts a price as checked only on the seller's own site, and ranks one seen on a blog below every estimate", async () => {
    scenario = "chair";
    const t = await signIn("ada@example.com");
    const run = await runWish(t);
    const [hm, dwr, blog] = run.result.options as [PriceOption, PriceOption, PriceOption];
    expect(hm).toMatchObject({ seller: "Herman Miller", status: "verified", statusLabel: "Checked on store.hermanmiller.com", url: HERMAN_MILLER });
    expect(dwr).toMatchObject({ seller: "Design Within Reach", status: "estimate", statusLabel: "Estimate", upfrontCents: 800000 });
    expect(blog).toMatchObject({ seller: "Herman Miller", status: "estimate", statusLabel: "Estimate: seen on thekitchn.com, not Herman Miller's own site", upfrontCents: 779500 });
    expect(run.steps.find((s: Step) => s.type === "check" && s.url === KITCHEN_BLOG)).toMatchObject({ verified: false });
  });
});

describe("trips", () => {
  it("prices a trip from its parts, flights plus nights times the nightly rate, each with its own source", async () => {
    scenario = "trip";
    const t = await signIn("ada@example.com");
    const run = await runWish(t);
    expect(run.status).toBe("done");
    // The single-number package is dropped: a trip is shown as its parts.
    expect(run.result.options).toHaveLength(2);
    const [palace, loft] = run.result.options as [PriceOption, PriceOption];
    expect(palace).toMatchObject({ status: "verified", statusLabel: "2 of 2 parts checked on the sellers' sites", upfrontCents: 124000 + 7 * 18000, url: HOTEL });
    expect(palace.parts).toEqual([
      expect.objectContaining({ kind: "flight", seller: "TAP Air Portugal", url: FLIGHT, unitCents: 124000, quantity: 1, unit: "trip", totalCents: 124000, status: "verified", statusLabel: "Checked on flytap.com" }),
      expect.objectContaining({ kind: "lodging", seller: "Hotel Avenida Palace", url: HOTEL, unitCents: 18000, quantity: 7, unit: "night", totalCents: 126000, status: "verified", statusLabel: "Checked on avenidapalace.com" }),
    ]);
    expect(palace.parts![1]!.source).toMatchObject({ currency: "USD", price: 180 });
    expect(palace.totals.horizonCents).toBe(250000);
    // The loft's nightly rate only appears on a food blog, so that part is an estimate and so is the whole option.
    expect(loft).toMatchObject({ status: "estimate", statusLabel: "1 of 2 parts checked on the sellers' sites", upfrontCents: 124000 + 7 * 9500 });
    expect(loft.parts![1]).toMatchObject({ status: "estimate", statusLabel: "Estimate: seen on lisbon-food-blog.com, not Lisbon Lofts's own site", totalCents: 66500 });
    // The explanation may quote the parts' numbers.
    const explain = metaCalls.find((c) => String(c.input ?? "").startsWith("FACTS:"))!;
    expect(explain.input).toContain('"each":"$180","quantity":7,"per":"night","total":"$1,260"');
  });
});

describe("photos for places and the generated fallback", () => {
  const option = (): PriceOption => ({
    label: "A week in Lisbon",
    seller: "Booking",
    url: "https://93.184.215.30/lisbon",
    upfrontCents: 150000,
    recurring: [],
    source: { currency: "USD", price: 1500, rate: 1, rateDate: "2026-10-27" },
    status: "estimate",
    statusLabel: "Estimate",
    evidence: "",
    confidence: "medium",
    checkedAt: clock.toISOString(),
    totals: { monthlyCents: 0, horizonCents: 150000, spreadMonthlyCents: 2500 },
  });
  const commonsPage = (id: number, title: string, w: number, h: number) => ({
    pageid: id,
    title: `File:${title}.jpg`,
    index: id,
    categories: [{ title: "Category:Quality images" }],
    imageinfo: [{ width: w, height: h, mime: "image/jpeg", url: `https://upload.wikimedia.org/${id}.jpg`, thumburl: `https://upload.wikimedia.org/thumb/${id}.jpg`, extmetadata: { Artist: { value: `Photographer ${id}` }, LicenseShortName: { value: "CC BY-SA 4.0" } } }],
  });

  function metaFor(picks: string[], calls: Record<string, any>[]): Meta {
    return {
      responses: async (body) => {
        calls.push(body);
        return { id: "r", text: JSON.stringify({ photos: picks, model3d_uid: "" }), citations: [], functionCalls: [], searchQueries: [], usage: { model: "muse-spark-1.3", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 }, costUsd: 0, raw: {} };
      },
      images: async (op, body) => {
        calls.push({ op, ...body });
        return { images: [jpegHeader(1920, 1280)], format: "jpeg", usage: { model: "muse-image-1.0", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0, images: 1 }, costUsd: 0.01 };
      },
    };
  }

  it("shows the Commons photos the model picked, in its order, with author and license", async () => {
    const web = (async (url: string | URL) =>
      String(url).startsWith("https://commons.wikimedia.org/")
        ? new Response(JSON.stringify({ query: { pages: { 1: commonsPage(1, "Alfama rooftops", 5000, 3300), 2: commonsPage(2, "Pigs at the zoo", 4000, 2600), 3: commonsPage(3, "Belem tower", 4200, 2800) } } }))
        : new Response("", { status: 404 })) as unknown as typeof fetch;
    const calls: Record<string, any>[] = [];
    const steps: Step[] = [];
    const opt = option();
    const draft = { title: "A week in Lisbon", kind: "visit" as const, summary: "", specifics: [], region: "PT", currency: "EUR", unknowns: [] };
    await huntMedia(metaFor(["3", "1", "99"], calls), { draft, answers: [], onStep: (s) => void steps.push(s), now: () => clock, fetcher: web, media: { store, generate: true, allow: async () => true } }, { kind: "place", subject: "Lisbon", noun: "" }, [opt], new Map(), [], new Map());
    expect(opt.media!.images.map((i) => [i.url, i.width, i.credit, i.license])).toEqual([
      ["https://upload.wikimedia.org/thumb/3.jpg", 3840, "Photographer 3", "CC BY-SA 4.0"],
      ["https://upload.wikimedia.org/thumb/1.jpg", 3840, "Photographer 1", "CC BY-SA 4.0"],
    ]);
    expect(JSON.parse(calls[0]!.input).PHOTOS).toHaveLength(3);
    // Real 4K photos were found, so nothing was generated.
    expect(calls.some((c) => c.op)).toBe(false);
    expect(steps.find((s) => s.type === "note" && s.event?.kind === "photos")).toMatchObject({
      text: "Found 2 photos for A week in Lisbon, the best 3840×2560 from commons.wikimedia.org",
      event: { count: 2, best: { width: 3840, source: "commons.wikimedia.org" } },
    });
  });

  it("looks up the maker's own pages with web search when the research opened none", async () => {
    const searches: string[] = [];
    const meta: Meta = {
      responses: async (body) => {
        expect(body.tools).toEqual([{ type: "web_search" }]);
        return {
          id: "r",
          text: "https://leica-camera.com/en-US/photography/cameras/q/q3-black.\nhttps://leica-camera.com/en-US/press/q3",
          citations: [{ url: "https://leica-camera.com/en-US/photography/cameras/q/q3-black" }, { url: "http://insecure.example.com/q3" }],
          functionCalls: [],
          searchQueries: ["Leica Q3 official page"],
          usage: { model: "muse-spark-1.3", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 1 },
          costUsd: 0,
          raw: {},
        };
      },
    };
    expect(await findMakerPages(meta, { kind: "product", subject: "Leica Q3", noun: "camera" }, (q) => void searches.push(q))).toEqual([
      "https://leica-camera.com/en-US/photography/cameras/q/q3-black",
      "https://leica-camera.com/en-US/press/q3",
    ]);
    expect(searches).toEqual(["Leica Q3 official page"]);
  });

  it("re-renders a small product photo with Muse Image, marked generated, and only keeps it when it is larger", async () => {
    const calls: Record<string, any>[] = [];
    const web = (async () => imageResponse(jpegHeader(500, 375), "image/jpeg")) as unknown as typeof fetch;
    const up = await upscaleImage(metaFor([], calls), { url: "https://93.184.215.40/q3-small.jpg", width: 500, height: 375, type: "jpeg", alpha: false, source: "shop.example.com" }, web, store);
    expect(up).toMatchObject({ width: 1920, height: 1280, source: "shop.example.com", credit: "Muse Image upscale of a photo from shop.example.com", generated: true });
    expect(calls[0]).toMatchObject({ op: "edits", images: [{ image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) }] });
    expect(calls[0]!.prompt).toMatch(/Keep the product identical/);
    const already = await upscaleImage(metaFor([], []), { url: "https://93.184.215.40/q3.jpg", width: 2400, height: 1600, type: "jpeg", alpha: false, source: "x" }, web, store);
    expect(already).toBeNull();
  });

  it("generates one campaign-grade picture, labelled, only when no real photo is good enough and the cap allows", async () => {
    const web = (async (url: string | URL) => (String(url).startsWith("https://commons.wikimedia.org/") ? new Response(JSON.stringify({ query: { pages: {} } })) : new Response("", { status: 404 }))) as unknown as typeof fetch;
    const draft = { title: "A week in Lisbon", kind: "visit" as const, summary: "", specifics: [], region: "PT", currency: "EUR", unknowns: [] };
    const calls: Record<string, any>[] = [];
    const steps: Step[] = [];
    const [a, b] = [option(), option()];
    await huntMedia(metaFor([], calls), { draft, answers: [], onStep: (s) => void steps.push(s), now: () => clock, fetcher: web, media: { store, generate: true, allow: async () => true } }, { kind: "place", subject: "Lisbon", noun: "" }, [a, b], new Map(), [], new Map());
    expect(a.media!.images).toEqual([{ url: expect.stringMatching(/^https:\/\/api\.dandelist\.test\/media\/[a-f0-9]{64}\.jpg$/), width: 1920, height: 1280, source: "Meta Muse Image", credit: "Generated with Muse Image", generated: true }]);
    expect(b.media!.images[0]!.url).toBe(a.media!.images[0]!.url);
    const gen = calls.filter((c) => c.op === "generations");
    expect(gen).toHaveLength(1);
    expect(gen[0]!.prompt).toMatch(/Lisbon.*No text, no logos, no watermarks, no people/s);
    expect(steps.filter((s) => s.type === "note" && s.event?.kind === "imagework")).toEqual([
      { type: "note", text: "Made a picture of Lisbon with Muse Image", event: { kind: "imagework", how: "generated", label: "Lisbon", ok: true }, at: clock.toISOString() },
    ]);

    const capped = option();
    const none: Record<string, any>[] = [];
    await huntMedia(metaFor([], none), { draft, answers: [], onStep: () => undefined, now: () => clock, fetcher: web, media: { store, generate: true, allow: async () => false } }, { kind: "place", subject: "Lisbon", noun: "" }, [capped], new Map(), [], new Map());
    expect(none.some((c) => c.op)).toBe(false);
    expect(capped.media!.images).toEqual([]);
  });
});
