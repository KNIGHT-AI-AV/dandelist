import { PGlite } from "@electric-sql/pglite";
import { MetaApiError, type ResponsesResult } from "@dandelist/meta";
import { beforeEach, describe, expect, it } from "vitest";
import { accepted } from "./consent-helper";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { readEnv } from "../src/env";
import { PHOTO_CHECK } from "../src/agent/photos";
import { holdFor } from "../src/picks";
import { CLAUDE_HOLD_USD, HOLD_USD, SpendLimitError, assertBudget, assertClaudeBudget, assertUserBudget, heldFor, heldInPool, withHold } from "../src/spend";
import { claudeFor, claudeForGuests, eitherReady, guestShareUsd, metaFirst, type Under } from "../src/under";

type Json = Record<string, any>;

// ---------------------------------------------------------------- the order: Meta first, Claude under it

const answer = (id: string, text = id): ResponsesResult => ({
  id,
  text,
  citations: [],
  functionCalls: [],
  searchQueries: [],
  usage: { model: "x", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searches: 0 },
  costUsd: 0,
  raw: null,
});

/** A Meta that answers, or refuses with `fail`, and counts its calls. */
function meta(fail?: unknown) {
  const calls: Json[] = [];
  return {
    calls,
    responses: async (body: Json) => {
      calls.push(body);
      if (fail) throw fail;
      return answer("resp_meta");
    },
  };
}

/** A Claude under it that answers, or refuses with `fail`. */
function under(fail?: unknown, setup: Partial<Under["setup"]> = {}) {
  const calls: Json[] = [];
  const u: Under = {
    setup: { apiKey: "k", dailyUsd: 5, ...setup },
    guard: async () => {
      if (fail instanceof SpendLimitError) throw fail;
    },
    run: async (body) => {
      calls.push(body);
      if (fail) throw fail;
      return answer("claude_1");
    },
  };
  return { calls, u };
}

describe("metaFirst", () => {
  it("never calls Claude while Meta answers", async () => {
    const m = meta();
    const c = under();
    expect((await metaFirst(m.responses, c.u)({ input: "hi" })).id).toBe("resp_meta");
    expect(c.calls).toHaveLength(0);
  });

  it("hands the call to Claude when Meta's daily or all-time cap, or the guests' share, is spent", async () => {
    for (const scope of ["daily", "total"] as const) {
      const m = meta(new SpendLimitError(scope));
      const c = under();
      expect((await metaFirst(m.responses, c.u)({ input: "hi" })).id).toBe("claude_1");
      expect(m.calls).toHaveLength(1);
      expect(c.calls).toEqual([{ input: "hi" }]);
    }
  });

  it("keeps one person's allowance and their calls in flight on Meta: those refusals stand", async () => {
    const refusal = new SpendLimitError("user");
    const c = under();
    await expect(metaFirst(meta(refusal).responses, c.u)({ input: "hi" })).rejects.toBe(refusal);
    expect(c.calls).toHaveLength(0);
  });

  it("without a Claude key, gives today's refusal", async () => {
    const refusal = new SpendLimitError("daily");
    await expect(metaFirst(meta(refusal).responses, undefined)({ input: "hi" })).rejects.toBe(refusal);
  });

  it("gives Meta's refusal, not Claude's, when Claude's own cap is spent too, or Claude fails", async () => {
    const refusal = new SpendLimitError("daily");
    await expect(metaFirst(meta(refusal).responses, under(new SpendLimitError("daily")).u)({ input: "hi" })).rejects.toBe(refusal);
    await expect(metaFirst(meta(refusal).responses, under(new MetaApiError(500, "down")).u)({ input: "hi" })).rejects.toBe(refusal);
  });

  it("hands Meta's service failing to Claude only when the setup says so", async () => {
    const down = new MetaApiError(503, "down");
    await expect(metaFirst(meta(down).responses, under().u)({ input: "hi" })).rejects.toBe(down);
    expect((await metaFirst(meta(down).responses, under(undefined, { onMetaErrors: true }).u)({ input: "hi" })).id).toBe("claude_1");
    const refused = new MetaApiError(400, "bad");
    await expect(metaFirst(meta(refused).responses, under(undefined, { onMetaErrors: true }).u)({ input: "hi" })).rejects.toBe(refused);
  });

  it("hands the call to Claude when Meta says its credit has run out (402), with or without onMetaErrors", async () => {
    const broke = new MetaApiError(402, '{"error":{"message":"insufficient credits"}}');
    const c = under();
    expect((await metaFirst(meta(broke).responses, c.u)({ input: "hi" })).id).toBe("claude_1");
    expect(c.calls).toHaveLength(1);
  });

  it("keeps a conversation with whoever began it", async () => {
    // Claude's own conversation goes on with Claude, without asking Meta.
    const m = meta();
    const c = under();
    await metaFirst(m.responses, c.u)({ previous_response_id: "claude_1", input: "more" });
    expect(m.calls).toHaveLength(0);
    expect(c.calls).toHaveLength(1);
    // Meta's can't move to Claude, which never saw it.
    const refusal = new SpendLimitError("daily");
    const c2 = under();
    await expect(metaFirst(meta(refusal).responses, c2.u)({ previous_response_id: "resp_meta", input: "more" })).rejects.toBe(refusal);
    expect(c2.calls).toHaveLength(0);
  });

  it("never sends Meta's own models to Claude: SAM stays Meta's", async () => {
    const refusal = new SpendLimitError("daily");
    const c = under();
    await expect(metaFirst(meta(refusal).responses, c.u)({ model: "sam-3.1", input: "a watch" })).rejects.toBe(refusal);
    expect(c.calls).toHaveLength(0);
    expect((await metaFirst(meta(refusal).responses, c.u)({ model: "muse-spark-1.3", input: "hi" })).id).toBe("claude_1");
  });
});

