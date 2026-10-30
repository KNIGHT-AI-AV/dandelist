import { PGlite } from "@electric-sql/pglite";
import { entries as catalogue } from "@dandelist/catalogue";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { GUEST_DAILY_USD } from "../src/guest";
import { NOTES_HEADING } from "../src/notes";
import { MAX_ADJACENT, PAIRS_EFFORT, PAIRS_FORMAT, isTheWish, leadFileOk, leadFits, roughCents, tidyPlan, typicalFor } from "../src/pairs";
import { visionReply } from "./vision";

/**
 * This or that made from what the person typed (owner, 2026-10-30): one model call names the pairs, the same kind of
 * thing first; each side gets a real photo and a typical price from lookups that call no model; anything that fails
 * gives no pairs, so the app keeps its pool.
 */

type Json = Record<string, any>;
const clock = new Date("2026-10-30T12:00:00Z");
const SHOP = "https://www.onepeloton.com/bike-plus";
let db: Db;
/** Every model call, as sent. */
let calls: Json[];
/** Every web address fetched. */
let web: string[];
let mail: { to: string; code: string }[];
/** How the model answers the pairs call: an answer, a raw string, or a status to fail with. */
let pairsAnswer: Json | string | number;

const thing = (title: string, type: string, wikipedia: string, usd: number, preowned = false) => ({ title, type, wikipedia, usd, preowned });
const pair = (a: Json, b: Json, adjacent = false) => ({ a, b, why: "Which feels more like you", adjacent });

/**
 * After "I want a Rolls Royce": four pairs of cars (one is the wish itself; two lose a side whose article lends no
 * photo), then three next door (one loses a side, one is past the limit).
 */
const ROLLS = {
  pairs: [
    pair(thing("Bentley Mulsanne", "vehicle", "Bentley Mulsanne (2010)", 310_000), thing("Mercedes-Maybach S-Class", "vehicle", "Mercedes-Maybach S-Class", 194_500)),
    pair(thing("Rolls-Royce Ghost", "vehicle", "Rolls-Royce Ghost", 350_000), thing("Rolls-Royce Cullinan", "vehicle", "Rolls-Royce Cullinan", 410_000)),
    pair(thing("Bentley Flying Spur", "vehicle", "Bentley Flying Spur", 230_000), thing("Rolls-Royce Spectre", "vehicle", "Rolls-Royce Spectre", 420_000)),
    pair(thing("Rolls-Royce", "vehicle", "Rolls-Royce Motor Cars", 400_000), thing("Bentley Bentayga", "vehicle", "Bentley Bentayga", 210_000)),
    pair(thing("Riva Aquarama", "vehicle", "Riva Aquarama", 1_150_000, true), thing("Gulfstream G700", "vehicle", "Gulfstream G700", 79_000_000), true),
    pair(thing("Patek Philippe Nautilus", "thing", "Patek Philippe Nautilus", 140_000), thing("Audemars Piguet Royal Oak", "thing", "Audemars Piguet Royal Oak", 32_000), true),
    pair(thing("Amangiri", "trip", "Amangiri", 30_000), thing("Aman Tokyo", "trip", "Aman Tokyo", 25_000), true),
  ],
};

/** After "a Leica Q3": cameras (one pair is the wish itself; two lose a side), then a pair the pool has and a trip. */
const CAMERAS = {
  pairs: [
    pair(thing("Fujifilm X100VI", "thing", "Fujifilm X100VI", 1_799), thing("Ricoh GR III", "thing", "Ricoh GR III", 949)),
    pair(thing("Leica M11", "thing", "Leica M11", 9_000), thing("Hasselblad X2D", "thing", "Hasselblad X2D 100C", 8_199)),
    pair(thing("Leica Q3", "thing", "Leica Q3", 7_350), thing("Leica Q3 43", "thing", "Leica Q3 43", 6_995)),
    pair(thing("Nikon Zf", "thing", "Nikon Zf", 1_999), thing("Sony RX1R II", "thing", "Sony RX1R II", 3_300)),
    pair(thing("Apple Vision Pro", "thing", "Apple Vision Pro", 3_499), thing("Rimowa Original Cabin", "thing", "Rimowa", 1_550), true),
    pair(thing("Seychelles", "trip", "Seychelles", 12_000), thing("Kyoto", "trip", "Kyoto", 7_000), true),
  ],
};

