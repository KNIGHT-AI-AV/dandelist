-- The same licensed photograph may legitimately illustrate more than one entity, such as Positano and
-- the Amalfi Coast. Approval votes and hero selection belong to the entity/photo association.
create unique index if not exists archive_photos_entity_url on archive_photos (entity_id, url);
alter table archive_photos drop constraint if exists archive_photos_url_key;

-- The former global-URL upsert could mix votes from different subjects. Their original subject cannot be
-- recovered from the old array, so preserve that history and require fresh matching-subject votes.
-- Seed photographs keep their reviewed approval; rejected photographs remain rejected.
create table if not exists archive_photo_vote_resets (
  photo_id uuid primary key references archive_photos (id) on delete cascade,
  previous_status text not null,
  previous_vouchers text[] not null,
  reset_at timestamptz not null default now()
);

with recorded as (
  insert into archive_photo_vote_resets (photo_id, previous_status, previous_vouchers)
    select id, status, vouchers from archive_photos where contributed_by <> 'seed'
    on conflict (photo_id) do nothing
    returning photo_id
)
update archive_photos
  set vouchers = '{}', status = case when status = 'approved' then 'pending' else status end
  where id in (select photo_id from recorded);
