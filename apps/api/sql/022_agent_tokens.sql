-- Agent access (owner, 2026-10-29: "Build mcp for agent", "Needs full control (secure security for each account no
-- bleed)"). One key per agent a person connects to their own account. Only a keyed hash of each key is stored, and
-- each key has a session of its own: every call the agent makes runs as that person alone, and revoking the key (or
-- deleting the account) cuts the agent off at once.
create table if not exists agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists agent_tokens_user on agent_tokens (user_id);
