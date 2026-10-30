import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Image hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { MAX_AGENT_KEYS, MAX_BATCH, MCP_CALLS_PER_MINUTE, MCP_TOOLS, PHOTO_CHECKS_PER_MINUTE, hashAgentKey } from "../src/mcp";
import { imageResponse, jpegHeader } from "./images";

/**
 * Dandelist over MCP (owner, 2026-10-29: "Build mcp for agent", "Needs full control (secure security for each account
 * no bleed)"): keys a person makes, full control of their own account, and nothing of anyone else's.
 */

const PEPPER = "test-pepper-16-chars";
const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Leica_Q3.jpg";
const web = (async (u: string | URL) => (String(u) === PHOTO ? imageResponse(jpegHeader(3000, 2000), "image/jpeg") : new Response("gone", { status: 404 }))) as unknown as typeof fetch;

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
    codePepper: PEPPER,
    now: () => new Date(),
    webOrigins: ["https://dandelist.knightaiav.com"],
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: web,
  });
});

async function signIn(email: string) {
  await app.request("/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const res = await app.request("/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code: mail.at(-1)!.code }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const asUser = (token: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function makeKey(token: string, name = "Claude") {
  const res = await asUser(token, "POST", "/me/agent-keys", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as { key: string; record: { id: string; prefix: string } };
}

let seq = 0;
const rpc = async (key: string | null, method: string, params?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
  return { status: res.status, body: (res.status === 202 ? null : await res.json()) as any };
};
const tool = async (key: string, name: string, args: Record<string, unknown> = {}) => (await rpc(key, "tools/call", { name, arguments: args })).body.result as { isError: boolean; structuredContent?: any; content: { text: string }[] };

describe("agent keys", () => {
  it("shows a key once, stores only its keyed hash, lists it without the secret, and caps how many one person holds", async () => {
    const ada = await signIn("ada@example.com");
    const { key, record } = await makeKey(ada);
    expect(key).toMatch(/^dl_[A-Za-z0-9_-]{43}$/);
    expect(record.prefix).toBe(key.slice(0, 10));
    const stored = (await db.query<{ token_hash: string }>("select token_hash from agent_tokens")).rows;
    expect(stored).toEqual([{ token_hash: hashAgentKey(PEPPER, key) }]);
    expect(JSON.stringify((await db.query("select * from agent_tokens")).rows)).not.toContain(key);
    const listed = (await (await asUser(ada, "GET", "/me/agent-keys")).json()) as { keys: Record<string, unknown>[] };
    expect(listed.keys).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(key);
    for (let i = 1; i < MAX_AGENT_KEYS; i++) await makeKey(ada, `agent ${i}`);
    expect((await asUser(ada, "POST", "/me/agent-keys", { name: "one too many" })).status).toBe(409);
  });

  it("cuts an agent off the moment its key is revoked, and only its owner can revoke it", async () => {
    const ada = await signIn("ada@example.com");
    const bea = await signIn("bea@example.com");
    const { key, record } = await makeKey(ada);
    expect((await rpc(key, "tools/list")).status).toBe(200);
    expect((await asUser(bea, "DELETE", `/me/agent-keys/${record.id}`)).status).toBe(404);
    expect((await rpc(key, "tools/list")).status).toBe(200);
    expect((await asUser(ada, "DELETE", `/me/agent-keys/${record.id}`)).status).toBe(204);
    expect((await rpc(key, "tools/list")).status).toBe(401);
  });
});

describe("the MCP server", () => {
  it("refuses calls without a key, with a wrong one, or from another site's page", async () => {
    const ada = await signIn("ada@example.com");
    const { key } = await makeKey(ada);
    expect((await rpc(null, "initialize")).status).toBe(401);
    expect((await rpc(`dl_${"x".repeat(43)}`, "initialize")).status).toBe(401);
    // A session token is not an agent key.
    expect((await rpc(ada, "initialize")).status).toBe(401);
    expect((await rpc(key, "initialize", {}, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await app.request("/mcp", { method: "GET" })).status).toBe(405);
  });

  it("speaks MCP: initialize, notifications, ping and the tool list", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    const init = await rpc(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dandelist" } });
    const res = await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(res.status).toBe(202);
    expect((await rpc(key, "ping")).body.result).toEqual({});
    const tools = (await rpc(key, "tools/list")).body.result.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect((await rpc(key, "no/such")).body.error.code).toBe(-32601);
  });

  it("gives full control of the key's own account: add, list, change, summarise and remove wishes, and check a photo", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    const added = await tool(key, "add_wish", { name: "Leica Q3", kind: "buy", tier: "must", upfront_cents: 599_500, photo_url: PHOTO, source_url: "https://leica-camera.com/q3" });
    expect(added.isError).toBe(false);
    const id = added.structuredContent.wish.id as string;
    expect(added.structuredContent.wish).toMatchObject({ name: "Leica Q3", tier: "must", upfront_cents: 599_500, photo_url: PHOTO, seller: "leica-camera.com" });
    expect((await tool(key, "update_wish", { id, tier: "dream" })).structuredContent.wish.tier).toBe("dream");
    expect((await tool(key, "list_wishes")).structuredContent.wishes.map((w: { id: string }) => w.id)).toEqual([id]);
    expect((await tool(key, "summary")).structuredContent.all).toMatchObject({ count: 1, upfront_cents: 599_500 });
    expect((await tool(key, "photo_check", { url: PHOTO })).structuredContent).toMatchObject({ ok: true, width: 3000, height: 2000 });
    expect((await tool(key, "remove_wish", { id })).structuredContent).toEqual({ removed: true });
    expect((await tool(key, "list_wishes")).structuredContent.wishes).toEqual([]);
  });

  it("reorders the key's own list by price, kind or pinned wishes, and keeps that order", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    const add = async (name: string, kind: string, upfront_cents: number) => (await tool(key, "add_wish", { name, kind, upfront_cents })).structuredContent.wish.id as string;
    const watch = await add("Watch", "buy", 1_000_000);
    const trip = await add("Trip", "visit", 400_000);
    const bike = await add("Bike", "buy", 200_000);
    const ids = (r: { structuredContent?: { wishes: { id: string }[] } }) => r.structuredContent!.wishes.map((w) => w.id);
    expect(ids(await tool(key, "reorder_wishes", { sort: "price_high" }))).toEqual([watch, trip, bike]);
    expect(ids(await tool(key, "list_wishes"))).toEqual([watch, trip, bike]);
    expect(ids(await tool(key, "reorder_wishes", { first: ["visit"] }))).toEqual([trip, watch, bike]);
    expect(ids(await tool(key, "reorder_wishes", { top: [bike], bottom: [trip] }))).toEqual([bike, watch, trip]);
  });

  it("never lets one account's key read or change another's wishes", async () => {
    const ada = await signIn("ada@example.com");
    const bea = await signIn("bea@example.com");
    const adaKey = (await makeKey(ada)).key;
    const beaKey = (await makeKey(bea)).key;
    const id = (await tool(adaKey, "add_wish", { name: "Ada's watch", kind: "buy", upfront_cents: 1_000_000 })).structuredContent.wish.id as string;
    expect((await tool(beaKey, "list_wishes")).structuredContent.wishes).toEqual([]);
    for (const [name, args] of [
      ["get_wish", { id }],
      ["update_wish", { id, name: "Mine now" }],
      ["remove_wish", { id }],
      ["find_photo", { wish_id: id }],
      ["reorder_wishes", { top: [id] }],
    ] as const) {
      const r = await tool(beaKey, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0]!.text, name).toMatch(/wasn't found/);
    }
    // Ada's wish is untouched.
    expect((await tool(adaKey, "list_wishes")).structuredContent.wishes).toMatchObject([{ id, name: "Ada's watch" }]);
    expect((await tool(beaKey, "summary")).structuredContent.all.count).toBe(0);
  });

  it("counts every message of a batch against the key's minute, and caps batches and photo checks", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    const batch = (n: number, method = "ping") =>
      app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(Array.from({ length: n }, () => ({ jsonrpc: "2.0", id: ++seq, method }))) });
    expect((await batch(MAX_BATCH + 1)).status).toBe(400);
    for (let i = 0; i < MCP_CALLS_PER_MINUTE / MAX_BATCH; i++) expect((await batch(MAX_BATCH)).status).toBe(200);
    // The minute's allowance is spent by batches as surely as by single calls.
    const over = await rpc(key, "ping");
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe(-32002);
  });

  it("caps photo checks, which fetch from the web, tighter than other calls", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    for (let i = 0; i < PHOTO_CHECKS_PER_MINUTE; i++) expect((await tool(key, "photo_check", { url: PHOTO })).isError).toBe(false);
    expect((await rpc(key, "tools/call", { name: "photo_check", arguments: { url: PHOTO } })).body.error.code).toBe(-32002);
    expect((await tool(key, "list_wishes")).isError).toBe(false);
  });

  it("refuses a key whose session has expired", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    expect((await rpc(key, "ping")).status).toBe(200);
    await db.query("update sessions set expires_at = '2000-01-01T00:00:00Z' where id = (select session_id from agent_tokens)");
    expect((await rpc(key, "ping")).status).toBe(401);
  });

  it("says what is wrong with bad arguments instead of failing silently", async () => {
    const { key } = await makeKey(await signIn("ada@example.com"));
    const r = await tool(key, "add_wish", { name: "", kind: "spaceship" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/^Check the arguments/);
    expect((await rpc(key, "tools/call", { name: "drop_tables", arguments: {} })).body.error.code).toBe(-32602);
  });
});
