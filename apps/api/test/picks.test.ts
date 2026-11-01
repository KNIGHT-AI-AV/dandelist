import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Image hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { USER_DAILY_USD } from "../src/agent/routes";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { NOTES_HEADING } from "../src/notes";
import { PICK_RETRY_MS, PICK_TRIES_PER_DAY, PickRejected, checkPick, dayOk, holdFor, sameThing } from "../src/picks";
import { HOLD_USD, heldFor } from "../src/spend";
import { imageResponse, jpegHeader } from "./images";

/**
 * Today's pick (owner, 2026-10-29): one real suggestion a day, made when the list opens, from the person's wishes,
 * notes and earlier picks; never a repeat; with a checked photo or none; within their daily allowance.
 */

type Json = Record<string, any>;
const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/r/ri/Riva_Aquariva.jpg";
const RIVA = {
  title: "Riva Aquariva Super",
  kind: "own",
  why: "It goes with the summers on the lake you wrote about.",
  summary: "A classic wooden runabout.",
  about: "A mahogany runabout built by Riva in Sarnico on Lake Iseo, a modern take on the 1960s Aquarama. It seats eight and is made to order.",
  facts: [{ label: "Made by", value: "Riva" }, { label: "Built in", value: "Sarnico, Italy" }],
  place: "",
};

let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;
let clock: Date;
let calls: Json[];
/** What the model says for each daily pick call, in turn; a string is said as it is. */
let answers: (Json | string)[];
/** The size of the pick's photo on Wikipedia, or none. */
let photoSize: [number, number] | null;
/** Whether the photo search's two looks pick the photo out of the line-up. */
let looksPass: boolean;
/** What the photo search's web search answers. */
let webSays: string;
/** Whose holds each model call sees while it runs, and what they were. */
let watch: string | null;
let held: { format: string; usd: number }[];

const reply = (output: unknown[]) => Response.json({ id: `resp_${calls.length}`, output, usage: { input_tokens: 4000, output_tokens: 300 } });
const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text, annotations: [] }] });

const fakeMeta = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Json;
  calls.push(body);
  const format = body.text?.format?.name;
  if (watch) held.push({ format: format ?? "text", usd: heldFor(watch) });
  if (format === "daily_pick") {
    const next = answers.shift() ?? RIVA;
    // The live API often writes a sentence before the JSON when it has searched (2026-10-29).
    return reply([{ type: "web_search_call", action: { query: "riva boats" } }, message(typeof next === "string" ? next : `Checking what's current first. ${JSON.stringify(next)}`)]);
  }
  if (format === "photo_plan") {
    return reply([message(JSON.stringify({ identity: RIVA.title, lookalikes: ["Riva Iseo"], exact: true, official: "", articles: ["Riva Aquariva"], commons: "", web: "", kind: "vehicle" }))]);
  }
  if (format === "photo_check") {
    // Each look sees the line-up in its own order and answers by letter.
    const options = JSON.stringify(body.input);
    const letter = (name: string) => new RegExp(`([A-G])\\. ${name}`).exec(options)?.[1];
    return reply([message(JSON.stringify({ seen: "A wooden runabout on a lake.", fits: [looksPass ? letter(RIVA.title) : letter("None of these")], quality: "studio", clean: true }))]);
  }
  return reply([message(webSays)]);
}) as unknown as typeof fetch;

const fakeWeb = (async (input: string | URL) => {
  const u = String(input);
  if (u.startsWith("https://en.wikipedia.org/w/api.php")) {
    const pages = photoSize ? { "1": { title: "Riva Aquariva", original: { source: PHOTO, width: photoSize[0], height: photoSize[1] } } } : {};
    return Response.json({ query: { pages } });
  }
  if (u === PHOTO && photoSize) return imageResponse(jpegHeader(photoSize[0], photoSize[1]), "image/jpeg");
  return new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  calls = [];
  answers = [];
  photoSize = [3000, 2000];
  looksPass = true;
  webSays = "Nothing.";
  watch = null;
  held = [];
  clock = new Date("2026-10-29T12:00:00Z");
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: { apiKey: "test", fetch: fakeMeta },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: fakeWeb,
    archive: null,
  });
});