describe("eitherReady", () => {
  it("passes when Meta can, or when Meta's caps are spent and Claude can; otherwise Meta's refusal stands", async () => {
    const refusal = new SpendLimitError("daily");
    await expect(eitherReady(async () => {}, undefined)).resolves.toBeUndefined();
    await expect(eitherReady(async () => Promise.reject(refusal), async () => {})).resolves.toBeUndefined();
    await expect(eitherReady(async () => Promise.reject(refusal), undefined)).rejects.toBe(refusal);
    await expect(eitherReady(async () => Promise.reject(refusal), async () => Promise.reject(new SpendLimitError("daily")))).rejects.toBe(refusal);
    const mine = new SpendLimitError("user");
    await expect(eitherReady(async () => Promise.reject(mine), async () => {})).rejects.toBe(mine);
  });
});

// ---------------------------------------------------------------- the ledger: each provider's caps count its own rows

let db: Db;
beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
});

describe("caps by model", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const caps = { dailyUsd: 10, totalUsd: 120 };
  const row = (model: string, usd: number, userId: string | null = null) =>
    db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, $2, 'test', $3, $4)", [userId, model, usd.toFixed(6), now.toISOString()]);

  it("counts Meta's spend against Meta's caps and Claude's against Claude's", async () => {
    await row("claude-opus-5-5", 50);
    await expect(assertBudget(db, caps, now)).resolves.toBeUndefined();
    await expect(assertClaudeBudget(db, 60, now)).resolves.toBeUndefined();
    await expect(assertClaudeBudget(db, 50, now)).rejects.toBeInstanceOf(SpendLimitError);
    await row("muse-spark-1.3", 10);
    await expect(assertBudget(db, caps, now)).rejects.toMatchObject({ scope: "daily" });
    await expect(assertClaudeBudget(db, 60, now)).resolves.toBeUndefined();
  });

  it("keeps one person's Claude spend out of their Meta allowance", async () => {
    const { rows } = await db.query<{ id: string }>("insert into users (email) values ('ada@example.com') returning id");
    const id = rows[0]!.id;
    await row("claude-opus-5-5", 3, id);
    await expect(assertUserBudget(db, id, 2, now)).resolves.toBeUndefined();
  });

  it("holds Claude's calls in flight against Claude's caps, never Meta's", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const running = withHold(async () => {}, () => gate, "user-z", HOLD_USD, undefined, "claude");
    await new Promise((r) => setTimeout(r, 0));
    expect(heldFor("user-z")).toBe(0);
    expect(heldFor("user-z", "claude")).toBeCloseTo(HOLD_USD, 12);
    await row("claude-opus-5-5", 5 - HOLD_USD / 2);
    await expect(assertClaudeBudget(db, 5, now)).rejects.toBeInstanceOf(SpendLimitError);
    await row("muse-spark-1.3", 10 - HOLD_USD / 2);
    await expect(assertBudget(db, caps, now)).resolves.toBeUndefined();
    open();
    await running;
  });
});

