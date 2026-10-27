-- One row per price-research run by the Meta agent. The app polls it while the agent works, the steps show
-- the agent's trail (searched, opened, checked, priced), and a finished run doubles as a 24-hour cache.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  cache_key text not null,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  draft jsonb not null,
  answers jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_runs_user_created on agent_runs (user_id, created_at desc);
create index if not exists agent_runs_cache on agent_runs (user_id, cache_key, created_at desc);
