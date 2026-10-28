-- The shared archive (owner, 2026-10-27): the things people want, with real photos and typical prices, so a wish
-- for something common gets premium photos at once instead of a fresh hunt. Seeded from the master list
-- (data/archive-seed.json, loaded at boot), then grown by the agents: freely licensed photos they find for a
-- subject are offered back and kept only when they pass src/archive/guard.ts.

create table if not exists archive_entities (
  -- kebab-case, e.g. 'porsche-911-carrera-992'
  id text primary key,
  domain text not null,
  category text not null,
  subcategory text not null,
  name text not null,
  aliases text[] not null default '{}',
  kind text not null,
  price_model text not null,
  -- { "low": 120000, "high": 180000, "currency": "USD", "unit": "new MSRP" }, an estimate shown as such
  typical jsonb,
  running jsonb,
  tier smallint not null default 3 check (tier between 1 and 3),
  regions text[] not null default '{US,EU}',
  -- 'seed' for the master list, 'agent' for one the agents proposed (kept 'pending' until a second person asks)
  origin text not null default 'seed' check (origin in ('seed', 'agent')),
  status text not null default 'live' check (status in ('live', 'pending', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists archive_entities_status on archive_entities (status);

create table if not exists archive_photos (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references archive_entities (id) on delete cascade,
  url text not null unique,
  width integer not null,
  height integer not null,
  -- where the licence came from: an API that reports it, never a scraped page
  source text not null check (source in ('commons', 'unsplash', 'pexels')),
  source_page text not null,
  photographer text,
  license text not null,
  hero boolean not null default false,
  status text not null default 'approved' check (status in ('approved', 'pending', 'rejected')),
  -- 'seed' or the user id whose agent found it
  contributed_by text not null default 'seed',
  created_at timestamptz not null default now()
);
create index if not exists archive_photos_entity on archive_photos (entity_id, status);

-- Which seed file was loaded last, so a boot reloads it only when it changes.
create table if not exists archive_seed_runs (
  version text primary key,
  entities integer not null,
  photos integer not null,
  loaded_at timestamptz not null default now()
);
