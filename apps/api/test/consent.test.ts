import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Hostnames resolve to a public documentation address, so nothing here touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { createApp } from "../src/app";
import { AI_CONSENT_VERSION, CONSENT_REQUIRED } from "../src/consent";
import { migrate, type Db } from "../src/db";

/**
 * Account-level AI consent (consent.ts; the owner, 2026-11-06: "It should be the first thing they do when they login to
 * their account or make their account is accept", and anyone using it without it "should just be prompted"). The real
 * app on a fresh database; Meta, Claude and the web stand in and count every call, so "refused" also means "nothing
 * reached a model".
 */
let db: Db;
let mail: { to: string; code: string }[];
let clock: Date;
let app: ReturnType<typeof createApp>;
/** Every call that reached a model provider, and every page fetched. */
let models: string[];
let web: string[];

const counted = (who: string) =>
  (async (url: string | URL) => {
    models.push(`${who} ${String(url)}`);
    return new Response(JSON.stringify({ error: { message: "no model in this test" } }), { status: 500, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  models = [];
  web = [];
  clock = new Date("2026-11-06T16:00:00Z");
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: ["http://localhost:8081"],
    meta: { apiKey: "test", fetch: counted("meta") },
    claude: { apiKey: "test", dailyUsd: 5, fetch: counted("claude") },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
    webFetch: (async (u: string | URL) => {
      web.push(String(u));
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch,
  } as Parameters<typeof createApp>[0]);
});

const call = (method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A sign-in by email code, as the app does it; the account has not accepted anything. */
async function signIn(email: string) {
  await call("POST", "/auth/email/start", null, { email });
  const res = await call("POST", "/auth/email/verify", null, { email, code: mail.at(-1)!.code });
  const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { id: string } };
  return { token: body.accessToken, refresh: body.refreshToken, id: body.user.id };
}
const accept = (token: string, version = AI_CONSENT_VERSION) => call("POST", "/me/consent", token, { version });
const consentOf = async (token: string) => ((await (await call("GET", "/me/consent", token)).json()) as { consent: { version: number | null; acceptedAt: string | null; current: number; accepted: boolean } }).consent;

describe("a new account", () => {
  it("can do nothing but the open paths until it accepts, then everything", async () => {
    const ada = await signIn("ada@example.com");
    expect(await consentOf(ada.token)).toEqual({ version: null, acceptedAt: null, current: AI_CONSENT_VERSION, accepted: false });
    expect((await call("GET", "/me", ada.token)).status).toBe(200);
    const refused = await call("GET", "/wishes", ada.token);
    expect(refused.status).toBe(403);
    // An older app shows the words; a new one shows the consent screen on the code.
    expect(await refused.json()).toEqual(CONSENT_REQUIRED);

    const saved = await accept(ada.token);
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { consent: unknown }).consent).toEqual({ version: AI_CONSENT_VERSION, acceptedAt: clock.toISOString(), current: AI_CONSENT_VERSION, accepted: true });
    expect((await call("GET", "/wishes", ada.token)).status).toBe(200);
  });

  it("keeps the first time it accepted when the same yes comes again (a second tap, a retry)", async () => {
    const ada = await signIn("ada@example.com");
    await accept(ada.token);
    const first = clock.toISOString();
    clock = new Date(clock.getTime() + 60_000);
    const again = await accept(ada.token);
    expect(again.status).toBe(200);
    expect((await consentOf(ada.token)).acceptedAt).toBe(first);
  });

  it("can't accept words an older app never showed, and stays refused", async () => {
    const ada = await signIn("ada@example.com");
    const old = await accept(ada.token, AI_CONSENT_VERSION - 1);
    expect(old.status).toBe(409);
    expect(((await old.json()) as { code: string }).code).toBe("consent_outdated");
    expect((await call("POST", "/me/consent", ada.token, { version: "yes" })).status).toBe(400);
    expect((await call("POST", "/me/consent", ada.token)).status).toBe(400);
    expect((await consentOf(ada.token)).accepted).toBe(false);
    expect((await call("GET", "/wishes", ada.token)).status).toBe(403);
  });

  it("can sign out and delete itself before accepting, and nothing else", async () => {
    const ada = await signIn("ada@example.com");
    expect((await call("POST", "/auth/logout", ada.token)).status).toBe(204);
    expect((await call("GET", "/me", ada.token)).status).toBe(401);
    const bob = await signIn("bob@example.com");
    expect((await call("DELETE", "/me", bob.token)).status).toBe(204);
    expect((await db.query("select 1 from users where email = 'bob@example.com'")).rows).toEqual([]);
  });
});

