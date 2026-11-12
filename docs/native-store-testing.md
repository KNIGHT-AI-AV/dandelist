# Native store testing

This branch adds an internal purchase/restore lab and account-bound verification transport. Production billing and history remain off. It does not put a paywall on existing product routes or activate paid access.

## Build and connection

- `expo-iap` is pinned to 6.3.0. Android explicitly selects Play. The module's manifest contributes `com.android.vending.BILLING`; confirm the merged permission in the final bundle before uploading.
- The `billing-internal` EAS profile creates a store-format Android bundle with the internal lab compiled in. No automatic submission is configured. Ordinary builds redirect `/store-test` to `/` without connecting to the native SDK.
- The lab requires an existing sign-in, accepted account consent and an authenticated service response declaring that platform's verifier available. A missing route or verifier stops before a purchase sheet.
- `BILLING_SANDBOX_ENABLED=1` mounts the Apple sandbox verifier for local development only. Production rejects that flag while reading configuration, before opening the database. Google remains unavailable in the server entry point until a deployment-owned credential supplier is connected; the read-only Play client accepts an injected supplier and never changes Play subscriptions.
- The internal profile currently points at the existing production API, which has no billing transport. Its bundle can establish native compilation and unlock draft Play catalogue setup; it cannot establish a successful purchase round trip until a separately reviewed test API is configured.

## Purchase behavior

StoreKit uses `appAccountToken` equal to the signed-in user UUID. Play uses the SHA-256 of that UUID as `obfuscatedAccountId` and requires an explicitly selected store offer. Prices and offers come from the store catalogue. An Apple trial action requires a real fourteen-day free introductory offer and an eligibility check; it never falls through to a paid purchase.

Purchase dispatch does not grant access. Pending transactions wait. Purchased transactions go to the authenticated service, which verifies and persists ownership before the native transaction is finished. Receipt proof stays in memory and the HTTPS request body; no proof is added to logs, storage or status messages. Duplicate delivery is coalesced. Verification failure leaves the transaction unfinished for an explicit restore. Account changes close the connection, clear products and suppress delayed replies.

The access response describes entitlement state only. It is not quota admission for a new hunt. Existing source still needs production premium-work admission, authenticated notification transport and reconciliation, and real store/device acceptance before enablement.

Play access uses the current `offerPhase` reported by the Developer API, including free-trial proration. A current free trial remains `trialing` with the ten-hunt trial allowance even after cancellation while unexpired. A later paid phase becomes `active` with the twenty-hunt monthly allowance, preserving trial history. Missing/ambiguous phase data or invalid trial dates reject verification. The original offer ID cannot establish the current phase because it can remain after renewal. Reference: [SubscriptionPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2).

## Acceptance still required

1. Final Android bundle package/version, merged billing permission and signature verified; native iOS build verified with the existing minimum OS.
2. Store product and offer availability on a real signed-in test device.
3. Apple trial eligible/ineligible/cancel, purchase, restore and refund; Play test payment pending/success/cancel, purchase and restore.
4. Correct-account verification, account-switch/rebind rejection, interrupted network recovery and acknowledgement after persistence.
5. Authenticated notification delivery, duplicate/out-of-order renewal, expiry/refund/revocation and reconciliation against actual store state.
6. Reviewed server/client rollout with paid-access admission and independent launch authorization.

Fixture tests, a successful native build or draft console products do not satisfy these device and live-store checks. No real purchase or live entitlement enablement is claimed here.