/**
 * Each article Wikipedia knows: where its title lands (through a redirect, maybe to one section), whether it is a
 * disambiguation page, its lead photo file and its Wikidata item.
 */
const ARTICLES: Record<string, { to?: string; section?: string; file?: string; item?: string; disambiguation?: boolean }> = {
  "Bentley Mulsanne (2010)": { file: "Bentley_Mulsanne_2016.jpg", item: "Q101" },
  "Mercedes-Maybach S-Class": { file: "Mercedes-Maybach_S_580.jpg", item: "Q102" },
  // A trim's name in the file ("Black Badge") is not a badge: the photo still stands.
  "Rolls-Royce Ghost": { file: "2022_Rolls-Royce_Ghost_Black_Badge_in_Arctic_White,_front_left.jpg", item: "Q103" },
  "Rolls-Royce Cullinan": { to: "Rolls-Royce Motor Cars", section: "Cullinan" },
  "Rolls-Royce Motor Cars": { file: "Rolls-Royce_Motor_Cars_Goodwood.jpg", item: "Q104" },
  "Bentley Flying Spur": { to: "Flying Spur" },
  "Flying Spur": { disambiguation: true, item: "Q105" },
  "Rolls-Royce Spectre": { file: "2024_Rolls-Royce_Spectre.jpg", item: "Q106" },
  "Riva Aquarama": { file: "Riva_Aquarama.jpg", item: "Q107" },
  "Gulfstream G700": { file: "Gulfstream_G700.jpg", item: "Q108" },
  "Audemars Piguet Royal Oak": { file: "Royal_Oak.jpg", item: "Q109" },
  "Fujifilm X100VI": { to: "Fujifilm X100", section: "Fujifilm X100VI" },
  "Fujifilm X100": { file: "Fujifilm_X100_001.jpg", item: "Q110" },
  "Ricoh GR III": { file: "Ricoh_GR_III.jpg", item: "Q111" },
  "Leica M11": { file: "Leica_M11.jpg", item: "Q112" },
  "Hasselblad X2D 100C": { file: "Hasselblad_X2D.jpg", item: "Q113" },
  "Nikon Zf": { file: "Nikon_Z_f_8_nov_2023a.jpg", item: "Q114" },
  // A country's article leads with its flag; its Wikidata item shows a beach.
  Seychelles: { file: "Flag_of_Seychelles.svg", item: "Q1042" },
};
/** Wikidata items' own images (P18). A disambiguation page's item is never asked. */
const ITEMS: Record<string, string> = { Q1042: "La Digue asv2024-10 img56 Anse Patates.jpg", Q105: "Bentley Flying Spur 2020.jpg" };
/** Each file: its original size, type and author as Commons states it. */
const FILES: Record<string, { w: number; h: number; mime?: string; artist?: string }> = {
  "Bentley Mulsanne 2016.jpg": { w: 4000, h: 2600, artist: '<a href="//commons.wikimedia.org/wiki/User:Vauxford">Vauxford</a>' },
  "Mercedes-Maybach S 580.jpg": { w: 3000, h: 2000, artist: "Alexander Migl" },
  "2022 Rolls-Royce Ghost Black Badge in Arctic White, front left.jpg": { w: 5158, h: 2956, artist: "Mr.choppers" },
  "Rolls-Royce Motor Cars Goodwood.jpg": { w: 3000, h: 2000 },
  "2024 Rolls-Royce Spectre.jpg": { w: 5268, h: 3149, artist: "Mr.choppers" },
  "Riva Aquarama.jpg": { w: 2400, h: 1600, artist: "See File history, below, for details." },
  "Gulfstream G700.jpg": { w: 3000, h: 2000, artist: "Gulfstream" },
  "Royal Oak.jpg": { w: 2000, h: 2000 },
  "Fujifilm X100 001.jpg": { w: 2000, h: 1300 },
  "Ricoh GR III.jpg": { w: 2400, h: 1600, artist: "Ricoh" },
  "Leica M11.jpg": { w: 7008, h: 4672, artist: "Peachyeung316" },
  "Hasselblad X2D.jpg": { w: 3000, h: 2000 },
  "Nikon Z f 8 nov 2023a.jpg": { w: 2937, h: 2553 },
  "Flag of Seychelles.svg": { w: 1200, h: 600, mime: "image/svg+xml" },
  "La Digue asv2024-10 img56 Anse Patates.jpg": { w: 7952, h: 4473, artist: "Ralf Roletschek" },
  "Bentley Flying Spur 2020.jpg": { w: 3000, h: 2000 },
};

