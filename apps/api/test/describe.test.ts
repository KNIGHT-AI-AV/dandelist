import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { DESCRIBES_PER_USER_PER_DAY, SEARCHES_PER_USER_PER_DAY, tidyAbout, tidyTags } from "../src/describe";

// ---------------------------------------------------------------- fixtures: a fake Meta

type Body = Record<string, any>;
let metaCalls: Body[];
/** What the fake model answers to a describe call, given the wishes it was sent. */
let describeReply: (wishes: { ref: string; name: string }[]) => unknown;
/** What the fake model answers to a search call, given the wishes it was sent. */
let searchReply: (q: string, wishes: { ref: string; name: string }[]) => unknown;
let metaStatus: number;

const reply = (json: unknown) =>
  Response.json({ id: `resp_${metaCalls.length}`, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(json), annotations: [] }] }], usage: { input_tokens: 2000, output_tokens: 300 } });

const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Body;
  metaCalls.push(body);
  if (metaStatus !== 200) return new Response("busy", { status: metaStatus });
  const format = body.text?.format?.name;
  const input = String(body.input);
  if (format === "wish_about") return reply(describeReply(JSON.parse(input.slice(input.indexOf("\n") + 1))));
  if (format === "wish_matches") {
    const q = JSON.parse(input.slice("Search: ".length, input.indexOf("\n"))) as string;
    const wishes = input.slice(input.indexOf("Wishes:\n") + 8).split("\n").map((l) => JSON.parse(l));
    return reply(searchReply(q, wishes));
  }
  return new Response("unexpected", { status: 500 });
}) as unknown as typeof fetch;

// ---------------------------------------------------------------- fixtures: the app

let db: Db;
let mail: { to: string; code: string }[];
let clock: Date;
let app: ReturnType<typeof createApp>;

function makeApp(opts: { meta?: boolean; dailyUsd?: number } = {}) {
  return createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: opts.meta === false ? undefined : { apiKey: "test", fetch: fakeMeta },
    spendCaps: { dailyUsd: opts.dailyUsd ?? 10, totalUsd: 120 },
  });
}

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  metaCalls = [];
  metaStatus = 200;
  clock = new Date("2026-10-28T12:00:00Z");
  describeReply = (wishes) => ({
    wishes: wishes.map((w) => ({
      ref: w.ref,
      about: `${w.name} — something they want.`,
      tags: ["Travel", "travel", "  Trips!  ", "a", "b", "c", "d"],
    })),
  });
  searchReply = () => ({ refs: [] });
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

async function addWish(token: string, name: string, kind = "buy", details?: Record<string, unknown>) {
  clock = new Date(clock.getTime() + 1000);
  const res = await call("POST", "/wishes", token, { name, kind, upfrontCents: 100_000, ...(details ? { details } : {}) });
  return ((await res.json()) as { wish: { id: string } }).wish.id;
}

type Wire = { id: string; name: string; details: { about?: string; tags?: string[] } };
const list = async (token: string) => ((await (await call("GET", "/wishes", token)).json()) as { wishes: Wire[] }).wishes;
const ledger = async (kind: string) => (await db.query<{ n: string | number }>("select count(*) as n from spend_ledger where kind = $1", [kind])).rows[0]!.n;

// ---------------------------------------------------------------- describe

