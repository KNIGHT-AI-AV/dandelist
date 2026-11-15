import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { accepted } from "./consent-helper";
import { ADMIN_DIGESTS, adminDigest, issueOf } from "../src/admin";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { memoryMediaStore } from "../src/media-store";
import { reserve, settle } from "../src/spend-reservations";

/** GET /admin/*: the owner's read-only view of use, accounts and issues (src/admin.ts); a 404 to anyone else. */
let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;
let now: Date;
type Json = Record<string, any>;
type Deps = Parameters<typeof createApp>[0];

const OWNER = "owner@example.com";
const PEPPER = "test-pepper-16-chars";
const store = memoryMediaStore("https://api.test/media");
const make = (admins?: ReadonlySet<string>) =>
  createApp({
    db,
    mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: PEPPER,
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
  app = make(new Set([adminDigest(OWNER, PEPPER)]));
});

const call = (path: string, token: string | null) => app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
async function signIn(email: string) {
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await post("/auth/email/start", { email });
  const body = (await (await post("/auth/email/verify", { email, code: mail.at(-1)!.code })).json()) as { accessToken: string; user: { id: string } };
  await accepted(app, body.accessToken);
  return { token: body.accessToken, id: body.user.id };
}
const spend = (userId: string | null, kind: string, usd: number, at: string, tokens = [1000, 200]) =>
  db.query("insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values ($1, 'muse-spark-1.3', $2, $3, $4, 1, $5, $6)", [userId, kind, tokens[0], tokens[1], usd, at]);

