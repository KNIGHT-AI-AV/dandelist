-- Today's pick in more depth (owner, 2026-11-01: "users can enter the card and see greater details, of which should
-- have been already generated on said card"): written in the same call that makes the pick, shown on its own page.
alter table daily_picks add column if not exists about text;
-- [{ "label", "value" }]: at most three short facts, like { "label": "Made by", "value": "Leica" }.
alter table daily_picks add column if not exists facts jsonb;
