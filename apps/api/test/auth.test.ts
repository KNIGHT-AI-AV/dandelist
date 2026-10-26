import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { assertBudget, recordSpend, SpendLimitError } from "../src/spend";

let db: Db;
let mail: { to: string; code: string }[];
let clock: Date;
let app: ReturnType<typeof createApp>;

const JUDGE = { email: "judge@dandelist.com", code: "424242" };

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  clock = new Date("2026-10-27T12:00:00Z");
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    judge: JUDGE,
    now: () => clock,
    webOrigins: ["http://localhost:8081"],
  });
});

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) => app.request(path, { headers: { Authorization: `Bearer ${token}` } });

async function signIn(email = "Ada@Example.com") {
  expect((await post("/auth/email/start", { email })).status).toBe(204);
  const code = mail.at(-1)!.code;
  const res = await post("/auth/email/verify", { email, code });
  expect(res.status).toBe(200);
  return (await res.json()) as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
}

describe("email-code sign-in", () => {
  it("signs in, reads the account, refreshes and signs out", async () => {
    const s = await signIn();
    expect(s.user.email).toBe("ada@example.com");
    expect((await get("/me", s.accessToken)).status).toBe(200);

    const r = await post("/auth/refresh", { refreshToken: s.refreshToken });
    expect(r.status).toBe(200);
    const next = (await r.json()) as { accessToken: string; refreshToken: string };
    expect((await post("/auth/refresh", { refreshToken: s.refreshToken })).status).toBe(401);

    expect((await post("/auth/logout", {}, next.accessToken)).status).toBe(204);
    expect((await get("/me", next.accessToken)).status).toBe(401);
  });

  it("locks a code after five wrong tries", async () => {
    await post("/auth/email/start", { email: "bo@example.com" });
    const code = mail.at(-1)!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await post("/auth/email/verify", { email: "bo@example.com", code: wrong })).status).toBe(400);
    const res = await post("/auth/email/verify", { email: "bo@example.com", code });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Too many wrong tries/);
  });

  it("expires codes after 10 minutes", async () => {
    await post("/auth/email/start", { email: "cy@example.com" });
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    const res = await post("/auth/email/verify", { email: "cy@example.com", code: mail.at(-1)!.code });
    expect(res.status).toBe(400);
  });

  it("stops emailing after five codes an hour without locking the owner out", async () => {
    for (let i = 0; i < 5; i++) expect((await post("/auth/email/start", { email: "di@example.com" })).status).toBe(204);
    expect((await post("/auth/email/start", { email: "di@example.com" })).status).toBe(204);
    expect(mail).toHaveLength(5);
    const res = await post("/auth/email/verify", { email: "di@example.com", code: mail.at(-1)!.code });
    expect(res.status).toBe(200);
  });

  it("limits sign-in starts per network", async () => {
    const fromIp = (email: string) =>
      app.request("/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "6.6.6.6, 203.0.113.9" },
        body: JSON.stringify({ email }),
      });
    for (let i = 0; i < 10; i++) expect((await fromIp(`u${i}@example.com`)).status).toBe(204);
    expect((await fromIp("u10@example.com")).status).toBe(429);
    expect((await post("/auth/email/start", { email: "other@example.com" })).status).toBe(204);
  });

  it("caps parallel wrong guesses at five and never reuses a code", async () => {
    await post("/auth/email/start", { email: "ed@example.com" });
    const code = mail.at(-1)!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => post("/auth/email/verify", { email: "ed@example.com", code: wrong })));
    expect((await db.query("select attempts from email_codes where email = $1", ["ed@example.com"])).rows[0]).toEqual({ attempts: 5 });
    expect((await post("/auth/email/verify", { email: "ed@example.com", code })).status).toBe(400);

    await post("/auth/email/start", { email: "fi@example.com" });
    const good = mail.at(-1)!.code;
    expect((await post("/auth/email/verify", { email: "fi@example.com", code: good })).status).toBe(200);
    expect((await post("/auth/email/verify", { email: "fi@example.com", code: good })).status).toBe(400);
  });

  it("lets the judge account in with its fixed code and sends no email", async () => {
    expect((await post("/auth/email/start", { email: JUDGE.email })).status).toBe(204);
    expect(mail).toHaveLength(0);
    expect((await post("/auth/email/verify", { email: JUDGE.email, code: JUDGE.code })).status).toBe(200);
  });

  it("deletes the account and everything that hangs off it", async () => {
    const s = await signIn();
    const del = await app.request("/me", { method: "DELETE", headers: { Authorization: `Bearer ${s.accessToken}` } });
    expect(del.status).toBe(204);
    expect((await get("/me", s.accessToken)).status).toBe(401);
    expect((await db.query("select count(*) as n from sessions")).rows[0]).toEqual({ n: 0 });
  });

  it("rejects requests without a token", async () => {
    expect((await app.request("/me")).status).toBe(401);
  });
});

describe("spend guard", () => {
  const usage = { model: "muse-spark-1.3", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, searches: 1 };

  it("allows calls under the caps and stops at the daily cap", async () => {
    await assertBudget(db, { dailyUsd: 1, totalUsd: 5 }, clock);
    await recordSpend(db, null, "research", usage, 0.6, clock);
    await assertBudget(db, { dailyUsd: 1, totalUsd: 5 }, clock);
    await recordSpend(db, null, "research", usage, 0.5, clock);
    await expect(assertBudget(db, { dailyUsd: 1, totalUsd: 5 }, clock)).rejects.toBeInstanceOf(SpendLimitError);
  });

  it("stops at the total cap even on a new day", async () => {
    await recordSpend(db, null, "research", usage, 5, clock);
    const tomorrow = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
    await expect(assertBudget(db, { dailyUsd: 10, totalUsd: 5 }, tomorrow)).rejects.toMatchObject({ scope: "total" });
  });
});
