import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAIKU_MODEL } from "@dandelist/meta";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { inferenceFor, haikuMaximumCharge, INFERENCE_UNAVAILABLE, VOICE_UNAVAILABLE, type InferenceSetup } from "../src/inference";
import type { NoMetaPolicy } from "../src/inference-policy";
import { reserve, SpendLimitError, type BudgetPolicy } from "../src/spend-reservations";
import { recordSpend } from "../src/spend";
import { accepted } from "./consent-helper";
import { AI_CONSENT_VERSION } from "../src/consent";
import { findPhoto, type PhotoPlan } from "../src/agent/photos";
import { pngHeader } from "./images";

vi.mock("node:dns/promises", async (original) => ({ ...(await original<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));

// Real application + real Messages adapter. Every HTTP request is intercepted; no legacy fixture-app transport.
let pg: PGlite, db: Db, app: ReturnType<typeof createApp>, clock: Date, setup: InferenceSetup, policy: NoMetaPolicy;
let token: string, userId: string, wishId: string, mail: string[], responseText: string, responseStatus: number;
let requests: { url: string; body: any }[];
let nativeFetch: typeof fetch;
let nativeUsage: { input: number; output: number }, providerGate: Promise<void> | null;
const call = (method: string, path: string, body?: unknown) => app.request(path, { method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const rebuild = () => { app = createApp({ db, now: () => clock, jwtSecret: "synthetic-only-secret-32-characters-long", codePepper: "synthetic-only-pepper",
  mailer: { sendCode: async (_to, code) => { mail.push(code); } }, webOrigins: [], inference: setup, modelHistory: true,
  webFetch: (async () => { throw Error("Unexpected external resource request"); }) as typeof fetch, archive: null,
  media: { generate: true, upscale: true, cutouts: true, imagesPerDay: 10, cutoutsPerDay: 10 } }); };
beforeEach(async () => {
  pg = new PGlite(); db = { query: (q, p) => pg.query(q, p) as never, exec: q => pg.exec(q) }; await migrate(db);
  clock = new Date("2026-11-14T20:00:00Z"); mail = []; requests = []; responseStatus = 200;
  nativeUsage = { input: 1000, output: 100 }; providerGate = null;
  responseText = JSON.stringify({ facts: ["You saved a bike.", "Your wishes are on your list.", "You can keep adding wishes."] });
  policy = { provider: "anthropic-api", billingAccountId: "synthetic-org", modelId: HAIKU_MODEL,
    funding: { verified: true, provider: "anthropic-api", billingAccountId: "synthetic-org", receiptId: "synthetic-receipt",
      modelIds: [HAIKU_MODEL], capabilities: ["text", "vision", "app-tools", "web-search"], checkedAtMs: clock.getTime() - 1000,
      expiresAtMs: clock.getTime() + 60_000, eligibleRemainingUsd: 100 },
    limits: { callUsd: 0.05, dailyUsd: 1, totalUsd: 10, inputBytes: 8_388_608, outputTokens: 2048, toolCalls: 8 } };
  nativeFetch = vi.fn(async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), body: JSON.parse(String(init?.body)) });
    await providerGate;
    if (responseStatus !== 200) return Response.json({ error: { type: "overloaded_error", message: "PRIVATE PROVIDER DETAIL" } }, { status: responseStatus });
    return Response.json({ id: "msg_synthetic", type: "message", role: "assistant", model: HAIKU_MODEL,
      content: [{ type: "text", text: responseText }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: nativeUsage.input, output_tokens: nativeUsage.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
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
  it("requires the literal Claude notice version and preserves a returning account's manual wishes during renewal", async () => {
    expect(AI_CONSENT_VERSION).toBe(2);
    await db.query("update users set ai_consent_version=1,ai_consent_at=$2 where id=$1", [userId,"2026-11-06T00:00:00Z"]);
    const status:any=await(await call("GET","/me/consent")).json();
    expect(status.consent).toMatchObject({version:1,current:2,accepted:false});
    expect((await call("POST","/me/consent",{version:1})).status).toBe(409);
    for(const [method,path,body] of [
      ["POST","/agent/interpret",{text:"A camera"}], ["POST","/agent/runs",{text:"A camera"}],
      ["POST","/agent/photo",{title:"A camera",kind:"buy"}], ["POST","/dream/turn",{action:{type:"message",text:"A camera"}}],
      ["GET","/dream/suggestions",undefined], ["POST","/me/facts",{}], ["POST","/picks/today",{day:"2026-11-14"}],
      ["POST","/pairs",{text:"A camera"}], ["POST","/wishes/describe",{ids:[wishId]}], ["POST","/wishes/search",{q:"camera"}],
    ] as const) {
      const r=await call(method,path,body); expect([path,r.status]).toEqual([path,403]);
      expect((await r.json() as any).code).toBe("consent_required");
    }
    expect(requests).toHaveLength(0); expect((await db.query("select * from spend_reservations")).rows).toHaveLength(0);
    expect((await call("GET","/wishes")).status).toBe(200);
    expect((await call("PATCH",`/wishes/${wishId}`,{name:"Manual bike edit"})).status).toBe(200);
    const added:any=await(await call("POST","/wishes",{name:"Manual camera",kind:"buy",upfrontCents:1234})).json();
    expect(added.wish.name).toBe("Manual camera");
    expect((await call("PUT","/wishes/order",{ids:[added.wish.id,wishId]})).status).toBe(200);
    expect((await call("DELETE",`/wishes/${added.wish.id}`)).status).toBe(204);
    expect(requests).toHaveLength(0); expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    const sessionCount=(await db.query("select count(*)::int as n from sessions")).rows;
    await call("POST","/auth/email/start",{email:"synthetic@example.com"});
    const returning:any=await(await call("POST","/auth/email/verify",{email:"synthetic@example.com",code:mail.at(-1)})).json();
    expect(returning.user.id).toBe(userId); expect(returning.accessToken).toBeTruthy();
    expect((await db.query("select * from wishes where id=$1",[wishId])).rows).toHaveLength(1);
    expect((await db.query<{n:number}>("select count(*)::int as n from sessions")).rows[0]!.n).toBe(Number(sessionCount[0]!.n)+1);
  });
  it("renews version-one acceptance once for Claude across devices without resetting account data", async () => {
    await db.query("update users set ai_consent_version=1,ai_consent_at=$2 where id=$1",[userId,"2026-11-06T00:00:00Z"]);
    const renewed:any=await(await call("POST","/me/consent",{version:2})).json();
    expect(renewed.consent).toEqual({version:2,current:2,accepted:true,acceptedAt:clock.toISOString()});
    clock=new Date(clock.getTime()+1000);
    expect((await(await call("POST","/me/consent",{version:2})).json() as any).consent.acceptedAt).toBe(renewed.consent.acceptedAt);
    expect((await call("POST","/me/consent",{version:1})).status).toBe(409);
    expect((await call("POST","/me/consent",{version:3})).status).toBe(409);
    expect((await call("POST","/me/facts",{})).status).toBe(200); expect(requests).toHaveLength(1);
    expect((await db.query("select id from wishes where id=$1",[wishId])).rows).toHaveLength(1);
  });
  it("rechecks current consent for an already-created background inference client", async () => {
    const brain=inferenceFor({db,now:()=>clock,inference:setup},userId,"background");
    await db.query("update users set ai_consent_version=1 where id=$1",[userId]);
    await expect(brain.responses({input:"A retained background job"})).rejects.toThrow();
    expect(requests).toHaveLength(0); expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    expect((await db.query("select * from spend_reservations")).rows).toHaveLength(0);
    await call("POST","/me/consent",{version:2});
    await brain.responses({input:"Now the current notice is accepted"}); expect(requests).toHaveLength(1);
  });
  it("checks consent again after SQL reservation admission and releases without claiming a provider charge", async () => {
    let changed=false;
    const guarded:Db={exec:db.exec,query:async<T>(q:string,p?:unknown[])=>{
      const r=await db.query<T>(q,p);
      if(!changed&&q.startsWith("select spend_reserve(")){changed=true;await db.query("update users set ai_consent_version=1 where id=$1",[userId]);}
      return r;
    }};
    await expect(inferenceFor({db:guarded,now:()=>clock,inference:setup},userId,"queued-job").responses({input:"Queued"})).rejects.toThrow();
    expect(changed).toBe(true);expect(requests).toHaveLength(0);
    expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    expect((await db.query("select state from spend_reservations")).rows).toEqual([{state:"released"}]);
  });
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
  it("logs only fixed sanitized preflight metadata for a locally rejected photo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const image_url = "https://images.example.com/PRIVATE_PHOTO_NAME.heic?secret=PRIVATE_QUERY";
    setup.apiKey = "PRIVATE_DIAGNOSTIC_KEY";
    try {
      await expect(inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo").responses({
        instructions: "PRIVATE_WISH_AND_NOTE", input: [{ role: "user", content: [{ type: "input_text", text: "PRIVATE_USER_TEXT" }, { type: "input_image", image_url }] }],
      })).rejects.toThrow();
      expect(warn.mock.calls).toEqual([["inference attempt failed", JSON.stringify({ kind: "photo", phase: "preflight", category: "image_rejected" })]]);
      const logged = JSON.stringify(warn.mock.calls);
      for (const privateValue of ["PRIVATE_", image_url, setup.apiKey, userId, token, "stack", "message"]) expect(logged).not.toContain(privateValue);
      expect(requests).toHaveLength(0); expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
      expect((await db.query("select state from spend_reservations")).rows).toEqual([{ state: "released" }]);
    } finally { warn.mockRestore(); }
  });
  it("logs only sanitized attempted/status metadata and never a caller kind or provider error body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const privateKind = "PRIVATE_KIND_owner@example.invalid";
    responseStatus = 503; setup.apiKey = "PRIVATE_DIAGNOSTIC_KEY";
    try {
      await expect(inferenceFor({ db, now: () => clock, inference: setup }, userId, privateKind).responses({ input: "PRIVATE_WISH https://private.example.com/note", instructions: "PRIVATE_NOTE" })).rejects.toThrow();
      expect(warn.mock.calls).toEqual([["inference attempt failed", JSON.stringify({ kind: "other", phase: "http-attempted", category: "provider_error", httpStatus: 503 })]]);
      const logged = JSON.stringify(warn.mock.calls);
      for (const privateValue of ["PRIVATE", privateKind, "private.example.com", setup.apiKey, userId, token, "headers", "stack", "message"]) expect(logged).not.toContain(privateValue);
      expect(requests).toHaveLength(1);
      const rows = (await db.query<any>("select l.kind,l.cost_usd,r.usd,r.state from spend_ledger l join spend_reservations r on r.id=l.reservation_id")).rows;
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: `${privateKind}:unconfirmed`, state: "settled" });
      expect(Number(rows[0].cost_usd)).toBe(Number(rows[0].usd));
    } finally { warn.mockRestore(); }
  });
  it("preserves conservative settlement even when the diagnostic logger itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("PRIVATE_LOGGER_FAILURE"); });
    responseStatus = 503;
    try {
      await expect(inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo").responses({ input: "A failed synthetic photo" })).rejects.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      const rows = (await db.query<any>("select l.kind,l.cost_usd,r.usd,r.state from spend_ledger l join spend_reservations r on r.id=l.reservation_id")).rows;
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: "photo:unconfirmed", state: "settled" });
      expect(Number(rows[0].cost_usd)).toBe(Number(rows[0].usd));
    } finally { warn.mockRestore(); }
  });
  it.each(["data:image/avif;base64,AAAA", "https://images.example.com/photo.heic"])("does not record unknown spend for an image rejected by the real adapter before HTTP: %s", async image_url => {
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo");
    await expect(brain.responses({ input: [{ role: "user", content: [{ type: "input_text", text: "Check this photo" }, { type: "input_image", image_url }] }] })).rejects.toThrow();
    expect(requests).toHaveLength(0);
    expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    expect((await db.query("select state from spend_reservations")).rows).toEqual([{ state: "released" }]);
  });
  it("does not claim a charge when cancellation is proven before the fetch boundary", async () => {
    const stop = new AbortController(); let reserved = false;
    const guarded: Db = { exec: db.exec, query: async <T>(q: string, p?: unknown[]) => {
      const r = await db.query<T>(q, p);
      if (q.startsWith("select spend_reserve(")) reserved = true;
      else if (reserved && q === "select ai_consent_version from users where id = $1") stop.abort();
      return r;
    } };
    setup.fetch = vi.fn(async (_input, init) => { init?.signal?.throwIfAborted(); throw new Error("Must never dispatch"); }) as typeof fetch;
    await expect(inferenceFor({ db: guarded, now: () => clock, inference: setup }, userId, "photo", { signal: stop.signal }).responses({ input: "A cancelled photo" })).rejects.toThrow();
    expect(reserved).toBe(true); expect(setup.fetch).not.toHaveBeenCalled();
    expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    expect((await db.query("select state from spend_reservations")).rows).toEqual([{ state: "released" }]);
  });
  it("retains the maximum unconfirmed charge after cancellation of an actually dispatched request", async () => {
    const stop = new AbortController();
    setup.fetch = vi.fn(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Synthetic disconnect", "AbortError")), { once: true });
        stop.abort();
      });
    }) as typeof fetch;
    await expect(inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo", { signal: stop.signal }).responses({ input: "A dispatched photo" })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    const rows = (await db.query<any>("select l.kind,l.cost_usd,r.usd,r.state from spend_ledger l join spend_reservations r on r.id=l.reservation_id")).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: "photo:unconfirmed", state: "settled" });
    expect(Number(rows[0].cost_usd)).toBe(Number(rows[0].usd));
  });
  it("keeps dispatch evidence isolated between concurrent successful and locally rejected photo calls", async () => {
    let release!: () => void;
    providerGate = new Promise<void>(done => { release = done; });
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo");
    const sent = brain.responses({ input: "A supported photo check" });
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      await expect(brain.responses({ input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/avif;base64,AAAA" }] }] })).rejects.toThrow();
      expect((await db.query("select * from spend_ledger")).rows).toHaveLength(0);
    } finally { release(); await sent; }
    expect((await db.query("select kind from spend_ledger")).rows).toEqual([{ kind: "photo" }]);
    expect((await db.query<any>("select state from spend_reservations order by created_at")).rows).toEqual([{ state: "settled" }, { state: "released" }]);
  });
  it("lets dispatched photo work settle within the existing deadline before route cleanup aborts it", async () => {
    const stop = new AbortController(); let slowFinished = false;
    setup.fetch = vi.fn(async (input, init) => {
      const body = JSON.parse(String(init?.body)); requests.push({ url: String(input), body });
      const text = body.messages.flatMap((m: any) => m.content).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
      const vision = text.includes("Options:");
      if (!vision) await new Promise<void>((resolve, reject) => {
        const done = () => { init?.signal?.removeEventListener("abort", abort); slowFinished = true; resolve(); };
        const timer = setTimeout(done, 500);
        const abort = () => { clearTimeout(timer); reject(new DOMException("Route cleanup", "AbortError")); };
        init?.signal?.addEventListener("abort", abort, { once: true });
      });
      const letter = /^([A-G])\. A camera$/m.exec(text)?.[1];
      return Response.json({ id: "msg_photo", type: "message", role: "assistant", model: HAIKU_MODEL,
        content: [{ type: "text", text: vision ? JSON.stringify({ seen: "A camera", fits: [letter], quality: "studio", clean: true, subject: true }) : "" }],
        stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } });
    }) as typeof fetch;
    const brain = inferenceFor({ db, now: () => clock, inference: setup }, userId, "photo", { signal: stop.signal });
    const pending: Promise<unknown>[] = [];
    const meta = { responses: (body: Record<string, unknown>) => { const p = brain.responses(body); pending.push(p); return p; } };
    const image = "https://images.example.com/camera.png";
    const web = (async (input: any) => {
      const url = String(input);
      if (url.startsWith("https://en.wikipedia.org/w/api.php")) return Response.json({ query: { pages: { 1: { title: "A camera", original: { source: image, width: 1600, height: 1200 } } } } });
      if (url === image) return new Response(pngHeader(1600, 1200), { headers: { "Content-Type": "image/png" } });
      return Response.json({ query: { pages: {} }, results: [] });
    }) as typeof fetch;
    const plan: PhotoPlan = { identity: "A camera", broad: "", lookalikes: ["A bicycle"], exact: true, official: "", articles: ["A camera"], commons: "", web: "A camera", kind: "product" };
    let found;
    try { found = await findPhoto(meta, { title: "A camera", kind: "buy" }, { fetcher: web, plan: Promise.resolve(plan), by: Date.now() + 4300 }); }
    finally { stop.abort(); await Promise.allSettled(pending); }
    expect(found?.image.url).toBe(image); expect(slowFinished).toBe(true);
    expect(requests).toHaveLength(3);
    expect((await db.query<any>("select kind from spend_ledger order by id")).rows).toEqual([{ kind: "photo" }, { kind: "photo" }, { kind: "photo" }]);
    expect((await db.query<any>("select state from spend_reservations")).rows.every(r => r.state === "settled")).toBe(true);
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


describe("MG0132 account allowance across every inference context",()=>{
  // Real Messages adapter/SQL:0.002 known cost, below the conservative worst-case hold and0.05 request cap.
  const input="Synthetic camera, house and trip. "+"x".repeat(10_000);
  const kinds=["interpret","research","photo","dream","facts","pick","describe","search","pairs","suggest"];
  const use=(kind:string,owner=userId)=>inferenceFor({db,now:()=>clock,inference:setup},owner,kind,{personUsd:999}).responses({input});
  const sum=async(owner=userId)=>Number((await db.query<{usd:string}>("select coalesce(sum(cost_usd),0) as usd from spend_ledger where user_id=$1 and created_at >= $2",[owner,new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth(),clock.getUTCDate())).toISOString()])).rows[0]!.usd);
  const seed=async(usd:number,at=clock)=>recordSpend(db,userId,"synthetic-prior-use",{model:HAIKU_MODEL,inputTokens:0,cachedInputTokens:0,outputTokens:0,searches:0},usd,at);
  const refresh=()=>{policy.funding.checkedAtMs=clock.getTime()-1000;policy.funding.expiresAtMs=clock.getTime()+60_000;};
  beforeEach(()=>{nativeUsage={input:10_000,output:2000};});
  it("fails closed for invalid internal allowance values instead of serializing a null SQL cap",async()=>{
    await seed(.25);
    for(const personUsd of [Number.NaN,Number.POSITIVE_INFINITY,-1]){
      await expect(inferenceFor({db,now:()=>clock,inference:setup},userId,"invalid-allowance",{personUsd}).responses({input})).rejects.toThrow();
    }
    expect(requests).toHaveLength(0);expect((await db.query("select * from spend_reservations")).rows).toHaveLength(0);
  });
  it("shares interpret, research, photos, rechecks and retries across fresh contexts, without a client reset",async()=>{
    await db.query("update users set team=true where id=$1",[userId]);
    await seed(.22);for(let i=0;i<7;i++)await use(kinds[i]!);
    expect(await sum()).toBeCloseTo(.234,6);expect(requests).toHaveLength(7);
    await expect(use("retry-a-new-wish")).rejects.toMatchObject({scope:"user"});
    expect(requests).toHaveLength(7);expect(await sum()).toBeLessThanOrEqual(.25);
  });
  it("keeps unknown charges in the same account allowance when a different context retries",async()=>{
    await seed(.22);for(let i=0;i<2;i++)await use(kinds[i]!);
    responseStatus=503;await expect(use("photo-unknown")).rejects.toThrow();
    const unknown=(await db.query<any>("select cost_usd,reservation_id from spend_ledger where kind='photo-unknown:unconfirmed'")).rows[0]!;
    expect(Number(unknown.cost_usd)).toBeGreaterThan(.002);expect(Number(unknown.cost_usd)).toBeLessThanOrEqual(.05);
    const reservation=(await db.query<any>("select usd from spend_reservations where id=$1",[unknown.reservation_id])).rows[0]!;
    expect(Number(unknown.cost_usd)).toBe(Number(reservation.usd));
    responseStatus=200;await expect(use("new-client-retry")).rejects.toMatchObject({scope:"user"});
    expect(requests).toHaveLength(3);expect(await sum()).toBeLessThanOrEqual(.25);
  });
  it("atomically counts other-context holds while parallel research and photo calls compete",async()=>{
    await seed(.21);
    requests=[];let release!:()=>void;providerGate=new Promise<void>(r=>{release=r;});let refused=0;
    const pending=Promise.allSettled(Array.from({length:6},(_,i)=>use(i%2?"photo":"research").catch(e=>{refused++;throw e;})));
    try{
      await vi.waitFor(()=>expect(refused).toBe(4),{timeout:5000});expect(requests).toHaveLength(2);
      const held=Number((await db.query<{usd:string}>("select coalesce(sum(usd),0) as usd from spend_reservations where user_id=$1 and pool='claude' and state='held'",[userId])).rows[0]!.usd);
      expect(await sum()+held).toBeLessThanOrEqual(.25);
    }finally{release();}
    const results=await pending;expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(2);
    expect(await sum()).toBeCloseTo(.214,6);
    await seed(.02);await expect(use("another-parallel-retry")).rejects.toMatchObject({scope:"user"});
    expect(await sum()).toBeLessThanOrEqual(.25);
  });
  it("charges pre-wish and multi-wish concierge work and jobs to the person, not a wish or conversation key",async()=>{
    await seed(.22);for(let i=0;i<7;i++)await use(i%2?"dream-background-job":"dream-multiple-wishes");
    await expect(use("new-conversation-with-more-wishes")).rejects.toMatchObject({scope:"user"});
    expect(requests).toHaveLength(7);expect(await sum()).toBeCloseTo(.234,6);
    const other=(await db.query<{id:string}>("insert into users(email,ai_consent_version,ai_consent_at)values('other-synthetic@example.com',2,$1)returning id",[clock.toISOString()])).rows[0]!.id;
    await use("dream-independent-person",other);expect(await sum(other)).toBeCloseTo(.002,6);
    await expect(use("same-person-different-wish")).rejects.toMatchObject({scope:"user"});
  });
  it("resets only at the UTC day boundary and includes charges exactly at midnight",async()=>{
    clock=new Date("2026-11-14T23:59:59Z");refresh();await seed(.25);
    await expect(use("before-midnight")).rejects.toMatchObject({scope:"user"});
    clock=new Date("2026-11-15T00:00:00Z");refresh();await use("new-UTC-day");
    // Below the cap at exactly midnight: SQL must include these charges when admitting the next hold.
    expect(await sum()).toBeCloseTo(.002,6);await seed(.238);
    await expect(use("midnight-charge-is-not-excluded")).rejects.toMatchObject({scope:"user"});
    expect(requests).toHaveLength(1);
  });
  it("retains an unsettled hold across midnight instead of restoring a fresh allowance",async()=>{
    const hold=await reserve(db,{pool:"claude",userId,usd:.24,mineUsd:.24});expect(hold).not.toBe("slots");
    clock=new Date("2026-11-15T00:00:00Z");refresh();
    await expect(use("cross-midnight-job")).rejects.toMatchObject({scope:"user"});expect(requests).toHaveLength(0);
    if(hold!=="slots")await hold.release();await use("released-unused-hold");expect(requests).toHaveLength(1);
  });
  it("denies every inference kind and real selected route at the account cap while manual entry remains available",async()=>{
    await seed(.25);
    for(const kind of kinds)await expect(use(kind)).rejects.toMatchObject({scope:"user"});
    const exhausted=await call("POST","/me/facts",{});expect(exhausted.status).toBe(429);
    expect((await exhausted.json() as any).error).toContain("allowance");expect(requests).toHaveLength(0);
    for(const [method,path,body] of [
      ["POST","/agent/interpret",{text:"A camera"}], ["POST","/agent/runs",{text:"A camera"}],
      ["POST","/agent/photo",{title:"A camera",kind:"buy"}], ["POST","/dream/turn",{action:{type:"message",text:"A camera and a house"}}],
      ["GET","/dream/suggestions",undefined], ["POST","/picks/today",{day:"2026-11-14"}],
      ["POST","/pairs",{text:"A camera"}], ["POST","/wishes/describe",{ids:[wishId]}], ["POST","/wishes/search",{q:"bike"}],
    ] as const){const r=await call(method,path,body);expect([200,429],path).toContain(r.status);}
    expect(requests).toHaveLength(0);expect(await sum()).toBe(.25);
    expect((await call("POST","/wishes",{name:"Manual while capped",kind:"buy",upfrontCents:200})).status).toBe(201);
    expect((await call("GET","/wishes")).status).toBe(200);expect(requests).toHaveLength(0);
  });
});
