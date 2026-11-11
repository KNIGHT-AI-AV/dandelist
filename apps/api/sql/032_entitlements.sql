create table entitlements (
  user_id uuid primary key references users(id) on delete cascade,
  state text not null default 'none' check(state in ('none','trialing','active','grace','expired','revoked')),
  platform text check(platform in ('web','android','ios')),
  product text,
  original_transaction_id text,
  expires_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_platform text,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
create table entitlement_purchases (
  platform text not null check(platform in ('android','ios')),
  external_key text not null,
  user_id uuid not null references users(id) on delete cascade,
  original_transaction_id text not null,
  product text not null,
  state text not null check(state in ('none','trialing','active','grace','expired','revoked')),
  expires_at timestamptz not null,
  event_at timestamptz not null,
  cancel_at_period_end boolean not null default false,
  primary key(platform,external_key)
);
create index entitlement_purchases_account on entitlement_purchases(user_id);
create table entitlement_events (
  platform text not null,
  event_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  received_at timestamptz not null default clock_timestamp(),
  primary key(platform,event_id)
);
create table entitlement_hunts (
  user_id uuid not null references users(id) on delete cascade,
  request_id text not null,
  fingerprint text not null,
  period_key text not null,
  admitted_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id)
);
create index entitlement_hunts_period on entitlement_hunts(user_id,period_key);

create function entitlement_refresh(p_user uuid) returns entitlements language plpgsql as $$
declare e entitlements%rowtype; p entitlement_purchases%rowtype;
begin
  insert into entitlements(user_id)values(p_user)on conflict do nothing;
  select * into e from entitlements where user_id=p_user for update;
  select * into p from entitlement_purchases where user_id=p_user and state in ('active','grace','trialing') and expires_at>clock_timestamp()
    order by case state when 'active' then 3 when 'grace' then 2 else 1 end desc,expires_at desc,event_at desc limit 1;
  if found then
    update entitlements set state=p.state,platform=p.platform,product=p.product,original_transaction_id=p.original_transaction_id,
      expires_at=p.expires_at,cancel_at_period_end=p.cancel_at_period_end,updated_at=clock_timestamp() where user_id=p_user;
  elsif e.trial_platform in ('web','android') and e.trial_ends_at>clock_timestamp() and not exists(select 1 from entitlement_purchases where user_id=p_user and state<>'none') then
    update entitlements set state='trialing',platform=e.trial_platform,expires_at=e.trial_ends_at,updated_at=clock_timestamp()where user_id=p_user;
  else
    update entitlements set state=case when exists(select 1 from entitlement_purchases where user_id=p_user and state='revoked') then 'revoked'
      when e.trial_started_at is not null or exists(select 1 from entitlement_purchases where user_id=p_user) then 'expired' else 'none' end,
      updated_at=clock_timestamp()where user_id=p_user;
  end if;
  select * into e from entitlements where user_id=p_user;return e;
end $$;

create function entitlement_start_trial(p_user uuid,p_platform text) returns entitlements language plpgsql as $$
declare e entitlements%rowtype; t timestamptz;
begin
  if p_platform not in ('web','android') then raise exception 'Native Apple trial requires verified store transaction';end if;
  e:=entitlement_refresh(p_user);
  if e.trial_started_at is null and not exists(select 1 from entitlement_purchases where user_id=p_user) then
    t:=clock_timestamp();
    update entitlements set state='trialing',platform=p_platform,trial_platform=p_platform,
      trial_started_at=t,trial_ends_at=t+interval '14 days',expires_at=t+interval '14 days' where user_id=p_user;
  end if;
  return entitlement_refresh(p_user);
end $$;

create function entitlement_apply_event(p_user uuid,p_platform text,p_key text,p_event text,p_original text,p_product text,
  p_state text,p_expires timestamptz,p_event_at timestamptz,p_cancel boolean,p_trial_start timestamptz,p_trial_end timestamptz) returns boolean language plpgsql as $$
begin
  perform entitlement_refresh(p_user);
  if exists(select 1 from entitlement_purchases where platform=p_platform and external_key=p_key and user_id<>p_user)then raise exception 'Purchase already linked to another account';end if;
  insert into entitlement_events(platform,event_id,user_id)values(p_platform,p_event,p_user)on conflict do nothing;
  if not found then return false;end if;
  insert into entitlement_purchases(platform,external_key,user_id,original_transaction_id,product,state,expires_at,event_at,cancel_at_period_end)
    values(p_platform,p_key,p_user,p_original,p_product,p_state,p_expires,p_event_at,coalesce(p_cancel,false))
    on conflict(platform,external_key)do update set product=excluded.product,state=excluded.state,expires_at=excluded.expires_at,event_at=excluded.event_at,cancel_at_period_end=coalesce(p_cancel,entitlement_purchases.cancel_at_period_end)
    where entitlement_purchases.user_id=excluded.user_id and (excluded.event_at>entitlement_purchases.event_at or
      (excluded.event_at=entitlement_purchases.event_at and
        (case excluded.state when 'revoked' then 6 when 'expired' then 5 when 'grace' then 4 when 'active' then 3 else 2 end)>=
        (case entitlement_purchases.state when 'revoked' then 6 when 'expired' then 5 when 'grace' then 4 when 'active' then 3 else 2 end)));
  if exists(select 1 from entitlement_purchases where platform=p_platform and external_key=p_key and user_id<>p_user)then raise exception 'Purchase already linked to another account';end if;
  if p_state='trialing' and p_trial_start is not null and p_trial_end is not null then
    update entitlements set trial_started_at=coalesce(trial_started_at,p_trial_start),trial_ends_at=coalesce(trial_ends_at,p_trial_end),trial_platform=coalesce(trial_platform,p_platform)where user_id=p_user;
  end if;
  perform entitlement_refresh(p_user);return true;
end $$;

create function entitlement_admit_hunt(p_user uuid,p_request text,p_fingerprint text) returns text language plpgsql as $$
declare e entitlements%rowtype; k text; n integer; cap integer; previous text;
begin
  e:=entitlement_refresh(p_user);
  if e.state not in ('trialing','active','grace') or e.expires_at<=clock_timestamp()then return 'expired';end if;
  select fingerprint into previous from entitlement_hunts where user_id=p_user and request_id=p_request;
  if found then
    if previous<>p_fingerprint then raise exception 'Conflicting hunt idempotency key';end if;
    return 'duplicate';
  end if;
  -- One trial quota across platforms/reinstalls; paid annual and monthly accounts each get 20 per UTC calendar month.
  if e.state='trialing' then k:='trial';cap:=10;else k:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM');cap:=20;end if;
  select count(*) into n from entitlement_hunts where user_id=p_user and period_key=k;
  if n>=cap then return 'quota';end if;
  insert into entitlement_hunts(user_id,request_id,fingerprint,period_key)values(p_user,p_request,p_fingerprint,k);return 'admitted';
end $$;