const upload = (file: string) => `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file.replace(/ /g, "_")}`;
const thumb = (file: string, width: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file.replace(/ /g, "_")}/${width}px-${file.replace(/ /g, "_")}`;
const description = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;

const DRAFT = { title: "Peloton Bike+", kind: "buy", summary: "A Peloton Bike+ for home.", specifics: [], region: "US", currency: "usd", unknowns: [], worth: "priced", amount: 0, line: "" };
const draftFor = (said: string) =>
  /rolls/i.test(said) ? { ...DRAFT, title: "A Rolls-Royce", kind: "own", summary: "A Rolls-Royce." } : /leica/i.test(said) ? { ...DRAFT, title: "Leica Q3", summary: "A Leica Q3 camera." } : DRAFT;

const reply = (output: unknown[]) => Response.json({ id: `resp_${calls.length}`, output, usage: { input_tokens: 1000, output_tokens: 1500 } });
const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });

const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Json;
  calls.push(body);
  const format = body.text?.format?.name;
  const tools = (body.tools ?? []).map((t: { name?: string; type: string }) => t.name ?? t.type);
  if (format === PAIRS_FORMAT) {
    if (typeof pairsAnswer === "number") return new Response("down", { status: pairsAnswer });
    return reply([message(typeof pairsAnswer === "string" ? pairsAnswer : JSON.stringify(pairsAnswer))]);
  }
  const vision = visionReply(body);
  if (vision !== null) return reply([message(vision)]);
  if (String(body.instructions ?? "").startsWith("You find, fast")) {
    return reply([{ type: "web_search_call", action: { query: "peloton bike+ price" }, results: [{ url: SHOP, title: "Peloton Bike+" }] }, message(`${SHOP} | $2,495.00 | USD`)]);
  }
  if (format === "wish_draft") return reply([message(JSON.stringify(draftFor(String(body.input ?? ""))))]);
  if (format === "wish_questions") return reply([message(JSON.stringify({ questions: [] }))]);
  if (format === "price_options") {
    return reply([message(JSON.stringify({ options: [{ label: "Bike+ Basics", seller: "Peloton", url: SHOP, currency: "USD", price: 2495, recurring: [], evidence: "$2,495.00", confidence: "high" }], note: "" }))]);
  }
  if (tools.includes("get_page") && !body.previous_response_id) {
    return reply([{ type: "function_call", call_id: "gp_1", name: "get_page", arguments: JSON.stringify({ thought: "Peloton's own store sets the price.", url: SHOP }) }]);
  }
  if (tools.includes("get_page")) return reply([message("Found it.")]);
  return reply([message("Done.")]);
}) as unknown as typeof fetch;

const PRODUCT = `<script type="application/ld+json">{"@type":"Product","name":"Peloton Bike+","offers":{"price":"2495.00","priceCurrency":"USD"}}</script>`;

/** Wikipedia and Wikidata as their APIs answer, from the tables above; the shop's page for the hunt beside it. */
const fakeWeb = (async (input: string | URL) => {
  const u = new URL(String(input));
  web.push(u.toString());
  const q = u.searchParams;
  if (u.hostname === "en.wikipedia.org" && q.get("prop") === "pageimages|pageprops") {
    const redirects: Json[] = [];
    const pages: Json[] = [];
    const page = (title: string) => {
      const a = ARTICLES[title] ?? {};
      return { title, ...(a.file ? { pageimage: a.file } : {}), pageprops: { ...(a.item ? { wikibase_item: a.item } : {}), ...(a.disambiguation ? { disambiguation: "" } : {}) } };
    };
    for (const t of (q.get("titles") ?? "").split("|")) {
      const a = ARTICLES[t];
      if (!a) pages.push({ title: t, missing: true });
      else if (a.to) {
        redirects.push({ from: t, to: a.to, ...(a.section ? { tofragment: a.section } : {}) });
        pages.push(page(a.to));
      } else pages.push(page(t));
    }
    return Response.json({ batchcomplete: true, query: { redirects, pages } });
  }
  if (u.hostname === "en.wikipedia.org" && q.get("prop") === "imageinfo") {
    const width = Number(q.get("iiurlwidth"));
    const pages = (q.get("titles") ?? "").split("|").map((t) => {
      const name = t.replace(/^File:/, "").replace(/_/g, " ");
      const f = FILES[name];
      if (!f) return { title: `File:${name}`, missing: true };
      const extmetadata = { ...(f.artist ? { Artist: { value: f.artist } } : {}), LicenseShortName: { value: "CC BY-SA 4.0" } };
      return { title: `File:${name}`, imagerepository: "shared", imageinfo: [{ url: `${upload(name)}?utm_source=en.wikipedia.org`, descriptionurl: description(name), width: f.w, height: f.h, mime: f.mime ?? "image/jpeg", thumburl: `${thumb(name, width)}?utm_source=en.wikipedia.org&utm_content=thumbnail`, thumbwidth: width, thumbheight: Math.round((f.h * width) / f.w), extmetadata }] };
    });
    return Response.json({ query: { pages } });
  }
  if (u.hostname === "www.wikidata.org" && q.get("action") === "wbgetclaims") {
    const file = ITEMS[q.get("entity") ?? ""];
    return Response.json({ claims: file ? { P18: [{ rank: "normal", mainsnak: { datavalue: { value: file } } }] } : {} });
  }
  if (u.hostname.endsWith("wikipedia.org") || u.hostname.endsWith("wikimedia.org")) return Response.json({ query: { pages: {} } });
  if (u.toString().startsWith(SHOP)) {
    return new Response(`<html><head><title>Peloton Bike+</title><meta property="og:site_name" content="Peloton">${PRODUCT}</head><body>Bike+ $2,495.00.</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("<html><body>Nothing here</body></html>", { status: 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

function makeApp() {
  return createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: { apiKey: "test", fetch: fakeMeta },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: fakeWeb,
  });
}

