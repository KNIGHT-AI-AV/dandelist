import { beforeEach, expect, it, vi } from "vitest";
import { nativeStore } from "./native-store";
import { STORE_PRODUCTS } from "./store-core";
const h = vi.hoisted(() => ({
  purchase: undefined as ((p: unknown) => void) | undefined,
  error: undefined as ((e: unknown) => void) | undefined,
  remove: vi.fn(), initConnection: vi.fn(), fetchProducts: vi.fn(), requestPurchase: vi.fn(), finishTransaction: vi.fn(), getAvailablePurchases: vi.fn(), syncIOS: vi.fn(), endConnection: vi.fn(), isEligibleForIntroOfferIOS: vi.fn(),
}));
vi.mock("expo-iap", () => ({ ...h, ErrorCode: { UserCancelled: "user-cancelled" }, purchaseUpdatedListener: (listener: typeof h.purchase) => { h.purchase = listener; return { remove: h.remove }; }, purchaseErrorListener: (listener: typeof h.error) => { h.error = listener; return { remove: h.remove }; } }));
beforeEach(() => { vi.clearAllMocks(); h.initConnection.mockResolvedValue(true); h.requestPurchase.mockResolvedValue(null); h.finishTransaction.mockResolvedValue(true); h.endConnection.mockResolvedValue(true); h.isEligibleForIntroOfferIOS.mockResolvedValue(true); });
const raw = { id: "fixture-tx", productId: STORE_PRODUCTS.monthly, storeId: "apple", purchaseState: "purchased", purchaseToken: "fixture-jws" };
it("sends UUID appAccountToken to StoreKit and never auto-finishes", async () => {
  const store = await nativeStore("ios"); const update = vi.fn(); await store.connect(update, vi.fn());
  await store.buy(STORE_PRODUCTS.monthly, "fixture-user-id", "a".repeat(64));
  expect(h.requestPurchase).toHaveBeenCalledWith({ type: "subs", request: { apple: { sku: STORE_PRODUCTS.monthly, appAccountToken: "fixture-user-id", andDangerouslyFinishTransactionAutomatically: false } } });
  h.purchase!(raw); expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "fixture-tx", token: "fixture-jws", platform: "ios", native: raw })); expect(h.finishTransaction).not.toHaveBeenCalled();
  await store.finish(update.mock.calls[0]![0]); expect(h.finishTransaction).toHaveBeenCalledWith({ purchase: raw, isConsumable: false });
  await store.close(); expect(h.remove).toHaveBeenCalledTimes(2);
});
it("requires explicit Play offer and uses the hash rather than raw user ID", async () => {
  const store = await nativeStore("android"); await store.connect(vi.fn(), vi.fn()); await store.buy(STORE_PRODUCTS.annual, "user-id", "b".repeat(64), "selected-offer");
  expect(h.requestPurchase).toHaveBeenCalledWith({ type: "subs", request: { google: { skus: [STORE_PRODUCTS.annual], obfuscatedAccountId: "b".repeat(64), subscriptionOffers: [{ sku: STORE_PRODUCTS.annual, offerToken: "selected-offer" }] } } });
});
it("restores from the SDK instead of local flags and excludes suspended Play items", async () => {
  h.getAvailablePurchases.mockResolvedValue([raw]); const store = await nativeStore("ios"); await store.connect(vi.fn(), vi.fn()); const list = await store.restore(); expect(h.syncIOS).toHaveBeenCalledTimes(1); expect(list[0]?.token).toBe("fixture-jws");
  expect(h.getAvailablePurchases).toHaveBeenCalledWith({ onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false, includeSuspendedAndroid: false });
});
it("rejects purchases from a different store and reports cancellation separately", async () => {
  const store = await nativeStore("ios"); const update = vi.fn(); const error = vi.fn(); await store.connect(update, error); h.purchase!({ ...raw, storeId: "horizon" }); expect(update).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(false); h.error!({ code: "user-cancelled" }); expect(error).toHaveBeenCalledWith(true);
});
it("maps current localized product data and the actual two-week trial", async () => {
  h.fetchProducts.mockResolvedValue([{ id: STORE_PRODUCTS.monthly, type: "subs", platform: "ios", title: "Store title", displayPrice: "€9.99", subscriptionOffers: [{ id: "intro", type: "introductory", paymentMode: "free-trial", period: { unit: "week", value: 2 }, periodCount: 1, price: 0, displayPrice: "Free" }] }]);
  const store = await nativeStore("ios"); expect(await store.products()).toEqual([{ id: STORE_PRODUCTS.monthly, title: "Store title", displayPrice: "€9.99", trialDays: 14, offers: [] }]);
});
