# Phase 3 local drafts

Branch codex/dandelist-phase3-20261111 starts at fresh origin/main 92a94f0cc201251b7f9297e20504984ac981edff, the squash merge of #258. Nothing in this packet is pushed, deployed or connected to real purchases.

History: see ../docs/phase3-history.md. The proposed temporary-context lifetime is 30 days per copy, with size/item bounds and conversation/account deletion cascades. Older dream chats already rebuild context from saved transcript entries. Meta's public documentation does not give a fixed response-ID lifetime; this policy is an app draft, not a Meta guarantee. Cleanup still runs when generation is disabled, so turning the flag off does not strand earlier copies. Migration 033 is additive; only disposable PGlite has run it.

Privacy/terms source remains apps/mobile/lib/legal.ts, rendered at /legal with /privacy and /terms redirects. The new drafts/legal.ts selector returns those exact arrays and dates when MODEL_HISTORY_ENABLED is false. The extra sections/date appear only in its history-enabled lane. Both draft client flags in drafts/features.ts and both API env defaults remain false. A coordinated client/server release must include this legal text before enabling history; merely changing a server flag is not an approved rollout. The existing account AI-consent gate is unchanged.

The native trial/paywall components live in apps/mobile/components/drafts. They follow Phase 1's sign-in -> account consent -> trial -> first useful plan -> optional offer sequence. On expiry, new premium work waits at the offer while saved plans remain read-only. Sign-in, reads, export, deletion, privacy and cancellation bypass entitlement checks, including after service failure. The UI rechecks the injected service at admission; device time never grants access. iPhone uses a separate Apple introductory-offer interface, including confirmed/cancelled/ineligible outcomes. Android/web use the separate 14-day no-card trial interface. Subscription prices are Pending with no checkout action. The sample camera costs are safe plan fixtures, not subscription prices.

These are working fixture UI drafts, not a production entitlement integration. No root navigator, consent provider, purchase SDK, billing route, store product/key/service account or store configuration was added. The existing development /lab?only=entitlements entry also requires the draft entitlement flag; it renders nothing while that flag is false. The standalone preview explicitly enables only the fixture component. It neither signs in nor records account consent and cannot grant a real entitlement.

Run from the repository root:

```
corepack pnpm exec vite --config phase3/preview/vite.config.mjs
```

Then open http://127.0.0.1:8562/. The preview reuses the app's React Native components, palette/type tokens and local font files, with a small web theme adapter. It loads no env files, uses no external resources and has no provider/store transport. Reset/platform controls create fresh fixtures. Advance to trial end changes the fixture service clock. Sample Apple decisions resolve only the injected fixture callback. Keep those preview controls out of the production journey.

copy.draft.json contains every new UI/legal string. The actual aitextclean.com Copy Output was read from the Windows system clipboard and pasted into apps/mobile/lib/drafts/copy.json with LF line endings. cleaner-receipt.json records its hash, 8-on/2-off options and two cleaning passes (the second clarified cleanup wording). Unit tests verify that receipt against the imported artifact. No handwritten substitute output was used.

browser-verification.json records 17 observed checks, including first value before offer, Pending prices, six free actions after expiry, Android flow, Apple cancellation/ineligibility/confirmation, verified 320/390/1440 CSS-pixel widths, no horizontal overflow and no external resource loads. evidence/ contains the inspected screenshots. This is browser fixture evidence, not physical-device, StoreKit or Play acceptance.

Required gates are full workspace typecheck, apps/mobile/scripts/check-type.mjs, and the API and mobile package test scripts (both set maxWorkers=2). The final receipt records the actual results. Before enabling anything: Claude review, the owner's final terms/prices and launch decisions, real authoritative transports and purchase/restore/reconciliation validation, the offline OCSP decision, and a separate production-deploy GO. None is inferred from these local drafts.
