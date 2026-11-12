import type { Purchase, ProductSubscription } from "expo-iap";
import { STORE_PRODUCTS, type StoreBridge, type StoreProduct, type StorePurchase } from "./store-core";

/** Import the native SDK only after the account/consent/feature gate authorizes store work. */
export async function nativeStore(platform: "ios" | "android"): Promise<StoreBridge> {
  const sdk = await import("expo-iap");
  const listeners: { remove(): void }[] = [];
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
      const list = await sdk.fetchProducts({ skus: Object.values(STORE_PRODUCTS), type: "subs" });
      return (list ?? []).filter((p): p is ProductSubscription => p.type === "subs").map(product);
    },
    async eligibleForTrial(productId) { return platform === "ios" && await sdk.isEligibleForIntroOfferIOS(productId); },
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
    async close() { for (const listener of listeners.splice(0)) listener.remove(); await sdk.endConnection(); },
  };
}
