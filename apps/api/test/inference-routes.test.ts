import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAIKU_MODEL } from "@dandelist/meta";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { inferenceFor, haikuMaximumCharge, INFERENCE_UNAVAILABLE, VOICE_UNAVAILABLE, type InferenceSetup } from "../src/inference";
import type { NoMetaPolicy } from "../src/inference-policy";
import { reserve, SpendLimitError, type BudgetPolicy } from "../src/spend-reservations";
import { accepted } from "./consent-helper";

// Real application + real Messages adapter. Every HTTP request is intercepted; no legacy fixture-app transport.
let pg: PGlite, db: Db, app: ReturnType<typeof createApp>, clock: Date, setup: InferenceSetup, policy: NoMetaPolicy;
let token: string, userId: string, wishId: string, mail: string[], responseText: string, responseStatus: number;
let requests: { url: string; body: any }[];
let nativeFetch: typeof fetch;
const call = (method: string, path: string, body?: unknown) => app.request(path, { method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const rebuild = () => { app = createApp({ db, now: () => clock, jwtSecret: "synthetic-only-secret-32-characters-long", codePepper: "synthetic-only-pepper",
  mailer: { sendCode: async (_to, code) => { mail.push(code); } }, webOrigins: [], inference: setup, modelHistory: true,
  webFetch: (async () => { throw Error("Unexpected external resource request"); }) as typeof fetch, archive: null,
  media: { generate: true, upscale: true, cutouts: true, imagesPerDay: 10, cutoutsPerDay: 10 } }); };
beforeEach(async () => {
  pg = new PGlite(); db = { query: (q, p) => pg.query(q, p) as never, exec: q => pg.exec(q) }; await migrate(db);
  clock = new Date("2026-11-14T20:00:00Z"); mail = []; requests = []; responseStatus = 200;
  responseText = JSON.stringify({ facts: ["You saved a bike.", "Your wishes are on your list.", "You can keep adding wishes."] });
  policy = { provider: "anthropic-api", billingAccountId: "synthetic-org", modelId: HAIKU_MODEL,
    funding: { verified: true, provider: "anthropic-api", billingAccountId: "synthetic-org", receiptId: "synthetic-receipt",
      modelIds: [HAIKU_MODEL], capabilities: ["text", "vision", "app-tools", "web-search"], checkedAtMs: clock.getTime() - 1000,
      expiresAtMs: clock.getTime() + 60_000, eligibleRemainingUsd: 100 },
    limits: { callUsd: 0.05, dailyUsd: 1, totalUsd: 10, inputBytes: 8_388_608, outputTokens: 2048, toolCalls: 8 } };
  nativeFetch = vi.fn(async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), body: JSON.parse(String(init?.body)) });
    if (responseStatus !== 200) return Response.json({ error: { type: "overloaded_error", message: "PRIVATE PROVIDER DETAIL" } }, { status: responseStatus });
    return Response.json({ id: "msg_synthetic", type: "message", role: "assistant", model: HAIKU_MODEL,
      content: [{ type: "text", text: responseText }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  }) as typeof fetch;
  setup = { apiKey: "synthetic-key", keyOrganizationVerified: true, policy, fetch: nativeFetch }; rebuild();
  const email = "synthetic@example.com";
  await call("POST", "/auth/email/start", { email });
  const auth: any = await (await call("POST", "/auth/email/verify", { email, code: mail.at(-1) })).json();
  token = auth.accessToken; userId = auth.user.id; await accepted(app, token);
  const saved: any = await (await call("POST", "/wishes", { name: "A bike", kind: "buy", upfrontCents: 10000 })).json(); wishId = saved.wish.id;
});
afterEach(async () => { await pg.close(); });

describe("selected Haiku application boundary", () => {
  it("runs a real facts route only on direct standard Haiku and settles its current price in the Claude pool", async () => {
    const res = await call("POST", "/me/facts", {}); expect(res.status).toBe(200);
    expect(requests).toHaveLength(1); expect(requests[0]!.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(requests[0]!.body).toMatchObject({ model: HAIKU_MODEL, max_tokens: 2048, thinking: { type: "disabled" } });
    expect(requests[0]!.body.speed).toBeUndefined();
    const rows = (await db.query<any>("select model,kind,cost_usd,reservation_id from spend_ledger")).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ model: HAIKU_MODEL, kind: "facts" });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(0.00015, 8); expect(rows[0].reservation_id).toBeTruthy();
    expect((await db.query<any>("select pool,state from spend_reservations")).rows).toEqual([{ pool: "claude", state: "settled" }]);
  });
  it.each(["key", "binding", "policy", "expired", "account", "model", "cash"])("refuses %s before HTTP and preserves manual wishes", async bad => {
    if (bad === "key") setup.apiKey = undefined;
    if (bad === "binding") setup.keyOrganizationVerified = false;
    if (bad === "policy") setup.policy = undefined;
    if (bad === "expired") policy.funding.expiresAtMs = clock.getTime();
    if (bad === "account") policy.funding.billingAccountId = "different-org";
    if (bad === "model") policy.modelId = "muse-spark-1.3";
    if (bad === "cash") policy.funding.eligibleRemainingUsd = 0;
    rebuild();
    for (const [path, body] of [["/agent/interpret", { text: "A bike" }], ["/me/facts", {}], ["/wishes/describe", { ids: [wishId] }],
      ["/wishes/search", { q: "bike" }], ["/dream/turn", { action: { type: "say", text: "Hi" } }]] as const) {
      const res = await call("POST", path, body); expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: INFERENCE_UNAVAILABLE });
    }
    expect((await call("POST", "/pairs", {})).status).toBe(200);
    expect((await call("POST", "/picks/today", { day: "2026-11-14" })).status).toBe(200);
    expect((await call("GET", "/dream/suggestions")).status).toBe(200);
    expect((await call("GET", "/wishes")).status).toBe(200);
    expect((await call("POST", "/wishes", { name: "Another saved wish", kind: "do", upfrontCents: 0 })).status).toBe(201);
    expect(requests).toHaveLength(0);
  });
  it.each(["daily", "total", "user"])("refuses an exhausted %s Claude allowance at the real route before HTTP", async cap => {
    await db.query("insert into spend_ledger(user_id,model,kind,cost_usd,created_at)values($1,$2,'test', $3,$4)",
      [cap === "user" ? userId : null, HAIKU_MODEL, cap === "total" ? 10 : cap === "daily" ? 1 : 1, clock.toISOString()]);
    expect((await call("POST", "/me/facts", {})).status).toBe(429); expect(requests).toHaveLength(0);
  });
  it("blocks unsupported voice and old media requests even when legacy enable flags are supplied", async () => {
    expect(await (await call("GET", "/config/features")).json()).toMatchObject({ voiceWishes: false, generatedImages: false });
    const r = await call("POST", "/agent/transcribe", {}); expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: VOICE_UNAVAILABLE });
    for (const model of ["muse-image-1.0", "sam-3.1", "muse-voice-transcribe-1.0", "claude-opus-5-5", "unknown"]) {
      await expect(inferenceFor({ db, now: () => clock, inference: setup }, userId, "old-client").responses({ model, input: "synthetic" })).rejects.toThrow();
    }
    expect(requests).toHaveLength(0); expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
  });
  it("does not follow legacy provider affinity, and keeps app-owned history scoped to its owner", async () => {
    const deps = { db, now: () => clock, inference: setup, modelHistory: true };
    const brain = inferenceFor(deps, userId, "history"); responseText = "First answer";
    for (const previous_response_id of ["resp_old_meta", "claude_old_opus"]) await expect(brain.responses({ previous_response_id, input: "Continue" })).rejects.toThrow();
    expect(requests).toHaveLength(0);
    const first = await brain.responses({ model: HAIKU_MODEL, input: "My saved synthetic context" }); expect(first.id).toMatch(/^app_/);
    await brain.responses({ previous_response_id: first.id, input: "Continue" });
    expect(JSON.stringify(requests.at(-1)!.body.messages)).toContain("My saved synthetic context");
    expect(requests.at(-1)!.body.previous_response_id).toBeUndefined();
    await expect(inferenceFor(deps, "00000000-0000-4000-8000-000000000001", "history").responses({ previous_response_id: first.id, input: "Cross-owner" })).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
  it("does not retry or fall back after an upstream failure and conservatively accounts for unknown usage", async () => {
    responseStatus = 503; const res = await call("POST", "/me/facts", {}); expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("PRIVATE PROVIDER DETAIL"); expect(requests).toHaveLength(1);
    const rows = (await db.query<any>("select kind,cost_usd from spend_ledger")).rows;
    expect(rows[0].kind).toBe("facts:unconfirmed");
    expect(Number(rows[0].cost_usd)).toBe(Number((await db.query<any>("select usd from spend_reservations")).rows[0].usd));
    expect(Number(rows[0].cost_usd)).toBeLessThanOrEqual(0.05);
  });
  it("enforces a run's 32-call ceiling through the actual SQL admission function", async () => {
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "bounded-run");
    for (let i = 0; i < 32; i++) await brain.responses({ input: `Synthetic step ${i}` });
    await expect(brain.responses({ input: "Thirty-third step" })).rejects.toBeInstanceOf(SpendLimitError); expect(requests).toHaveLength(32);
  });
  it("normalizes vision and bounded hosted search through the real adapter", async () => {
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "vision-search"); responseText = "Synthetic photo answer";
    await brain.responses({ input: [{ role: "user", content: [{ type: "input_text", text: "Check this photo" }, { type: "input_image", image_url: "https://images.example.com/fixture.jpg" }] }], tools: [{ type: "web_search" }], max_tool_calls: 8 });
    expect(requests).toHaveLength(1); expect(requests[0]!.body.tools).toBeUndefined();
    expect(requests[0]!.body.system).toContain("Live web search is unavailable");
    expect(JSON.stringify(requests[0]!.body.messages)).toContain('"type":"image"');
    expect(requests[0]!.body.speed).toBeUndefined();
  });
  it("preserves the existing dream transcript while resuming on Haiku", async () => {
    responseText = "Let's keep your saved wishes together.";
    const res = await call("POST", "/dream/turn", { action: { type: "message", text: "Remember my bike" } });
    expect(res.status).toBe(200); await res.text();
    const sessions = (await db.query<any>("select id from dream_sessions where user_id=$1", [userId])).rows; expect(sessions).toHaveLength(1);
    const read = await call("GET", `/dream/sessions/${sessions[0].id}`); expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).toContain("Remember my bike"); expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(r => r.url.startsWith("https://api.anthropic.com/") && r.body.model === HAIKU_MODEL)).toBe(true);
  });
  it.each(["global", "user", "run"] as const)("atomically admits one of two competing %s reservations", async type => {
    const p: BudgetPolicy = { pool: "claude", type, since: "1970-01-01T00:00:00Z", cap: 1, total: 1, userId, scope: "synthetic-run", calls: 1 };
    const outcomes = await Promise.allSettled([1, 2].map(() => reserve(db, { userId, pool: "claude", scope: p.scope, usd: 0.7, policies: [p] })));
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1);
  });
  it("rejects pilot limit mutations, oversized input and unknown hosted tools before HTTP", async () => {
    for (const [field, value] of [["callUsd", 0.051], ["dailyUsd", 1.01], ["totalUsd", 10.01]] as const) {
      const before = policy.limits[field]; policy.limits[field] = value;
      expect((await call("POST", "/me/facts", {})).status).toBe(503); policy.limits[field] = before;
    }
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "mutants");
    for (const body of [{ input: "x".repeat(60_000) }, { input: "hello", tools: [{ type: "code_execution" }] },
      { input: "hello", endpoint: "https://api.meta.ai" }, { input: "hello", service_tier: "priority" }]) await expect(brain.responses(body)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it("keeps saved research readable without inference and scopes it to the signed-in owner", async () => {
    const row = (await db.query<any>("insert into agent_runs(user_id,cache_key,draft,answers)values($1,'synthetic-saved','{}','[]')returning id", [userId])).rows[0];
    setup.apiKey = undefined; rebuild();
    expect((await call("GET", `/agent/runs/${row.id}`)).status).toBe(200);
    expect((await app.request(`/agent/runs/${row.id}`)).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it("has no application Meta transport constructors or legacy-key binding", async () => {
    const root = new URL("../src/", import.meta.url);
    const files = await readdir(root, { recursive: true });
    for (const file of files.filter(f => f.endsWith(".ts"))) {
      const source = await readFile(new URL(file.replaceAll("\\", "/"), root), "utf8");
      expect(source, file).not.toMatch(/new\s+MetaClient\s*\(|https:\/\/api\.meta\.ai/);
    }
    const server = await readFile(new URL("server.ts", root), "utf8");
    expect(server).not.toContain("env.MODEL_API_KEY"); expect(server).not.toContain("env.APIFY_TOKEN");
  });
});
