import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { createApp } from "../src/app";
import { imageResponse, jpegHeader } from "./images";
import { migrate, type Db } from "../src/db";
import { GUEST_WISHES_PER_IP_PER_HOUR } from "../src/guest";
import { ARCHIVE_PREFIX, fromArchive } from "../src/pool";
import { visionReply } from "./vision";

const clock = new Date("2026-10-28T12:00:00Z");
const SHOP = "https://www.onepeloton.com/bike-plus";
let db: Db;
let metaCalls: Record<string, any>[];

const reply = (output: unknown[]) => new Response(JSON.stringify({ id: `resp_${metaCalls.length}`, output, usage: { input_tokens: 1000, output_tokens: 200 } }), { status: 200 });
const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });

// The agent's steps, answered the way Meta does: read the wish, open the seller's page, return priced options.
const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, any>;
  metaCalls.push(body);
  const format = body.text?.format?.name;
  const tools = (body.tools ?? []).map((t: { name?: string; type: string }) => t.name ?? t.type);
  const vision = visionReply(body);
  if (vision !== null) return reply([message(vision)]);
  // The fast find: one bounded web search that names the seller's page.
  if (String(body.instructions ?? "").startsWith("You find, fast")) {
    return reply([{ type: "web_search_call", action: { query: "peloton bike+ price" }, results: [{ url: SHOP, title: "Peloton Bike+" }] }, message(`${SHOP} | $2,495.00 | USD`)]);
  }
  if (format === "wish_draft") return reply([message(JSON.stringify({ title: "Peloton Bike+", kind: "buy", summary: "A Peloton Bike+ for home.", specifics: [], region: "US", currency: "usd", unknowns: [] }))]);
  if (format === "wish_questions") return reply([message(JSON.stringify({ questions: [{ id: "package", label: "Which package?", options: ["Basics", "Essentials"], picked: "Basics" }] }))]);
  if (format === "price_options") {
    return reply([message(JSON.stringify({ options: [{ label: "Bike+ Basics", seller: "Peloton", url: SHOP, currency: "USD", price: 2495, recurring: [{ label: "All-Access", amount: 44, period: "month" }], evidence: "$2,495.00", confidence: "high" }], note: "" }))]);
  }
  if (tools.includes("get_page") && !body.previous_response_id) {
    return reply([{ type: "function_call", call_id: "gp_1", name: "get_page", arguments: JSON.stringify({ thought: "Peloton's own store sets the list price, so I'll read it there.", url: SHOP }) }]);
  }
  if (tools.includes("get_page")) return reply([message("Found it.")]);
  return reply([message("The Bike+ Basics costs $2,495 upfront.")]);
}) as unknown as typeof fetch;

