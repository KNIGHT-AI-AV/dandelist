# Release checks and consent

Use the public check for the first release-health pass:

```powershell
$env:API_URL = 'https://api.dandelist.knightaiav.com'
corepack pnpm --filter @dandelist/infra-aws run smoke:public
```

This command reads only GET /healthz, /config/features, /auth/providers and /me/consent. It supplies no cookies or authorization, rejects redirects, and bounds each request to 15 seconds. It expects the consent endpoint to require authentication. It imports no credential loader and starts no AI work. A boolean chatContinuity value is valid in either state; reporting health does not approve enablement or establish a deployed source SHA.

The existing authenticated `smoke` command still uses the designated test account and its existing secret-loading path. It now reads the account's current consent before creating a fixture wish. If acceptance is missing, it checks that a protected read is refused, reports the run incomplete, and signs out. It never accepts consent. An account owner must review and accept the actual notice in the app before a later authenticated run can exercise the wish flow.

When consent is present, a fixture is created and listed, then removed in a finally block. A failed create does not issue reads or deletes with an invalid ID. Sign-out also runs after an account-check exception. Model requests remain opt-in through exactly AGENT=1 and need separate spending authority; a missing consent still prevents that request. Logs contain status results, not model text, tokens or server response bodies.

Offline tests inject response fixtures: no credential imports, real sign-ins, account mutations or model calls. The public checks can run against the live API at $0 in model charges. Real store purchases, provider quality, multi-instance load and native acceptance need their own evidence.

## Prepare the web artifact

`node apps/mobile/scripts/deploy-web.mjs --build-only` runs the existing export and packaging checks, then stops before invoking the Pages upload. It needs no publishing credential. The normal command without that flag keeps its existing publication behavior and still requires the release authorization. Unknown arguments fail before starting a build. Use a clean, committed worktree for the final release artifact so latest.json identifies the actual source; a dirty development build labels itself accordingly.
