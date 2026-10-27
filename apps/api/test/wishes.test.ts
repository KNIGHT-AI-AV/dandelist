import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";

let db: Db;
let mail: { to: string; code: string }[];
let clock: Date;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) };
  await migrate(db);
  mail = [];
  clock = new Date("2026-10-27T12:00:00Z");
  app = createApp({
    db,
    mailer: { sendCode: async (to, code) => void mail.push({ to, code }) },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    judge: { email: "judge@dandelist.com", code: "424242" },
    now: () => clock,
    webOrigins: ["http://localhost:8081"],
  });
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

const gym = { name: "Gym membership", kind: "do", upfrontCents: 5000, recurring: [{ amountCents: 4000, period: "month", label: "membership" }] };

describe("wishes", () => {
  it("adds, lists, changes and removes a wish", async () => {
    const t = await signIn("ada@example.com");
    const created = await call("POST", "/wishes", t, gym);
    expect(created.status).toBe(201);
    const { wish } = (await created.json()) as { wish: { id: string; tier: string; recurring: unknown[]; upfrontCents: number } };
    expect(wish).toMatchObject({ tier: "nice", upfrontCents: 5000, recurring: [{ amountCents: 4000, period: "month" }] });

    const list = (await (await call("GET", "/wishes", t)).json()) as { wishes: { id: string }[] };
    expect(list.wishes.map((w) => w.id)).toEqual([wish.id]);

    clock = new Date(clock.getTime() + 60_000);
    const patched = await call("PATCH", `/wishes/${wish.id}`, t, { tier: "must", upfrontCents: 0 });
    expect(patched.status).toBe(200);
    const after = ((await patched.json()) as { wish: { tier: string; upfrontCents: number; updatedAt: string; name: string } }).wish;
    expect(after).toMatchObject({ tier: "must", upfrontCents: 0, name: "Gym membership", updatedAt: "2026-10-27T12:01:00.000Z" });

    expect((await call("DELETE", `/wishes/${wish.id}`, t)).status).toBe(204);
    expect(((await (await call("GET", "/wishes", t)).json()) as { wishes: unknown[] }).wishes).toEqual([]);
  });

  it("keeps each person's wishes private", async () => {
    const ada = await signIn("ada@example.com");
    const bo = await signIn("bo@example.com");
    const { wish } = (await (await call("POST", "/wishes", ada, gym)).json()) as { wish: { id: string } };

    expect(((await (await call("GET", "/wishes", bo)).json()) as { wishes: unknown[] }).wishes).toEqual([]);
    expect((await call("PATCH", `/wishes/${wish.id}`, bo, { name: "Mine now" })).status).toBe(404);
    expect((await call("DELETE", `/wishes/${wish.id}`, bo)).status).toBe(404);
    expect(((await (await call("GET", "/wishes", ada)).json()) as { wishes: { name: string }[] }).wishes[0]!.name).toBe("Gym membership");
  });

  it("rejects bad input", async () => {
    const t = await signIn("ada@example.com");
    expect((await call("POST", "/wishes", t, { ...gym, upfrontCents: 12.5 })).status).toBe(400);
    expect((await call("POST", "/wishes", t, { ...gym, upfrontCents: -1 })).status).toBe(400);
    expect((await call("POST", "/wishes", t, { ...gym, kind: "steal" })).status).toBe(400);
    expect((await call("POST", "/wishes", t, { ...gym, name: "   " })).status).toBe(400);
    expect((await call("PATCH", "/wishes/not-a-uuid", t, { name: "x" })).status).toBe(400);
    const { wish } = (await (await call("POST", "/wishes", t, gym)).json()) as { wish: { id: string } };
    expect((await call("PATCH", `/wishes/${wish.id}`, t, {})).status).toBe(400);
  });

  it("needs a signed-in person", async () => {
    expect((await app.request("/wishes")).status).toBe(401);
  });

  it("goes when the account is deleted", async () => {
    const t = await signIn("ada@example.com");
    await call("POST", "/wishes", t, gym);
    expect((await call("DELETE", "/me", t)).status).toBe(204);
    expect((await db.query("select count(*) as n from wishes")).rows[0]).toEqual({ n: 0 });
  });
});

describe("wish links", () => {
  it("stores only web addresses for a wish's source and image", async () => {
    const { webLinksOnly } = await import("../src/wishes");
    expect(webLinksOnly({ agent: { url: "https://www.rolex.com/x", imageUrl: "https://media.rolex.com/a.jpg" } })).toBe(true);
    expect(webLinksOnly({ agent: { url: "" } })).toBe(true);
    expect(webLinksOnly({})).toBe(true);
    expect(webLinksOnly({ agent: { url: "javascript:alert(1)" } })).toBe(false);
    expect(webLinksOnly({ agent: { url: "intent://evil#Intent;end" } })).toBe(false);
    expect(webLinksOnly({ agent: { imageUrl: "file:///etc/passwd" } })).toBe(false);
  });
});
