import type { BillingAccess, StoreControllerOptions, VerifiedStorePurchase } from "./store-core";

const states = new Set(["none", "trialing", "active", "grace", "expired", "revoked"]);
function access(value: unknown): BillingAccess {
  const a = value as Partial<BillingAccess> | null;
  if (!a || !states.has(a.state ?? "") || typeof a.hasPremiumEntitlement !== "boolean" ||
    !(a.expiresAt === null || typeof a.expiresAt === "string" && Number.isFinite(Date.parse(a.expiresAt)))) {
    throw new Error("Invalid entitlement response");
  }
  if (a.hasPremiumEntitlement !== ["trialing", "active", "grace"].includes(a.state!)) throw new Error("Inconsistent entitlement response");
  return { state: a.state!, expiresAt: a.expiresAt!, hasPremiumEntitlement: a.hasPremiumEntitlement };
}
/** Pass an API function already bound to the current sign-in; never attach or log a store token elsewhere. */
export function billingService(api: (path: string, init?: RequestInit) => Promise<Response>, userId: string) {
  const request = async (path: string, body?: unknown) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await api("/me/billing" + path, { signal: abort.signal, ...(body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }) });
      if (!response.ok) throw new Error("Store verification unavailable");
      return await response.json();
    } finally { clearTimeout(timer); }
  };
  const verify: StoreControllerOptions["verify"] = async (purchase): Promise<VerifiedStorePurchase> => {
    const result = await request("/" + (purchase.platform === "ios" ? "apple" : "google"), purchase.platform === "ios"
      ? { signedTransaction: purchase.token } : { purchaseToken: purchase.token });
    if (result?.verified !== true || result.userId !== userId) throw new Error("Purchase belongs to a different account");
    return { verified: true, userId, access: access(result.access) };
  };
  return {
    verify,
    async read() { return access((await request("/")).access); },
    async available(platform: "ios" | "android") { return (await request("/")).stores?.[platform] === true; },
    async startTrial(platform: "web" | "android") { return access((await request("/trial", { platform })).access); },
  };
}
