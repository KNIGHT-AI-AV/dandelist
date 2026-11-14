-- Add per-run admission under the existing shared mutex; preserve all history/settlement rows.
create index spend_reservations_scope on spend_reservations(scope);
create or replace function spend_reserve(p_id uuid, p_pool text, p_user text, p_scope text, p_usd numeric,
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
    if p->>'type' = 'run' and (select count(*) from spend_reservations where pool=p_pool and scope=p->>'scope') >= (p->>'calls')::integer then return 'daily'; end if;
    -- Keep the timestamp bound in WHERE so spend_ledger_created can bound the scan.
    if coalesce((p->>'exclusive')::boolean,false) then
      select coalesce(sum(cost_usd),0) into spent from spend_ledger where created_at > (p->>'since')::timestamptz
        and (case when p->>'pool' = 'claude' then model like 'claude-%' else model not like 'claude-%' and model not like 'apify:%' end)
        and (p->>'type' <> 'user' or user_id::text = p->>'userId')
        and (p->>'type' <> 'scope' or (user_id is null and kind like (p->>'scope') || '%'))
        and (p->>'type' <> 'run' or reservation_id in (select id from spend_reservations where scope=p->>'scope'));
    else
      select coalesce(sum(cost_usd),0) into spent from spend_ledger where created_at >= (p->>'since')::timestamptz
        and (case when p->>'pool' = 'claude' then model like 'claude-%' else model not like 'claude-%' and model not like 'apify:%' end)
        and (p->>'type' <> 'user' or user_id::text = p->>'userId')
        and (p->>'type' <> 'scope' or (user_id is null and kind like (p->>'scope') || '%'))
        and (p->>'type' <> 'run' or reservation_id in (select id from spend_reservations where scope=p->>'scope'));
    end if;
    select coalesce(sum(case when p->>'type' = 'user' then mine_usd else usd end),0) into pending from spend_reservations where
      state = 'held' and pool = p->>'pool' and expires_at > clock_timestamp()
      and (p->>'type' <> 'user' or user_id = p->>'userId')
      and (p->>'type' not in ('scope','run') or scope = p->>'scope');
    extra := case when p->>'pool' <> p_pool then 0
      when p->>'type' = 'user' then case when p->>'userId' = p_user then p_mine else 0 end
      when p->>'type' in ('scope','run') then case when p->>'scope' = p_scope then p_usd else 0 end else p_usd end;
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
