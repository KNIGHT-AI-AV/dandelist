import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { memoryMediaStore } from "../src/media-store";
import { FACTS_PER_USER_PER_DAY, MAX_AVATAR_BYTES, cleanDisplayName, cleanFact, sniffImage } from "../src/me";
import { jpegHeader, pngHeader, webpHeader } from "./images";

let db: Db;
let mail: { to: string; code: string }[];
let clock: Date;
let store: ReturnType<typeof memoryMediaStore>;
let metaCalls: Record<string, any>[];
let nextFacts: unknown;
let metaStatus: number;
let app: ReturnType<typeof createApp>;

/** Stands in for Meta's Responses API: answers the facts format with `nextFacts`. */
const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, any>;
  metaCalls.push(body);
  if (metaStatus !== 200) return new Response("busy", { status: metaStatus });
  return Response.json({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(nextFacts) }] }], usage: { input_tokens: 900, output_tokens: 80 } });
}) as unknown as typeof fetch;

function makeApp(opts: { meta?: boolean; media?: boolean } = {}) {
  return createApp({
    db,
    mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: opts.meta === false ? undefined : { apiKey: "test", fetch: fakeMeta },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    media: opts.media === false ? undefined : { store, cutoutsPerDay: 0, imagesPerDay: 0 },
    oauth: { apiUrl: "https://api.test", production: false },
  } as Parameters<typeof createApp>[0]);
}

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  clock = new Date("2026-10-28T12:00:00Z");
  store = memoryMediaStore("https://api.test");
  metaCalls = [];
  metaStatus = 200;
  nextFacts = { facts: ["You want three places for every thing.", "Your Riviera villa outshines the rest of the list.", "Two of your prices are already checked."] };
  app = makeApp();
});

const call = (method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined || body instanceof Uint8Array ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });

