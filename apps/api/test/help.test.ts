import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { HELP_PER_DAY, HELP_RETRY_AFTER_MS, sweepHelp } from "../src/help";
import { memoryMediaStore } from "../src/media-store";

/** POST /help: a report of what someone saw, kept private for the team (src/help.ts). */
let db: Db;
let mail: { to: string; code: string }[];
let store: ReturnType<typeof faultyStore>;
let app: ReturnType<typeof createApp>;
let now: Date;
type Json = Record<string, any>;
type Deps = Parameters<typeof createApp>[0];

/** Holds every query whose text contains `text` until `need` of them are waiting, then lets them all go at once. */
let barrier: { text: string; need: number; waiting: (() => void)[] } | null = null;

/**
 * The memory store with faults the test turns on: a file name's next upload or delete fails once, or its uploads wait
 * on a gate (and say when one has started waiting).
 */
function faultyStore() {
  const base = memoryMediaStore("https://api.test/media");
  const failPut = new Set<string>();
  const failDelete = new Set<string>();
  const holds = new Map<string, { gate: Promise<void>; reached: () => void }>();
  const nameOf = (key: string) => key.split("/")[1]!;
  return {
    ...base,
    objects: base.objects,
    failPut,
    failDelete,
    /** Makes uploads of `name` wait until the returned `open` is called; `reached` resolves once one is waiting. */
    hold(name: string) {
      let open!: () => void;
      let reached!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const waiting = new Promise<void>((r) => (reached = r));
      holds.set(name, { gate, reached });
      return { open, waiting };
    },
    async putPrivate(key: string, bytes: Uint8Array, type: string) {
      const held = holds.get(nameOf(key));
      if (held) {
        held.reached();
        await held.gate;
      }
      if (failPut.delete(nameOf(key))) throw new Error(`synthetic ${nameOf(key)} upload failure`);
      return base.putPrivate(key, bytes, type);
    },
    async deletePrivate(key: string) {
      if (failDelete.delete(nameOf(key))) throw new Error(`synthetic ${nameOf(key)} delete failure`);
      return base.deletePrivate(key);
    },
  };
}

const depsFor = (media: Deps["media"]): Deps =>
  ({
    db,
    mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => now,
    webOrigins: [],
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    media,
    oauth: { apiUrl: "https://api.test", production: false },
  }) as Deps;

beforeEach(async () => {
  const pg = new PGlite();
  barrier = null;
  db = {
    query: async (t, p) => {
      const b = barrier;
      if (b && t.includes(b.text)) {
        await new Promise<void>((go) => {
          b.waiting.push(go);
          if (b.waiting.length === b.need) b.waiting.forEach((w) => w());
        });
      }
      return pg.query(t, p) as never;
    },
    exec: (s) => pg.exec(s),
  };
  await migrate(db);
  mail = [];
  now = new Date("2026-10-31T06:00:00Z");
  store = faultyStore();
  app = createApp(depsFor({ store, cutoutsPerDay: 0, imagesPerDay: 0 }));
});

