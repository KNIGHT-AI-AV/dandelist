-- Every admission/settlement is a single statement/transaction, including through pg.Pool.
-- One short mutex serializes both provider pools and rolling account/feature caps. Never held over inference.
create table spend_mutex (id integer primary key check (id = 1));
insert into spend_mutex values (1);
create table spend_reservations (
  id uuid primary key,
  pool text not null check (pool in ('meta','claude')),
  user_id text,
  scope text,
  usd numeric(12,6) not null check (usd >= 0),
  mine_usd numeric(12,6) not null check (mine_usd >= 0),
  state text not null default 'held' check (state in ('held','settled','released','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
create index spend_reservations_live on spend_reservations (pool, state, expires_at);
alter table spend_ledger add column reservation_id uuid unique;

-- Bootstrap once; admission must never sum the lifetime ledger under the mutex.
create function spend_pool(p_model text) returns text language sql immutable as $$
  select case when p_model like 'apify:%' then null when p_model like 'claude-%' then 'claude' else 'meta' end
$$;
create table spend_pool_totals (pool text primary key check (pool in ('meta','claude')), usd numeric not null);
insert into spend_pool_totals(pool,usd)
  select pools.pool,coalesce(sum(l.cost_usd),0) from (values ('meta'),('claude')) pools(pool)
  left join spend_ledger l on spend_pool(l.model)=pools.pool group by pools.pool;
-- Ledger triggers also cover unreserved usage, corrections and deletes. Settlement's insert
-- updates these totals inside the same transaction as retiring the hold.
create function spend_update_totals() returns trigger language plpgsql as $$
begin
  if tg_op='TRUNCATE' then update spend_pool_totals set usd=0;return null;end if;
  if tg_op<>'INSERT' then update spend_pool_totals set usd=usd-old.cost_usd where pool=spend_pool(old.model);end if;
  if tg_op<>'DELETE' then update spend_pool_totals set usd=usd+new.cost_usd where pool=spend_pool(new.model);end if;
  return null;
end $$;
create trigger spend_totals_changed after insert or update of model,cost_usd or delete on spend_ledger
  for each row execute function spend_update_totals();
create trigger spend_totals_truncated after truncate on spend_ledger
  for each statement execute function spend_update_totals();

create function spend_reserve(p_id uuid, p_pool text, p_user text, p_scope text, p_usd numeric,
  p_mine numeric, p_ttl_ms integer, p_policies jsonb) returns text language plpgsql as $$
declare p jsonb; spent numeric; total numeric; pending numeric; extra numeric; cap numeric;
begin
  perform id from spend_mutex where id = 1 for update;
  if exists (select 1 from spend_reservations where id = p_id) then
    raise exception 'Reservation ID already used';
  end if;
  update spend_reservations set state = 'expired' where state = 'held' and expires_at <= clock_timestamp();
  if p_user is not null and (select count(*) from spend_reservations where pool = p_pool and user_id = p_user and state = 'held') >= 8 then return 'slots'; end if;
  for p in select value from jsonb_array_elements(p_policies) loop
    -- Keep the timestamp bound in WHERE so spend_ledger_created can bound the scan.
    if coalesce((p->>'exclusive')::boolean,false) then
      select coalesce(sum(cost_usd),0) into spent from spend_ledger where created_at > (p->>'since')::timestamptz
        and (case when p->>'pool' = 'claude' then model like 'claude-%' else model not like 'claude-%' and model not like 'apify:%' end)
        and (p->>'type' <> 'user' or user_id::text = p->>'userId')
        and (p->>'type' <> 'scope' or (user_id is null and kind like (p->>'scope') || '%'));
    else
      select coalesce(sum(cost_usd),0) into spent from spend_ledger where created_at >= (p->>'since')::timestamptz
        and (case when p->>'pool' = 'claude' then model like 'claude-%' else model not like 'claude-%' and model not like 'apify:%' end)
        and (p->>'type' <> 'user' or user_id::text = p->>'userId')
        and (p->>'type' <> 'scope' or (user_id is null and kind like (p->>'scope') || '%'));
    end if;
    select coalesce(sum(case when p->>'type' = 'user' then mine_usd else usd end),0) into pending from spend_reservations where
      state = 'held' and pool = p->>'pool' and expires_at > clock_timestamp()
      and (p->>'type' <> 'user' or user_id = p->>'userId')
      and (p->>'type' <> 'scope' or scope = p->>'scope');
    extra := case when p->>'pool' <> p_pool then 0
      when p->>'type' = 'user' then case when p->>'userId' = p_user then p_mine else 0 end
      when p->>'type' = 'scope' then case when p->>'scope' = p_scope then p_usd else 0 end else p_usd end;
    if p->>'type' = 'global' and p->>'total' is not null then
      select usd into strict total from spend_pool_totals where pool=p->>'pool';
      cap := (p->>'total')::numeric;
      if total >= cap or total + pending + extra > cap then return 'total'; end if;
    end if;
    cap := (p->>'cap')::numeric;
    spent := spent + coalesce((p->>'extra')::numeric,0);
    if spent >= cap or spent + pending + extra > cap then
      return case when p->>'type' = 'user' then 'user' else 'daily' end;
    end if;
  end loop;
  insert into spend_reservations(id,pool,user_id,scope,usd,mine_usd,expires_at)
    values(p_id,p_pool,p_user,p_scope,p_usd,p_mine,clock_timestamp() + p_ttl_ms * interval '1 millisecond');
  return 'ok';
end $$;

create function spend_release(p_id uuid) returns void language plpgsql as $$
begin
  perform id from spend_mutex where id = 1 for update;
  update spend_reservations set state = 'released' where id = p_id and state = 'held';
end $$;

create function spend_renew(p_id uuid,p_ttl_ms integer) returns boolean language plpgsql as $$
declare n integer;
begin
  perform id from spend_mutex where id = 1 for update;
  update spend_reservations set expires_at = clock_timestamp() + p_ttl_ms * interval '1 millisecond'
    where id = p_id and state = 'held' and expires_at > clock_timestamp();
  get diagnostics n = row_count;
  return n = 1;
end $$;

create function spend_settle(p_id uuid,p_user uuid,p_kind text,p_model text,p_input integer,p_output integer,
  p_searches integer,p_cost numeric,p_at timestamptz) returns boolean language plpgsql as $$
declare r spend_reservations%rowtype;
begin
  perform id from spend_mutex where id = 1 for update;
  select * into r from spend_reservations where id = p_id;
  if not found then raise exception 'Unknown reservation'; end if;
  if p_user is not null and r.user_id is null and not exists (select 1 from users where id = p_user) then p_user := null; end if;
  if r.user_id is distinct from p_user::text or (r.pool = 'claude') <> (p_model like 'claude-%') or p_model like 'apify:%' or p_cost < 0 then
    raise exception 'Settlement does not match reservation';
  end if;
  if exists (select 1 from spend_ledger where reservation_id = p_id) then
    if not exists (select 1 from spend_ledger where reservation_id = p_id and model = p_model and kind = p_kind
      and cost_usd = p_cost and input_tokens = p_input and output_tokens = p_output and searches = p_searches) then
      raise exception 'Conflicting settlement';
    end if;
    return false;
  end if;
  -- Late usage is still recorded: never hide a provider charge when a lease/request expired.
  insert into spend_ledger(user_id,model,kind,input_tokens,output_tokens,searches,cost_usd,created_at,reservation_id)
    values(p_user,p_model,p_kind,p_input,p_output,p_searches,p_cost,p_at,p_id);
  update spend_reservations set state = 'settled' where id = p_id;
  return true;
end $$;

-- Remove the opaque account identifier on deletion while keeping settlement dedupe/audit IDs.
create function anonymize_spend_reservations() returns trigger language plpgsql as $$
begin
  update spend_reservations set user_id = null where user_id = old.id::text;
  return old;
end $$;
create trigger spend_reservations_account_deleted before delete on users for each row execute function anonymize_spend_reservations();