/** Archive subjects with a typical price and no photos: only their prices are of use here. */
async function seedTypicals() {
  const typical = (low: number, unit: string) => JSON.stringify({ low, high: low * 2, currency: "USD", unit });
  await db.query(
    `insert into archive_entities (id, domain, category, subcategory, name, kind, price_model, typical, tier) values
      ('rolls-royce-ghost-series-ii', 'Vehicles', 'Cars', 'Ultra-luxury saloons', 'Rolls-Royce Ghost (Series II)', 'vehicle', 'one-off', $1::jsonb, 1),
      ('gulfstream-g700', 'Vehicles', 'Aircraft', 'Business jets', 'Gulfstream G700', 'vehicle', 'one-off', $2::jsonb, 1),
      ('leica-m11', 'Tech & gadgets', 'Cameras', 'Rangefinders', 'Leica M11', 'product', 'one-off', $3::jsonb, 1),
      ('ghost-tour', 'Experiences', 'Tours', 'Night tours', 'Rolls-Royce Ghost tour', 'experience', 'per-event', $4::jsonb, 3)`,
    [typical(360_000, "new MSRP, base to well-optioned"), typical(78_000_000, "new, typical delivered"), typical(9_195, "US list price, new (2026)"), typical(90, "per person")],
  );
}

async function events(res: Response): Promise<Json[]> {
  return (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)) as Json);
}

const wish = (text: string, ip: string, extra: Json = { pairs: true }) =>
  makeApp().request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ text, ...extra }) });
const pairCalls = () => calls.filter((c) => c.text?.format?.name === PAIRS_FORMAT);
const sides = (pairs: Json[]) => pairs.flatMap((p) => [p.a, p.b]);
const fetched = (host: string, has: string) => web.filter((u) => new URL(u).hostname === host && u.includes(has)).length;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) } as Db;
  await migrate(db);
  calls = [];
  web = [];
  mail = [];
  pairsAnswer = ROLLS;
});

