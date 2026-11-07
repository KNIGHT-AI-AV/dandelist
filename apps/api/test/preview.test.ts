import { PGlite } from "@electric-sql/pglite";
import { entry, firstPick, pairs } from "@dandelist/catalogue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { NOT_RECORDED, PREVIEWS_PER_IP_PER_HOUR, fallbackNote, ipOf, planFacts, reachBy } from "../src/preview";
import { unknownNumbers } from "../src/agent/agent";

const clock = new Date("2026-10-27T12:00:00Z");
let db: Db;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) } as Db;
  await migrate(db);
});

// The seller page shows the catalogue price for whatever is fetched.
const sellerPage = (price: string): typeof fetch =>
  (async () => new Response(`<html><title>Shop</title><body>Price ${price}</body></html>`, { status: 200, headers: { "content-type": "text/html" } })) as never;

function makeApp(webFetch: typeof fetch, meta?: typeof fetch) {
  return createApp({
    db,
    mailer: { sendCode: async () => {} },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: meta ? { apiKey: "test", fetch: meta } : undefined,
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch,
  });
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
}

const post = (app: ReturnType<typeof makeApp>, body: unknown, ip = "203.0.113.9") =>
  app.request("/preview", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

describe("pre-login preview", () => {
  it("writes its note from the facts and never asks a model, even with a key (nothing reaches AI before sign-in)", async () => {
    const meta = vi.fn(async () => new Response(JSON.stringify({ id: "should-not-run", output: [] }), { status: 200 }));
    const evs = await events(await post(makeApp(sellerPage("$1.00"), meta), { picks: ["porsche-911", "leica-q3"], monthlyCents: 300_000 }));
    expect(meta).not.toHaveBeenCalled();
    expect(evs.find((e) => e.type === "note").text.length).toBeGreaterThan(10);
    expect(evs.find((e) => e.type === "result").largest.share).toBe(95);
    expect((await db.query("select 1 from spend_ledger")).rows).toEqual([]);
  });

  it("streams real rows, a live check, a note and the result without a Meta key", async () => {
    const app = makeApp(sellerPage("$7,350.00"));
    const res = await post(app, { picks: ["leica-q3", "peloton-bike-plus"], monthlyCents: 100_000 });
    expect(res.status).toBe(200);
    const ev = await events(res);
    const rows = ev.filter((e) => e.type === "row");
    expect(rows[0].text).toBe("Read your 2 picks.");
    expect(rows.find((r) => r.id === "check" && r.state === "done").text).toContain("(just now)");
    expect(ev.find((e) => e.type === "note").text.length).toBeGreaterThan(10);
    const result = ev.find((e) => e.type === "result");
    expect(result.upfrontCents).toBe(entry("leica-q3")!.upfrontCents + entry("peloton-bike-plus")!.upfrontCents);
  });

  it("says so when the seller can't confirm the price", async () => {
    const ev = await events(await post(makeApp(sellerPage("$1.00")), { picks: ["leica-q3"], monthlyCents: 100_000 }));
    expect(ev.find((e) => e.id === "check" && e.state === "done").text).toMatch(/Couldn't confirm .* Using the .* check\./);
  });

  it.each(firstPick)("previews all nine picks after choosing %s and Both in every round", async (first) => {
    const picks = [...new Set([first, ...pairs.flat()])];
    expect(picks).toHaveLength(9);
    const res = await post(makeApp(sellerPage("$1.00")), { picks, monthlyCents: 100_000 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = await events(res);
    expect(ev.find((e) => e.id === "read").text).toBe("Read your 9 picks.");
    expect(ev.find((e) => e.type === "result").upfrontCents).toBe(picks.reduce((sum, id) => sum + entry(id)!.upfrontCents, 0));
  });

  it("rejects more than twelve picks before fetching a seller", async () => {
    const webFetch = vi.fn(sellerPage("$1.00"));
    // The flow's longest list is three answered rounds of Both plus Neither rounds: well under twelve.
    const picks = [...firstPick, ...pairs.flat(), ...firstPick.slice(0, 2)];
    expect(picks).toHaveLength(13);
    const res = await post(makeApp(webFetch), { picks, monthlyCents: 100_000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Check your picks and try again." });
    expect(webFetch).not.toHaveBeenCalled();
  });

  it("accepts a known percentage in the number guard and rejects an invented percentage", () => {
    const facts = { largest: { share_percent: "95%" } };
    expect(unknownNumbers("The largest is 95% of the total.", facts)).toEqual([]);
    expect(unknownNumbers("The largest is 96% of the total.", facts)).toEqual(["96"]);
  });

  it("trusts only the hop the proxy appended", () => {
    const h = (v: string) => (n: string) => (n === "x-forwarded-for" ? v : undefined);
    expect(ipOf(h("1.2.3.4, 198.51.100.7"))).toBe("198.51.100.7");
    expect(ipOf(h("198.51.100.7"))).toBe("198.51.100.7");
    expect(ipOf(() => undefined)).toBe("unknown");
  });

  it("refuses unknown picks and limits each address", async () => {
    const app = makeApp(sellerPage("$7,350.00"));
    expect((await post(app, { picks: ["nope"], monthlyCents: 100_000 })).status).toBe(400);
    for (let i = 0; i < PREVIEWS_PER_IP_PER_HOUR; i++) await (await post(app, { picks: ["vision-pro"], monthlyCents: 100_000 }, "198.51.100.7")).text();
    expect((await post(app, { picks: ["vision-pro"], monthlyCents: 100_000 }, "198.51.100.7")).status).toBe(429);
    expect((await post(app, { picks: ["vision-pro"], monthlyCents: 100_000 }, "198.51.100.8")).status).toBe(200);
  });
});