describe("guests on Claude", () => {
  it("count the guests' share of Claude's day on Claude's guest rows alone", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const guestRow = (model: string, usd: number) =>
      db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, $1, 'guest', $2, $3)", [model, usd.toFixed(6), now.toISOString()]);
    const u = claudeForGuests({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 20 } }, "guest", { shareUsd: 6 })!;
    await guestRow("muse-spark-1.3", 6);
    await expect(u.guard()).resolves.toBeUndefined();
    await guestRow("claude-opus-5-5", 6);
    await expect(u.guard()).rejects.toBeInstanceOf(SpendLimitError);
    expect(claudeForGuests({ db, now: () => now }, "guest", { shareUsd: 6 })).toBeUndefined();
  });

  it("get the same share of Claude's day as of Meta's", () => {
    // $6 of Meta's $10 is three fifths; three fifths of Claude's $5 is $3.
    expect(guestShareUsd(5, 6, 10)).toBeCloseTo(3, 12);
  });
});

describe("Claude's holds", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  /** A Claude whose replies wait at a gate, counting the calls that reached it. */
  const gatedClaude = () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const reached = { n: 0 };
    const fetch = (async () => {
      reached.n++;
      await gate;
      return new Response(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, open: () => open(), reached };
  };
  const person = async (email: string) => (await db.query<{ id: string }>("insert into users (email) values ($1) returning id", [email])).rows[0]!.id;
  const photoCheck = { input: "which?", text: { format: { type: "json_schema", name: PHOTO_CHECK, schema: { type: "object", properties: {} } } } };

  it("hold enough of Claude's day for a full Opus 5.5 call, and a fifth of it for a photo check", async () => {
    const userId = await person("hold@example.com");
    const claude = gatedClaude();
    const u = claudeFor({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 5, fetch: claude.fetch, maxRetries: 0 } }, userId, "research", { personUsd: 2, usd: holdFor })!;
    const full = u.run({ input: "price it" });
    await new Promise((r) => setTimeout(r, 50));
    expect(CLAUDE_HOLD_USD).toBe(0.6);
    expect(heldInPool("claude")).toBeCloseTo(CLAUDE_HOLD_USD, 12);
    const look = u.run(photoCheck);
    await new Promise((r) => setTimeout(r, 50));
    expect(heldInPool("claude")).toBeCloseTo(CLAUDE_HOLD_USD * 1.2, 12);
    // The person's own share counts what their calls hold on Meta: a tenth of a dollar, a fiftieth for a photo check.
    expect(heldFor(userId, "claude")).toBeCloseTo(HOLD_USD * 1.2, 12);
    claude.open();
    await Promise.all([full, look]);
    expect(heldFor(userId, "claude")).toBe(0);
    // Back to nothing, give or take float dust (0.6 + 0.12 - 0.6 - 0.12).
    expect(heldInPool("claude")).toBeCloseTo(0, 12);
  });

  it("let a person with five full calls in flight and nothing spent start another, while Claude's day counts each in full", async () => {
    const userId = await person("busy@example.com");
    const claude = gatedClaude();
    const u = claudeFor({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 20, fetch: claude.fetch, maxRetries: 0 } }, userId, "research", { personUsd: 2, usd: holdFor })!;
    const calls = Array.from({ length: 6 }, () => u.run({ input: "price it" }));
    await new Promise((r) => setTimeout(r, 100));
    // Six at $0.60 would be $3.60 against the person's $2 and the fourth would be refused; at $0.10 each, all six run.
    expect(claude.reached.n).toBe(6);
    expect(heldFor(userId, "claude")).toBeCloseTo(6 * HOLD_USD, 12);
    expect(heldInPool("claude")).toBeCloseTo(6 * CLAUDE_HOLD_USD, 12);
    // Claude's day still sees the full holds: with $16.50 spent, six in flight ($3.60) leave no room for a seventh.
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'claude-opus-5-5', 'guest', 16.5, $1)", [now.toISOString()]);
    await expect(assertClaudeBudget(db, 20, now)).rejects.toBeInstanceOf(SpendLimitError);
    claude.open();
    await Promise.all(calls);
  });
});

