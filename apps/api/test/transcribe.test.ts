import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_CLIP_BYTES, TRANSCRIBES_PER_USER_PER_DAY, cleanTranscript, clipProblem, readWav } from "../src/agent/transcribe";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";

/** A mono 16-bit PCM WAV of `ms` of quiet tone at `rate`, with an extra LIST chunk first when asked. */
function wav(ms: number, rate = 16_000, { channels = 1, bits = 16, list = false } = {}) {
  const samples = Math.round((rate * ms) / 1000);
  const data = samples * channels * (bits / 8);
  const extra = list ? 8 + 4 : 0;
  const buf = new ArrayBuffer(44 + extra + data);
  const v = new DataView(buf);
  const put = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + extra + data, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true);
  v.setUint16(32, channels * (bits / 8), true);
  v.setUint16(34, bits, true);
  let at = 36;
  if (list) {
    put(at, "LIST");
    v.setUint32(at + 4, 4, true);
    put(at + 8, "INFO");
    at += 12;
  }
  put(at, "data");
  v.setUint32(at + 4, data, true);
  for (let i = 0; i < samples; i++) v.setInt16(at + 8 + i * 2, Math.round(Math.sin(i / 8) * 2000), true);
  return new Uint8Array(buf);
}

describe("clip checks", () => {
  it("reads a PCM WAV, walking past chunks it doesn't need", () => {
    expect(readWav(wav(1000))).toEqual({ channels: 1, sampleRate: 16_000, bitsPerSample: 16, durationMs: 1000 });
    expect(readWav(wav(500, 24_000, { list: true }))?.durationMs).toBe(500);
    expect(readWav(new TextEncoder().encode("not a wav at all, just some text that is long enough"))).toBeNull();
  });

  it("refuses what Meta would refuse, in words a person understands", () => {
    expect(clipProblem(readWav(wav(1200)))).toBeNull();
    expect(clipProblem(readWav(wav(1200, 44_100)))).toMatch(/format/);
    expect(clipProblem(readWav(wav(1200, 16_000, { channels: 2 })))).toMatch(/format/);
    expect(clipProblem(readWav(wav(100)))).toMatch(/longer/);
    expect(clipProblem(null)).toMatch(/didn't come through/);
  });

  it("keeps a transcript to one tidy line within the field", () => {
    expect(cleanTranscript("  A week in\n Kyoto   in autumn. ")).toBe("A week in Kyoto in autumn.");
    expect(cleanTranscript("a week at Amanzoe with my wife in May")).toBe("A week at Amanzoe with my wife in May");
    expect(cleanTranscript("x".repeat(400))).toHaveLength(300);
  });
});

let db: Db;
let mail: { to: string; code: string }[];
let metaRequests: { url: string; request: Record<string, unknown>; audioBytes: number }[];
let metaReply: () => Response;
const clock = new Date("2026-10-28T12:00:00Z");

const fakeMeta = (async (url: string, init: RequestInit) => {
  const form = init.body as FormData;
  const request = JSON.parse(await (form.get("request") as Blob).text()) as Record<string, unknown>;
  metaRequests.push({ url: String(url), request, audioBytes: (form.get("audio") as Blob).size });
  return metaReply();
}) as unknown as typeof fetch;

function makeApp(withMeta = true) {
  return createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: withMeta ? { apiKey: "test", fetch: fakeMeta } : undefined,
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
  });
}
let app: ReturnType<typeof makeApp>;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  metaRequests = [];
  metaReply = () => new Response(JSON.stringify({ sessionId: "s1", transcript: " A week at Amanzoe with my wife in May. ", audioDurationMs: 2400, turns: [] }), { status: 200 });
  app = makeApp();
});

async function signIn(email: string) {
  await app.request("/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const res = await app.request("/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code: mail.at(-1)!.code }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const say = (token: string, body: Uint8Array, type = "audio/wav") => app.request("/agent/transcribe", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body });

describe("POST /agent/transcribe", () => {
  it("sends Meta the request part and the clip, records the cost, and returns the words", async () => {
    const t = await signIn("ada@example.com");
    const res = await say(t, wav(2400));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "A week at Amanzoe with my wife in May." });
    expect(metaRequests).toHaveLength(1);
    expect(metaRequests[0]!.url).toMatch(/\/asr\/transcribe$/);
    expect(metaRequests[0]!.request).toMatchObject({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" });
    expect(metaRequests[0]!.request.keywords).toContain("Amanzoe");
    expect(metaRequests[0]!.audioBytes).toBe(wav(2400).length);
    const spend = (await db.query<{ model: string; cost_usd: string }>("select model, cost_usd from spend_ledger where kind = 'transcribe'")).rows;
    expect(spend).toHaveLength(1);
    expect(spend[0]!.model).toBe("muse-voice-transcribe-1.0");
    expect(Number(spend[0]!.cost_usd)).toBeCloseTo((2.4 * 0.18) / 3600, 6);
  });

  it("needs a signed-in person", async () => {
    const res = await app.request("/agent/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav(1000) });
    expect(res.status).toBe(401);
    expect(metaRequests).toHaveLength(0);
  });

  it("refuses other formats and oversized clips before any paid call", async () => {
    const t = await signIn("ada@example.com");
    expect((await say(t, wav(1000), "audio/webm")).status).toBe(415);
    expect((await say(t, wav(1000, 44_100))).status).toBe(400);
    expect((await say(t, wav(100))).status).toBe(400);
    expect((await say(t, new Uint8Array(MAX_CLIP_BYTES + 1))).status).toBe(413);
    expect(metaRequests).toHaveLength(0);
  });

  it("says so when nothing was heard, and maps Meta's busy signal", async () => {
    const t = await signIn("ada@example.com");
    metaReply = () => new Response(JSON.stringify({ sessionId: "s", transcript: "  ", audioDurationMs: 900, turns: [] }), { status: 200 });
    expect((await say(t, wav(900))).status).toBe(422);
    metaReply = () => new Response("slow down", { status: 429 });
    const busy = await say(t, wav(900));
    expect(busy.status).toBe(429);
    expect(((await busy.json()) as { error: string }).error).toMatch(/busy/);
  });

  it("caps voice wishes per person per day", async () => {
    const t = await signIn("ada@example.com");
    const { rows } = await db.query<{ id: string }>("select id from users where email = 'ada@example.com'");
    for (let i = 0; i < TRANSCRIBES_PER_USER_PER_DAY; i++) {
      await db.query("insert into spend_ledger (user_id, model, kind, cost_usd, created_at) values ($1, 'muse-voice-transcribe-1.0', 'transcribe', 0, $2)", [rows[0]!.id, clock.toISOString()]);
    }
    expect((await say(t, wav(1000))).status).toBe(429);
    expect(metaRequests).toHaveLength(0);
  });

  it("answers 503 when no Meta key is configured", async () => {
    app = makeApp(false);
    const t = await signIn("ada@example.com");
    expect((await say(t, wav(1000))).status).toBe(503);
  });
});
