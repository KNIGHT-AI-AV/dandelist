-- What the Dandy remembers about a person from one conversation to the next (owner, 2026-10-31: "It needs to retain
-- that memory and retain its personality"): a few short lines drawn from what they say in the chat, read by the
-- concierge in every conversation and listed in Settings, where each one can be removed. Additive only: one new table.
-- The lines go with the account: deleting it deletes them.
create table if not exists dream_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  -- The conversation it came from; kept when that conversation is deleted, since the person can remove the line itself.
  session_id uuid references dream_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dream_memories_user on dream_memories (user_id, created_at desc);
-- Moves on every Forget (memory.ts forgetMemories): an update read before it never writes after it (review of #147).
alter table users add column if not exists memory_epoch integer not null default 0;