describe("the pair rules", () => {
  it("rounds the agent's own estimate to two figures and refuses what isn't a price", () => {
    expect(roughCents(412_345)).toBe(41_000_000);
    expect(roughCents(194_500)).toBe(19_000_000);
    expect(roughCents(7_350)).toBe(740_000);
    expect(roughCents(1_799)).toBe(180_000);
    expect(roughCents(95)).toBe(9_500);
    for (const bad of [0, -5, Number.NaN, 2e10]) expect(roughCents(bad)).toBeNull();
  });

  it("knows the wish itself, or something vaguer, from a sibling of it", () => {
    expect(isTheWish("Bali", "I want a week in Bali")).toBe(true);
    expect(isTheWish("Rolls-Royce", "I want a Rolls Royce")).toBe(true);
    expect(isTheWish("Rolls-Royce Ghost", "I want a Rolls Royce")).toBe(false);
    expect(isTheWish("Ubud", "a week in Bali")).toBe(false);
  });

  it("keeps the same kind of thing first, at most two pairs next door, and nothing twice or unusable", () => {
    const item = (title: string, usd = 1000) => thing(title, "thing", title, usd);
    const plan = tidyPlan(
      {
        pairs: [
          pair(item("Riva Aquarama"), item("Gulfstream G700"), true),
          pair(item("Leica M11"), item("Fujifilm X100VI")),
          pair(item("Leica M11 Monochrom"), item("Ricoh GR III")),
          pair(item("Hasselblad X2D"), item("Sony RX1R III", 0)),
          pair(item("Leica SL3"), item("https://example.com")),
          pair(item("Leica Q3"), item("Canon EOS R5")),
          { a: item("Nikon Zf"), b: { title: "Half a thing" }, why: "x", adjacent: false },
          pair(item("Patek Philippe Nautilus"), item("Audemars Piguet Royal Oak"), true),
          pair(item("Amangiri"), item("Aman Tokyo"), true),
        ],
      },
      { wish: "a Leica Q3" },
    );
    expect(plan.map((p) => [p.a.title, p.b.title])).toEqual([
      ["Leica M11", "Fujifilm X100VI"],
      ["Riva Aquarama", "Gulfstream G700"],
      ["Patek Philippe Nautilus", "Audemars Piguet Royal Oak"],
    ]);
    expect(plan.filter((p) => p.adjacent)).toHaveLength(MAX_ADJACENT);
    expect(tidyPlan("nonsense")).toEqual([]);
    expect(tidyPlan({ pairs: "nonsense" })).toEqual([]);
  });

  it("prices a thing new only from a new price, pre-owned only from a used one, and never as another kind", () => {
    const entity = (id: string, name: string, note: string, upfrontCents: number) => ({ id, name, aliases: [], kind: "vehicle", tier: 1, subcategory: "", price: { kind: "own" as const, group: "things" as const, category: "drive", upfrontCents, note } });
    const typicals = [entity("g-w463", "Mercedes-Benz G-Class (W463)", "Typical price · used, good condition", 4_000_000), entity("rr-l460", "Range Rover (L460)", "Typical price · new MSRP, base to well-optioned", 11_200_000)];
    expect(typicalFor({ title: "Mercedes-Benz G-Class", type: "vehicle", preowned: false }, typicals)).toBeNull();
    expect(typicalFor({ title: "Mercedes-Benz G-Class", type: "vehicle", preowned: true }, typicals)?.id).toBe("g-w463");
    expect(typicalFor({ title: "Range Rover", type: "vehicle", preowned: false }, typicals)?.id).toBe("rr-l460");
    expect(typicalFor({ title: "Range Rover", type: "thing", preowned: false }, typicals)).toBeNull();
  });

  it("lends an article's photo only to the thing it is about", () => {
    expect(leadFits("Rolex Daytona", "Rolex Cosmograph Daytona")).toBe(true);
    expect(leadFits("Hermès Birkin", "Birkin bag")).toBe(true);
    expect(leadFits("Rolls-Royce Phantom VIII", "Rolls-Royce Phantom")).toBe(true);
    expect(leadFits("Bora Bora", "Bora Bora")).toBe(true);
    expect(leadFits("Porsche Taycan", "Porsche")).toBe(false);
    expect(leadFits("Patek Philippe Nautilus", "Patek Philippe")).toBe(false);
    expect(leadFits("Fujifilm X100VI", "Fujifilm X100")).toBe(false);
  });

  it("takes only photographs: a JPEG, big enough, not a strip, a map, a flag, a collage or a view from orbit", () => {
    expect(leadFileOk("Kiyomizu-dera,_Kyoto,_November_2016_-02.jpg", "image/jpeg", 5659, 3738)).toBe(true);
    expect(leadFileOk("2022_Rolls-Royce_Ghost_Black_Badge_in_Arctic_White,_front_left.jpg", "image/jpeg", 5158, 2956)).toBe(true);
    expect(leadFileOk("Flag_of_Maldives.svg", "image/svg+xml", 720, 480)).toBe(false);
    expect(leadFileOk("Flag of Maldives (photo).jpg", "image/jpeg", 3000, 2000)).toBe(false);
    expect(leadFileOk("2011_Dimos_Thiras.png", "image/png", 2000, 1253)).toBe(false);
    expect(leadFileOk("Daytona116509.jpg", "image/jpeg", 800, 600)).toBe(false);
    expect(leadFileOk("Kyoto_montage.jpg", "image/jpeg", 3000, 4000)).toBe(false);
    expect(leadFileOk("Bora_Bora_ISS006.jpg", "image/jpeg", 2000, 1600)).toBe(false);
    expect(leadFileOk("Kauai_from_space_2.jpg", "image/jpeg", 2000, 1600)).toBe(false);
    expect(leadFileOk("Maui_panorama.jpg", "image/jpeg", 8000, 2000)).toBe(false);
    expect(leadFileOk("Locator_map_of_Bali.jpg", "image/jpeg", 3000, 2000)).toBe(false);
  });
});