describe("Claude's resumes", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  /** A Claude that pauses its search once, at $0.50 of fast-mode output, then finishes; it counts the requests. */
  const pausingClaude = () => {
    const replies = [
      { content: [{ type: "text", text: "Looking it up." }, { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q3" } }], stop_reason: "pause_turn" },
      { content: [{ type: "text", text: "It is $5,995." }], stop_reason: "end_turn" },
    ];
    const sent = { n: 0 };
    const fetch = (async () => {
      const r = replies[Math.min(sent.n++, replies.length - 1)]!;
      return new Response(JSON.stringify({ id: `msg_${sent.n}`, type: "message", role: "assistant", model: "claude-opus-5-5", ...r, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 12_500 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, sent };
  };
  const person = async (email: string) => (await db.query<{ id: string }>("insert into users (email) values ($1) returning id", [email])).rows[0]!.id;
  const claudeRow = (userId: string | null, usd: number) =>
    db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'claude-opus-5-5', 'guest', $2, $3)", [userId, usd.toFixed(6), now.toISOString()]);
  const search = { input: "price the Q3", tools: [{ type: "web_search" }] };

  it("stop a paused search that would resume past Claude's day, with the answer so far", async () => {
    const userId = await person("cap@example.com");
    // $4.00 spent of $5: the call starts ($4.60 with its hold), but its first $0.50 leaves no room to resume ($5.10).
    await claudeRow(null, 4);
    const claude = pausingClaude();
    const u = claudeFor({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 5, fetch: claude.fetch, maxRetries: 0 } }, userId, "research", { personUsd: 2 })!;
    const r = await u.run(search);
    expect(claude.sent.n).toBe(1);
    expect(r.text).toBe("Looking it up.");
    expect(r.costUsd).toBeCloseTo(0.5, 12);
  });

  it("stop a guests' paused search that would resume past the guests' share", async () => {
    // $2.20 of the guests' $3: the call starts ($2.80 with its hold), but a resume after its first $0.50 would make $3.30.
    await claudeRow(null, 2.2);
    const claude = pausingClaude();
    const g = claudeForGuests({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 5, fetch: claude.fetch, maxRetries: 0 } }, "guest", { shareUsd: 3 })!;
    expect((await g.run(search)).text).toBe("Looking it up.");
    expect(claude.sent.n).toBe(1);
  });

  it("resume a paused search that stays within the caps", async () => {
    const userId = await person("room@example.com");
    const claude = pausingClaude();
    const u = claudeFor({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 5, fetch: claude.fetch, maxRetries: 0 } }, userId, "research", { personUsd: 2 })!;
    const r = await u.run(search);
    expect(claude.sent.n).toBe(2);
    expect(r.text).toBe("Looking it up. It is $5,995.");
  });

  it("stop resuming once the person's own spend, with what is in flight, passes their share", async () => {
    const userId = await person("share@example.com");
    // $1.50 of their $2: the call starts ($1.60 with its $0.10), but after its first $0.50 a resume would make $2.10.
    await claudeRow(userId, 1.5);
    const claude = pausingClaude();
    const u = claudeFor({ db, now: () => now, claude: { apiKey: "k", dailyUsd: 20, fetch: claude.fetch, maxRetries: 0 } }, userId, "research", { personUsd: 2 })!;
    const r = await u.run(search);
    expect(claude.sent.n).toBe(1);
    expect(r.text).toBe("Looking it up.");
  });

  it("change nothing without a Claude key", async () => {
    const userId = await person("nokey@example.com");
    expect(claudeFor({ db, now: () => now }, userId, "research", { personUsd: 2 })).toBeUndefined();
    expect(claudeForGuests({ db, now: () => now }, "guest", { shareUsd: 3 })).toBeUndefined();
    const refusal = new SpendLimitError("daily");
    await expect(metaFirst(meta(refusal).responses, claudeFor({ db, now: () => now }, userId, "research", { personUsd: 2 }))({ input: "hi" })).rejects.toBe(refusal);
  });
});

// ---------------------------------------------------------------- end to end: the facts route on Claude

const metaReply = () =>
  Response.json({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ facts: ["From Meta one.", "From Meta two.", "From Meta three."] }) }] }], usage: { input_tokens: 900, output_tokens: 80 } });
