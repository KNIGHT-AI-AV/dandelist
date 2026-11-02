import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL_SHA256, emailHash } from "../src/admin";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { memoryMediaStore } from "../src/media-store";

/** GET /admin/*: the owner's read-only view of use, accounts and issues (src/admin.ts); a 404 to anyone else. */
let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;
let now: Date;
type Json = Record<string, any>;
type Deps = Parameters<typeof createApp>[0];

const OWNER = "owner@example.com";
const store = memoryMediaStore("https://api.test/media");
const make = (admins?: ReadonlySet<string>) =>
  createApp({
    db,
    mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => now,
    webOrigins: [],
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    media: { store, cutoutsPerDay: 0, imagesPerDay: 0 },
    oauth: { apiUrl: "https://api.test", production: false },
    admins,
  } as Deps);

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  now = new Date("2026-11-02T06:00:00Z");
  app = make(new Set([emailHash(OWNER)]));
});

const call = (path: string, token: string | null) => app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
async function signIn(email: string) {
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await post("/auth/email/start", { email });
  const body = (await (await post("/auth/email/verify", { email, code: mail.at(-1)!.code })).json()) as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}
const spend = (userId: string | null, kind: string, usd: number, at: string, tokens = [1000, 200]) =>
  db.query("insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values ($1, 'muse-spark-1.3', $2, $3, $4, 1, $5, $6)", [userId, kind, tokens[0], tokens[1], usd, at]);

describe("the admin view", () => {
  it("is a 404 to everyone but the owner: signed out, a bad token, or any other account", async () => {
    const other = await signIn("ada@example.com");
    for (const path of ["/admin/usage", "/admin/accounts", "/admin/issues"]) {
      expect((await call(path, null)).status).toBe(404);
      expect((await call(path, "not-a-token")).status).toBe(404);
      expect((await call(path, other.token)).status).toBe(404);
    }
    const owner = await signIn(OWNER);
    expect((await call("/admin/usage", owner.token)).status).toBe(200);
  });

  it("matches the owner's address whatever its case or spaces, and keeps no address in the code", async () => {
    expect(emailHash("  Owner@Example.COM ")).toBe(emailHash(OWNER));
    for (const h of ADMIN_EMAIL_SHA256) expect(h).toMatch(/^[0-9a-f]{64}$/);
    const owner = await signIn("OWNER@example.com");
    expect((await call("/admin/accounts", owner.token)).status).toBe(200);
  });

  it("is never cached and asks not to be indexed", async () => {
    const owner = await signIn(OWNER);
    const res = await call("/admin/usage", owner.token);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("shows model use by day and kind, with today's and all-time totals against the caps", async () => {
    const owner = await signIn(OWNER);
    await spend(null, "guest", 0.25, "2026-11-02T01:00:00Z");
    await spend(owner.id, "research", 0.1, "2026-11-02T02:00:00Z");
    await spend(owner.id, "research", 0.05, "2026-11-01T09:00:00Z");
    await spend(owner.id, "research", 9, "2026-10-01T09:00:00Z"); // outside the window, but in the all-time total
    const body = (await (await call("/admin/usage?days=2", owner.token)).json()) as Json;
    expect(body.from).toBe("2026-11-01");
    expect(body.days).toEqual([
      { day: "2026-11-02", kind: "guest", calls: 1, inputTokens: 1000, outputTokens: 200, searches: 1, usd: 0.25 },
      { day: "2026-11-02", kind: "research", calls: 1, inputTokens: 1000, outputTokens: 200, searches: 1, usd: 0.1 },
      { day: "2026-11-01", kind: "research", calls: 1, inputTokens: 1000, outputTokens: 200, searches: 1, usd: 0.05 },
    ]);
    expect(body.totals).toEqual({ todayUsd: 0.35, guestsTodayUsd: 0.25, totalUsd: 9.4, totalCalls: 4 });
    expect(body.caps).toEqual({ dailyUsd: 10, totalUsd: 120, guestDailyUsd: 6 });
  });

  it("lists every account with how it signs in, what it holds and its tokens, and signed-out visitors as one line", async () => {
    const ada = await signIn("ada@example.com");
    const owner = await signIn(OWNER);
    await db.query("insert into user_identities (provider, subject, user_id, email) values ('apple', 'sub-1', $1, 'ada@example.com')", [ada.id]);
    await app.request("/wishes", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ada.token}` }, body: JSON.stringify({ name: "Leica Q3", kind: "buy", tier: "nice", upfrontCents: 699_500, recurring: [] }) });
    await spend(ada.id, "research", 0.2, "2026-11-01T09:00:00Z", [5000, 600]);
    await spend(ada.id, "dream", 0.1, "2026-10-20T09:00:00Z", [3000, 400]);
    await spend(null, "guest", 0.3, "2026-11-02T01:00:00Z", [2000, 100]);
    const body = (await (await call("/admin/accounts", owner.token)).json()) as Json;
    const a = body.accounts.find((x: Json) => x.email === "ada@example.com");
    expect(a).toMatchObject({ providers: ["apple"], wishes: 1, runs: 0, memories: 0, reports: 0, calls: 2, inputTokens: 8000, outputTokens: 1000, usdWeek: 0.2 });
    expect(a.usd).toBeCloseTo(0.3);
    expect(a.lastUsed).toBe("2026-11-01T09:00:00.000Z");
    expect(a.lastSignIn).toBeTruthy();
    expect(body.accounts.find((x: Json) => x.email === OWNER)).toMatchObject({ calls: 0, usd: 0, providers: [] });
    expect(body.guests).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 100, usd: 0.3, usdWeek: 0.3 });
  });

  it("lists help reports with where they were and what was last said, and hunts that ended in an error", async () => {
    const ada = await signIn("ada@example.com");
    const owner = await signIn(OWNER);
    const report = { app: { route: "/wishes", platform: "ios", version: "1.0.0", build: "45", logs: [{ at: "t", level: "error", text: "boom" }] }, chat: { transcript: [{ role: "user", text: "Louis Vuitton green Christopher mm" }, { role: "assistant", text: "On it" }] }, replay: "ph-1" };
    await db.query("insert into help_reports (id, user_id, report, status, has_screen, created_at) values ('d1412af5-fb19-47ab-8c07-093849e11e19', $1, $2::jsonb, 'complete', true, $3)", [ada.id, JSON.stringify(report), now.toISOString()]);
    await db.query("insert into agent_runs (user_id, cache_key, status, draft, error, created_at) values ($1, 'k', 'error', $2::jsonb, 'Meta Model API returned 500', $3)", [ada.id, JSON.stringify({ title: "Rolex Submariner" }), now.toISOString()]);
    const body = (await (await call("/admin/issues", owner.token)).json()) as Json;
    expect(body.reports).toEqual([
      { id: "d1412af5-fb19-47ab-8c07-093849e11e19", code: "D1412A", at: now.toISOString(), email: "ada@example.com", route: "/wishes", platform: "ios", os: null, version: "1.0.0", build: "45", lastSaid: "Louis Vuitton green Christopher mm", logs: [{ at: "t", level: "error", text: "boom" }], replay: "ph-1", screen: true },
    ]);
    expect(body.failedRuns).toEqual([expect.objectContaining({ email: "ada@example.com", title: "Rolex Submariner", error: "Meta Model API returned 500" })]);
  });

  it("only reads: nothing under /admin changes data", async () => {
    const owner = await signIn(OWNER);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/admin/accounts", { method, headers: { Authorization: `Bearer ${owner.token}` } });
      expect(res.status).toBe(404);
    }
  });
});
