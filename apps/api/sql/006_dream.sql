-- The dream builder: where someone wants to live, their chat sessions with the concierge, and cached evidence.

-- One row per person. Regional things (homes, staff, services, utilities, taxes) are priced for `home`.
create table if not exists life_context (
  user_id uuid primary key references users (id) on delete cascade,
  -- { "country": "MT", "region": null, "city": null, "label": "Malta" }, or null when not set yet
  home jsonb,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- { "adults": 2, "children": 1 }, when mentioned
  household jsonb,
  -- What set it last: 'chat:<session id>', 'chip' or 'settings'.
  updated_from text,
  updated_at timestamptz not null default now()
);

-- A concierge conversation. `state` holds the open widgets, search criteria, decks and swipes.
create table if not exists dream_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  transcript jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dream_sessions_user_updated on dream_sessions (user_id, updated_at desc);

-- Regional evidence the cost-to-keep estimator uses, such as Malta's property tax or a close-protection officer's
-- hourly rate in Bali. Shared by everyone and re-researched once it is 30 days old.
create table if not exists region_rates (
  region text not null,
  key text not null,
  -- { "amount": 0.42, "unit": "percent_of_value_per_year", "currency": "EUR", "quote": "...", "verified": true, ... }
  value jsonb not null,
  source_url text,
  checked_at timestamptz not null default now(),
  primary key (region, key)
);

-- Listing searches, keyed by a hash of the criteria, so the same search within 24 hours costs nothing.
create table if not exists listing_searches (
  key text primary key,
  kind text not null check (kind in ('home', 'car')),
  listings jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists listing_searches_created on listing_searches (created_at);
