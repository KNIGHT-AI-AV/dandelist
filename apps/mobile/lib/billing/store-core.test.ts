import { describe, expect, it, vi } from "vitest";
import { StoreController, STORE_PRODUCTS, type BillingAccess, type StoreBridge, type StoreControllerOptions, type StorePurchase, type StoreState } from "./store-core";
import { billingService } from "./service";

const userId = "11111111-2222-4333-8444-555555555555";
const access: BillingAccess = { state: "trialing", expiresAt: "2026-12-01T00:00:00Z", hasPremiumEntitlement: true };
const hash = "a".repeat(64);
const purchase = (patch: Partial<StorePurchase> = {}): StorePurchase => ({ id: "fixture-tx-1", productId: STORE_PRODUCTS.monthly, platform: "ios", state: "purchased", token: "private-fixture-token", native: { fixture: true }, ...patch });
function fixture(patch: Partial<StoreControllerOptions> = {}) {
  let onPurchase!: (p: StorePurchase) => void;
  let onError!: (cancelled: boolean) => void;
  const events: StoreState[] = [];
  const order: string[] = [];
  const bridge: StoreBridge = {
    connect: vi.fn(async (p, e) => { onPurchase = p; onError = e; }),
    products: vi.fn(async () => [{ id: STORE_PRODUCTS.monthly, title: "Monthly", displayPrice: "$9.99", trialDays: 14, offers: [{ token: "fixture-offer", basePlanId: "monthly", displayPrice: "$9.99" }] }]),
    eligibleForTrial: vi.fn(async () => true),
    buy: vi.fn(async () => { order.push("buy"); }),
    restore: vi.fn(async () => [purchase()]),
    finish: vi.fn(async () => { order.push("finish"); }),
    close: vi.fn(async () => {}),
  };
  const load = vi.fn(async () => bridge);
  const verify = vi.fn(async () => { order.push("verify-persisted"); return { verified: true as const, userId, access }; });
  const options: StoreControllerOptions = { enabled: true, userId, platform: "ios", isCurrent: () => true, accountHash: vi.fn(async () => hash), load, verify, onState: s => events.push(s), ...patch };
  const controller = new StoreController(options);
  return { controller, bridge, load, verify, options, events, order, emit: (p: StorePurchase) => onPurchase(p), error: (c: boolean) => onError(c) };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("account-bound store lifecycle", () => {
  it.each([{ enabled: false }, { isCurrent: () => false }, { userId: "bad-user" }])("refuses SDK initialization before authorization: %j", async patch => {
    const f = fixture(patch); await expect(f.controller.list()).rejects.toThrow(); expect(f.load).not.toHaveBeenCalled();
  });
  it("opens one connection across simultaneous reads and registers results before buying", async () => {
    const f = fixture(); await Promise.all([f.controller.list(), f.controller.list()]); await f.controller.buy(STORE_PRODUCTS.monthly, "trial");
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.bridge.connect).toHaveBeenCalledTimes(1); expect(f.bridge.buy).toHaveBeenCalledWith(STORE_PRODUCTS.monthly, userId, hash, undefined);
    expect(f.verify).not.toHaveBeenCalled(); expect(f.bridge.finish).not.toHaveBeenCalled(); expect(f.events.at(-1)?.status).toBe("pending");
  });
  it("dispatch completion does not grant access; verification persists before finish", async () => {
    const f = fixture(); await f.controller.buy(STORE_PRODUCTS.monthly, "subscribe"); f.emit(purchase()); await flush();
    expect(f.order).toEqual(["buy", "verify-persisted", "finish"]); expect(f.events.at(-1)).toEqual({ status: "complete", access });
    expect(JSON.stringify(f.events)).not.toContain("private-fixture-token");
  });
  it("rapid duplicate taps dispatch only one store request", async () => {
    const f = fixture(); const first = f.controller.buy(STORE_PRODUCTS.monthly, "subscribe"); await expect(f.controller.buy(STORE_PRODUCTS.monthly, "subscribe")).rejects.toThrow("already"); await first;
    expect(f.bridge.buy).toHaveBeenCalledTimes(1);
  });
  it("deduplicates simultaneous and repeated delivery of one transaction", async () => {
    const f = fixture(); await f.controller.list(); f.emit(purchase()); f.emit(purchase()); await flush(); f.emit(purchase()); await flush();
    expect(f.verify).toHaveBeenCalledTimes(1); expect(f.bridge.finish).toHaveBeenCalledTimes(1);
  });
  it("pending store results are never verified, finished or granted", async () => {
    const f = fixture(); await f.controller.list(); f.emit(purchase({ state: "pending", token: null })); await flush();
    expect(f.verify).not.toHaveBeenCalled(); expect(f.bridge.finish).not.toHaveBeenCalled(); expect(f.events.at(-1)).toEqual({ status: "pending" });
  });
  it("verification failure keeps the transaction unfinished and a later restore retries it", async () => {
    const f = fixture(); f.verify.mockRejectedValueOnce(new Error("network unavailable")); await f.controller.list(); f.emit(purchase()); await flush();
    expect(f.bridge.finish).not.toHaveBeenCalled(); expect(f.events.at(-1)?.status).toBe("retry"); await f.controller.restore();
    expect(f.verify).toHaveBeenCalledTimes(2); expect(f.bridge.finish).toHaveBeenCalledTimes(1);
  });
  it("a wrong-account service result never finishes or grants", async () => {
    const f = fixture(); f.verify.mockResolvedValueOnce({ verified: true, userId: "other-user", access }); await expect(f.controller.restore()).rejects.toThrow();
    expect(f.bridge.finish).not.toHaveBeenCalled(); expect(f.events.some(s => s.status === "complete")).toBe(false);
  });
  it("a sign-in change during verification suppresses the old result and acknowledgement", async () => {
    let current = true; let resolve!: (v: { verified: true; userId: string; access: BillingAccess }) => void;
    const f = fixture({ isCurrent: () => current, verify: () => new Promise(r => { resolve = r; }) }); await f.controller.list(); f.emit(purchase()); current = false; resolve({ verified: true, userId, access }); await flush();
    expect(f.bridge.finish).not.toHaveBeenCalled(); expect(f.events.some(s => s.status === "complete")).toBe(false);
  });
  it("cancellation permits another explicit request without retrying the first", async () => {
    const f = fixture(); await f.controller.buy(STORE_PRODUCTS.monthly, "subscribe"); f.error(true); await f.controller.buy(STORE_PRODUCTS.monthly, "subscribe");
    expect(f.bridge.buy).toHaveBeenCalledTimes(2); expect(f.events).toContainEqual({ status: "cancelled" });
  });
  it.each([false, true])("an ineligible or non-fourteen-day Apple trial never opens a paid sheet (%s)", async wrongDuration => {
    const f = fixture(); if (wrongDuration) vi.mocked(f.bridge.products).mockResolvedValueOnce([{ id: STORE_PRODUCTS.monthly, title: "Monthly", displayPrice: "$9.99", trialDays: 7, offers: [] }]); else vi.mocked(f.bridge.eligibleForTrial).mockResolvedValueOnce(false);
    await expect(f.controller.buy(STORE_PRODUCTS.monthly, "trial")).rejects.toThrow("trial unavailable"); expect(f.bridge.buy).not.toHaveBeenCalled();
  });
  it("Android requires an explicitly selected offer and sends the account hash", async () => {
    const f = fixture({ platform: "android" }); await expect(f.controller.buy(STORE_PRODUCTS.monthly, "subscribe")).rejects.toThrow("offer"); await expect(f.controller.buy(STORE_PRODUCTS.monthly, "trial", "fixture-offer")).rejects.toThrow("trial unavailable");
    await f.controller.buy(STORE_PRODUCTS.monthly, "subscribe", "fixture-offer"); expect(f.bridge.buy).toHaveBeenCalledWith(STORE_PRODUCTS.monthly, userId, hash, "fixture-offer");
  });
  it.each([{ productId: "foreign.product" }, { platform: "android" as const }, { token: null }, { state: "unknown" as const }])("rejects foreign or incomplete purchase %j", async patch => {
    const f = fixture(); vi.mocked(f.bridge.restore).mockResolvedValueOnce([purchase(patch)]); await expect(f.controller.restore()).rejects.toThrow(); expect(f.verify).not.toHaveBeenCalled(); expect(f.bridge.finish).not.toHaveBeenCalled();
  });
  it("removes listeners on close and ignores late store events", async () => {
    const f = fixture(); await f.controller.list(); await f.controller.close(); f.emit(purchase()); await flush(); expect(f.bridge.close).toHaveBeenCalledTimes(1); expect(f.verify).not.toHaveBeenCalled();
  });
  it("an empty restore does not claim entitlement", async () => {
    const f = fixture(); vi.mocked(f.bridge.restore).mockResolvedValueOnce([]); await f.controller.restore(); expect(f.events.at(-1)).toEqual({ status: "idle" }); expect(f.verify).not.toHaveBeenCalled();
  });
});