const PRODUCT = `<script type="application/ld+json">{"@type":"Product","name":"Peloton Bike+","image":"https://www.onepeloton.com/img/bike-plus.jpg","offers":{"price":"2495.00","priceCurrency":"USD"}}</script>`;
const fakeWeb = (async (url: string | URL) => {
  const u = String(url);
  if (u === "https://www.onepeloton.com/img/bike-plus.jpg") return imageResponse(jpegHeader(2400, 1600), "image/jpeg");
  return u.startsWith(SHOP)
    ? new Response(`<html><head><title>Peloton Bike+</title><meta property="og:site_name" content="Peloton">${PRODUCT}</head><body>Bike+ $2,495.00. Membership $44/mo.</body></html>`, { status: 200, headers: { "content-type": "text/html" } })
    : new Response("<html><body>Nothing here</body></html>", { status: 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

function makeApp(withMeta = true) {
  return createApp({
    db,
    mailer: { sendCode: async () => {} },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: withMeta ? { apiKey: "test", fetch: fakeMeta } : undefined,
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: fakeWeb,
  });
}

async function seedArchive() {
  const typical = (low: number, unit: string) => JSON.stringify({ low, high: low * 3, currency: "USD", unit });
  await db.query(
    `insert into archive_entities (id, domain, category, subcategory, name, kind, price_model, typical, tier) values
      ('dublin', 'Travel & places', 'City breaks', 'Irish cities', 'Dublin', 'place', 'trip', $1::jsonb, 1),
      ('gym-membership', 'Wellness & body', 'Fitness', 'Gyms', 'Gym membership', 'membership', 'per-month', $2::jsonb, 1),
      ('no-photos', 'Vehicles', 'Cars', 'SUVs', 'Some SUV', 'vehicle', 'one-off', $3::jsonb, 1)`,
    [typical(3500, "7 nights for two incl. economy flights; mid-range hotel (low) to luxury hotel (high)"), typical(60, "a month"), typical(50000, "new MSRP")],
  );
  for (const [entity, url, hero] of [["dublin", "https://upload.wikimedia.org/dublin-1.jpg", true], ["dublin", "https://upload.wikimedia.org/dublin-2.jpg", false], ["gym-membership", "https://upload.wikimedia.org/gym.jpg", true]] as const) {
    await db.query(
      `insert into archive_photos (entity_id, url, width, height, source, source_page, photographer, license, hero) values ($1, $2, 3840, 2560, 'commons', $2, 'Diliff', 'CC BY-SA 4.0', $3)`,
      [entity, url, hero],
    );
  }
}

async function events(res: Response) {
  return (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
}

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) } as Db;
  await migrate(db);
  metaCalls = [];
});

describe("the pool", () => {
  it("is the catalogue plus archive subjects with photos and a price paid once", async () => {
    await seedArchive();
    const res = await makeApp().request("/guest/pool");
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: any[] };
    expect(items.find((i) => i.id === "porsche-911")).toMatchObject({ group: "things", status: "verified" });
    const dublin = items.find((i) => i.id === `${ARCHIVE_PREFIX}dublin`);
    expect(dublin).toMatchObject({ name: "Dublin", kind: "visit", group: "travel", upfrontCents: 350_000, status: "estimate", url: "", note: "Typical price · 7 nights for two incl. economy flights", credit: "Photo: Diliff, CC BY-SA 4.0" });
    expect(dublin.media.images.map((i: any) => i.url)).toEqual(["https://upload.wikimedia.org/dublin-1.jpg", "https://upload.wikimedia.org/dublin-2.jpg"]);
    // A monthly price isn't an upfront cost, and a subject without photos can't be a card.
    expect(items.some((i) => i.id === `${ARCHIVE_PREFIX}gym-membership` || i.id === `${ARCHIVE_PREFIX}no-photos`)).toBe(false);
  });

  it("keeps only shapes it can price honestly", () => {
    const row = { id: "x", name: "X", kind: "stay", price_model: "per-night", domain: "Travel & places", typical: { low: 300, currency: "USD", unit: "a night" }, photos: [{ url: "u", width: 1, height: 1, source: "commons", photographer: null, license: "CC0" }] };
    expect(fromArchive(row, clock.toISOString())).toBeNull();
    expect(fromArchive({ ...row, kind: "place", price_model: "trip", typical: { low: 300, currency: "EUR", unit: "" } }, clock.toISOString())).toBeNull();
  });
});

