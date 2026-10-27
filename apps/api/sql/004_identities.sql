-- A person's Google, GitHub or Apple account, tied to their Dandelist user. The provider's subject is the stable key;
-- the email is what the provider reported when the link was made.
create table if not exists user_identities (
  provider text not null check (provider in ('google', 'github', 'apple')),
  subject text not null,
  user_id uuid not null references users (id) on delete cascade,
  email text,
  -- Apple shares the name only on the very first sign-in, so it is kept here when given.
  name text,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index if not exists user_identities_user on user_identities (user_id);

-- One-time tickets that carry a finished social sign-in back to the app. Stored hashed, valid for 60 seconds, used once.
create table if not exists oauth_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_hash text not null unique,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oauth_tickets_expires on oauth_tickets (expires_at);