describe("this or that from the first wish", () => {
  it("ties every pair to a Rolls-Royce: comparable cars first, next door last, each with a real photo and a typical price", async () => {
    await seedTypicals();
    const evs = await events(await wish("I want a Rolls Royce", "203.0.113.40"));
    const got = evs.find((e) => e.type === "pairs")!;
    expect(got).toBeTruthy();
    // The wish itself and the third pair next door fell away. The Cullinan's title lands on one section of a broader
    // article and the Flying Spur's on a disambiguation page, so neither has a photo: the Ghost and the Spectre they
    // were paired with make a pair of their own.
    expect(got.pairs.map((p: Json) => [p.a.name, p.b.name])).toEqual([
      ["Bentley Mulsanne", "Mercedes-Maybach S-Class"],
      ["Rolls-Royce Ghost", "Rolls-Royce Spectre"],
      ["Riva Aquarama", "Gulfstream G700"],
    ]);
    expect(got.pairs.map((p: Json) => p.adjacent)).toEqual([false, false, true]);
    expect(got.pairs.map((p: Json) => p.why)).toEqual(["Which feels more like you", "", "Which feels more like you"]);
    for (const side of sides(got.pairs.slice(0, 2))) expect(side).toMatchObject({ kind: "own", group: "things", category: "drive", media: { kind: "vehicle" } });
    // Every side has a real photograph, with no tracking on its address.
    for (const side of sides(got.pairs)) {
      expect(side.media.images[0].url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
      expect(side.media.images[0].url).not.toContain("utm_");
    }
    const card = (name: string) => sides(got.pairs).find((c) => c.name === name)!;
    // A lead photo comes as Wikimedia's 1920 px rendering, credited like the pool's photos.
    expect(card("Bentley Mulsanne")).toMatchObject({
      id: "p:bentley-mulsanne",
      status: "estimate",
      seller: "Typical price",
      url: "",
      upfrontCents: 31_000_000,
      note: "Typical price · new",
      credit: "Photo: Vauxford, CC BY-SA 4.0",
      checkedAt: clock.toISOString(),
      media: { kind: "vehicle", images: [{ url: thumb("Bentley Mulsanne 2016.jpg", 1920), width: 1920, height: 1248, source: "commons.wikimedia.org", sourcePage: description("Bentley Mulsanne 2016.jpg") }] },
    });
    // The archive's typical price when it has the thing (a car, never the tour that shares its name), as the pool shows
    // it; else the agent's own, to two figures.
    expect(card("Rolls-Royce Ghost")).toMatchObject({ upfrontCents: 36_000_000, note: "Typical price · new MSRP, base to well-optioned" });
    expect(card("Gulfstream G700")).toMatchObject({ upfrontCents: 7_800_000_000, note: "Typical price · new, typical delivered" });
    expect(card("Mercedes-Maybach S-Class")).toMatchObject({ upfrontCents: 19_000_000, note: "Typical price · new" });
    expect(card("Riva Aquarama")).toMatchObject({ upfrontCents: 120_000_000, note: "Typical price · pre-owned", credit: "Photo: Wikimedia Commons contributor, CC BY-SA 4.0" });
    // One model call, at minimal effort and with no tools, from their own words.
    expect(pairCalls()).toHaveLength(1);
    expect(pairCalls()[0]).toMatchObject({ reasoning: { effort: PAIRS_EFFORT } });
    expect(PAIRS_EFFORT).toBe("minimal");
    expect(pairCalls()[0]!.tools).toBeUndefined();
    expect(pairCalls()[0]!.input).toContain('WISH: "I want a Rolls Royce"');
    // All the photos in two requests: where each article lands, then its file. No Wikidata call when every lead is a photo.
    expect(fetched("en.wikipedia.org", "pageprops")).toBe(1);
    expect(fetched("en.wikipedia.org", "imageinfo")).toBe(1);
    expect(fetched("www.wikidata.org", "wbgetclaims")).toBe(0);
    // Its spend is guest spend, under the guest allowance.
    const spend = (await db.query<{ n: string }>("select count(*) as n from spend_ledger where user_id is null and kind = 'guest-pairs'")).rows[0]!;
    expect(Number(spend.n)).toBe(1);
  });

  it("answers a camera with cameras, lets the pool's own cards stand for what it has, and shows a country's beach, not its flag", async () => {
    await seedTypicals();
    pairsAnswer = CAMERAS;
    const evs = await events(await wish("a Leica Q3", "203.0.113.41"));
    const got = evs.find((e) => e.type === "pairs")!;
    expect(got.pairs.map((p: Json) => [p.a.name, p.b.name])).toEqual([
      ["Leica M11", "Hasselblad X2D"],
      ["Ricoh GR III", "Nikon Zf"],
      ["Apple Vision Pro", "Rimowa Original Cabin"],
      ["Seychelles", "Two weeks in Kyoto"],
    ]);
    for (const side of sides(got.pairs.slice(0, 2))) expect(side).toMatchObject({ kind: "buy", group: "things", category: "capture", media: { kind: "product" } });
    const card = (name: string) => sides(got.pairs).find((c) => c.name === name)!;
    expect(card("Leica M11")).toMatchObject({ upfrontCents: 919_500, note: "Typical price · US list price, new (2026)" });
    // The pool's cards keep their own ids, prices and photos, so the pool never shows them twice.
    for (const id of ["vision-pro", "rimowa-cabin", "kyoto-autumn"]) {
      const e = catalogue.find((x) => x.id === id)!;
      expect(card(e.name)).toMatchObject({ id, upfrontCents: e.upfrontCents, status: e.status, url: e.url });
    }
    // The Seychelles' article leads with its flag; the Wikidata item's own image, a beach, stands.
    expect(card("Seychelles")).toMatchObject({ kind: "visit", group: "travel", note: "Typical price · 7 nights for two incl. economy flights", upfrontCents: 1_200_000, credit: "Photo: Ralf Roletschek, CC BY-SA 4.0" });
    expect(card("Seychelles").media.images[0].url).toBe(thumb("La Digue asv2024-10 img56 Anse Patates.jpg", 1920));
    expect(card("Seychelles").media.images[0].sourcePage).toBe(description("La Digue asv2024-10 img56 Anse Patates.jpg"));
    expect(fetched("www.wikidata.org", "wbgetclaims")).toBe(1);
    expect(fetched("en.wikipedia.org", "imageinfo")).toBe(2);
    // The model was shown the places the pool already has curated photographs of.
    expect(pairCalls()[0]!.input).toContain("PLACES WE HAVE PHOTOGRAPHED:");
    expect(pairCalls()[0]!.input).toContain('"Two weeks in Kyoto"');
    expect(sides(got.pairs).map((c) => c.name)).not.toContain("Leica Q3");
  });

  it("sends no pairs when the model fails or answers nonsense, and the wish is still priced", { timeout: 20_000 }, async () => {
    const answers: [Json | string | number, string][] = [[500, "203.0.113.50"], ["not json at all", "203.0.113.51"], [{ pairs: [{ a: { title: "X" } }] }, "203.0.113.52"]];
    for (const [answer, ip] of answers) {
      pairsAnswer = answer;
      const evs = await events(await wish("a peloton bike", ip));
      expect(evs.some((e) => e.type === "pairs")).toBe(false);
      expect(evs.some((e) => e.type === "priced")).toBe(true);
      expect(evs.some((e) => e.type === "error")).toBe(false);
    }
  });

  it("sends no pairs when no side has a photo", async () => {
    pairsAnswer = { pairs: [pair(thing("Patek Philippe Nautilus", "thing", "Patek Philippe Nautilus", 140_000), thing("Bentley Flying Spur", "vehicle", "Bentley Flying Spur", 230_000))] };
    const evs = await events(await wish("a Patek Philippe", "203.0.113.53"));
    expect(evs.some((e) => e.type === "pairs")).toBe(false);
    expect(pairCalls()).toHaveLength(1);
  });

  it("makes none unless the app asks, and never for a hunt again with changed answers", async () => {
    await (await wish("I want a Rolls Royce", "203.0.113.60", {})).text();
    const draft = { ...DRAFT, currency: "USD", questions: [] };
    await (await wish("I want a Rolls Royce", "203.0.113.61", { pairs: true, draft, answers: [{ question: "package", answer: "Basics" }] })).text();
    expect(pairCalls()).toHaveLength(0);
  });

  it("is refused with the rest once the guest allowance is spent", async () => {
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'guest', $2, $1)", [clock.toISOString(), (GUEST_DAILY_USD - 0.05).toFixed(2)]);
    const evs = await events(await wish("I want a Rolls Royce", "203.0.113.62"));
    expect(calls).toHaveLength(0);
    expect(evs.some((e) => e.type === "pairs")).toBe(false);
  });
});

