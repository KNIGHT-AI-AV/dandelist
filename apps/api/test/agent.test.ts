import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanThought, json, unknownNumbers } from "../src/agent/agent";
import { assertPublicUrl, htmlToText, pageNamesItem, pageShowsPrice, privateIp, sellerOwnsHost, structuredPrices } from "../src/agent/tools";

// Shop hostnames resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { createApp } from "../src/app";
import { forgetMoneyPhoto } from "../src/agent/worth";
import { migrate, type Db } from "../src/db";
import { visionReply } from "./vision";

describe("page tools", () => {
  it("finds a price however the page writes it", () => {
    const page = (text: string) => ({ text, structuredPrices: [] });
    expect(pageShowsPrice(page("Now $2,495.00 with free delivery"), 2495)).toBe(true);
    expect(pageShowsPrice(page("Prix 2.495,00 €"), 2495)).toBe(true);
    expect(pageShowsPrice(page("Only 2495 left"), 2495)).toBe(true);
    expect(pageShowsPrice(page("Now $2,495.00"), 249)).toBe(false);
    expect(pageShowsPrice(page("$44.50 a month"), 44.5)).toBe(true);
    expect(pageShowsPrice({ text: "", structuredPrices: [{ amount: 1299.99 }] }, 1299.99)).toBe(true);
  });

  it("reads JSON-LD offers and strips markup", () => {
    const html = `<title>Bike</title><script type="application/ld+json">{"@type":"Product","offers":{"price":"2495.00","priceCurrency":"USD"}}</script><p>Hello&nbsp;<b>there</b></p><script>var x=1</script>`;
    expect(structuredPrices(html)).toEqual([{ amount: 2495, currency: "USD" }]);
    expect(htmlToText(html)).toContain("Hello there");
    expect(htmlToText(html)).not.toContain("var x");
  });

  it("refuses private and non-web addresses", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toThrow();
    await expect(assertPublicUrl("http://10.1.2.3/")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:8080/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::ffff:7f00:1]/")).rejects.toThrow();
    await expect(assertPublicUrl("https://93.184.215.14/bike")).resolves.toBeInstanceOf(URL);
  });

  it("treats every mapped, translated and reserved form of a private address as private", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "169.254.169.254", "fd00::1", "fe80::1", "0.0.0.0", "::", "100.64.0.1", "nonsense"]) {
      expect(privateIp(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.215.14", "2606:4700::6810:84e5", "8.8.8.8"]) expect(privateIp(ip), ip).toBe(false);
  });

  it("counts a page as the seller's only when its host belongs to the seller", () => {
    expect(sellerOwnsHost("Herman Miller", "https://store.hermanmiller.com/living-room-furniture/eames-lounge-chair")).toBe(true);
    expect(sellerOwnsHost("Herman Miller", "https://www.thekitchn.com/eames-chair-at-home")).toBe(false);
    expect(sellerOwnsHost("Leica Camera", "https://leica-camera.com/en-US/q3")).toBe(true);
    expect(sellerOwnsHost("Leica Camera", "https://woodwardcamera.com/products/leica-q3")).toBe(false);
    expect(sellerOwnsHost("B&H Photo Video", "https://www.bhphotovideo.com/c/product/1.html")).toBe(true);
    expect(sellerOwnsHost("B&H", "https://www.bhphotovideo.com/c/product/1.html")).toBe(true);
    expect(sellerOwnsHost("Peloton", "https://www.onepeloton.com/bike-plus")).toBe(true);
    expect(sellerOwnsHost("TAP Air Portugal", "https://www.flytap.com/en-us/flights")).toBe(true);
    expect(sellerOwnsHost("Booking.com", "https://www.booking.com/hotel/pt/avenida-palace.html")).toBe(true);
    expect(sellerOwnsHost("John Lewis", "https://www.johnlewis.co.uk/eames")).toBe(true);
    expect(sellerOwnsHost("Design Within Reach", "https://www.dwr.com/living/eames")).toBe(true);
    expect(sellerOwnsHost("Hotel Avenida Palace", "https://www.avenidapalace.com/rooms")).toBe(true);
    expect(sellerOwnsHost("Leica Camera", "https://leicacamerausa.com/q3")).toBe(true);
    expect(sellerOwnsHost("Lisbon Lofts", "https://www.lisbon-food-blog.com/stay")).toBe(false);
    expect(sellerOwnsHost("Peloton", "https://www.pelotonfanblog.com/bike")).toBe(false);
    expect(sellerOwnsHost("Porsche", "https://93.184.215.14/911")).toBe(false);
    expect(sellerOwnsHost("Porsche", "not a url")).toBe(false);
  });

  it("only takes a price from a page that names the item", () => {
    const page = (title: string, text: string) => ({ title, text });
    expect(pageNamesItem(page("Stays | KAYAK", "Hotels from $75 a night"), "ibis Lisboa Centro Liberdade, double room")).toBe(false);
    expect(pageNamesItem(page("ibis Lisboa Centro Liberdade | KAYAK", "$75 a night"), "ibis Lisboa Centro Liberdade, double room")).toBe(true);
    expect(pageNamesItem(page("Peloton Bike+", "Bike+ $2,495.00"), "Bike+ Basics")).toBe(true);
    expect(pageNamesItem(page("Home", "Sale $75"), "New, double room")).toBe(true);
  });

  it("flags numbers the facts don't contain", () => {
    const facts = { horizon_years: 5, options: [{ upfront: "$2,495", total: "$5,135" }] };
    expect(unknownNumbers("It costs $2,495 now and $5,135 over 5 years.", facts)).toEqual([]);
    expect(unknownNumbers("It costs $2,500.", facts)).toEqual(["2,500"]);
  });
});

