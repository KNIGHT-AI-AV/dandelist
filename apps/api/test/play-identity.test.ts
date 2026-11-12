import { beforeAll, expect, it, vi } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { playIdentity } from "../src/billing/play-identity";
let json: string;
let publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];
beforeAll(async () => {
  const keys = await generateKeyPair("RS256"); publicKey = keys.publicKey;
  json = JSON.stringify({ type: "service_account", client_email: "billing@fixture-only.iam.gserviceaccount.com", private_key: await exportPKCS8(keys.privateKey), token_uri: "https://attacker.invalid" });
});
const response = () => Response.json({ token_type: "Bearer", access_token: "synthetic-test-token", expires_in: 3600 });
it("signs a bounded assertion for Google's fixed endpoint and Android Publisher scope", async () => {
  const request = vi.fn(async () => response());
  const identity = playIdentity(json, request as typeof fetch);
  expect(await identity()).toBe("synthetic-test-token");
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
  const body = new URLSearchParams(String(init.body));
  expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  const { payload } = await jwtVerify(body.get("assertion")!, publicKey, { algorithms: ["RS256"], audience: url, issuer: "billing@fixture-only.iam.gserviceaccount.com" });
  expect(payload.scope).toBe("https://www.googleapis.com/auth/androidpublisher");
  expect(payload.exp! - payload.iat!).toBe(3600);
});
it("coalesces concurrent refreshes and refreshes before expiry", async () => {
  let time = Date.now(); const request = vi.fn(async () => response());
  const identity = playIdentity(json, request as typeof fetch, () => time);
  await Promise.all([identity(), identity(), identity()]); expect(request).toHaveBeenCalledTimes(1);
  time += 3539_000; await identity(); expect(request).toHaveBeenCalledTimes(1);
  time += 1000; await identity(); expect(request).toHaveBeenCalledTimes(2);
});
it("retries after a failed refresh without exposing a key, assertion or provider body", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("private-provider-detail" )).mockResolvedValueOnce(response());
  const identity = playIdentity(json, request);
  await expect(identity()).rejects.toThrow(/^Play identity unavailable$/);
  expect(await identity()).toBe("synthetic-test-token");
});
it.each([{}, { access_token: "secret", token_type: "Basic", expires_in: 3600 }, { access_token: "a\nb", token_type: "Bearer", expires_in: 3600 }, { access_token: "secret", token_type: "Bearer", expires_in: 60 }, { access_token: "secret", token_type: "Bearer", expires_in: 99999 }])("fails closed on malformed token responses %j", async data => {
  await expect(playIdentity(json, async () => Response.json(data))()).rejects.toThrow(/^Play identity unavailable$/);
});
it("redacts non-OK bodies and refuses oversized responses", async () => {
  await expect(playIdentity(json, async () => new Response("private", { status: 403 }))()).rejects.toThrow(/^Play identity unavailable$/);
  await expect(playIdentity(json, async () => new Response("x".repeat(32_001)))()).rejects.toThrow(/^Play identity unavailable$/);
});
it.each(["not-json", "{}", JSON.stringify({ type: "authorized_user" }), "x".repeat(32_001)])("rejects invalid credential input before a request", data => {
  const request = vi.fn(); expect(() => playIdentity(data, request)).toThrow(/^Play identity unavailable$/); expect(request).not.toHaveBeenCalled();
});