describe("the preview with this-or-that cards from the wish", () => {
  it("adds them up with their own prices, beside the pool's picks and the wish", async () => {
    const res = await makeApp().request("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.70" },
      body: JSON.stringify({ picks: ["leica-q3"], extra: { name: "A Rolls-Royce", upfrontCents: 36_000_000 }, extras: [{ name: "Bentley Mulsanne", upfrontCents: 31_000_000 }], monthlyCents: 100_000 }),
    });
    expect(res.status).toBe(200);
    const evs = await events(res);
    const leica = catalogue.find((e) => e.id === "leica-q3")!;
    expect(evs[0]).toMatchObject({ type: "row", text: "Read your 3 picks." });
    expect(evs.find((e) => e.type === "result")).toMatchObject({ upfrontCents: 36_000_000 + 31_000_000 + leica.upfrontCents });
  });

  it("takes this-or-that cards alone", async () => {
    const res = await makeApp().request("/preview", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.71" }, body: JSON.stringify({ extras: [{ name: "Bentley Mulsanne", upfrontCents: 31_000_000 }], monthlyCents: 100_000 }) });
    expect(res.status).toBe(200);
    expect((await events(res)).find((e) => e.type === "result")).toMatchObject({ upfrontCents: 31_000_000 });
  });
});

