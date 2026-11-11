# Phase 2 local review packet

Branch codex/dandelist-phase2-20261111 from origin/main ffe8ae98312514a7f1843271c3e69b1e4f7e1521. Local review by the Claude lane; no push or PR. The three ordered commits cover shared spend reservations (030), provider-neutral app-owned history (031), and disabled server-authoritative entitlements (032).

Read phase2-reservations.md, phase2-model-adapter.md and phase2-entitlements.md for invariants, migration behavior, test scope and limits. All migrations were run only on disposable PGlite databases. Existing migration-runner behavior is unchanged. No account consent middleware or app UI change was made. MODEL_HISTORY_ENABLED and ENTITLEMENTS_ENABLED are false by default. The entitlement service is not mounted on any app route; there is no production entitlement gate, webhook, paywall or purchase path.

Provisional product decisions encoded only in internal constants/fixtures: $9.99/month, $79.99/year, 14-day trial, twenty paid hunts per UTC calendar month and ten per trial. Meta remains the default hunt provider; new adapters are interfaces, not new paid runtimes. Final prices, launch, processor disclosures and live integration need separate explicit approval.

Verification commands:

```
corepack pnpm typecheck
node apps/mobile/scripts/check-type.mjs
corepack pnpm --filter @dandelist/api exec vitest run test/spend.test.ts test/model-adapter.test.ts test/entitlements.test.ts test/storekit-config.test.ts --maxWorkers=2 --minWorkers=1
corepack pnpm test
git diff --check
```

The authoritative dated results and exact commit IDs are appended after each commit in C:/Users/Copper Mile/knight-reports/codex-handoff/reports/Dandelist Build.md. Gate logs are held outside the repository under that handoff's scratch/dandelist-phase2/ directory. No real credentials, keys, token files or provider payloads were read. Certificate signing keys are generated only inside tests and immediately removed from their verified temporary directory.

Apple Small Business Program status: UNKNOWN. Ego task37 visited https://developer.apple.com/account/ and reached "Sign In - Apple". Stopped and closed its own task space; no sign-in, enrollment, agreement or account action occurred. Do not assume 15% commission. StoreKit Xcode execution, real store sandbox purchases/restores, real notification transport/reconciliation, multi-instance Postgres load and live provider history parity remain unverified. No store products, keys, service accounts, agreements, permissions, paid services, production migrations or deployment were created.
