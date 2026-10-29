-- Notes and today's pick (owner, 2026-10-29: "users can click items and write notes to explain more details of why
-- they like this item and what it means to them... The AI can recall that as part of its memory", and "daily item
-- suggestions with notifications and banner pop up cards"). Additive only: two nullable columns on wishes and one new
-- table, so every row that exists keeps working.

-- Why the wish matters to the person, in their own words. Read only by its owner, like the rest of the row.
alter table wishes add column if not exists note text check (note is null or char_length(note) <= 600);
-- When the note was last written, so the agent's memory reads the newest notes first.
alter table wishes add column if not exists note_updated_at timestamptz;

-- Today's pick: at most one a day per person, for the date on their own phone. The row is claimed ('making') before
-- the model is asked, so two requests at once never make two picks. 'ready' is shown until the person answers
-- ('added' or 'skipped'); 'failed' may be tried again a few times that day; 'none' means no pick that day (a spend
-- cap was reached).
create table if not exists daily_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  day date not null,
  status text not null default 'making' check (status in ('making', 'ready', 'added', 'skipped', 'failed', 'none')),
  attempts integer not null default 1,
  title text check (title is null or char_length(title) between 1 and 120),
  kind text check (kind is null or kind in ('buy', 'own', 'do', 'visit')),
  why text,
  summary text,
  -- { "url", "width", "height", "source", "credit", "license" }: only a photo that passed the photo check
  photo jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists daily_picks_user_created on daily_picks (user_id, created_at desc);