describe("POST /wishes/describe", () => {
  it("writes one sentence and up to five lowercase tags, only for the person's own undescribed wishes", async () => {
    const ada = await signIn("ada@example.com");
    const bo = await signIn("bo@example.com");
    const trip = await addWish(ada, "A month in Lisbon", "visit");
    const car = await addWish(ada, "Mercedes G-Wagon");
    const done = await addWish(ada, "Rolex Submariner", "buy", { about: "A diving watch.", tags: ["watch"] });
    const theirs = await addWish(bo, "Private security", "do");

    const res = await call("POST", "/wishes/describe", ada, { ids: [trip, car, done, theirs, trip] });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { wishes: { id: string; details: { about: string; tags: string[] } }[] };
    expect(out.wishes.map((w) => w.id).sort()).toEqual([trip, car].sort());

    // The model only ever saw the two wishes that needed it, under short refs, never another person's.
    expect(metaCalls).toHaveLength(1);
    const sent = String(metaCalls[0]!.input);
    expect(sent).toContain("A month in Lisbon");
    expect(sent).toContain("Mercedes G-Wagon");
    expect(sent).not.toContain("Rolex");
    expect(sent).not.toContain("Private security");
    expect(sent).not.toContain(trip);

    const mine = await list(ada);
    const lisbon = mine.find((w) => w.id === trip)!;
    expect(lisbon.details.about).toBe("A month in Lisbon, something they want.");
    expect(lisbon.details.tags).toEqual(["travel", "trips", "a", "b", "c"]);
    // Already described: left exactly as it was.
    expect(mine.find((w) => w.id === done)!.details).toEqual({ about: "A diving watch.", tags: ["watch"] });
    // The other person's wish is untouched.
    expect((await list(bo))[0]!.details.about).toBeUndefined();
    expect(Number(await ledger("describe"))).toBe(1);
  });

  it("keeps what else the wish holds and makes no call when nothing needs describing", async () => {
    const ada = await signIn("ada@example.com");
    const agent = { runId: "r1", seller: "Mercedes", url: "https://www.mercedes-benz.com/g", status: "verified", checkedAt: "2026-10-27T00:00:00Z", explanation: "", source: { currency: "USD", price: 1000, rate: 1, rateDate: "2026-10-27" } };
    const car = await addWish(ada, "Mercedes G-Wagon", "buy", { agent });
    await call("POST", "/wishes/describe", ada, { ids: [car] });
    const saved = (await list(ada))[0]!;
    expect(saved.details).toMatchObject({ agent, about: "Mercedes G-Wagon, something they want." });

    metaCalls = [];
    const again = await call("POST", "/wishes/describe", ada, { ids: [car] });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ wishes: [] });
    expect(metaCalls).toHaveLength(0);
  });

  it("ignores refs the model makes up and wishes it skips", async () => {
    const ada = await signIn("ada@example.com");
    const a = await addWish(ada, "Gym membership", "do");
    const b = await addWish(ada, "Private jet card", "buy");
    describeReply = () => ({ wishes: [{ ref: "w2", about: "Hours on a private jet.", tags: ["travel"] }, { ref: "w99", about: "Invented.", tags: [] }, { ref: "w2", about: "Twice.", tags: [] }] });
    const out = (await (await call("POST", "/wishes/describe", ada, { ids: [a, b] })).json()) as { wishes: { id: string }[] };
    expect(out.wishes.map((w) => w.id)).toEqual([b]);
    const mine = await list(ada);
    expect(mine.find((w) => w.id === b)!.details.about).toBe("Hours on a private jet.");
    expect(mine.find((w) => w.id === a)!.details.about).toBeUndefined();
  });

  it("checks the body, the server's setup and the daily count", async () => {
    const ada = await signIn("ada@example.com");
    const id = await addWish(ada, "Gym membership", "do");
    expect((await call("POST", "/wishes/describe", ada, { ids: [] })).status).toBe(400);
    expect((await call("POST", "/wishes/describe", ada, { ids: ["nope"] })).status).toBe(400);
    expect((await call("POST", "/wishes/describe", ada, { ids: Array.from({ length: 21 }, () => id) })).status).toBe(400);
    expect((await app.request("/wishes/describe", { method: "POST", body: JSON.stringify({ ids: [id] }) })).status).toBe(401);

    for (let i = 0; i < DESCRIBES_PER_USER_PER_DAY; i++) {
      await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) select user_id, 'muse-spark-1.3', 'describe', 0, $1 from wishes limit 1", [clock.toISOString()]);
    }
    expect((await call("POST", "/wishes/describe", ada, { ids: [id] })).status).toBe(429);
    expect(metaCalls).toHaveLength(0);

    app = makeApp({ meta: false });
    expect((await call("POST", "/wishes/describe", ada, { ids: [id] })).status).toBe(503);
  });

  it("stops at the spend caps and when the model is busy", async () => {
    const ada = await signIn("ada@example.com");
    const id = await addWish(ada, "Gym membership", "do");
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'dream', 1, $1)", [clock.toISOString()]);
    app = makeApp({ dailyUsd: 1 });
    const capped = await call("POST", "/wishes/describe", ada, { ids: [id] });
    expect(capped.status).toBe(429);
    expect(metaCalls).toHaveLength(0);

    app = makeApp();
    metaStatus = 429;
    expect((await call("POST", "/wishes/describe", ada, { ids: [id] })).status).toBe(429);
    expect((await list(ada))[0]!.details.about).toBeUndefined();
  });
});

