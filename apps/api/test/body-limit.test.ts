import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_CLIP_BYTES } from "../src/agent/transcribe";
import { createApp, MAX_BODY_BYTES, TOO_BIG } from "../src/app";
import { migrate, type Db } from "../src/db";
import { HELP_MAX_BYTES } from "../src/help";
import { MAX_AVATAR_BYTES } from "../src/me";

/** The API-wide body cap (app.ts, 2026-11-06 audit): bigger than any upload, refused before sign-in and unread. */
let db: Db;
let mail: { to: string; code: string }[];
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => new Date("2026-11-06T12:00:00Z"),
    webOrigins: ["http://localhost:8081"],
  });
});

async function signIn(email: string) {
  await app.request("/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const res = await app.request("/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code: mail.at(-1)!.code }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** A wish whose details fill the 20,000-character limit, padded past `bytes` with one long name if asked. */
const wishJson = (pad = 0) =>
  JSON.stringify({ name: "Leica M11", kind: "buy", upfrontCents: 899_500, details: { note: "x".repeat(19_900) }, pad: "y".repeat(pad) });

/** The same bytes as a stream with no Content-Length, the way a chunked upload arrives. */
const chunked = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 64 * 1024) c.enqueue(bytes.subarray(i, i + 64 * 1024));
      c.close();
    },
  });
};

describe("the API-wide body cap", () => {
  it("is never below an upload a route takes", () => {
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(HELP_MAX_BYTES);
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(MAX_CLIP_BYTES);
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(MAX_AVATAR_BYTES);
  });

  it("still takes the biggest wish the app sends", async () => {
    const token = await signIn("lena@example.com");
    const res = await app.request("/wishes", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: wishJson() });
    expect(res.status).toBe(201);
  });

  it("refuses a bigger body before sign-in, by its declared length", async () => {
    const body = wishJson(MAX_BODY_BYTES);
    const res = await app.request("/wishes", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(body.length) }, body });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_BIG });
  });

  it("refuses a bigger body sent without a length, and nothing is saved", async () => {
    const token = await signIn("sam@example.com");
    const res = await app.request("/wishes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: chunked(wishJson(MAX_BODY_BYTES)),
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from wishes");
    expect(rows[0]!.n).toBe(0);
  });
});