// A fake Meta Responses API that answers each step of the agent the way the real one does.
const SHOP = "https://www.onepeloton.com/bike-plus";
let explainReplies: string[];
let metaCalls: Record<string, unknown>[];
/** The pages the fast find's search names; none unless a test sets some. */
let quickLines: string;
/** Holds the research's final answer back until a test releases it. */
let gate: Promise<void> | null;

function reply(output: unknown[], id = `resp_${metaCalls.length}`) {
  return new Response(JSON.stringify({ id, output, usage: { input_tokens: 1000, output_tokens: 200 } }), { status: 200 });
}
const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });

const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, any>;
  metaCalls.push(body);
  const format = body.text?.format?.name;
  const toolNames = (body.tools ?? []).map((t: { name?: string; type: string }) => t.name ?? t.type);
  if (String(body.instructions ?? "").startsWith("You find, fast")) {
    return reply(quickLines ? [{ type: "web_search_call", action: { query: "peloton bike+ price" }, results: [{ url: SHOP, title: "Peloton Bike+" }] }, message(quickLines)] : [message("Nothing found.")]);
  }
  if (format === "wish_questions") return reply([message(JSON.stringify({ questions: [] }))]);
  const vision = visionReply(body);
  if (vision !== null) return reply([message(vision)]);
  // The photo search's plan, beside every hunt: nothing it names opens here, so the hunt's own photos stand.
  if (format === "photo_plan") return reply([message(JSON.stringify({ articles: [], commons: "", web: "", kind: "product" }))]);
  if (format === "wish_draft" && /million dollars/i.test(String(body.input))) {
    return reply([message(JSON.stringify({ title: "A million dollars", kind: "buy", summary: "A million dollars.", specifics: [], region: "US", currency: "USD", unknowns: [], worth: "money", amount: 1_000_000, line: "" }))]);
  }
  if (format === "wish_draft" && /\blove\b/i.test(String(body.input))) {
    return reply([message(JSON.stringify({ title: "Love", kind: "do", summary: "Love.", specifics: [], region: "US", currency: "USD", unknowns: [], worth: "priceless", amount: 0, line: "Free to give, impossible to buy." }))]);
  }
  if (format === "wish_draft") {
    return reply([
      message(
        JSON.stringify({ title: "Peloton Bike+", kind: "buy", summary: "A Peloton Bike+ for home.", specifics: [{ name: "model", value: "Bike+" }], region: "US", currency: "usd", unknowns: ["package"] }),
      ),
    ]);
  }
  if (toolNames.includes("ask_user")) {
    return reply([{ type: "function_call", call_id: "ask_1", name: "ask_user", arguments: JSON.stringify({ questions: [{ question: "Which package?", choices: ["Basics", "Essentials"] }] }) }]);
  }
  if (format === "price_options") {
    await gate;
    return reply([
      message(
        JSON.stringify({
          options: [
            { label: "Bike+ Basics", seller: "Peloton", url: SHOP, currency: "USD", price: 2495, recurring: [{ label: "All-Access", amount: 44, period: "month" }], evidence: "$2,495.00", confidence: "high" },
            { label: "Bike+ used", seller: "Marketplace", url: "https://93.184.215.15/used", currency: "USD", price: 1500, recurring: [], evidence: "$1,500", confidence: "low" },
            { label: "Not a link", seller: "x", url: "javascript:alert(1)", currency: "USD", price: 1, recurring: [], evidence: "", confidence: "low" },
          ],
          note: "The bike plus a year of membership comes to about $3,423.",
        }),
      ),
    ]);
  }
  if (toolNames.includes("get_page") && !body.previous_response_id) {
    const thought = "Peloton's own store sets the list price,   so I'll read it there first: https://evil.example/x";
    return reply([{ type: "web_search_call", action: { query: "Peloton Bike+ price" } }, { type: "function_call", call_id: "gp_1", name: "get_page", arguments: JSON.stringify({ thought, url: SHOP }) }]);
  }
  if (toolNames.includes("get_page")) return reply([message("Found it.")]);
  return reply([message(explainReplies.shift() ?? "The Bike+ Basics costs $2,495 upfront and $5,135 over 5 years.")]);
}) as unknown as typeof fetch;