describe("this or that for a signed-in person", () => {
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, token: string | null, body?: unknown) =>
    app.request(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function signIn(app: ReturnType<typeof createApp>, email = "ada@example.com") {
    await call(app, "POST", "/auth/email/start", null, { email });
    const res = await call(app, "POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
    return (await res.json()) as { accessToken: string; user: { id: string } };
  }

  it("needs a session", async () => {
    expect((await call(makeApp(), "POST", "/pairs", null, {})).status).toBe(401);
  });

  it("starts from their list and their notes, and never offers what is already on it", async () => {
    const app = makeApp();
    const me = await signIn(app);
    expect((await call(app, "POST", "/wishes", me.accessToken, { name: "Rolls-Royce Ghost", kind: "own", upfrontCents: 36_000_000, note: "For Sunday drives with my dad." })).status).toBe(201);
    const res = await call(app, "POST", "/pairs", me.accessToken, {});
    expect(res.status).toBe(200);
    const { pairs } = (await res.json()) as { pairs: Json[] };
    // The Ghost is on their list, so its pair goes, and so does the brand alone; the Spectre has no partner left.
    expect(pairs.map((p) => [p.a.name, p.b.name])).toEqual([
      ["Bentley Mulsanne", "Mercedes-Maybach S-Class"],
      ["Riva Aquarama", "Gulfstream G700"],
    ]);
    const sent = pairCalls()[0]!;
    expect(sent.input).toContain('THEIR LIST (newest first): ["Rolls-Royce Ghost"]');
    expect(sent.input).not.toContain("WISH:");
    expect(sent.instructions).toContain(NOTES_HEADING);
    expect(sent.instructions).toContain("For Sunday drives with my dad.");
    const spend = (await db.query<{ n: string }>("select count(*) as n from spend_ledger where user_id = $1 and kind = 'pairs'", [me.user.id])).rows[0]!;
    expect(Number(spend.n)).toBe(1);
  });

  it("calls no model with nothing to start from", async () => {
    const app = makeApp();
    const me = await signIn(app);
    const res = await call(app, "POST", "/pairs", me.accessToken, {});
    expect(await res.json()).toEqual({ pairs: [] });
    expect(calls).toHaveLength(0);
  });
});
