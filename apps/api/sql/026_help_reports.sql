-- What someone saw when they asked for help (owner, 2026-10-31: "a help icon so that it takes a direct state of
-- everything on the application and loads it somewhere where you can and Codex can always reach to see issues;
-- however, that data needs to be protected"). The row holds the whole report; its screenshot and a copy of the report
-- go to the private media bucket under help/ (never served publicly), where the team reads them. A report is pending
-- until both copies are stored, its picture waiting in the row meanwhile so a failed upload is retried from here
-- (help.ts sweepHelp); then it's complete and the row lets the picture go. Deleting the account deletes its reports,
-- and help_deletions holds their private copies until those are gone from the bucket too.
create table if not exists help_reports (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  report jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  screen bytea,
  has_screen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists help_reports_user_created on help_reports (user_id, created_at desc);
create index if not exists help_reports_pending on help_reports (created_at) where status = 'pending';

-- Reports a person has sent each UTC day, counted up in one statement so two at once can't both take the last one.
create table if not exists help_quota (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  sent int not null,
  primary key (user_id, day)
);

-- Private copies of reports whose account was deleted, until both of a report's files are gone from the bucket.
create table if not exists help_deletions (
  id uuid primary key,
  attempts int not null default 0,
  queued_at timestamptz not null default now()
);
