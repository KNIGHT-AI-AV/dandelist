import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { EntitlementService, PRODUCTS, googleAccountId } from "../src/entitlements";
import { AppleVerifier, Environment } from "../src/billing/apple";
import type { GoogleSubscription } from "../src/billing/google";
import { testCertificates } from "./store-certificates";

let lite: PGlite, db: Db, certs: ReturnType<typeof testCertificates>, apple: AppleVerifier;
let app: ReturnType<typeof createApp>, service: EntitlementService, google: GoogleSubscription;
const mail: { to: string; code: string }[] = [];
const getSubscription = vi.fn(async () => google);
const now = () => new Date();
const deps = () => ({ db, now, jwtSecret: "fixture-secret-over-32-characters-long", codePepper: "fixture-pepper-over-16", mailer: { sendCode: async (to: string, code: string) => { mail.push({ to, code }); } }, webOrigins: ["http://localhost:8081"] });
beforeAll(async () => {
  lite = new PGlite(); db = { query: (s, p) => lite.query(s, p) as never, exec: s => lite.exec(s) };
  await migrate(db); certs = testCertificates(); apple = new AppleVerifier({ bundleId: "com.knightaiav.dandelist", environment: Environment.SANDBOX }, [certs.root]);
});
afterAll(async () => { await lite.close(); });
beforeEach(async () => {
  await db.exec("truncate users cascade"); mail.length = 0; getSubscription.mockClear();
  service = new EntitlementService(db, { enabled: true, apple, google: { getSubscription }, packageName: "com.knightaiav.dandelist" });
  app = createApp({ ...deps(), billing: { enabled: true, service, apple: true, google: true } });
});
const call = (method: string, path: string, token?: string, body?: unknown) => {
  const sendBody = method !== "GET" && body !== undefined;
  return app.request(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sendBody ? { "Content-Type": "application/json" } : {}) }, body: sendBody ? JSON.stringify(body) : undefined });
};
async function account(accept = true) {
  const email = randomUUID() + "@fixture.invalid";
  await call("POST", "/auth/email/start", undefined, { email });
  const response = await call("POST", "/auth/email/verify", undefined, { email, code: mail.at(-1)!.code });
  const result = await response.json() as { accessToken: string; user: { id: string } };
  if (accept) expect((await call("POST", "/me/consent", result.accessToken, { version: 1 })).status).toBe(200);
  return { token: result.accessToken, id: result.user.id };
}
function transaction(userId: string, patch: Record<string, unknown> = {}) {
  const instant = Date.now();
  return certs.jws({ transactionId: "fixture-transaction", originalTransactionId: "fixture-original", bundleId: "com.knightaiav.dandelist", productId: PRODUCTS.monthly, subscriptionGroupIdentifier: "fixture-premium", purchaseDate: instant - 1000, originalPurchaseDate: instant - 1000, expiresDate: instant + 14 * 86400000, quantity: 1, type: "Auto-Renewable Subscription", inAppOwnershipType: "PURCHASED", signedDate: instant, environment: "Sandbox", appAccountToken: userId, offerType: 1, offerDiscountType: "FREE_TRIAL", ...patch });
}
function play(userId: string) {
  google = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", latestOrderId: "GPA.FIXTURE.0001", externalAccountIdentifiers: { obfuscatedExternalAccountId: googleAccountId(userId) }, lineItems: [{ productId: PRODUCTS.monthly, expiryTime: new Date(Date.now() + 30 * 86400000).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }] };
}
it("ordinary deployments have no billing routes", async () => {
  app = createApp(deps()); expect((await call("GET", "/me/billing/")).status).toBe(404);
});
it("explicitly disabled routes return 404 and never invoke the service", async () => {
  const read = vi.spyOn(service, "read"); app = createApp({ ...deps(), billing: { enabled: false, service, apple: true, google: true } });
  expect((await call("GET", "/me/billing/")).status).toBe(404); expect(read).not.toHaveBeenCalled();
});
it.each(["GET /me/billing/", "POST /me/billing/trial", "POST /me/billing/apple", "POST /me/billing/google"])("requires sign-in and current consent for %s", async route => {
  const [method, path] = route.split(" "); expect((await call(method!, path!, undefined, {})).status).toBe(401);
  const a = await account(false); const response = await call(method!, path!, a.token, {});
  expect(response.status).toBe(403); expect((await response.json() as { code: string }).code).toBe("consent_required"); expect(getSubscription).not.toHaveBeenCalled();
  expect((await db.query("select * from entitlements")).rows).toHaveLength(0);
});
it("starts one fixed web/Android trial and returns no private store identifiers", async () => {
  const a = await account(); const first = await call("POST", "/me/billing/trial", a.token, { platform: "web" }); const body = await first.json();
  expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toBe("no-store"); expect(body).toMatchObject({ access: { state: "trialing", hasPremiumEntitlement: true } });
  const repeated = await call("POST", "/me/billing/trial", a.token, { platform: "android" }); expect(await repeated.json()).toEqual(body);
  expect(JSON.stringify(body)).not.toMatch(/original_transaction|user_id|fixture/);
});
it("refuses a synthetic iPhone server trial", async () => {
  const a = await account(); expect((await call("POST", "/me/billing/trial", a.token, { platform: "ios" })).status).toBe(400);
  expect((await db.query("select * from entitlements")).rows).toHaveLength(0);
});
it("verifies an account-bound Apple receipt before reporting completion and deduplicates its replay", async () => {
  const a = await account(); const signedTransaction = transaction(a.id);
  const first = await call("POST", "/me/billing/apple", a.token, { signedTransaction }); expect(first.status).toBe(200);
  const body = await first.json(); expect(body).toMatchObject({ verified: true, userId: a.id, access: { state: "trialing", hasPremiumEntitlement: true } });
  const second = await call("POST", "/me/billing/apple", a.token, { signedTransaction }); expect(await second.json()).toEqual(body);
  expect((await db.query("select * from entitlement_purchases")).rows).toHaveLength(1);
});
it("rejects a different account's Apple receipt and bad signatures without disclosing proof", async () => {
  const a = await account(); const b = await account(); const signedTransaction = transaction(a.id);
  const wrong = await call("POST", "/me/billing/apple", b.token, { signedTransaction }); expect(wrong.status).toBe(422); expect(await wrong.text()).not.toContain(signedTransaction);
  expect((await call("POST", "/me/billing/apple", a.token, { signedTransaction: "forged-jws" })).status).toBe(422);
  expect((await db.query("select * from entitlement_purchases")).rows).toHaveLength(0);
});
it("uses the verified Play API account binding instead of client price/state claims", async () => {
  const a = await account(); play(a.id); const response = await call("POST", "/me/billing/google", a.token, { purchaseToken: "fixture-store-token" });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ verified: true, userId: a.id, access: { state: "active" } });
  expect(getSubscription).toHaveBeenCalledWith("com.knightaiav.dandelist", "fixture-store-token");
  expect((await call("POST", "/me/billing/google", a.token, { purchaseToken: "fixture", state: "active" })).status).toBe(400);
});
it("rejects unbound Play purchases and does not change entitlement", async () => {
  const a = await account(); play(randomUUID()); expect((await call("POST", "/me/billing/google", a.token, { purchaseToken: "private-proof" })).status).toBe(422);
  expect((await db.query("select * from entitlement_purchases")).rows).toHaveLength(0);
});
it("rejects oversized proofs before store verification", async () => {
  const a = await account(); expect((await call("POST", "/me/billing/google", a.token, { purchaseToken: "x".repeat(16001) })).status).toBe(400); expect(getSubscription).not.toHaveBeenCalled();
  expect((await call("POST", "/me/billing/apple", a.token, { signedTransaction: "x".repeat(510001) })).status).toBe(413);
});
it("fails closed when a verifier is unconfigured", async () => {
  const a = await account(); app = createApp({ ...deps(), billing: { enabled: true, service, apple: false, google: false } });
  expect((await call("POST", "/me/billing/google", a.token, { purchaseToken: "fixture" })).status).toBe(503); expect(getSubscription).not.toHaveBeenCalled();
});