async function signIn(email = "ada@example.com") {
  await call("POST", "/auth/email/start", null, { email });
  const res = await call("POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}

const upload = (token: string, bytes: Uint8Array, type: string) => call("POST", "/me/avatar", token, bytes, { "Content-Type": type });
type Json = Record<string, any>;

describe("migration 021", () => {
  it("adds the profile columns and lets Facebook identities in, but nothing unknown", async () => {
    const { id } = await signIn();
    await db.query("insert into user_identities (provider, subject, user_id) values ('facebook', 'fb-1', $1)", [id]);
    await expect(db.query("insert into user_identities (provider, subject, user_id) values ('twitter', 't-1', $1)", [id])).rejects.toThrow();
    expect((await db.query("select name, avatar_key, facts from users where id = $1", [id])).rows).toEqual([{ name: null, avatar_key: null, facts: null }]);
    expect((await db.query("select id from schema_migrations where id = '021_profile.sql'")).rows).toHaveLength(1);
  });
});

describe("profile", () => {
  it("needs a session", async () => {
    for (const [m, p] of [["GET", "/me/profile"], ["PATCH", "/me/profile"], ["POST", "/me/avatar"], ["GET", "/me/identities"], ["GET", "/me/stats"], ["GET", "/me/facts"], ["POST", "/me/facts"]] as const) {
      expect((await call(m, p, null)).status).toBe(401);
    }
  });

  it("reads and renames, tidying the name and refusing a long one", async () => {
    const { token } = await signIn();
    const first = (await (await call("GET", "/me/profile", token)).json()) as Json;
    expect(first.profile).toMatchObject({ email: "ada@example.com", name: null, avatarKey: null, avatarUrl: null });
    let res = await call("PATCH", "/me/profile", token, { name: "  Ada \n  Lovelace " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).profile.name).toBe("Ada Lovelace");
    res = await call("PATCH", "/me/profile", token, { name: "x".repeat(61) });
    expect(res.status).toBe(400);
    res = await call("PATCH", "/me/profile", token, { name: "   " });
    expect(((await res.json()) as Json).profile.name).toBeNull();
    expect((await call("PATCH", "/me/profile", token, { nickname: "A" })).status).toBe(400);
    expect(cleanDisplayName("A\u0000da")).toBe("A da");
  });
});

describe("profile picture", () => {
  it("takes JPEG, PNG and WebP by their magic numbers, serves the latest, and removes it", async () => {
    const { token } = await signIn();
    for (const [bytes, type, ext] of [
      [jpegHeader(400, 400), "image/jpeg", "jpg"],
      [pngHeader(400, 400), "image/png", "png"],
      [webpHeader("VP8X", 400, 400), "image/webp", "webp"],
    ] as const) {
      const res = await upload(token, new Uint8Array(bytes), type);
      expect(res.status).toBe(200);
      const { profile } = (await res.json()) as Json;
      expect(profile.avatarKey).toMatch(new RegExp(`^av-[a-f0-9]{64}\\.${ext}$`));
      expect(profile.avatarUrl).toBe(`https://api.test/media/${profile.avatarKey}`);
      const served = await app.request(`/media/${profile.avatarKey}`);
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe(type);
    }
    const removed = await call("DELETE", "/me/avatar", token);
    expect(((await removed.json()) as Json).profile).toMatchObject({ avatarKey: null, avatarUrl: null });
  });

  it("refuses other files, mislabelled files, empty bodies and anything over 2 MB", async () => {
    const { token } = await signIn();
    const gif = new TextEncoder().encode("GIF89a........");
    expect((await upload(token, gif, "image/gif")).status).toBe(415);
    expect((await upload(token, gif, "image/png")).status).toBe(415);
    // A PNG sent as a JPEG, and an HTML page dressed up as one.
    expect((await upload(token, new Uint8Array(pngHeader(10, 10)), "image/jpeg")).status).toBe(415);
    expect((await upload(token, new TextEncoder().encode("<html><script>alert(1)</script>"), "image/jpeg")).status).toBe(415);
    expect((await upload(token, new Uint8Array(0), "image/png")).status).toBe(400);
    const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
    big.set(pngHeader(10, 10));
    expect((await upload(token, big, "image/png")).status).toBe(413);
    expect(store.objects.size).toBe(0);
    expect((await db.query("select avatar_key from users")).rows).toEqual([{ avatar_key: null }]);
  });

  it("keeps each person's pictures to themselves, and removing one never touches anyone else's or the agent's", async () => {
    const deleted: string[] = [];
    const base = memoryMediaStore("https://api.test");
    const remove = base.delete;
    store = Object.assign(base, { delete: async (key: string) => void (deleted.push(key), await remove(key)) });
    app = makeApp();
    const ada = await signIn("ada@example.com");
    const bob = await signIn("bob@example.com");
    const first = new Uint8Array(pngHeader(10, 10));
    const second = new Uint8Array(jpegHeader(20, 20));
    const keyOf = async (res: Response) => ((await res.json()) as Json).profile.avatarKey as string;
    // The same bytes as a picture the agent made for someone's wish.
    const agentUrl = await base.put(first, "image/png");
    const agentKey = agentUrl.split("/").pop()!;

    const a1 = await keyOf(await upload(ada.token, first, "image/png"));
    const b1 = await keyOf(await upload(bob.token, first, "image/png"));
    expect(a1).toMatch(/^av-/);
    expect(b1).not.toBe(a1);
    expect(a1).not.toBe(agentKey);
    await upload(ada.token, second, "image/jpeg");
    expect(deleted).toEqual([a1]);
    await call("DELETE", "/me/avatar", bob.token);
    expect(deleted).toEqual([a1, b1]);
    // Deleting the account takes Ada's current photo; the agent's picture stays.
    await call("DELETE", "/me", ada.token);
    expect(deleted).toHaveLength(3);
    expect([...store.objects.keys()]).toEqual([agentKey]);
    expect((await app.request(`/media/${agentKey}`)).status).toBe(200);
  });

  it("refuses to delete anything but a profile photo", async () => {
    const base = memoryMediaStore("https://api.test");
    const key = (await base.put(new Uint8Array(pngHeader(3, 3)), "image/png")).split("/").pop()!;
    await base.delete(key);
    expect(base.objects.has(key)).toBe(true);
  });

  it("says so when the server has nowhere to keep pictures", async () => {
    app = makeApp({ media: false });
    const { token } = await signIn();
    expect((await upload(token, new Uint8Array(pngHeader(10, 10)), "image/png")).status).toBe(503);
  });

  it("knows the three formats", () => {
    expect(sniffImage(new Uint8Array(jpegHeader(1, 1)))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array(pngHeader(1, 1)))).toBe("image/png");
    expect(sniffImage(new Uint8Array(webpHeader("VP8L", 1, 1)))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("RIFF....WAVE"))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

async function addWish(token: string, name: string, kind: string, cents: number, verified = false) {
  const res = await call("POST", "/wishes", token, { name, kind, upfrontCents: cents, ...(verified ? { details: { agent: { status: "verified" } } } : {}) });
  expect(res.status).toBe(201);
}

describe("stats", () => {
  it("adds up the list, the checked prices, the conversations and the days", async () => {
    const { token, id } = await signIn();
    const empty = ((await (await call("GET", "/me/stats", token)).json()) as Json).stats;
    expect(empty).toEqual({ wishes: 0, totalCents: 0, pricesChecked: 0, conversations: 0, daysSinceJoining: 0, biggest: null, places: 0, things: 0, experiences: 0 });

    await addWish(token, "Villa on the Riviera", "own", 450_000_000, true);
    await addWish(token, "Porsche 911", "buy", 14_000_000, true);
    await addWish(token, "A week in Kyoto", "visit", 600_000);
    await addWish(token, "Learn to sail", "do", 250_000);
    await addWish(token, "Lisbon", "visit", 0);
    await db.query("insert into dream_sessions (user_id) values ($1), ($1)", [id]);
    await db.query("update users set created_at = $2 where id = $1", [id, "2026-10-01T09:00:00Z"]);
    // Someone else's list never counts.
    const other = await signIn("bob@example.com");
    await addWish(other.token, "Yacht", "own", 9_000_000_000, true);

    const stats = ((await (await call("GET", "/me/stats", token)).json()) as Json).stats;
    expect(stats).toEqual({
      wishes: 5,
      totalCents: 450_000_000 + 14_000_000 + 600_000 + 250_000,
      pricesChecked: 2,
      conversations: 2,
      daysSinceJoining: 27,
      biggest: { name: "Villa on the Riviera", cents: 450_000_000 },
      places: 2,
      things: 2,
      experiences: 1,
    });
  });
});

describe("facts", () => {
  it("writes three grounded lines from the list, keeps them, and records the spend", async () => {
    const { token } = await signIn();
    expect(((await (await call("GET", "/me/facts", token)).json()) as Json).facts).toBeNull();
    await addWish(token, "Villa on the Riviera", "own", 450_000_000, true);
    await addWish(token, "A week in Kyoto", "visit", 600_000);
    await call("PUT", "/me/life", token, { home: { country: "MT", label: "Malta" }, currency: "USD" });
    await call("PATCH", "/me/profile", token, { name: "Ada Lovelace" });
    nextFacts = { facts: ["“Your villa — the crown of the list.”", "Malta suits a list this sunny.", "Kyoto is the one trip - for now."] };

    const res = await call("POST", "/me/facts", token, { persona: "heir" });
    expect(res.status).toBe(200);
    const { facts } = (await res.json()) as Json;
    expect(facts.lines).toEqual(["Your villa, the crown of the list.", "Malta suits a list this sunny.", "Kyoto is the one trip, for now."]);
    expect(facts.generatedAt).toBe(clock.toISOString());
    expect(((await (await call("GET", "/me/facts", token)).json()) as Json).facts).toEqual(facts);

    // The model saw the list and the home, the house rules and the chosen voice; never the email address.
    const sent = metaCalls[0]!;
    expect(sent.text.format).toMatchObject({ type: "json_schema", name: "facts", strict: true });
    expect(sent.instructions).toMatch(/Never invent/);
    expect(sent.instructions).toMatch(/heir/);
    const input = JSON.parse(sent.input) as Json;
    expect(input.wants_to_live).toBe("Malta");
    expect(input.wishes.map((w: Json) => w.name)).toEqual(["Villa on the Riviera", "A week in Kyoto"]);
    expect(input.wishes[0]).toMatchObject({ kind: "a thing to own", price_usd: 4_500_000, price_checked: true });
    // The privacy policy promises Meta never gets the email address or the name.
    expect(sent.input).not.toContain("ada@example.com");
    expect(sent.input).not.toContain("Lovelace");
    expect((await db.query("select kind from spend_ledger")).rows).toEqual([{ kind: "facts" }]);
  });

  it("asks for a list first, and says so when the helper is off", async () => {
    const { token } = await signIn();
    expect((await call("POST", "/me/facts", token)).status).toBe(409);
    expect(metaCalls).toHaveLength(0);
    app = makeApp({ meta: false });
    expect((await call("POST", "/me/facts", token)).status).toBe(503);
  });

  it(`allows ${FACTS_PER_USER_PER_DAY} new sets a day per person`, async () => {
    const { token } = await signIn();
    await addWish(token, "Porsche 911", "buy", 14_000_000);
    for (let i = 0; i < FACTS_PER_USER_PER_DAY; i++) expect((await call("POST", "/me/facts", token)).status).toBe(200);
    const res = await call("POST", "/me/facts", token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as Json).error).not.toMatch(/\bAI\b/);
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000 + 1000);
    // A day later the access token has long expired; signing in again, the allowance is back.
    expect((await call("POST", "/me/facts", (await signIn()).token)).status).toBe(200);
  });

  it("stops at the spend caps and keeps the old facts when the answer is unusable", async () => {
    const { token, id } = await signIn();
    await addWish(token, "Porsche 911", "buy", 14_000_000);
    expect((await call("POST", "/me/facts", token)).status).toBe(200);
    const kept = ((await (await call("GET", "/me/facts", token)).json()) as Json).facts;

    nextFacts = { facts: ["Only one."] };
    expect((await call("POST", "/me/facts", token)).status).toBe(502);
    metaStatus = 429;
    expect((await call("POST", "/me/facts", token)).status).toBe(429);
    expect(((await (await call("GET", "/me/facts", token)).json()) as Json).facts).toEqual(kept);

    metaStatus = 200;
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'muse-spark-1.3', 'research', 5, $2)", [id, clock.toISOString()]);
    const capped = await call("POST", "/me/facts", token);
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as Json).error).not.toMatch(/\bAI\b/);
  });

  it("cleans dashes and quotes out of a line", () => {
    expect(cleanFact("  “A – B” ")).toBe("A, B");
    expect(cleanFact("Well-made - and loved")).toBe("Well-made, and loved");
  });
});

