-- App-owned, bounded, account-scoped Responses-style history. Enabled only by explicit dev flag.
create table model_turns (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  envelope jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
create index model_turns_expiry on model_turns(expires_at);
