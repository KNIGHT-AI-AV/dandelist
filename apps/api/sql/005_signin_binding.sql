-- Tickets are bound to the app that started the sign-in: it must show the verifier behind this challenge to redeem.
-- Tickets live 60 seconds, so any left over from before this change are simply dropped.
delete from oauth_tickets;
alter table oauth_tickets add column if not exists client_challenge text not null;

-- Single-use nonces for native Sign in with Apple, so a captured identity token can't be replayed. Stored hashed.
create table if not exists apple_nonces (
  id uuid primary key default gen_random_uuid(),
  nonce_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists apple_nonces_expires on apple_nonces (expires_at);
