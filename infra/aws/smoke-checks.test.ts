import assert from "node:assert/strict";
import test from "node:test";
import { accountSmoke, publicSmoke, type SmokeCall } from "./smoke-checks";

const id = "11111111-2222-3333-4444-555555555555";
const consent = { status: 200, json: { consent: { accepted: true } } };

test("public checks use only unauthenticated GETs and refuse redirects", async () => {
  const paths: string[] = [];
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    assert.equal(url.origin, "https://api.example.test");
    assert.equal(options?.method, "GET");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    assert.ok(options?.signal);
    const body = url.pathname === "/healthz" ? { ok: true }
      : url.pathname === "/config/features" ? { chatContinuity: false }
      : url.pathname === "/auth/providers" ? { providers: [{ id: "apple" }] }
      : { error: "Sign in" };
    return new Response(JSON.stringify(body), { status: url.pathname === "/me/consent" ? 401 : 200 });
  };
  assert.ok((await publicSmoke("https://api.example.test", request)).every(r => r.ok));
  assert.deepEqual(paths, ["/healthz", "/config/features", "/auth/providers", "/me/consent"]);
});

test("public checks reject credential-bearing origins and nonlocal HTTP before a request", async () => {
  const request: typeof fetch = async () => { throw new Error("must not request"); };
  for (const origin of ["https://user:pass@api.example.test", "https://api.example.test/path", "https://api.example.test/?key=x", "http://api.example.test"]) {
    await assert.rejects(publicSmoke(origin, request), /Use /);
  }
});

test("public failures are reported without leaking response bodies or errors", async () => {
  let index = 0;
  const request: typeof fetch = async () => {
    if (++index === 1) throw new Error("private network detail");
    return new Response("unexpected private response", { status: 200 });
  };
  const results = await publicSmoke("http://127.0.0.1:8080", request);
  assert.equal(results.length, 4);
  assert.ok(results.every(r => !r.ok));
  assert.doesNotMatch(JSON.stringify(results), /private/);
});

test("missing consent verifies the gate without accepting consent, writing data or calling AI", async () => {
  const calls: string[] = [];
  const call: SmokeCall = async (method, path) => {
    calls.push(`${method} ${path}`);
    return path === "/me/consent" ? { status: 200, json: { consent: { accepted: false } } }
      : { status: 403, json: { code: "consent_required" } };
  };
  const results = await accountSmoke(call, true);
  assert.deepEqual(calls, ["GET /me/consent", "GET /wishes"]);
  assert.equal(results[0]?.ok, false);
  assert.equal(results[1]?.ok, true);
});

test("an unreadable consent response stops before protected account requests", async () => {
  const calls: string[] = [];
  const results = await accountSmoke(async (method, path) => {
    calls.push(`${method} ${path}`); return { status: 503, json: null };
  }, true);
  assert.deepEqual(calls, ["GET /me/consent"]);
  assert.equal(results[0]?.ok, false);
});

test("consented account checks clean up only their new wish and default to no AI", async () => {
  const calls: string[] = [];
  const results = await accountSmoke(async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === "/me/consent") return consent;
    if (method === "POST") return { status: 201, json: { wish: { id } } };
    if (method === "DELETE") return { status: 204, json: null };
    return { status: 200, json: { wishes: [{ id }, { id: "another-account-wish" }] } };
  });
  assert.ok(results.every(r => r.ok));
  assert.deepEqual(calls, ["GET /me/consent", "POST /wishes", "GET /wishes", `DELETE /wishes/${id}`]);
});

test("a failed list read still attempts removal of the created fixture", async () => {
  const calls: string[] = [];
  await assert.rejects(accountSmoke(async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === "/me/consent") return consent;
    if (method === "POST") return { status: 201, json: { wish: { id } } };
    if (method === "DELETE") return { status: 204, json: null };
    throw new Error("list unavailable");
  }), /list unavailable/);
  assert.equal(calls.at(-1), `DELETE /wishes/${id}`);
});

test("failed creation never requests an undefined or attacker-controlled wish ID", async () => {
  for (const reply of [{ status: 403, json: null }, { status: 201, json: { wish: { id: "../me" } } }]) {
    const calls: string[] = [];
    const results = await accountSmoke(async (method, path) => {
      calls.push(`${method} ${path}`); return path === "/me/consent" ? consent : reply;
    }, true);
    assert.equal(results.at(-1)?.ok, false);
    assert.deepEqual(calls, ["GET /me/consent", "POST /wishes"]);
  }
});

test("a model request needs explicit opt-in and keeps model output out of the report", async () => {
  const calls: string[] = [];
  const results = await accountSmoke(async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === "/me/consent") return consent;
    if (path === "/agent/interpret") return { status: 200, json: { draft: { title: "private model output" } } };
    if (method === "POST") return { status: 201, json: { wish: { id } } };
    if (method === "DELETE") return { status: 204, json: null };
    return { status: 200, json: { wishes: [{ id }] } };
  }, true);
  assert.ok(results.every(r => r.ok));
  assert.equal(calls.filter(c => c === "POST /agent/interpret").length, 1);
  assert.doesNotMatch(JSON.stringify(results), /private model output/);
});
