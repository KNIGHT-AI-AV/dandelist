import { expect, it, vi } from "vitest";
import { PlaySubscriptionClient } from "../src/billing/play-client";
import { googlePhaseIsTrial } from "../src/billing/google";
const fixture = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", latestOrderId: "GPA.FIXTURE", lineItems: [{ productId: "com.knightaiav.dandelist.premium.monthly", expiryTime: "2027-01-01T00:00:00Z", offerPhase: { basePrice: {} } }] };
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
it("the sandbox deployment refuses real purchases and accepts Google's test-purchase marker", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json(fixture)).mockResolvedValueOnce(Response.json({ ...fixture, testPurchase: {} }));
  const client = new PlaySubscriptionClient(async () => "fixture", request, { sandboxOnly: true });
  await expect(client.getSubscription("com.knightaiav.dandelist", "fixture-token")).rejects.toThrow("test purchase required");
  expect(await client.getSubscription("com.knightaiav.dandelist", "fixture-token")).toMatchObject(fixture);
});
it.each([undefined, {}, { freeTrial: null }, { madeUp: {} }, { freeTrial: {}, basePrice: {} }, { prorationPeriod: {} }])("unknown or ambiguous current Play offer phase fails closed: %j", async offerPhase => {
  const client = new PlaySubscriptionClient(async () => "fixture", async () => Response.json({ ...fixture, lineItems: [{ ...fixture.lineItems[0], offerPhase }] }));
  await expect(client.getSubscription("com.knightaiav.dandelist", "fixture-token")).rejects.toThrow(/phase/);
});
it("distinguishes free-trial proration from introductory or base pricing", () => {
  const line = fixture.lineItems[0]!;
  expect(googlePhaseIsTrial({ ...line, offerPhase: { prorationPeriod: { originalOfferPhaseType: "FREE_TRIAL" } } })).toBe(true);
  expect(googlePhaseIsTrial({ ...line, offerPhase: { introductoryPrice: {} } })).toBe(false);
  expect(googlePhaseIsTrial(line)).toBe(false);
});