let metaCalls: Json[];
const fakeMeta = (async (_url: string, init: RequestInit) => {
  metaCalls.push(JSON.parse(String(init.body)));
  return metaReply();
}) as unknown as typeof fetch;

let claudeCalls: Json[];
const fakeClaude = (async (_url: string, init: RequestInit) => {
  claudeCalls.push(JSON.parse(String(init.body)));
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify({ facts: ["From Claude one.", "From Claude two.", "From Claude three."] }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as unknown as typeof fetch;

describe("facts on Claude, under Meta", () => {
  let mail: { to: string; code: string }[];
  let clock: Date;
  let app: ReturnType<typeof createApp>;
  const makeApp = (claude: { dailyUsd: number } | null) =>
    createApp({
      db,
      mailer: { sendCode: async (to: string, code: string) => void mail.push({ to, code }) },
      jwtSecret: "test-secret-that-is-at-least-32-chars-long",
      codePepper: "test-pepper-16-chars",
      now: () => clock,
      webOrigins: [],
      meta: { apiKey: "test", fetch: fakeMeta },
      ...(claude ? { claude: { apiKey: "claude-test", dailyUsd: claude.dailyUsd, fetch: fakeClaude, maxRetries: 0 } } : {}),
      spendCaps: { dailyUsd: 10, totalUsd: 120 },
      oauth: { apiUrl: "https://api.test", production: false },
    } as Parameters<typeof createApp>[0]);
  const call = (method: string, path: string, token: string | null, body?: unknown) =>
    app.request(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const signIn = async () => {
    await call("POST", "/auth/email/start", null, { email: "ada@example.com" });
    const res = await call("POST", "/auth/email/verify", null, { email: "ada@example.com", code: mail.at(-1)!.code });
    return accepted(app, ((await res.json()) as { accessToken: string }).accessToken);
  };
  const metaSpent = () => db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'muse-spark-1.3', 'guest', 10, $1)", [clock.toISOString()]);

  beforeEach(async () => {
    mail = [];
    metaCalls = [];
    claudeCalls = [];
    clock = new Date("2026-11-02T12:00:00Z");
    app = makeApp({ dailyUsd: 5 });
  });

  it("asks Meta while Meta has room, and never Claude", async () => {
    const token = await signIn();
    await call("POST", "/wishes", token, { name: "Porsche 911", kind: "buy", upfrontCents: 14_000_000 });
    const res = await call("POST", "/me/facts", token, { persona: "heir" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).facts.lines[0]).toBe("From Meta one.");
    expect(metaCalls).toHaveLength(1);
    expect(claudeCalls).toHaveLength(0);
  });

  it("answers on Claude once Meta's day is spent, and records it under Claude's model", async () => {
    const token = await signIn();
    await call("POST", "/wishes", token, { name: "Porsche 911", kind: "buy", upfrontCents: 14_000_000 });
    await metaSpent();
    const res = await call("POST", "/me/facts", token, { persona: "heir" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).facts.lines[0]).toBe("From Claude one.");
    expect(metaCalls).toHaveLength(0);
    expect(claudeCalls).toHaveLength(1);
    expect(claudeCalls[0]).toMatchObject({ model: "claude-opus-5-5", speed: "fast", output_config: { effort: "low", format: { type: "json_schema" } } });
    const rows = (await db.query<{ model: string; kind: string }>("select model, kind from spend_ledger where kind = 'facts'")).rows;
    expect(rows).toEqual([{ model: "claude-opus-5-5", kind: "facts" }]);
  });

  it("gives today's answer when Claude's own day is spent too", async () => {
    const token = await signIn();
    await call("POST", "/wishes", token, { name: "Porsche 911", kind: "buy", upfrontCents: 14_000_000 });
    await metaSpent();
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values (null, 'claude-opus-5-5', 'guest', 5, $1)", [clock.toISOString()]);
    const res = await call("POST", "/me/facts", token, { persona: "heir" });
    expect(res.status).toBe(429);
    expect(claudeCalls).toHaveLength(0);
  });

  it("keeps a person over their own Meta allowance off Claude, even once Meta's whole day is spent", async () => {
    const token = await signIn();
    const id = (await db.query<{ id: string }>("select id from users where email = 'ada@example.com'")).rows[0]!.id;
    await call("POST", "/wishes", token, { name: "Porsche 911", kind: "buy", upfrontCents: 14_000_000 });
    // The route's own guards run in their real order: Meta's day first (spent), then the person's own $2 (spent too).
    await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'muse-spark-1.3', 'research', 2.5, $2)", [id, clock.toISOString()]);
    await metaSpent();
    const res = await call("POST", "/me/facts", token, { persona: "heir" });
    expect(res.status).toBe(429);
    expect(claudeCalls).toHaveLength(0);
  });

  it("without a Claude key, behaves as it always has", async () => {
    app = makeApp(null);
    const token = await signIn();
    await call("POST", "/wishes", token, { name: "Porsche 911", kind: "buy", upfrontCents: 14_000_000 });
    await metaSpent();
    expect((await call("POST", "/me/facts", token, { persona: "heir" })).status).toBe(429);
    expect(claudeCalls).toHaveLength(0);
  });
});

describe("env", () => {
  const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(32), CODE_PEPPER: "y".repeat(16) };
  it("reads the Claude key, its daily cap and its speed, all optional", () => {
    const off = readEnv(base);
    expect(off.ANTHROPIC_API_KEY).toBeUndefined();
    expect(off).toMatchObject({ CLAUDE_DAILY_USD: 5, CLAUDE_SPEED: "fast", CLAUDE_ON_META_ERRORS: false });
    expect(readEnv({ ...base, ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(readEnv({ ...base, ANTHROPIC_API_KEY: " sk-test ", CLAUDE_DAILY_USD: "2.5", CLAUDE_SPEED: "standard", CLAUDE_ON_META_ERRORS: "1" })).toMatchObject({
      ANTHROPIC_API_KEY: "sk-test",
      CLAUDE_DAILY_USD: 2.5,
      CLAUDE_SPEED: "standard",
      CLAUDE_ON_META_ERRORS: true,
    });
  });
});
