-- Temporary model context follows the saved conversation's ownership and deletion.
-- Existing unassociated copies remain account-scoped and expire under their original deadline.
alter table dream_sessions add constraint dream_sessions_id_user unique(id,user_id);
alter table model_turns add column session_id uuid;
alter table model_turns add constraint model_turns_session_owner
  foreign key(session_id,user_id) references dream_sessions(id,user_id) on delete cascade;
create index model_turns_session on model_turns(session_id,user_id);