describe("linked accounts", () => {
  it("lists them and unlinks by provider, leaving email sign-in", async () => {
    const { token, id } = await signIn();
    await db.query("insert into user_identities (provider, subject, user_id, email) values ('google', 'g-1', $1, 'ada@example.com'), ('facebook', 'fb-1', $1, null)", [id]);
    const listed = ((await (await call("GET", "/me/identities", token)).json()) as Json).identities;
    expect(listed.map((i: Json) => i.provider).sort()).toEqual(["facebook", "google"]);
    expect(listed[0]).toHaveProperty("linkedAt");
    const after = await call("DELETE", "/me/identities/google", token);
    expect(((await after.json()) as Json).identities.map((i: Json) => i.provider)).toEqual(["facebook"]);
    expect((await call("DELETE", "/me/identities/twitter", token)).status).toBe(404);
    // Someone else's identities are untouched by this account's unlink.
    const bob = await signIn("bob@example.com");
    await db.query("insert into user_identities (provider, subject, user_id) values ('facebook', 'fb-2', $1)", [bob.id]);
    await call("DELETE", "/me/identities/facebook", token);
    expect((await db.query("select subject from user_identities")).rows).toEqual([{ subject: "fb-2" }]);
    // The email code still signs Ada in.
    expect((await signIn()).id).toBe(id);
  });
});
