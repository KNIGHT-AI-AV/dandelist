# AWS infrastructure

Dandelist's API, database and media storage run on AWS, paid from the account's startup credits.

- `deploy-policy.json`: the IAM policy for the deploy-only user. Replace `ACCOUNT_ID` before creating it.
- `whoami.ts`: checks the deploy key works (`pnpm --filter @dandelist/infra-aws whoami`).
- `up.ts`: provisions the database secret, Postgres and the media bucket (`pnpm --filter @dandelist/infra-aws run provision`). Safe to re-run.

The deploy key is read from the local vault at run time and is never stored in this repo.
