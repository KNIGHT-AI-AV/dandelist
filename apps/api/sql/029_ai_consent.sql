-- An account's acceptance of how Dandelist uses AI, with the 18-or-older confirmation (App Store guideline 5.1.2(i);
-- Meta's Model API terms §10.1). The owner, 2026-11-06: the first thing after making an account or signing in, kept
-- per account across devices. Null until the account accepts: nothing is backfilled, so no account counts as having
-- accepted before it does.
alter table users add column if not exists ai_consent_version integer;
alter table users add column if not exists ai_consent_at timestamptz;