describe("one account, many devices; many accounts, one device", () => {
  it("is asked once per account: a second device signed in later needs no second yes", async () => {
    const phone = await signIn("ada@example.com");
    const laptop = await signIn("ada@example.com");
    expect((await call("GET", "/wishes", laptop.token)).status).toBe(403);
    await accept(phone.token);
    expect((await call("GET", "/wishes", laptop.token)).status).toBe(200);
    const tablet = await signIn("ada@example.com");
    expect((await consentOf(tablet.token)).accepted).toBe(true);
    expect((await call("GET", "/wishes", tablet.token)).status).toBe(200);
  });

  it("keeps each account's answer its own", async () => {
    const ada = await signIn("ada@example.com");
    await accept(ada.token);
    const bob = await signIn("bob@example.com");
    expect((await call("GET", "/wishes", ada.token)).status).toBe(200);
    expect((await call("GET", "/wishes", bob.token)).status).toBe(403);
    expect((await consentOf(bob.token)).accepted).toBe(false);
  });

  it("holds through a refreshed session, and a new version of the words asks again", async () => {
    const ada = await signIn("ada@example.com");
    await accept(ada.token);
    const refreshed = (await (await call("POST", "/auth/refresh", null, { refreshToken: ada.refresh })).json()) as { accessToken: string };
    expect((await call("GET", "/wishes", refreshed.accessToken)).status).toBe(200);
    // What a bump of AI_CONSENT_VERSION does to an account that accepted the one before.
    await db.query("update users set ai_consent_version = $2 where id = $1", [ada.id, AI_CONSENT_VERSION - 1]);
    expect((await call("GET", "/wishes", refreshed.accessToken)).status).toBe(403);
    expect((await consentOf(refreshed.accessToken)).accepted).toBe(false);
  });
});

describe("nothing reaches a model before the yes", () => {
  /** The AI routes by name, each with a body it would accept: the requests an older app would still send. */
  const AI_CALLS: [string, string, unknown?][] = [
    ["POST", "/agent/interpret", { text: "a Leica Q3" }],
    ["POST", "/agent/runs", { text: "a Leica Q3" }],
    ["POST", "/agent/photo", { title: "Leica Q3", kind: "buy" }],
    ["POST", "/dream/turn", { action: { type: "message", text: "a week in Lisbon" } }],
    ["GET", "/dream/suggestions"],
    ["POST", "/picks/today", { day: "2026-11-06" }],
    ["POST", "/me/facts", {}],
    ["POST", "/wishes/describe", { ids: ["00000000-0000-4000-8000-000000000000"] }],
    ["POST", "/wishes/search", { q: "camera" }],
    ["POST", "/pairs", { text: "a Leica Q3" }],
    ["POST", "/help", { message: "it broke" }],
  ];

  it("refuses every AI route with the consent code, and no model, page or ledger row is touched", async () => {
    const ada = await signIn("ada@example.com");
    for (const [method, path, body] of AI_CALLS) {
      const res = await call(method, path, ada.token, body);
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as { code: string }).code).toBe("consent_required");
    }
    expect(models).toEqual([]);
    expect(web).toEqual([]);
    expect((await db.query("select 1 from spend_ledger")).rows).toEqual([]);
  });

  it("refuses every signed-in route the app has but the open ones: a new route can't slip past", async () => {
    const ada = await signIn("ada@example.com");
    // Routes anyone may call without signing in: health, public images, rates, sign-in itself, the guest pool and
    // closed guest routes, the preview, and MCP (its own key check, tested below).
    const PUBLIC = [/^\/healthz$/, /^\/internal\/hold$/, /^\/media\//, /^\/fx/, /^\/auth\//, /^\/guest\//, /^\/preview$/, /^\/mcp$/];
    const OPEN = new Set(["GET /me", "DELETE /me", "GET /me/consent", "POST /me/consent", "POST /auth/logout"]);
    const routes = [...new Map(app.routes.filter((r) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method)).map((r) => [`${r.method} ${r.path}`, r])).values()];
    const fill = (path: string) => path.replace(/:id\b/g, "00000000-0000-4000-8000-000000000000").replace(/:provider\b/g, "github").replace(/:key\b/g, "x");
    let checked = 0;
    for (const r of routes) {
      const path = fill(r.path.replace(/\/+$/, "") || "/");
      if (PUBLIC.some((p) => p.test(path)) || OPEN.has(`${r.method} ${path}`)) continue;
      // Deleting the account would end the test early; it is open and covered above.
      const res = await call(r.method, path, ada.token, r.method === "GET" || r.method === "DELETE" ? undefined : {});
      // The owner's admin hides itself (a 404) from any account it won't serve, this one included; refused all the same.
      expect([`${r.method} ${path}`, res.status]).toEqual([`${r.method} ${path}`, path.startsWith("/admin/") ? 404 : 403]);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
    expect(models).toEqual([]);
  });

  it("gives an agent key nothing for an account without the yes, not even the tool list", async () => {
    const ada = await signIn("ada@example.com");
    // Before the yes there is no key to make.
    expect((await call("POST", "/me/agent-keys", ada.token, { name: "Claude" })).status).toBe(403);
    await accept(ada.token);
    const made = (await (await call("POST", "/me/agent-keys", ada.token, { name: "Claude" })).json()) as { key: string };
    const rpc = (method: string, params?: unknown) => call("POST", "/mcp", made.key, { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });
    expect((await rpc("tools/list")).status).toBe(200);
    // The words change (a version bump): the key gets nothing until the account accepts again.
    await db.query("update users set ai_consent_version = $2 where id = $1", [ada.id, AI_CONSENT_VERSION - 1]);
    for (const [method, params] of [["tools/list"], ["tools/call", { name: "photo_check", arguments: { url: "https://upload.wikimedia.org/x.jpg" } }], ["tools/call", { name: "add_wish", arguments: { text: "a Leica Q3" } }]] as const) {
      const res = await rpc(method, params);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: number; message: string } }).error).toEqual({ code: -32003, message: CONSENT_REQUIRED.error });
    }
    expect(models).toEqual([]);
    expect(web).toEqual([]);
  });
});
