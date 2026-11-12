import type { GooglePlayClient, GoogleSubscription } from "./google";

/** A read-only Play API client. Credential refresh is supplied by the deployment's existing identity provider. */
export class PlaySubscriptionClient implements GooglePlayClient {
  constructor(private accessToken: () => Promise<string>, private request: typeof fetch = fetch) {}
  async getSubscription(packageName: string, purchaseToken: string): Promise<GoogleSubscription> {
    if (packageName !== "com.knightaiav.dandelist" || !purchaseToken || purchaseToken.length > 16_000) throw new Error("Invalid Play purchase request");
    const bearer = await this.accessToken();
    if (!bearer || /[\r\n]/.test(bearer)) throw new Error("Play identity unavailable");
    const response = await this.request(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, {
      method: "GET", headers: { Authorization: `Bearer ${bearer}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Play verification unavailable");
    const text = await response.text();
    if (text.length > 200_000) throw new Error("Play response too large");
    const data = JSON.parse(text) as GoogleSubscription & { lineItems?: { latestSuccessfulOrderId?: string }[] };
    const states = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED"]);
    if (!states.has(data.subscriptionState) || !Array.isArray(data.lineItems) || data.lineItems.length !== 1) throw new Error("Play subscription is not ready");
    const line = data.lineItems[0]!;
    const latestOrderId = data.latestOrderId ?? line.latestSuccessfulOrderId;
    if (!latestOrderId || !line.productId || !Number.isFinite(Date.parse(line.expiryTime))) throw new Error("Invalid Play subscription response");
    return { ...data, latestOrderId };
  }
}