describe("the admin view", () => {
  it("is the plain 404 of a missing path to everyone but the owner: signed out, a bad token, or any other account", async () => {
    const other = await signIn("ada@example.com");
    const missing = await app.request("/no-such-path");
    for (const path of ["/admin/usage", "/admin/accounts", "/admin/issues", "/admin/inference-readiness"]) {
      for (const res of [await call(path, null), await call(path, "not-a-token"), await call(path, other.token)]) {
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(await missing.clone().text());
      }
    }
    const owner = await signIn(OWNER);
    expect((await call("/admin/usage", owner.token)).status).toBe(200);
  });

  it("matches the owner's address whatever its case or spaces, keyed so a guess can't be checked without the pepper", async () => {
    expect(adminDigest("  Owner@Example.COM ", PEPPER)).toBe(adminDigest(OWNER, PEPPER));
    expect(adminDigest(OWNER, "another-pepper-16")).not.toBe(adminDigest(OWNER, PEPPER));
    // Its own prefix: never the plain HMAC the same pepper gives an agent key of the same text.
    expect(adminDigest(OWNER, PEPPER)).not.toBe((await import("node:crypto")).createHmac("sha256", PEPPER).update(OWNER).digest("hex"));
    for (const h of ADMIN_DIGESTS) expect(h).toMatch(/^[0-9a-f]{64}$/);
    const owner = await signIn("OWNER@example.com");
    expect((await call("/admin/accounts", owner.token)).status).toBe(200);
  });

  it("is never cached and asks not to be indexed", async () => {
    const owner = await signIn(OWNER);
    const res = await call("/admin/usage", owner.token);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("reads a real empty readiness baseline without granting permission to infer", async () => {
    const owner = await signIn(OWNER);
    const res = await call("/admin/inference-readiness", owner.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const body = await res.json() as Json;
    expect(body).toEqual({
      asOf: expect.any(String), utcDayStart: `${body.asOf.slice(0, 10)}T00:00:00.000Z`, currency: "USD",
      ledgerAudit: { reservationUnlinkedTotalCalls: 0, nonPilotModelTotalCalls: 0, ownerReservationUnlinkedTodayCalls: 0, ownerNonPilotModelTodayCalls: 0 },
      claude: {
        poolTotalUsd: 0, ledgerTotalUsd: 0, ledgerTotalCalls: 0, ledgerTodayUsd: 0, ledgerTodayCalls: 0,
        ledgerTotalInputTokens: 0, ledgerTotalOutputTokens: 0, ledgerTotalSearches: 0,
        unconfirmedTotalUsd: 0, unconfirmedTotalCalls: 0, unconfirmedTodayUsd: 0, unconfirmedTodayCalls: 0,
        activeHolds: { count: 0, usd: 0 }, expiredHolds: { count: 0, usd: 0 },
      },
      owner: {
        ledgerTodayUsd: 0, ledgerTodayCalls: 0, unconfirmedTodayUsd: 0, unconfirmedTodayCalls: 0,
        ledgerTodayInputTokens: 0, ledgerTodayOutputTokens: 0, ledgerTodaySearches: 0,
        activeHolds: { count: 0, usd: 0 }, expiredHolds: { count: 0, usd: 0 }, savedNoteCount: 0,
      },
    });
  });

  it("counts the shared Claude pool, UTC-inclusive spend, unknown charges and holds without disclosing account content", async () => {
    const other = await signIn("ada@example.com");
    const owner = await signIn(OWNER);
    // Database UTC, independent of the connection timezone or the test auth clock.
    await db.exec("set timezone = 'Pacific/Honolulu'");
    const start = (await (await call("/admin/inference-readiness", owner.token)).json() as Json).utcDayStart as string;
    const yesterday = new Date(Date.parse(start) - 1).toISOString();
    for (const [userId, model, kind, usd, at, input, output, searches] of [
      [owner.id, "claude-haiku-5-5", "facts", .01, start, 11, 2, 1],
      [owner.id, "claude-haiku-5-5", "facts:unconfirmed", .05, start, 13, 3, 2],
      [owner.id, "claude-opus-5-5", "old:unconfirmed", .03, yesterday, 17, 5, 3],
      [other.id, "claude-haiku-5-5", "photo", .02, start, 19, 7, 4],
      [other.id, "claude-haiku-5-5", "photo:unconfirmed", .04, start, 23, 11, 5],
      [owner.id, "claude-opus-5-5", "legacy", .005, start, 29, 13, 6],
      [null, "claude-opus-5-5", "legacy", .07, yesterday, 31, 17, 7],
      [owner.id, "muse-spark-1.3", "old-meta", .9, start, 1000, 2000, 100],
      [owner.id, "apify:test", "tool", .8, start, 3000, 4000, 200],
    ]) {
      await db.query("insert into spend_ledger(user_id, model, kind, cost_usd, created_at, input_tokens, output_tokens, searches) values ($1,$2,$3,$4,$5,$6,$7,$8)", [userId, model, kind, usd, at, input, output, searches]);
    }
    for (const [userId, pool, usd, mineUsd, state, expired] of [
      [owner.id, "claude", .04, .02, "held", false],
      [other.id, "claude", .03, .01, "held", false],
      [null, "claude", .02, .005, "held", false],
      [owner.id, "claude", .06, .03, "held", true],
      [other.id, "claude", .07, .04, "expired", true],
      [owner.id, "claude", .08, .05, "released", false],
      [owner.id, "claude", .09, .06, "settled", false],
      [owner.id, "meta", .4, .2, "held", false],
    ]) {
      await db.query(`insert into spend_reservations(id, user_id, pool, usd, mine_usd, state, created_at, expires_at)
        values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,statement_timestamp() + ($7::int * interval '1 hour'))`,
        [userId, pool, usd, mineUsd, state, yesterday, expired ? -1 : 1]);
    }
    await db.query(`update spend_ledger set reservation_id =
      (select id from spend_reservations where user_id = $1::text and pool = 'claude' and state = 'settled')
      where user_id = $1::uuid and kind = 'facts'`, [owner.id]);
    for (const [userId, note] of [[owner.id, "private-owner-note"], [owner.id, "second-private-note"], [owner.id, ""], [owner.id, null], [other.id, "private-other-note"]]) {
      await db.query("insert into wishes(user_id,name,kind,tier,note) values ($1,'private-wish-title','buy','nice',$2)", [userId, note]);
    }
    // No query parameter can select another person's ledger or notes.
    const body = await (await call(`/admin/inference-readiness?userId=${other.id}`, owner.token)).json() as Json;
    expect(body.utcDayStart).toBe(start);
    expect(body.ledgerAudit).toEqual({ reservationUnlinkedTotalCalls: 8, nonPilotModelTotalCalls: 5, ownerReservationUnlinkedTodayCalls: 4, ownerNonPilotModelTodayCalls: 3 });
    expect(body.claude).toEqual({
      poolTotalUsd: .225, ledgerTotalUsd: .225, ledgerTotalCalls: 7, ledgerTodayUsd: .125, ledgerTodayCalls: 5,
      ledgerTotalInputTokens: 143, ledgerTotalOutputTokens: 58, ledgerTotalSearches: 28,
      unconfirmedTotalUsd: .12, unconfirmedTotalCalls: 3, unconfirmedTodayUsd: .09, unconfirmedTodayCalls: 2,
      activeHolds: { count: 3, usd: .09 }, expiredHolds: { count: 2, usd: .13 },
    });
    expect(body.owner).toEqual({
      ledgerTodayUsd: .065, ledgerTodayCalls: 3, unconfirmedTodayUsd: .05, unconfirmedTodayCalls: 1,
      ledgerTodayInputTokens: 53, ledgerTodayOutputTokens: 18, ledgerTodaySearches: 9,
      activeHolds: { count: 1, usd: .02 }, expiredHolds: { count: 1, usd: .03 }, savedNoteCount: 2,
    });
    for (const content of [owner.id, other.id, OWNER, "ada@example.com", "private-", "userId", "note:"]) expect(JSON.stringify(body)).not.toContain(content);
  });

  it("observes real reservation settlement once, includes unknown charges in spend, and cannot write even in a read-only transaction", async () => {
    const owner = await signIn(OWNER);
    const held = await reserve(db, { userId: owner.id, pool: "claude", usd: .05 });
    if (held === "slots") throw new Error("Unexpected fixture concurrency");
    const before = await (await call("/admin/inference-readiness", owner.token)).json() as Json;
    expect(before.claude.activeHolds).toEqual({ count: 1, usd: .05 });
    expect(before.claude.ledgerTotalUsd).toBe(0);
    await settle(db, held.id, owner.id, "facts:unconfirmed", { model: "claude-haiku-5-5", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 }, .05, new Date(before.asOf));
    const confirmed = await reserve(db, { userId: owner.id, pool: "claude", usd: .05 });
    if (confirmed === "slots") throw new Error("Unexpected fixture concurrency");
    await settle(db, confirmed.id, owner.id, "facts", { model: "claude-haiku-5-5", inputTokens: 17, cachedInputTokens: 0, outputTokens: 5, searches: 2 }, .02, new Date(before.asOf));
    await db.exec("begin read only");
    try {
      const res = await call("/admin/inference-readiness", owner.token);
      expect(res.status).toBe(200);
      const body = await res.json() as Json;
      expect(body.claude).toMatchObject({ poolTotalUsd: .07, ledgerTotalUsd: .07, ledgerTotalCalls: 2, unconfirmedTotalUsd: .05, activeHolds: { count: 0, usd: 0 } });
      expect(body.owner).toMatchObject({ ledgerTodayUsd: .07, unconfirmedTodayUsd: .05, activeHolds: { count: 0, usd: 0 } });
      expect(body.ledgerAudit).toEqual({ reservationUnlinkedTotalCalls: 0, nonPilotModelTotalCalls: 0, ownerReservationUnlinkedTodayCalls: 0, ownerNonPilotModelTodayCalls: 0 });
      // Compare before/after counters without any model, credential or customer-content path.
      for (const [section, window] of [["claude", "Total"], ["owner", "Today"]] as const) {
        for (const [metric, delta] of [["InputTokens", 17], ["OutputTokens", 5], ["Searches", 2]] as const) {
          const field = `ledger${window}${metric}`;
          expect(body[section][field] - before[section][field]).toBe(delta);
        }
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect((await app.request("/admin/inference-readiness", { method, headers: { Authorization: `Bearer ${owner.token}` } })).status).toBe(404);
      }
    } finally {
      await db.exec("rollback");
    }
  });

  it("retains current-consent and live-session checks for the owner and the default admin allowlist", async () => {
    const owner = await signIn(OWNER);
    const path = "/admin/inference-readiness";
    for (const version of [null, 1, 3]) {
      await db.query("update users set ai_consent_version = $1 where id = $2", [version, owner.id]);
      const res = await call(path, owner.token);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("404 Not Found");
    }
    await accepted(app, owner.token);
    expect((await call(path, owner.token)).status).toBe(200);
    await db.query("update sessions set revoked_at = $1 where user_id = $2", [now.toISOString(), owner.id]);
    expect((await call(path, owner.token)).status).toBe(404);
    await db.query("update sessions set revoked_at = null, expires_at = $1 where user_id = $2", [new Date(now.getTime() - 1).toISOString(), owner.id]);
    expect((await call(path, owner.token)).status).toBe(404);
    const fresh = await signIn(OWNER);
    app = make();
    expect((await call(path, fresh.token)).status).toBe(404);
  });

  it("reports a missing pool total as unknown rather than inventing a zero baseline", async () => {
    const owner = await signIn(OWNER);
    await db.query("delete from spend_pool_totals where pool = 'claude'");
    const res = await call("/admin/inference-readiness", owner.token);
    expect(res.status).toBe(200);
    expect((await res.json() as Json).claude.poolTotalUsd).toBeNull();
    expect((await db.query("select 1 from spend_pool_totals where pool = 'claude'")).rows).toEqual([]);
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

  it("counts Meta's totals on Meta's rows, as its caps do, and shows Claude's on a line of their own", async () => {
    app = createApp({
      db,
      mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
      jwtSecret: "test-secret-that-is-at-least-32-chars-long",
      codePepper: PEPPER,
      now: () => now,
      webOrigins: [],
      spendCaps: { dailyUsd: 10, totalUsd: 120 },
      claude: { apiKey: "k", dailyUsd: 5 },
      oauth: { apiUrl: "https://api.test", production: false },
      admins: new Set([adminDigest(OWNER, PEPPER)]),
    } as Deps);
    const owner = await signIn(OWNER);
    await spend(owner.id, "research", 0.1, "2026-11-02T02:00:00Z");
    const row = (userId: string | null, model: string, usd: number, at: string) =>
      db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, $2, 'guest', $3, $4)", [userId, model, usd, at]);
    await row(null, "claude-opus-5-5", 0.5, "2026-11-02T03:00:00Z");
    await row(owner.id, "claude-opus-5-5", 0.25, "2026-11-01T03:00:00Z");
    await row(null, "apify:google-shopping", 0.02, "2026-11-02T03:00:00Z");
    const body = (await (await call("/admin/usage?days=2", owner.token)).json()) as Json;
    expect(body.totals).toEqual({ todayUsd: 0.1, guestsTodayUsd: 0, totalUsd: 0.1, totalCalls: 1 });
    expect(body.claude).toEqual({ todayUsd: 0.5, guestsTodayUsd: 0.5, totalUsd: 0.75, totalCalls: 2, dailyUsd: 5, guestDailyUsd: 3 });
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

  it("lists a help report in any shape without failing, and never shows the app's own notes as what was said", () => {
    const row = { id: "abcdef12-0000-0000-0000-000000000000", created_at: "2026-11-02T06:00:00Z", email: "ada@example.com", has_screen: false, replay: null };
    expect(issueOf({ ...row, app: "not json", transcript: { not: "an array" } })).toMatchObject({ code: "ABCDEF", route: null, logs: [], lastSaid: null });
    expect(issueOf({ ...row, app: { route: 7, logs: [null, "x", { level: "error", text: "boom" }] }, transcript: null })).toMatchObject({ route: null, logs: [{ level: "error", text: "boom" }] });
    expect(issueOf({ ...row, app: {}, transcript: [{ role: "user", text: "A Leica Q3" }, { role: "user", text: "[picked l_3]" }, null] }).lastSaid).toBe("A Leica Q3");
  });
});
