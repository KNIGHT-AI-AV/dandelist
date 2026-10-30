-- Team accounts (owner, 2026-10-30): his own testing hit the one-person daily research allowance twice in a day, and a
-- hunt that stops on a cap reads to him as the app failing. A team account gets the shared judge account's allowance
-- (a bounded share of the service's daily cap, and its run count); the service's own caps still bind everyone. Set by
-- hand, never by the app. Additive: false for every row that exists.
alter table users add column if not exists team boolean not null default false;