const call = (method: string, path: string, token: string | null, body?: unknown) =>
  app.request(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const sweep = () => sweepHelp({ db, now: () => now, media: { store, cutoutsPerDay: 0, imagesPerDay: 0 } });

async function signIn(email = "ada@example.com") {
  await call("POST", "/auth/email/start", null, { email });
  const res = await call("POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}

// The smallest JPEG start a check can tell apart from anything else.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString("base64");
const files = (id: string) => ["report.json", "screen.jpg"].filter((f) => store.objects.has(`help/${id}/${f}`));
const row = async (id: string) => (await db.query<{ status: string; screen: Uint8Array | null; has_screen: boolean; report: Json }>("select status, screen, has_screen, report from help_reports where id = $1", [id])).rows[0];
const send = async (token: string, extra: Json = {}) => {
  const res = await call("POST", "/help", token, { state: { route: "/" }, screenshot: JPEG, ...extra });
  return { status: res.status, ...((await res.json()) as { id: string; code: string; stored: string; screen: boolean; error?: string }) };
};

describe("help reports", () => {
  it("keeps what the app saw with the server's own view, privately, and answers with a code to quote", async () => {
    const { token, id: userId } = await signIn();
    await call("POST", "/wishes", token, { name: "Leica Q3", kind: "buy", tier: "nice", upfrontCents: 699_500, recurring: [] });
    await db.query("insert into dream_sessions (user_id, transcript, state, created_at, updated_at) values ($1, $2::jsonb, $3::jsonb, $4, $4)", [
      userId,
      JSON.stringify([{ role: "user", text: "Is that the V12?", at: now.toISOString() }]),
      JSON.stringify({ widgets: { car_1: { kind: "car_builder", id: "car_1" } } }),
      now.toISOString(),
    ]);
    const sent = await send(token, { state: { route: "/", platform: "ios", logs: [] }, replay: "ph-session-1" });
    expect(sent).toMatchObject({ status: 201, stored: "complete", screen: true });
    expect(sent.code).toBe(sent.id.slice(0, 6).toUpperCase());

    const r = (await row(sent.id))!;
    expect([r.status, r.has_screen, r.screen]).toEqual(["complete", true, null]);
    expect(r.report.app).toEqual({ route: "/", platform: "ios", logs: [] });
    expect(r.report.replay).toBe("ph-session-1");
    expect(r.report.chat.transcript.map((e: Json) => e.text)).toEqual(["Is that the V12?"]);
    expect(r.report.chat.widgets).toEqual([{ id: "car_1", kind: "car_builder" }]);
    expect(r.report.list.map((w: Json) => w.name)).toEqual(["Leica Q3"]);

    // The team's copy: private keys only, which /media never serves.
    expect(JSON.parse(Buffer.from(store.objects.get(`help/${sent.id}/report.json`)!).toString("utf8")).id).toBe(sent.id);
    expect(files(sent.id)).toEqual(["report.json", "screen.jpg"]);
    expect((await app.request(`/media/help/${sent.id}/screen.jpg`)).status).toBe(404);
  });

  it("keeps only the diagnostics it knows, with anything shaped like a credential cut out (review of #140, H2)", async () => {
    const { token } = await signIn();
    const sent = await send(token, {
      state: {
        route: "/auth/callback?ticket=SYNTHETIC-TICKET-1",
        platform: "ios",
        logs: [
          { at: "2026-10-31T05:59:00Z", level: "error", text: "GET https://api.test/me?ticket=SYNTHETIC-TICKET-2 failed: Authorization: Bearer SYNTHETIC.TOKEN.3" },
          { at: "2026-10-31T05:59:01Z", level: "warn", text: '{"accessToken":"SYNTHETIC-ACCESS-4","refresh_token":"SYNTHETIC-REFRESH-5"} statusCode: 401' },
        ],
        // Not on the list: dropped, whatever it holds.
        wishes: ["SYNTHETIC-WISH-6"],
        token: "SYNTHETIC-TOKEN-7",
      },
    });
    expect(sent.status).toBe(201);
    const kept = JSON.stringify((await row(sent.id))!.report) + Buffer.from(store.objects.get(`help/${sent.id}/report.json`)!).toString("utf8");
    expect(kept).not.toContain("SYNTHETIC");
    const diag = (await row(sent.id))!.report.app;
    expect(Object.keys(diag).sort()).toEqual(["logs", "platform", "route"]);
    expect(diag.route).toBe("/auth/callback");
    expect(diag.logs[1].text).toContain("statusCode: 401");
  });

  it("drops a picture that isn't a JPEG and still keeps the report", async () => {
    const { token } = await signIn();
    const sent = await send(token, { state: { route: "/settings" }, screenshot: Buffer.from("<svg/>").toString("base64") });
    expect(sent).toMatchObject({ status: 201, screen: false });
    expect(files(sent.id)).toEqual(["report.json"]);
  });

  it("is for signed-in people only, and only their own data goes in", async () => {
    expect((await call("POST", "/help", null, { state: {} })).status).toBe(401);
    const ada = await signIn("ada@example.com");
    await call("POST", "/wishes", ada.token, { name: "Ada's wish", kind: "buy", tier: "nice", upfrontCents: 100, recurring: [] });
    const bob = await signIn("bob@example.com");
    const sent = await send(bob.token, { state: {} });
    const report = (await row(sent.id))!.report;
    expect(report.list).toEqual([]);
    expect(report.chat).toBeNull();
  });

  it("caps reports at a day's worth per person, and opens again the next day", async () => {
    const { token } = await signIn();
    for (let i = 0; i < HELP_PER_DAY; i++) expect((await send(token, { state: {} })).status).toBe(201);
    expect((await send(token, { state: {} })).status).toBe(429);
    now = new Date("2026-11-01T00:00:01Z");
    // A fresh sign-in for the new day: the first one's access has long run out.
    expect((await send((await signIn()).token, { state: {} })).status).toBe(201);
  });
});

describe("the day's last report, asked for twice at once (review of #140, H4)", () => {
  it("lets only one through, leaves another person's day alone, and opens again the next day", async () => {
    const ada = await signIn("ada@example.com");
    const bob = await signIn("bob@example.com");
    await db.query("insert into help_quota (user_id, day, sent) values ($1, $2, $3)", [ada.id, "2026-10-31", HELP_PER_DAY - 1]);
    // Both requests reach the count together, after everything they read before it.
    barrier = { text: "insert into help_quota", need: 3, waiting: [] };
    const results = await Promise.all([send(ada.token, { state: {} }), send(ada.token, { state: {} }), send(bob.token, { state: {} })]);
    barrier = null;
    expect(results.slice(0, 2).map((r) => r.status).sort()).toEqual([201, 429]);
    expect(results[2]!.status).toBe(201);
    const counts = (await db.query<{ user_id: string; n: number }>("select user_id, count(*)::int as n from help_reports group by user_id")).rows;
    expect(Object.fromEntries(counts.map((c) => [c.user_id, c.n]))).toEqual({ [ada.id]: 1, [bob.id]: 1 });
    expect((await db.query<{ sent: number }>("select sent from help_quota where user_id = $1", [ada.id])).rows[0]!.sent).toBe(HELP_PER_DAY);
    now = new Date("2026-11-01T00:00:01Z");
    expect((await send((await signIn("ada@example.com")).token, { state: {} })).status).toBe(201);
  });
});

describe("deleting an account deletes its reports' private copies (review of #140, H1)", () => {
  it("takes one person's rows and files and leaves the other's", async () => {
    const ada = await signIn("ada@example.com");
    const bob = await signIn("bob@example.com");
    const a = await send(ada.token);
    const b = await send(bob.token);
    expect([files(a.id), files(b.id)]).toEqual([
      ["report.json", "screen.jpg"],
      ["report.json", "screen.jpg"],
    ]);
    expect((await call("DELETE", "/me", ada.token)).status).toBe(204);
    expect(files(a.id)).toEqual([]);
    expect(await row(a.id)).toBeUndefined();
    expect(files(b.id)).toEqual(["report.json", "screen.jpg"]);
    expect((await row(b.id))!.status).toBe("complete");
    expect((await db.query("select id from help_deletions")).rows).toEqual([]);
  });

  it("keeps a copy whose delete failed queued, and the sweep deletes it", async () => {
    const ada = await signIn();
    const a = await send(ada.token);
    store.failDelete.add("screen.jpg");
    expect((await call("DELETE", "/me", ada.token)).status).toBe(204);
    expect(files(a.id)).toEqual(["screen.jpg"]);
    expect((await db.query<{ id: string; attempts: number }>("select id, attempts from help_deletions")).rows).toEqual([{ id: a.id, attempts: 1 }]);
    expect(await sweep()).toEqual({ deleted: 1, stored: 0 });
    expect(files(a.id)).toEqual([]);
    expect((await db.query("select id from help_deletions")).rows).toEqual([]);
  });

  it("deletes copies that land after the account went, and queues them if that delete fails too", async () => {
    for (const failAgain of [false, true]) {
      const ada = await signIn(`ada-${failAgain}@example.com`);
      const held = store.hold("report.json");
      const sending = send(ada.token);
      await held.waiting;
      expect((await call("DELETE", "/me", ada.token)).status).toBe(204);
      if (failAgain) store.failDelete.add("report.json");
      held.open();
      const sent = await sending;
      expect(sent.stored).toBe("gone");
      if (failAgain) {
        expect(files(sent.id)).toEqual(["report.json"]);
        await sweep();
      }
      expect(files(sent.id)).toEqual([]);
      expect((await db.query("select id from help_deletions")).rows).toEqual([]);
    }
  });
});

describe("a picture landing after the account went, its report copy failing (review of #140, round 35 H1)", () => {
  it("is deleted again, or queued until the sweep deletes it, and another person's report stays", async () => {
    for (const failAgain of [false, true]) {
      const ada = await signIn(`ada-late-${failAgain}@example.com`);
      const bob = await signIn(`bob-late-${failAgain}@example.com`);
      const b = await send(bob.token);
      // Ada's picture is on its way when her account is deleted; the deletion finds nothing yet and its queue drains.
      const held = store.hold("screen.jpg");
      const sending = send(ada.token);
      await held.waiting;
      expect((await call("DELETE", "/me", ada.token)).status).toBe(204);
      expect((await db.query("select id from help_deletions")).rows).toEqual([]);
      // Then the picture lands, and the report copy behind it fails.
      store.failPut.add("report.json");
      if (failAgain) store.failDelete.add("screen.jpg");
      held.open();
      const sent = await sending;
      expect(sent.stored).toBe("gone");
      if (failAgain) {
        expect(files(sent.id)).toEqual(["screen.jpg"]);
        expect((await db.query<{ id: string }>("select id from help_deletions")).rows.map((r) => r.id)).toEqual([sent.id]);
        expect(await sweep()).toEqual({ deleted: 1, stored: 0 });
      }
      expect(files(sent.id)).toEqual([]);
      expect((await db.query("select id from help_deletions")).rows).toEqual([]);
      expect(files(b.id)).toEqual(["report.json", "screen.jpg"]);
    }
  });
});

describe("a report is pending until both copies are stored (review of #140, H5)", () => {
  it("keeps a report whose picture didn't upload, says so, and stores it on a later sweep", async () => {
    const { token } = await signIn();
    store.failPut.add("screen.jpg");
    const sent = await send(token);
    expect(sent).toMatchObject({ status: 202, stored: "pending", screen: true });
    expect(files(sent.id)).toEqual([]);
    expect((await row(sent.id))!.status).toBe("pending");
    // Too soon: a request may still be storing it.
    expect(await sweep()).toEqual({ deleted: 0, stored: 0 });
    now = new Date(now.getTime() + HELP_RETRY_AFTER_MS + 1_000);
    expect(await sweep()).toEqual({ deleted: 0, stored: 1 });
    expect(files(sent.id)).toEqual(["report.json", "screen.jpg"]);
    const r = (await row(sent.id))!;
    expect([r.status, r.screen]).toEqual(["complete", null]);
  });

  it("stores the rest when the same sheet is sent again after its report copy failed, counted once", async () => {
    const { token, id: userId } = await signIn();
    const key = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
    store.failPut.add("report.json");
    const first = await send(token, { key });
    expect(first).toMatchObject({ status: 202, id: key, stored: "pending" });
    expect(files(key)).toEqual(["screen.jpg"]);
    const again = await send(token, { key });
    expect(again).toMatchObject({ status: 200, id: key, code: first.code, stored: "complete" });
    expect(files(key)).toEqual(["report.json", "screen.jpg"]);
    // And once more after it's complete: the same answer, still one report and one slot.
    expect(await send(token, { key })).toMatchObject({ status: 200, id: key, stored: "complete" });
    expect((await db.query<{ n: number }>("select count(*)::int as n from help_reports")).rows[0]!.n).toBe(1);
    expect((await db.query<{ sent: number }>("select sent from help_quota where user_id = $1", [userId])).rows[0]!.sent).toBe(1);
  });

  it("won't take another person's sheet id", async () => {
    const ada = await signIn("ada@example.com");
    const bob = await signIn("bob@example.com");
    const key = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect((await send(ada.token, { key })).status).toBe(201);
    expect((await send(bob.token, { key })).status).toBe(400);
  });

  it("says it can't keep a report when there is no private store, and keeps nothing", async () => {
    const { token } = await signIn();
    app = createApp(depsFor(undefined));
    expect((await send(token)).status).toBe(503);
    expect((await db.query("select id from help_reports")).rows).toEqual([]);
    expect((await db.query("select sent from help_quota")).rows).toEqual([]);
  });
});
