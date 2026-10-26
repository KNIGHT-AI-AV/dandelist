create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('buy', 'own', 'do', 'visit')),
  -- How much the person wants it; plans spend on "must" before "nice" before "dream".
  tier text not null default 'nice' check (tier in ('must', 'nice', 'dream')),
  upfront_cents bigint not null default 0 check (upfront_cents >= 0),
  -- [{ "amountCents": 3000, "period": "month", "label": "membership" }]
  recurring jsonb not null default '[]'::jsonb,
  resale_cents bigint check (resale_cents is null or resale_cents >= 0),
  -- What the Meta model learned about the wish: specifics, open questions and the answers given.
  details jsonb not null default '{}'::jsonb,
  image_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wishes_user_created on wishes (user_id, created_at desc);
