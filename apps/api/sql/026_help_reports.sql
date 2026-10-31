-- What someone saw when they asked for help (owner, 2026-10-31: "a help icon so that it takes a direct state of
-- everything on the application and loads it somewhere where you can and Codex can always reach to see issues;
-- however, that data needs to be protected"). The row holds the whole report; its screenshot and a copy of the report
-- go to the private media bucket under help/ (never served publicly), where the team reads them. Deleting the account
-- deletes its reports.
create table if not exists help_reports (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  report jsonb not null,
  has_screen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists help_reports_user_created on help_reports (user_id, created_at desc);