const fakeWeb = (async (url: string | URL) => {
  const u = String(url);
  if (u.startsWith(SHOP)) {
    return new Response(`<html><head><title>Peloton Bike+</title><meta property="og:image" content="/img/bike.jpg"></head><body>Bike+ $2,495.00. Membership $44/mo.</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  return new Response("<html><body>Sold out</body></html>", { status: 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;
const clock = new Date("2026-10-27T12:00:00Z");

function makeApp(withMeta = true) {
  return createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: withMeta ? { apiKey: "test", fetch: fakeMeta } : undefined,
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: fakeWeb,
  });
}

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  metaCalls = [];
  explainReplies = [];
  quickLines = "";
  gate = null;
  forgetMoneyPhoto();
  app = makeApp();
});

const call = (method: string, path: string, token: string, body?: unknown) =>
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

async function finished(token: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const { run } = (await (await call("GET", `/agent/runs/${id}`, token)).json()) as { run: Record<string, any> };
    if (run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("run never finished");
}

describe("wish agent", () => {
  it("reads a wish and asks only what changes the price", async () => {
    const t = await signIn("ada@example.com");
    const res = await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: Record<string, unknown>; questions: unknown[] };
    expect(body.draft).toMatchObject({ title: "Peloton Bike+", kind: "buy", currency: "USD" });
    expect(body.questions).toEqual([{ question: "Which package?", choices: ["Basics", "Essentials"] }]);
    const spend = await db.query<{ n: number }>("select count(*)::int as n from spend_ledger where kind = 'interpret'");
    expect(spend.rows[0]!.n).toBe(2);
  });

  it("researches, verifies prices on their pages, prices the horizon and explains", async () => {
    const t = await signIn("ada@example.com");
    const { draft } = (await (await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" })).json()) as { draft: unknown };
    const start = await call("POST", "/agent/runs", t, { draft, answers: [{ question: "Which package?", answer: "Basics" }] });
    expect(start.status).toBe(202);
    const run = await finished(t, ((await start.json()) as { run: { id: string } }).run.id);

    expect(run.status).toBe("done");
    const [bike, used] = run.result.options;
    expect(run.result.options).toHaveLength(2); // the javascript: link is dropped
    expect(bike).toMatchObject({ label: "Bike+ Basics", status: "verified", statusLabel: "Checked on onepeloton.com", upfrontCents: 249500, imageUrl: "https://www.onepeloton.com/img/bike.jpg" });
    expect(bike.totals.horizonCents).toBe(249500 + 4400 * 12 * 5);
    expect(used).toMatchObject({ status: "estimate", upfrontCents: 150000 });
    expect(run.result.explanation).toBe("The Bike+ Basics costs $2,495 upfront and $5,135 over 5 years.");
    expect(run.result.note).toBe(""); // its $3,423 isn't a number the cost engine produced
    const kinds = run.steps.map((s: { type: string }) => s.type);
    expect(kinds).toEqual(expect.arrayContaining(["search", "open", "check", "price", "explain"]));
    // The agent's reason for opening the page arrives just before the page, as one clean line with no link.
    const thoughtAt = run.steps.findIndex((s: { event?: { kind: string } }) => s.event?.kind === "thought");
    expect(run.steps[thoughtAt]).toMatchObject({ type: "note", text: "Peloton's own store sets the list price, so I'll read it there first:" });
    expect(run.steps[thoughtAt + 1]).toMatchObject({ type: "open" });
    expect(run.costUsd).toBeGreaterThan(0);
  });

  it("starts from the person's words, shows the fast card while it runs and ends with the research's, by question", async () => {
    quickLines = `${SHOP} | $2,495.00 | USD`;
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const t = await signIn("ada@example.com");
    const start = await call("POST", "/agent/runs", t, { text: "a peloton bike plus" });
    expect(start.status).toBe(202);
    const id = ((await start.json()) as { run: { id: string } }).run.id;
    // While the research still runs, the run already holds the fast card, marked provisional, and the read draft.
    let early: Record<string, any> | undefined;
    for (let i = 0; i < 200 && !early; i++) {
      const { run } = (await (await call("GET", `/agent/runs/${id}`, t)).json()) as { run: Record<string, any> };
      if (run.status === "running" && run.result?.provisional) early = run;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(early!.result.options[0]).toMatchObject({ url: SHOP, upfrontCents: 249_500 });
    expect(early!.draft).toMatchObject({ title: "Peloton Bike+", kind: "buy" });
    expect(early!.steps.every((s: { line?: string }) => typeof s.line === "string" && s.line.length > 0 && s.line.length <= 64)).toBe(true);
    release();
    const run = await finished(t, id);
    expect(run.status).toBe("done");
    expect(run.result).toMatchObject({ provisional: false, questions: [] });
    expect(run.result.options[0]).toMatchObject({ label: "Bike+ Basics", status: "verified", upfrontCents: 249_500 });
  });

  it("hunts again from a run's draft with changed answers", async () => {
    const t = await signIn("ada@example.com");
    const draft = { title: "Peloton Bike+", kind: "buy", summary: "A Peloton Bike+.", specifics: [], region: "US", currency: "USD", unknowns: [], questions: [{ id: "package", label: "Which package?", options: ["Basics", "Essentials"], picked: "Basics" }] };
    const start = await call("POST", "/agent/runs", t, { draft, answers: [{ question: "package", answer: "Essentials" }] });
    const run = await finished(t, ((await start.json()) as { run: { id: string } }).run.id);
    expect(run.result.questions).toEqual([{ id: "package", label: "Which package?", options: ["Basics", "Essentials"], picked: "Essentials", answered: true }]);
    expect(metaCalls.some((c) => (c.text as { format?: { name?: string } } | undefined)?.format?.name === "wish_draft")).toBe(false);
    const researched = metaCalls.find((c) => String(c.instructions ?? "").startsWith("You are Dandelist's price researcher"))!;
    expect(researched.input).toContain("The person answered: Which package? Essentials");
  });

  it("hands money back as an amount to pick and something priceless as infinity, with no price hunt", async () => {
    const t = await signIn("ada@example.com");
    const money = await finished(t, ((await (await call("POST", "/agent/runs", t, { text: "a million dollars" })).json()) as { run: { id: string } }).run.id);
    expect(money.status).toBe("done");
    expect(money.draft).toMatchObject({ title: "A million dollars", worth: "money", amount: 1_000_000 });
    expect(money.result).toMatchObject({ options: [], provisional: false, worth: { worth: "money", title: "A million dollars", kind: "buy", amountCents: 100_000_000 } });
    expect(money.result.photo).toBeUndefined(); // nothing passed here, so the card shows its own panel

    const love = await finished(t, ((await (await call("POST", "/agent/runs", t, { text: "love" })).json()) as { run: { id: string } }).run.id);
    expect(love.result).toMatchObject({ options: [], worth: { worth: "priceless", title: "Love", line: "Free to give, impossible to buy." } });
    expect(metaCalls.some((c) => (c.text as { format?: { name?: string } } | undefined)?.format?.name === "price_options")).toBe(false);

    // Reading money for the add-a-wish screen asks nothing back: there is no price to narrow down.
    const read = (await (await call("POST", "/agent/interpret", t, { text: "a million dollars" })).json()) as { draft: Record<string, unknown>; questions: unknown[] };
    expect(read).toMatchObject({ draft: { worth: "money" }, questions: [] });
    expect(metaCalls.some((c) => (c.tools as { name?: string }[] | undefined)?.some((x) => x.name === "ask_user"))).toBe(false);
  });

  it("prices a money wish when its card's Price it asks, never serving the money run from the cache", async () => {
    const t = await signIn("ada@example.com");
    const id = async (res: Response) => ((await res.json()) as { run: { id: string } }).run.id;
    const money = await finished(t, await id(await call("POST", "/agent/runs", t, { text: "a million dollars" })));
    expect(money.result.worth).toMatchObject({ worth: "money" });

    const asked = await call("POST", "/agent/runs", t, { text: "a million dollars", price: true });
    expect(asked.status).toBe(202); // a new hunt, not the cached money run
    const priced = await finished(t, await id(asked));
    expect(priced.result.worth).toBeUndefined();
    expect(priced.draft).toMatchObject({ worth: "priced" });
    expect(priced.result.options.length).toBeGreaterThan(0);

    // The same words without "Price it" still get the money card, from the cache.
    const again = await call("POST", "/agent/runs", t, { text: "a million dollars" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { run: { id: string; result: { worth?: unknown } } }).run).toMatchObject({ id: money.id, result: { worth: { worth: "money" } } });
  });

  it("keeps thoughts to one short plain line", () => {
    expect(cleanThought(42)).toBeNull();
    expect(cleanThought("ok")).toBeNull();
    expect(cleanThought("Checking\nthe   maker's page")).toBe("Checking the maker's page");
    const long = cleanThought("word ".repeat(60))!;
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("falls back to its own sentence when the model invents a number", async () => {
    explainReplies = ["It costs about $2,600.", "Roughly $3,000 all in."];
    const t = await signIn("ada@example.com");
    const { draft } = (await (await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" })).json()) as { draft: unknown };
    const start = await call("POST", "/agent/runs", t, { draft });
    const run = await finished(t, ((await start.json()) as { run: { id: string } }).run.id);
    expect(run.result.explanation).toMatch(/asks the least upfront at \$1,500/);
    expect(unknownNumbers(run.result.explanation, { a: "$1,500 $2,495 $5,135 $1,500 5" })).toEqual([]);
  });

  it("serves a repeat request from the cache and keeps runs private", async () => {
    const t = await signIn("ada@example.com");
    const { draft } = (await (await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" })).json()) as { draft: unknown };
    const first = ((await (await call("POST", "/agent/runs", t, { draft })).json()) as { run: { id: string } }).run;
    await finished(t, first.id);
    const callsBefore = metaCalls.length;
    const again = await call("POST", "/agent/runs", t, { draft });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { run: { cached: boolean } }).run.cached).toBe(true);
    expect(metaCalls.length).toBe(callsBefore);

    const other = await signIn("bob@example.com");
    expect((await call("GET", `/agent/runs/${first.id}`, other)).status).toBe(404);
  });

  it("stops at the spend cap and says so", async () => {
    const t = await signIn("ada@example.com");
    await db.query("insert into spend_ledger (model, kind, cost_usd, created_at) values ('muse-spark-1.3', 'test', 120, $1)", [clock.toISOString()]);
    const res = await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/);
  });

  it("stops one person at their own daily allowance", async () => {
    const t = await signIn("ada@example.com");
    const { rows } = await db.query<{ id: string }>("select id from users where email = 'ada@example.com'");
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'muse-spark-1.3', 'research', 2, $2)", [rows[0]!.id, clock.toISOString()]);
    const res = await call("POST", "/agent/interpret", t, { text: "a peloton bike plus" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/allowance/);
    const other = await signIn("bob@example.com");
    expect((await call("POST", "/agent/interpret", other, { text: "a peloton bike plus" })).status).toBe(200);
  });

  it("answers 503 when no Meta key is configured", async () => {
    app = makeApp(false);
    const t = await signIn("ada@example.com");
    expect((await call("POST", "/agent/interpret", t, { text: "a bike" })).status).toBe(503);
  });
});

describe("the model's JSON answer", () => {
  it("reads the object after a sentence the model put first, and still fails on text with no object", () => {
    expect(json('{"options":[]}')).toEqual({ options: [] });
    expect(json('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(json('I\'ve gathered the prices. {"options":[{"label":"x"}],"note":""}')).toEqual({ options: [{ label: "x" }], note: "" });
    expect(() => json("I couldn't find anything.")).toThrow();
  });
});
