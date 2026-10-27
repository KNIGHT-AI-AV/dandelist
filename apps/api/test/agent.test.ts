import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { unknownNumbers } from "../src/agent/agent";
import { assertPublicUrl, htmlToText, pageShowsPrice, structuredPrices } from "../src/agent/tools";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";

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
    await expect(assertPublicUrl("https://93.184.215.14/bike")).resolves.toBeInstanceOf(URL);
  });

  it("flags numbers the facts don't contain", () => {
    const facts = { horizon_years: 5, options: [{ upfront: "$2,495", total: "$5,135" }] };
    expect(unknownNumbers("It costs $2,495 now and $5,135 over 5 years.", facts)).toEqual([]);
    expect(unknownNumbers("It costs $2,500.", facts)).toEqual(["2,500"]);
  });
});

// A fake Meta Responses API that answers each step of the agent the way the real one does.
const SHOP = "https://93.184.215.14/bike-plus";
let explainReplies: string[];
let metaCalls: Record<string, unknown>[];

function reply(output: unknown[], id = `resp_${metaCalls.length}`) {
  return new Response(JSON.stringify({ id, output, usage: { input_tokens: 1000, output_tokens: 200 } }), { status: 200 });
}
const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });

const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, any>;
  metaCalls.push(body);
  const format = body.text?.format?.name;
  const toolNames = (body.tools ?? []).map((t: { name?: string; type: string }) => t.name ?? t.type);
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
    return reply([
      message(
        JSON.stringify({
          options: [
            { label: "Bike+ Basics", seller: "Peloton", url: SHOP, currency: "USD", price: 2495, recurring: [{ label: "All-Access", amount: 44, period: "month" }], evidence: "$2,495.00", confidence: "high" },
            { label: "Bike+ used", seller: "Marketplace", url: "https://93.184.215.15/used", currency: "USD", price: 1500, recurring: [], evidence: "$1,500", confidence: "low" },
            { label: "Not a link", seller: "x", url: "javascript:alert(1)", currency: "USD", price: 1, recurring: [], evidence: "", confidence: "low" },
          ],
          note: "Prices checked today.",
        }),
      ),
    ]);
  }
  if (toolNames.includes("get_page") && !body.previous_response_id) {
    return reply([{ type: "web_search_call", action: { query: "Peloton Bike+ price" } }, { type: "function_call", call_id: "gp_1", name: "get_page", arguments: JSON.stringify({ url: SHOP }) }]);
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
    expect(bike).toMatchObject({ label: "Bike+ Basics", status: "verified", upfrontCents: 249500, imageUrl: "https://93.184.215.14/img/bike.jpg" });
    expect(bike.totals.horizonCents).toBe(249500 + 4400 * 12 * 5);
    expect(used).toMatchObject({ status: "estimate", upfrontCents: 150000 });
    expect(run.result.explanation).toBe("The Bike+ Basics costs $2,495 upfront and $5,135 over 5 years.");
    const kinds = run.steps.map((s: { type: string }) => s.type);
    expect(kinds).toEqual(expect.arrayContaining(["search", "open", "check", "price", "explain"]));
    expect(run.costUsd).toBeGreaterThan(0);
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

  it("answers 503 when no Meta key is configured", async () => {
    app = makeApp(false);
    const t = await signIn("ada@example.com");
    expect((await call("POST", "/agent/interpret", t, { text: "a bike" })).status).toBe(503);
  });
});
