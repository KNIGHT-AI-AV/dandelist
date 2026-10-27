# AWS infrastructure

Dandelist's API, database and media storage run on AWS, paid from the account's startup credits.

- `deploy-policy.json`: the IAM policy for the deploy-only user. Replace `ACCOUNT_ID` before creating it.
- `whoami.ts`: checks the deploy key works (`pnpm --filter @dandelist/infra-aws whoami`).
- `up.ts`: provisions the database secret, Postgres and the media bucket (`pnpm --filter @dandelist/infra-aws run provision`). Safe to re-run.

- `deploy.ts`: builds the API image from `main` and deploys it to App Runner (`pnpm --filter @dandelist/infra-aws run deploy`).

Google and GitHub sign-in turn on when their client secrets exist in Secrets Manager as
`dandelist/api/google-client-secret` and `dandelist/api/github-client-secret` (plain string values). The deploy only
reads them; it never creates them. Client IDs are not secret: pass `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID` and
`APPLE_SERVICES_ID` to a deploy as environment variables, and later deploys keep the values the service already has.
Native Sign in with Apple on iOS needs no settings.

The deploy key is read from the local vault at run time and is never stored in this repo.