const call = async (method: string, path: string, token: string | null, body?: unknown) =>
  app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function signIn(email = "ada@example.com") {
  await call("POST", "/auth/email/start", null, { email });
  const res = await call("POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { id: string } };
  return { token: body.accessToken, refresh: body.refreshToken, id: body.user.id };
}

/** Moves the clock and renews the person's access token, which lasts 15 minutes. */
async function later(person: { token: string; refresh: string }, to: Date) {
  clock = to;
  const res = await call("POST", "/auth/refresh", null, { refreshToken: person.refresh });
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  person.token = body.accessToken;
  person.refresh = body.refreshToken;
}

const addWish = (token: string, name: string, note?: string) => call("POST", "/wishes", token, { name, kind: "buy", upfrontCents: 100_000, ...(note ? { note } : {}) });
const today = async (token: string, day = "2026-10-29", extra: Json = {}) => {
  const res = await call("POST", "/picks/today", token, { day, ...extra });
  return { status: res.status, body: (await res.json()) as Json };
};
const pickCalls = () => calls.filter((b) => b.text?.format?.name === "daily_pick");

describe("the pick's rules", () => {
  it("takes the person's own date within a day of the server's", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    for (const d of ["2026-10-28", "2026-10-29", "2026-10-30"]) expect(dayOk(d, now), d).toBe(true);
    for (const d of ["2026-10-27", "2026-10-31", "2026-02-30", "29/10/2026", "2026-10-29T00:00", "", "2026-1-29"]) expect(dayOk(d, now), d).toBe(false);
  });

  it("knows a thing by any of its names", () => {
    expect(sameThing("Leica Q3", "A Leica Q3")).toBe(true);
    expect(sameThing("Leica Q3 43", "leica q3")).toBe(true);
    expect(sameThing("A week in Kyoto in April", "A week in Kyoto")).toBe(true);
    expect(sameThing("Rolex", "Rolex Submariner")).toBe(false);
    expect(sameThing("Leica M11", "Leica Q3")).toBe(false);
  });

  it("refuses a repeat, a price, flattery and the machinery, and tidies what it keeps", () => {
    const none = { wishes: [{ name: "Leica Q3", kind: "buy" }], picks: [{ title: "Fujifilm X100VI", status: "skipped" }] };
    const ok = { title: "Leica Summilux 35", kind: "buy", why: "Your Q3 is fixed at 28mm — this lens frames people closer.", summary: "A fast lens.", place: "" };
    // A model answer from before about and facts were asked for still makes a pick, without them.
    expect(checkPick(ok, none)).toEqual({ title: "Leica Summilux 35", kind: "buy", why: "Your Q3 is fixed at 28mm, this lens frames people closer.", summary: "A fast lens.", about: "", facts: [], place: "" });
    const no = (change: Json) => expect(() => checkPick({ ...ok, ...change }, none)).toThrow(PickRejected);
    no({ title: "A Leica Q3" });
    no({ title: "Fujifilm X100VI" });
    no({ why: "It costs less than your Q3." });
    no({ why: "Only $4,000 and worth every penny." });
    no({ why: "A great deal for a camera like yours." });
    no({ why: "You deserve a lens as good as your eye." });
    no({ why: "Our AI thinks you will love it." });
    no({ why: "Short." });
    no({ kind: "steal" });
    no({ title: "https://leica.com/lens" });
    expect(() => checkPick(null, none)).toThrow(PickRejected);
  });

  it("keeps the page's about and facts to the why line's rules, dropping only what breaks them", () => {
    const none = { wishes: [], picks: [] };
    const ok = { title: "Leica M11-P", kind: "buy", why: "Your Q3 is fixed at 28mm, and this one takes every Leica M lens.", summary: "A rangefinder camera." };
    const about = "A full-frame rangefinder made by Leica in Wetzlar — the M11 with a silent shutter and content credentials built in.";
    const facts = [
      { label: "Made by", value: "Leica" },
      { label: "Price", value: "$9,195" },
      { label: "made by", value: "Leica Camera AG" },
      { label: "Sensor", value: "60 megapixels" },
      { label: "Weight", value: "530 g" },
      { label: "Mount", value: "Leica M" },
      { label: "", value: "Empty" },
    ];
    const made = checkPick({ ...ok, about, facts }, none);
    expect(made.about).toBe("A full-frame rangefinder made by Leica in Wetzlar, the M11 with a silent shutter and content credentials built in.");
    // The price goes, a repeated label goes, an empty one goes, and three at most stay.
    expect(made.facts).toEqual([{ label: "Made by", value: "Leica" }, { label: "Sensor", value: "60 megapixels" }, { label: "Weight", value: "530 g" }]);
    // An about with a price, flattery or too little in it is left out; the pick stands.
    expect(checkPick({ ...ok, about: "Yours for about $9,000 before tax." }, none).about).toBe("");
    expect(checkPick({ ...ok, about: "You deserve a camera this fine." }, none).about).toBe("");
    expect(checkPick({ ...ok, about: "A camera." }, none).about).toBe("");
    // Facts that come back as something else are simply none.
    expect(checkPick({ ...ok, facts: "Made by Leica" }, none).facts).toEqual([]);
  });
});

