-- The person's own order for their list (owner, 2026-10-30: the agent should be able to "change the list and manage
-- list for things like reorder"). Null means never arranged, and nulls sort first, so a new wish still lands on top
-- as it always has. Additive: every existing row keeps its place (newest first).
alter table wishes add column if not exists list_position integer;
