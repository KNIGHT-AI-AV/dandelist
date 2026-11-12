import type { Purchase, ProductSubscription } from "expo-iap";
import { STORE_PRODUCTS, type StoreBridge, type StoreProduct, type StorePurchase } from "./store-core";

/** Import the native SDK only after the account/consent/feature gate authorizes store work. */
export async function nativeStore(platform: "ios" | "android"): Promise<StoreBridge> {
  const sdk = await import("expo-iap");
  const listeners: { remove(): void }[] = [];
  const appleGroups = new Map<string, string>();
  const normalize = (purchase: Purchase): StorePurchase => {
    if (purchase.storeId !== (platform === "ios" ? "apple" : "play")) throw new Error("Unsupported purchase store");
    return { id: purchase.id, productId: purchase.productId, platform, state: purchase.purchaseState, token: purchase.purchaseToken ?? null, native: purchase };
  };
  const product = (p: ProductSubscription): StoreProduct => {
    const trial = p.subscriptionOffers?.find(o => o.paymentMode === "free-trial" && o.type === "introductory");
    const period = trial?.period;
    const trialDays = period?.unit === "week" ? period.value * 7 * (trial?.periodCount ?? 1)
      : period?.unit === "day" ? period.value * (trial?.periodCount ?? 1) : null;
    return { id: p.id, title: p.title, displayPrice: p.displayPrice, trialDays,
      offers: (p.subscriptionOffers ?? []).filter(o => !!o.offerTokenAndroid && !!o.basePlanIdAndroid).map(o => ({ token: o.offerTokenAndroid!, basePlanId: o.basePlanIdAndroid!, displayPrice: o.displayPrice })) };
  };
  return {
    async connect(onPurchase, onError) {
      listeners.push(sdk.purchaseUpdatedListener(purchase => {
        try { onPurchase(normalize(purchase)); } catch { onError(false); }
      }));
      listeners.push(sdk.purchaseErrorListener(error => onError(error.code === sdk.ErrorCode.UserCancelled)));
      if (!await sdk.initConnection()) throw new Error("Store connection unavailable");
    },
    async products() {
      // A failed/partial refresh must not leave an old eligibility mapping usable.
      appleGroups.clear();
      const list = await sdk.fetchProducts({ skus: Object.values(STORE_PRODUCTS), type: "subs" });
      const subscriptions = (list ?? []).filter((p): p is ProductSubscription => p.type === "subs");
      if (platform === "ios") for (const p of subscriptions) {
        const groupId = p.platform === "ios" ? p.subscriptionGroupIdIOS?.trim() : undefined;
        if (groupId && Object.values<string>(STORE_PRODUCTS).includes(p.id)) appleGroups.set(p.id, groupId);
      }
      return subscriptions.map(product);
    },
    async eligibleForTrial(productId) {
      const groupId = appleGroups.get(productId);
      // Expo IAP6.3/StoreKit expects a subscription GROUP, never a product SKU.
      return platform === "ios" && !!groupId && await sdk.isEligibleForIntroOfferIOS(groupId);
    },
    async buy(productId, userId, accountHash, offerToken) {
      await sdk.requestPurchase({ type: "subs", request: platform === "ios"
        ? { apple: { sku: productId, appAccountToken: userId, andDangerouslyFinishTransactionAutomatically: false } }
        : { google: { skus: [productId], obfuscatedAccountId: accountHash, subscriptionOffers: [{ sku: productId, offerToken: offerToken! }] } } });
    },
    async restore() {
      if (platform === "ios") await sdk.syncIOS();
      return (await sdk.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false, includeSuspendedAndroid: false })).map(normalize);
    },
    async finish(purchase) { await sdk.finishTransaction({ purchase: purchase.native as Purchase, isConsumable: false }); },
    async close() { appleGroups.clear(); for (const listener of listeners.splice(0)) listener.remove(); await sdk.endConnection(); },
  };
}
