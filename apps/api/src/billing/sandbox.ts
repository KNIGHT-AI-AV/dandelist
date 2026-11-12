import type { Db } from "../db";
import type { Env } from "../env";
import { EntitlementService } from "../entitlements";
import { AppleVerifier, Environment } from "./apple";
import { PlaySubscriptionClient } from "./play-client";
import { playIdentity } from "./play-identity";
import type { BillingRoutesOptions } from "./routes";

/** Only the isolated non-production service may construct store-verification transport. */
export function sandboxBilling(env: Pick<Env, "NODE_ENV" | "BILLING_SANDBOX_ENABLED" | "PLAY_SERVICE_ACCOUNT_JSON">, db: Db): BillingRoutesOptions | undefined {
  if (!env.BILLING_SANDBOX_ENABLED) return undefined;
  if (env.NODE_ENV === "production") throw new Error("Billing sandbox transport is development-only");
  const apple = new AppleVerifier({ bundleId: "com.knightaiav.dandelist", environment: Environment.SANDBOX });
  const google = env.PLAY_SERVICE_ACCOUNT_JSON
    ? new PlaySubscriptionClient(playIdentity(env.PLAY_SERVICE_ACCOUNT_JSON), fetch, { sandboxOnly: true }) : undefined;
  return {
    enabled: true, apple: true, google: !!google,
    service: new EntitlementService(db, { enabled: true, apple, google, packageName: "com.knightaiav.dandelist" }),
  };
}