describe("today's pick", () => {
  it("needs a signed-in person and their own date", async () => {
    expect((await call("POST", "/picks/today", null, { day: "2026-10-29" })).status).toBe(401);
    const { token } = await signIn();
    expect((await today(token, "2026-10-31")).status).toBe(400);
    expect((await today(token, "tomorrow")).status).toBe(400);
    expect((await call("POST", "/picks/today", token, {})).status).toBe(400);
  });

  it("waits for a first wish", async () => {
    const { token } = await signIn();
    expect((await today(token)).body).toEqual({ pick: null });
    expect(calls).toEqual([]);
    expect((await db.query("select count(*)::int as n from daily_picks")).rows[0]).toEqual({ n: 0 });
  });

  it("is one real thing from the list, the notes and the earlier picks, with a checked photo, made once a day", async () => {
    const { token, id } = await signIn();
    await addWish(token, "Leica Q3", "My dad shot everything on a Leica.");
    clock = new Date("2026-10-29T12:01:00Z");
    await addWish(token, "Riva boat", "Summers on the lake with my brother.");
    const first = await today(token);
    expect(first.status).toBe(200);
    expect(first.body.pick).toMatchObject({ day: "2026-10-29", status: "ready", title: "Riva Aquariva Super", kind: "own", why: RIVA.why, summary: RIVA.summary, about: RIVA.about, facts: RIVA.facts });
    expect(first.body.pick.photo).toEqual({ url: PHOTO, width: 3000, height: 2000, source: "wikipedia.org", credit: "Wikipedia: Riva Aquariva" });

    // Muse Spark at low effort, one web search, JSON out; the notes are framed as data in its instructions.
    const [ask] = pickCalls();
    expect(ask).toMatchObject({ model: "muse-spark-1.3", reasoning: { effort: "low" }, tools: [{ type: "web_search" }], max_tool_calls: 1, text: { format: { type: "json_schema", name: "daily_pick", strict: true } } });
    expect(ask!.instructions).toContain(NOTES_HEADING);
    expect(ask!.instructions).toContain('"Riva boat: Summers on the lake with my brother."');
    expect(ask!.input).toContain('THEIR WISHES (newest first): [{"title":"Riva boat","kind":"a thing to buy"},{"title":"Leica Q3","kind":"a thing to buy"}]');
    expect(ask!.input).toContain("PICKED BEFORE (newest first): none yet");
    expect(ask!.input).toContain("TODAY: 2026-10-29");
    // The photo passed the search's two looks, each picking it out of a line-up.
    expect(calls.filter((b) => b.text?.format?.name === "photo_check")).toHaveLength(2);
    // Every call, the photo search's included, counts against the person's own allowance.
    const spent = (await db.query<{ n: number }>("select count(*)::int as n from spend_ledger where user_id = $1 and kind = 'pick'", [id])).rows[0]!;
    expect(spent.n).toBe(calls.length);

    // Opening the list again the same day costs nothing.
    const again = await today(token);
    expect(again.body.pick).toEqual(first.body.pick);
    expect(pickCalls()).toHaveLength(1);
  });

  it("holds its own share of the caps for each call, a look at a photo a fifth of one", async () => {
    const { token, id } = await signIn();
    await addWish(token, "Riva boat");
    watch = id;
    expect((await today(token)).body.pick.photo).not.toBeNull();
    const looks = held.filter((h) => h.format === "photo_check");
    expect(looks).toHaveLength(2);
    // Each look runs under its own small hold (one or two in flight), never one shared hold for the whole search.
    for (const { usd } of looks) {
      const fifths = usd / (HOLD_USD / 5);
      expect(Math.abs(fifths - Math.round(fifths))).toBeLessThan(1e-9);
      expect(Math.round(fifths)).toBeGreaterThanOrEqual(1);
      expect(Math.round(fifths)).toBeLessThanOrEqual(2);
    }
    for (const h of held.filter((x) => x.format === "daily_pick" || x.format === "photo_plan")) expect(h.usd).toBeGreaterThanOrEqual(HOLD_USD);
    // Everything is released once the pick is made.
    expect(heldFor(id)).toBe(0);
    expect(holdFor({ text: { format: { name: "photo_check" } } })).toBeCloseTo(HOLD_USD / 5);
    expect(holdFor({ text: { format: { name: "daily_pick" } } })).toBe(HOLD_USD);
  });

  it("shows no photo rather than an unchecked one", async () => {
    const { token } = await signIn();
    await addWish(token, "Riva boat");
    photoSize = [320, 200];
    expect((await today(token)).body.pick).toMatchObject({ title: "Riva Aquariva Super", photo: null });
    photoSize = null;
    answers = [{ ...RIVA, title: "Riva Rivamare" }];
    expect((await today(token, "2026-10-30")).body.pick).toMatchObject({ title: "Riva Rivamare", photo: null });
    // A photo of the right size that the two looks don't pick out is not shown either.
    photoSize = [3000, 2000];
    looksPass = false;
    answers = [{ ...RIVA, title: "Riva Dolceriva" }];
    expect((await today(token, "2026-10-28")).body.pick).toMatchObject({ title: "Riva Dolceriva", photo: null });
    expect(calls.filter((b) => b.text?.format?.name === "photo_check").length).toBeGreaterThan(0);
  });

  it("logs how each pick's photo search went, in counts and hosts only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const lines = () => info.mock.calls.filter((c) => c[0] === "daily pick photo").map((c) => JSON.parse(String(c[1])) as Json);
      const { token } = await signIn();
      await addWish(token, "Riva boat");
      await today(token);
      // A photo the looks picked: found, from its host, with the counts behind it.
      expect(lines()).toEqual([expect.objectContaining({ kind: "own", found: true, source: "wikipedia.org", outOfTime: false, sizedOk: 1, judged: 1 })]);
      expect(lines()[0]!.sources).toMatchObject({ wikipedia: 1 });
      // The web search answered and named nothing (this stand-in's search answers "Nothing."), so nothing was opened.
      expect(lines()[0]!.web).toEqual({ said: 0, read: 0, readOk: 0, photos: 0 });
      // One the looks didn't pick: judged, not found.
      looksPass = false;
      answers = [{ ...RIVA, title: "Riva Rivamare" }];
      await today(token, "2026-10-30");
      expect(lines()[1]).toMatchObject({ found: false, sizedOk: 1, judged: 1 });
      // One too small to show: never judged, with the reason it was set aside.
      photoSize = [320, 200];
      answers = [{ ...RIVA, title: "Riva Dolceriva" }];
      await today(token, "2026-10-28");
      expect(lines()[2]).toMatchObject({ found: false, sizedOk: 0, judged: 0 });
      expect(Object.keys(lines()[2]!.setAside as Json)).toEqual(["too small"]);
      // A web search that names a photo and a page that won't open (the way shops refuse the server): counted, not named.
      photoSize = [3000, 2000];
      looksPass = true;
      webSays = "https://shop.example/riva-iseo.jpg\nhttps://shop.example/riva-iseo";
      answers = [{ ...RIVA, title: "Riva Iseo" }];
      // Another person's pick: this one already has a pick on each day the route takes.
      const other = await signIn("grace@example.com");
      await addWish(other.token, "Riva boat");
      await today(other.token);
      expect(lines()[3]!.web).toEqual({ said: 2, read: 1, readOk: 0, photos: 0 });
      // Never the pick's title or an address.
      expect(info.mock.calls.filter((c) => c[0] === "daily pick photo").map((c) => String(c[1])).join(" ")).not.toMatch(/Riva|https?:/);
    } finally {
      info.mockRestore();
    }
  });

  it("makes one pick when two requests come at once", async () => {
    const { token } = await signIn();
    await addWish(token, "Riva boat");
    const both = await Promise.all([today(token), today(token)]);
    expect(pickCalls()).toHaveLength(1);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.some((r) => r.body.pick?.title === "Riva Aquariva Super")).toBe(true);
    for (const r of both) expect(r.body.pick?.title === "Riva Aquariva Super" || r.body.pending === true).toBe(true);
    expect((await today(token)).body.pick.title).toBe("Riva Aquariva Super");
  });

  it("records what the person did with it, and the next pick learns from it", async () => {
    const ada = await signIn();
    const bo = await signIn("bo@example.com");
    await addWish(ada.token, "Riva boat");
    const { pick } = (await today(ada.token)).body;
    expect((await call("PATCH", `/picks/${pick.id}`, bo.token, { outcome: "skipped" })).status).toBe(404);
    expect((await call("PATCH", `/picks/${pick.id}`, ada.token, { outcome: "maybe" })).status).toBe(400);
    const res = await call("PATCH", `/picks/${pick.id}`, ada.token, { outcome: "skipped" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).pick).toMatchObject({ id: pick.id, status: "skipped" });
    expect((await today(ada.token)).body.pick.status).toBe("skipped");

    // The next day: never the same thing again, and what was turned down is in the model's input.
    await later(ada, new Date("2026-10-30T09:00:00Z"));
    answers = [{ ...RIVA, title: "Riva Aquariva" }];
    expect((await today(ada.token, "2026-10-30")).body).toEqual({ pick: null });
    expect(pickCalls().at(-1)!.input).toContain('PICKED BEFORE (newest first): [{"title":"Riva Aquariva Super","outcome":"turned down"}]');
    // A minute on, nothing is tried; five minutes on, the next open tries again, and the third failed try is the last.
    await later(ada, new Date(clock.getTime() + 60_000));
    expect((await today(ada.token, "2026-10-30")).body).toEqual({ pick: null });
    expect(pickCalls()).toHaveLength(2);
    for (let i = 1; i < PICK_TRIES_PER_DAY; i++) {
      await later(ada, new Date(clock.getTime() + PICK_RETRY_MS + 1));
      answers = [{ ...RIVA, title: "A Riva Aquariva Super" }];
      expect((await today(ada.token, "2026-10-30")).body).toEqual({ pick: null });
    }
    expect(pickCalls()).toHaveLength(1 + PICK_TRIES_PER_DAY);
    await later(ada, new Date(clock.getTime() + PICK_RETRY_MS + 1));
    expect((await today(ada.token, "2026-10-30")).body).toEqual({ pick: null });
    expect(pickCalls()).toHaveLength(1 + PICK_TRIES_PER_DAY);

    // Added: the outcome is kept.
    await later(ada, new Date("2026-10-31T09:00:00Z"));
    answers = [{ ...RIVA, title: "A week on Lake Como", kind: "visit", place: "Lake Como, Italy" }];
    const next = (await today(ada.token, "2026-10-31")).body.pick;
    expect(next).toMatchObject({ title: "A week on Lake Como", kind: "visit" });
    expect(((await (await call("PATCH", `/picks/${next.id}`, ada.token, { outcome: "added" })).json()) as Json).pick.status).toBe("added");
  });

  it("asks once more for the JSON when the answer comes back as plain words", async () => {
    const { token } = await signIn();
    await addWish(token, "Riva boat");
    answers = ["Here is a lovely idea for you: a Riva Aquariva Super.", RIVA];
    expect((await today(token)).body.pick.title).toBe("Riva Aquariva Super");
    const [first, second] = pickCalls();
    expect(first!.previous_response_id).toBeUndefined();
    expect(second).toMatchObject({ previous_response_id: "resp_1", reasoning: { effort: "low" } });
  });

  it("speaks in the Dandy's voice and ignores a personality it doesn't know", async () => {
    const { token } = await signIn();
    await addWish(token, "Riva boat");
    expect((await today(token, "2026-10-29", { persona: "mogul" })).status).toBe(200);
    expect(pickCalls()[0]!.instructions).toContain("self-made mogul");
    answers = [{ ...RIVA, title: "Riva Rivamare" }];
    expect((await today(token, "2026-10-30", { persona: "pirate" })).body.pick.title).toBe("Riva Rivamare");
    expect(pickCalls()[1]!.instructions).not.toContain("Speak in the voice");
  });

  it("is simply not there on a day the allowance is used up", async () => {
    const ada = await signIn();
    await addWish(ada.token, "Riva boat");
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'muse-spark-1.3', 'research', $2, $3)", [ada.id, USER_DAILY_USD, clock.toISOString()]);
    expect((await today(ada.token)).body).toEqual({ pick: null });
    expect(calls).toEqual([]);
    expect((await db.query("select status from daily_picks where user_id = $1", [ada.id])).rows).toEqual([{ status: "none" }]);
    // Even once the allowance frees up, that day stays without a pick.
    await db.query("delete from spend_ledger");
    await later(ada, new Date(clock.getTime() + 6 * 60 * 60 * 1000));
    expect((await today(ada.token)).body).toEqual({ pick: null });
    expect(calls).toEqual([]);
  });

  it("takes over a pick a request left unfinished", async () => {
    const { token, id } = await signIn();
    await addWish(token, "Riva boat");
    await db.query("insert into daily_picks (user_id, day, status, created_at, updated_at) values ($1, '2026-10-29', 'making', $2, $2)", [id, new Date(clock.getTime() - 60_000).toISOString()]);
    expect((await today(token)).body).toEqual({ pick: null, pending: true });
    expect(calls).toEqual([]);
    clock = new Date(clock.getTime() + 2 * 60_000);
    expect((await today(token)).body.pick.title).toBe("Riva Aquariva Super");
  });

  it("leaves a dead claim alone once the day's tries are used, so a crash can't buy a fourth try", async () => {
    const { token, id } = await signIn();
    await addWish(token, "Riva boat");
    await db.query("insert into daily_picks (user_id, day, status, attempts, created_at, updated_at) values ($1, '2026-10-29', 'making', 3, $2, $2)", [id, new Date(clock.getTime() - 10 * 60_000).toISOString()]);
    expect((await today(token)).body).toEqual({ pick: null });
    expect(calls).toEqual([]);
  });
});
