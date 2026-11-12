import { expect, it, vi } from "vitest";
import { PlaySubscriptionClient } from "../src/billing/play-client";
const fixture = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", latestOrderId: "GPA.FIXTURE", lineItems: [{ productId: "com.knightaiav.dandelist.premium.monthly", expiryTime: "2027-01-01T00:00:00Z" }] };
it("uses only the fixed read-only Play endpoint, encodes the token and bounds the request", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify(fixture)));
  const client = new PlaySubscriptionClient(async () => "fixture-bearer", request as typeof fetch);
  expect(await client.getSubscription("com.knightaiav.dandelist", "a/b?c")).toEqual(fixture);
  expect(request).toHaveBeenCalledWith("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.knightaiav.dandelist/purchases/subscriptionsv2/tokens/a%2Fb%3Fc", expect.objectContaining({ method: "GET", redirect: "error", headers: { Authorization: "Bearer fixture-bearer" }, signal: expect.any(AbortSignal) }));
});
it.each(["SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_UNSPECIFIED", "made-up"])("never acknowledges a non-actionable Play purchase: %s", async subscriptionState => {
  const client = new PlaySubscriptionClient(async () => "fixture", async () => new Response(JSON.stringify({ ...fixture, subscriptionState })));
  await expect(client.getSubscription("com.knightaiav.dandelist", "token")).rejects.toThrow("not ready");
});
it("supports the current per-line successful-order identifier", async () => {
  const client = new PlaySubscriptionClient(async () => "fixture", async () => new Response(JSON.stringify({ ...fixture, latestOrderId: undefined, lineItems: [{ ...fixture.lineItems[0], latestSuccessfulOrderId: "GPA.LINE" }] })));
  expect((await client.getSubscription("com.knightaiav.dandelist", "token")).latestOrderId).toBe("GPA.LINE");
});
it("rejects other applications before obtaining credentials", async () => {
  const token = vi.fn(async () => "fixture"); const client = new PlaySubscriptionClient(token);
  await expect(client.getSubscription("com.other.app", "token")).rejects.toThrow(); expect(token).not.toHaveBeenCalled();
});
it("does not expose bearer tokens, receipt tokens or Google error bodies", async () => {
  const client = new PlaySubscriptionClient(async () => "private-bearer", async () => new Response("private-token-and-provider-detail", { status: 403 }));
  await expect(client.getSubscription("com.knightaiav.dandelist", "private-token")).rejects.toThrow(/^Play verification unavailable$/);
});