// ---------------------------------------------------------------- search

describe("POST /wishes/search", () => {
  it("ranks the person's wishes by meaning and returns only their ids", async () => {
    const ada = await signIn("ada@example.com");
    const bo = await signIn("bo@example.com");
    const security = await addWish(ada, "Private security", "do", { about: "Close protection for the family.", tags: ["family", "safety"] });
    const villa = await addWish(ada, "Villa in Malta", "own");
    const nanny = await addWish(ada, "A live-in nanny", "do");
    await addWish(bo, "Family holiday", "visit");

    searchReply = (q, wishes) => {
      expect(q).toBe("family");
      const ref = (name: string) => wishes.find((w) => w.name === name)!.ref;
      return { refs: [ref("Private security"), "w404", ref("A live-in nanny"), ref("Private security")] };
    };
    const res = await call("POST", "/wishes/search", ada, { q: "  family " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [security, nanny] });

    const sent = String(metaCalls[0]!.input);
    expect(sent).toContain("Close protection for the family.");
    expect(sent).toContain('"tags":["family","safety"]');
    expect(sent).not.toContain("Family holiday");
    expect(sent).not.toContain(villa);
    expect(Number(await ledger("search"))).toBe(1);
  });

  it("answers an empty list without a call when there is nothing to search", async () => {
    const ada = await signIn("ada@example.com");
    const res = await call("POST", "/wishes/search", ada, { q: "travel" });
    expect(await res.json()).toEqual({ ids: [] });
    expect(metaCalls).toHaveLength(0);
  });

  it("checks the query, the server's setup, the daily count and a reply it can't read", async () => {
    const ada = await signIn("ada@example.com");
    await addWish(ada, "Gym membership", "do");
    expect((await call("POST", "/wishes/search", ada, { q: "   " })).status).toBe(400);
    expect((await call("POST", "/wishes/search", ada, { q: "x".repeat(201) })).status).toBe(400);
    expect((await call("POST", "/wishes/search", ada, {})).status).toBe(400);

    searchReply = () => ({ nothing: true });
    expect((await call("POST", "/wishes/search", ada, { q: "fitness" })).status).toBe(502);

    for (let i = 0; i < SEARCHES_PER_USER_PER_DAY; i++) {
      await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) select user_id, 'muse-spark-1.3', 'search', 0, $1 from wishes limit 1", [clock.toISOString()]);
    }
    metaCalls = [];
    expect((await call("POST", "/wishes/search", ada, { q: "fitness" })).status).toBe(429);
    expect(metaCalls).toHaveLength(0);

    app = makeApp({ meta: false });
    expect((await call("POST", "/wishes/search", ada, { q: "fitness" })).status).toBe(503);
  });

  it("leaves the other wish routes as they were", async () => {
    const ada = await signIn("ada@example.com");
    const id = await addWish(ada, "Gym membership", "do");
    expect((await call("PATCH", `/wishes/${id}`, ada, { tier: "must" })).status).toBe(200);
    expect((await call("DELETE", `/wishes/${id}`, ada)).status).toBe(204);
  });
});

describe("tidying the model's words", () => {
  it("keeps one plain sentence without long dashes", () => {
    expect(tidyAbout("  A sea-view villa — for summers  with   family. ")).toBe("A sea-view villa, for summers with family.");
    expect(tidyAbout("x".repeat(400))).toHaveLength(240);
  });

  it("keeps up to five distinct lowercase tags", () => {
    expect(tidyTags(["Car", "car", "SUV!", "", "luxury car", "g-wagon", "4x4", "extra"])).toEqual(["car", "suv", "luxury car", "g-wagon", "4x4"]);
  });
});
