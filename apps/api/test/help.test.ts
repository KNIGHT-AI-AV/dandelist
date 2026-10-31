import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { HELP_PER_DAY } from "../src/help";
import { memoryMediaStore } from "../src/media-store";

/** POST /help: a report of what someone saw, kept private for the team (src/help.ts). */
let db: Db;
let mail: { to: string; code: string }[];
let store: ReturnType<typeof memoryMediaStore>;
let app: ReturnType<typeof createApp>;
const clock = new Date("2026-10-31T06:00:00Z");
type Json = Record<string, any>;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  store = memoryMediaStore("https://api.test/media");
  app = createApp({
    db,
    mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    media: { store, cutoutsPerDay: 0, imagesPerDay: 0 },
    oauth: { apiUrl: "https://api.test", production: false },
  } as Parameters<typeof createApp>[0]);
});

const call = (method: string, path: string, token: string | null, body?: unknown) =>
  app.request(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function signIn(email = "ada@example.com") {
  await call("POST", "/auth/email/start", null, { email });
  const res = await call("POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}

// The smallest JPEG start a check can tell apart from anything else.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString("base64");

describe("help reports", () => {
  it("keeps what the app saw with the server's own view, privately, and answers with a code to quote", async () => {
    const { token, id: userId } = await signIn();
    await call("POST", "/wishes", token, { name: "Leica Q3", kind: "buy", tier: "nice", upfrontCents: 699_500, recurring: [] });
    await db.query("insert into dream_sessions (user_id, transcript, state, created_at, updated_at) values ($1, $2::jsonb, $3::jsonb, $4, $4)", [
      userId,
      JSON.stringify([{ role: "user", text: "Is that the V12?", at: clock.toISOString() }]),
      JSON.stringify({ widgets: { car_1: { kind: "car_builder", id: "car_1" } } }),
      clock.toISOString(),
    ]);
    const res = await call("POST", "/help", token, { state: { route: "/", platform: "ios", logs: [] }, screenshot: JPEG, replay: "ph-session-1" });
    expect(res.status).toBe(201);
    const { id, code } = (await res.json()) as { id: string; code: string };
    expect(code).toBe(id.slice(0, 6).toUpperCase());

    const row = (await db.query<{ report: Json; has_screen: boolean }>("select report, has_screen from help_reports where id = $1", [id])).rows[0]!;
    expect(row.has_screen).toBe(true);
    expect(row.report.app).toEqual({ route: "/", platform: "ios", logs: [] });
    expect(row.report.replay).toBe("ph-session-1");
    expect(row.report.chat.transcript.map((e: Json) => e.text)).toEqual(["Is that the V12?"]);
    expect(row.report.chat.widgets).toEqual([{ id: "car_1", kind: "car_builder" }]);
    expect(row.report.list.map((w: Json) => w.name)).toEqual(["Leica Q3"]);

    // The team's copy: private keys only, which /media never serves.
    expect(JSON.parse(Buffer.from(store.objects.get(`help/${id}/report.json`)!).toString("utf8")).id).toBe(id);
    expect(store.objects.has(`help/${id}/screen.jpg`)).toBe(true);
    expect((await app.request(`/media/help/${id}/screen.jpg`)).status).toBe(404);
  });

  it("drops a picture that isn't a JPEG and still keeps the report", async () => {
    const { token } = await signIn();
    const res = await call("POST", "/help", token, { state: { route: "/settings" }, screenshot: Buffer.from("<svg/>").toString("base64") });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(store.objects.has(`help/${id}/screen.jpg`)).toBe(false);
  });

  it("is for signed-in people only, and only their own data goes in", async () => {
    expect((await call("POST", "/help", null, { state: {} })).status).toBe(401);
    const ada = await signIn("ada@example.com");
    await call("POST", "/wishes", ada.token, { name: "Ada's wish", kind: "buy", tier: "nice", upfrontCents: 100, recurring: [] });
    const bob = await signIn("bob@example.com");
    const res = await call("POST", "/help", bob.token, { state: {} });
    const { id } = (await res.json()) as { id: string };
    const report = (await db.query<{ report: Json }>("select report from help_reports where id = $1", [id])).rows[0]!.report;
    expect(report.list).toEqual([]);
    expect(report.chat).toBeNull();
  });

  it("caps reports at a day's worth per person", async () => {
    const { token } = await signIn();
    for (let i = 0; i < HELP_PER_DAY; i++) expect((await call("POST", "/help", token, { state: { i } })).status).toBe(201);
    expect((await call("POST", "/help", token, { state: {} })).status).toBe(429);
  });
});
