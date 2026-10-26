create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_codes_email_created on email_codes (email, created_at desc);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  refresh_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user on sessions (user_id);

-- Every Meta call is logged before its result is used, so the daily and total caps hold.
create table if not exists spend_ledger (
  id bigserial primary key,
  user_id uuid references users (id) on delete set null,
  model text not null,
  kind text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  searches integer not null default 0,
  cost_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);
create index if not exists spend_ledger_created on spend_ledger (created_at);
create index if not exists spend_ledger_user_created on spend_ledger (user_id, created_at);
