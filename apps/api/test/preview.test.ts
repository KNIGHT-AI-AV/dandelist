import { PGlite } from "@electric-sql/pglite";
import { entry } from "@dandelist/catalogue";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { PREVIEWS_PER_IP_PER_HOUR, fallbackNote, ipOf, planFacts, reachBy } from "../src/preview";

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
  it("computes the plan from the catalogue and the cost engine", () => {
    const porsche = entry("porsche-911")!;
    const leica = entry("leica-q3")!;
    const f = planFacts([porsche, leica], 300_000, clock);
    expect(f.everything_upfront).toBe("$142,850");
    expect(f.largest.name).toBe("Porsche 911 Carrera");
    expect(f.largest.share_percent).toBe(95);
    // $142,850 at $3,000 a month is 48 months from Oct 2026.
    expect(f.everything_by).toBe(new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(reachBy(14_285_000, 300_000, clock)));
    expect(fallbackNote(f)).toContain("95%");
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

  it("drops a model note that invents numbers", async () => {
    const meta = (async () =>
      new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "You'll have it all in 3 years for $99." }] }], usage: { input_tokens: 10, output_tokens: 10 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as never;
    const ev = await events(await post(makeApp(sellerPage("$7,350.00"), meta), { picks: ["leica-q3"], monthlyCents: 100_000 }));
    expect(ev.find((e) => e.type === "note").text).not.toContain("$99");
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