describe("pricing the first wish before sign-in", () => {
  it("reserves guest voice against the same daily allowance before contacting Meta", async () => {
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'guest', 2.95, $1)", [clock.toISOString()]);
    const wav = new Uint8Array(44 + 32_000);
    const view = new DataView(wav.buffer);
    const text = (at: number, value: string) => wav.set(new TextEncoder().encode(value), at);
    text(0, "RIFF"); view.setUint32(4, wav.length - 8, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, 32_000, true);
    const res = await makeApp().request("/guest/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    expect(res.status).toBe(429);
    expect(metaCalls).toHaveLength(0);
  });

  it("streams what it is, the agent's trail, the fast card with its own photo, then the checked price", async () => {
    const res = await makeApp().request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.5" }, body: JSON.stringify({ text: "a peloton bike" }) });
    expect(res.status).toBe(200);
    const evs = await events(res);
    // The draft goes out as soon as it is read, then again with the questions and the answer the hunt assumed.
    const drafts = evs.filter((e) => e.type === "draft");
    expect(drafts[0]).toMatchObject({ title: "Peloton Bike+", kind: "buy" });
    expect(drafts.at(-1)).toMatchObject({ questions: [{ id: "package", label: "Which package?", options: ["Basics", "Essentials"], picked: "Basics", answered: false }] });
    expect(evs.some((e) => e.type === "step" && e.step.type === "note" && e.step.event?.kind === "thought")).toBe(true);
    expect(evs.filter((e) => e.type === "step").every((e) => typeof e.step.line === "string" && e.step.line.length > 0)).toBe(true);
    // The first card is the fast one: the seller's own page, its price and its own product photo.
    const cards = evs.filter((e) => e.type === "priced");
    expect(cards[0]).toMatchObject({ provisional: true, title: "Peloton Bike+", option: { url: SHOP, upfrontCents: 249_500, status: "verified", imageUrl: "https://www.onepeloton.com/img/bike-plus.jpg" }, questions: [{ id: "package", picked: "Basics" }] });
    expect(evs.indexOf(cards[0])).toBeGreaterThan(evs.findIndex((e) => e.type === "draft"));
    // The research's card follows only when it differs, never marked provisional; no error after a card.
    expect(cards.slice(1).every((c) => !c.provisional)).toBe(true);
    const priced = cards.at(-1);
    expect(priced.option).toMatchObject({ upfrontCents: 249_500, status: "verified" });
    expect(evs.some((e) => e.type === "error")).toBe(false);
    const spend = (await db.query<{ n: string }>("select count(*) as n from spend_ledger where user_id is null and kind = 'guest'")).rows[0]!;
    expect(Number(spend.n)).toBeGreaterThan(0);
  });

  it("hunts again with a changed answer, without reading the wish again", async () => {
    const draft = { title: "Peloton Bike+", kind: "buy", summary: "A Peloton Bike+ for home.", specifics: [], region: "US", currency: "USD", unknowns: [], questions: [{ id: "package", label: "Which package?", options: ["Basics", "Essentials"], picked: "Basics" }] };
    const res = await makeApp().request("/guest/wish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({ text: "a peloton bike", draft, answers: [{ question: "package", answer: "Essentials with the mat" }] }),
    });
    const evs = await events(res);
    expect(metaCalls.some((c) => c.text?.format?.name === "wish_draft")).toBe(false);
    expect(evs.find((e) => e.type === "draft")).toMatchObject({ questions: [{ id: "package", picked: "Essentials with the mat", answered: true }] });
    expect(metaCalls.find((c) => String(c.instructions ?? "").startsWith("You find, fast"))!.input).toContain("Which package? Essentials with the mat");
    expect(evs.find((e) => e.type === "priced")).toMatchObject({ questions: [{ id: "package", picked: "Essentials with the mat", answered: true }] });
  });

  it("caps each network address per hour, before any model call", async () => {
    const app = makeApp();
    const ask = () => app.request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.6" }, body: JSON.stringify({ text: "a peloton bike" }) });
    for (let i = 0; i < GUEST_WISHES_PER_IP_PER_HOUR; i++) await (await ask()).text();
    const calls = metaCalls.length;
    expect((await ask()).status).toBe(429);
    expect(metaCalls.length).toBe(calls);
  });

  it("stops at the guest share of the day's spend", async () => {
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'guest', 3.5, $1)", [clock.toISOString()]);
    const res = await makeApp().request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "a peloton bike" }) });
    expect(res.status).toBe(429);
    expect(metaCalls).toHaveLength(0);
  });

  it("reserves the next call against the guest allowance before calling Meta", async () => {
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'guest', 2.95, $1)", [clock.toISOString()]);
    const res = await makeApp().request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "a peloton bike" }) });
    const evs = await events(res);
    expect(metaCalls).toHaveLength(0);
    expect(evs).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("refuses an empty wish and a server without a key", async () => {
    expect((await makeApp().request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "" }) })).status).toBe(400);
    expect((await makeApp(false).request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "a bike" }) })).status).toBe(503);
  });
});

describe("the preview with a priced wish and archive picks", () => {
  it("sums the wish and the pool picks into the plan", async () => {
    await seedArchive();
    const res = await makeApp(false).request("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ picks: [`${ARCHIVE_PREFIX}dublin`], extra: { name: "Peloton Bike+", upfrontCents: 249_500, recurring: [{ label: "All-Access", amountCents: 4400, period: "month" }] }, monthlyCents: 100_000 }),
    });
    expect(res.status).toBe(200);
    const evs = await events(res);
    expect(evs[0]).toMatchObject({ type: "row", text: "Read your 2 picks." });
    expect(evs.find((e) => e.type === "result")).toMatchObject({ upfrontCents: 599_500, monthlyRunningCents: 4400 });
  });

  it("still needs something on the list", async () => {
    const res = await makeApp(false).request("/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks: [], monthlyCents: 100_000 }) });
    expect(res.status).toBe(400);
  });
});
