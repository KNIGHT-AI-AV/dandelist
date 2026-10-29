-- Chat history (owner, 2026-10-28): every conversation with the Dandy keeps a title, from the first thing the person
-- said, and a preview of its latest plain line, so the history list reads without loading every transcript.
alter table dream_sessions add column if not exists title text;
alter table dream_sessions add column if not exists preview text;

-- Conversations from before this migration. Bracketed user lines are the app's own notes ("[picked l_3]") and
-- lines with a widget are the concierge's notes to itself, so neither becomes a title or a preview.
update dream_sessions
set title = (
  select left(x.e ->> 'text', 80)
  from jsonb_array_elements(transcript) with ordinality as x(e, n)
  where x.e ->> 'role' = 'user' and left(x.e ->> 'text', 1) <> '['
  order by x.n
  limit 1
)
where title is null and jsonb_typeof(transcript) = 'array';

update dream_sessions
set preview = (
  select left(x.e ->> 'text', 140)
  from jsonb_array_elements(transcript) with ordinality as x(e, n)
  where x.e -> 'widget' is null and not (x.e ->> 'role' = 'user' and left(x.e ->> 'text', 1) = '[')
  order by x.n desc
  limit 1
)
where preview is null and jsonb_typeof(transcript) = 'array';