describe("billing HTTP response boundary", () => {
  it("posts only the receipt proof to the bound API and rejects other account replies", async () => {
    const api = vi.fn(async () => new Response(JSON.stringify({ verified: true, userId, access })));
    const service = billingService(api, userId); await service.verify(purchase());
    expect(api).toHaveBeenCalledWith("/me/billing/apple", expect.objectContaining({ method: "POST", body: JSON.stringify({ signedTransaction: "private-fixture-token" }) }));
    await expect(billingService(api, "other").verify(purchase())).rejects.toThrow("different account");
  });
  it.each([{ state: "made-up", expiresAt: null, hasPremiumEntitlement: true }, { state: "active", expiresAt: "invalid", hasPremiumEntitlement: true }, { state: "active", expiresAt: null }])("rejects malformed access state %j", async bad => {
    const api = vi.fn(async () => new Response(JSON.stringify({ verified: true, userId, access: bad }))); await expect(billingService(api, userId).verify(purchase())).rejects.toThrow("Invalid entitlement");
  });
  it("failed service requests never fall back to a local entitlement", async () => {
    const service = billingService(async () => new Response("unavailable", { status: 503 }), userId); await expect(service.read()).rejects.toThrow(); await expect(service.verify(purchase())).rejects.toThrow();
  });
});
