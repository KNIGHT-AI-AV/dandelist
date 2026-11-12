# Isolated store-verification sandbox

This sandbox is separate from the production API. Funding controls and configuration guards do not impose a cash hard cap. Keep the service paused between explicitly authorized test sessions.

## Resources

- Region us-east-1. App Runner `dandelist-api-sandbox`; its test-only URL is configured in the billing-internal profile. Select the expected account through `DANDELIST_SANDBOX_AWS_ACCOUNT_ID` in the operator's environment; verify it against the private funding receipt and actual STS identity. No account number or detailed funding/resource receipt belongs in this public source repository.
- Database `dandelist_sandbox` inside the existing `dandelist-db` instance; runtime login `dandelist_sandbox_app`. Existing RDS administrator retains database ownership; the application uses only the distinct new login. No production role membership or ACL was changed.
- Secrets Manager `dandelist/sandbox/database-url`, `jwt-secret`, `code-pepper`. Values are generated/consumed internally, never placed in a receipt or source file. Google identity will use `dandelist/sandbox/play-key` after its separate setup succeeds.
- Instance role `dandelist-apprunner-sandbox` trusts only App Runner tasks and can read only `dandelist/sandbox/*`. It has no media-bucket or production-secret permission. Existing ECR pull role is reused for read-only image access. New inline deploy-user permission passes only this new role; existing policies are unmodified.
- 0.25vCPU /0.5GB; maximum one instance; automatic deployments off. Staging environment, sandbox transport on, history and production premium admission at false defaults. No AI, Anthropic, Apify, mail-provider, analytics or media credential supplied.

## Source and device boundaries

The initial deployed image is built from reviewed main `bfbd681444a83f8aeb1102e9e06fbf1a3564b375`, tagged only `sandbox-bfbd681444a8`; the production `latest` tag and running digest are untouched. That image contains Apple's existing sandbox verifier and no Google credential supplier. This branch adds the supplier, but it is not deployed until reviewed main contains it. Android must remain unavailable until both the reviewed code and scoped service-account credential are present. Google test mode additionally rejects responses without the provider's test-purchase marker. It never acknowledges, cancels, refunds, consumes or edits an order through the server API.

Only `billing-internal` points at the new URL; production and APK profiles stay on the existing production API. No new native build or store rollout is implied by this configuration change. The unpublished Android30 draft and existing TF53 both predate this new sandbox target; TF53 also predates native billing. Do not call either a verified purchase-test build.

The existing TestFlight link is https://testflight.apple.com/join/tuh4Jxkw (Dandelist Beta). Reuse it and existing groups/testers. The owner explicitly does not add testers: creating a Sandbox Apple Account is not a prerequisite. TestFlight operates in Apple's sandbox automatically. Record link/build availability, account-specific trial eligibility, signed purchase verification and restore separately. Special renewal/reset controls require separate testing resources and are outside this existing-link workflow. Reference: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight/.

Email sign-in without a configured mail provider uses the existing development console mailer; do not copy its codes into reports or chat. Native Apple sign-in uses the existing bundle audience without an additional provider secret. Authentication and consent remain mandatory for billing transport; health alone proves neither a signed-in purchase nor consent. No consent is automatically accepted by these operations.

## Guarded operations

Use `pnpm --filter @dandelist/infra-aws sandbox <data|build|create|status|pause> --receipt <private-output.json>`, adding `--gate <private-verified-receipt.json>` for data/build/create and `--image <full ECR digest>` for create. Resource creation requires a fresh observed money-gate receipt, eligible unexpired credit and verified $1 actual/$5 forecast notifications. Status/pause remain available without a funding receipt so an expired credit or stale observation cannot block shutdown. Every command verifies the expected AWS identity; status/pause accept only the exact sandbox service ARN. Create refuses any existing sandbox rather than replacing it. Initial health checks run once before an automatic pause in `finally`; inspect the pause result even if another check fails.

The database operation checks the fixed DB/user/host before DDL, persists a recoverable generated password before creating the restricted login, marks its new database, revokes PUBLIC rights only on that new database, grants new-schema creation to its new runtime login and migrates only that database. A production metadata-only check verifies no table/sequence, schema-create or security-definer-function privileges; PUBLIC CONNECT can remain inherited from the existing production ACL, but does not grant application data access. No production rows are selected and no production ACL is changed. Do not rerun data initialization against a different URL or adopt an unmarked existing DB.

`sandbox-iam.sh` is for an account-admin CloudShell, not the restricted deploy identity. It creates only the dedicated sandbox role/policy and sandbox pass-role permission, and refuses to overwrite an existing role. Do not run `up.ts`, `deploy.ts`, `admin-setup.sh` or any production release-journal operation for this service.

Actual resource receipts, credit and budget evidence, health and final paused status are in the private Dandelist Build report. Google Cloud may require interactive organization reauthentication for the new service account; that block does not prevent this Apple/TestFlight workflow, and must not cause a new tester request.
