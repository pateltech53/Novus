-- 0020 · An enterprise has an identity, and an owner can close it.
--
-- Basic information is private to its owner except for the institution name,
-- returned only to its own members through my_chapter_summary. Legacy and
-- operator-created licences may be unnamed until their owner completes setup.
-- Deletion clears the roster and its grants, never accounts or game progress.
-- A minimal subscription tombstone prevents a delayed webhook resurrecting a
-- deleted enterprise. All grant/delete/webhook paths lock the same chapter row.

begin;

alter table public.chapters
  add column if not exists name text,
  add column if not exists organization_type text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists deleted_at timestamptz;

alter table public.chapters drop constraint if exists chapters_profile_check;
alter table public.chapters add constraint chapters_profile_check check (
  (name is null or length(btrim(name)) between 1 and 100)
  and (organization_type is null or organization_type in ('school','university','club','company','other'))
  and (contact_name is null or length(btrim(contact_name)) between 1 and 100)
  and (contact_email is null or length(btrim(contact_email)) between 3 and 254)
);

create or replace function public.my_chapter_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.chapter_id from public.chapter_seats s
       join public.chapters c on c.id = s.chapter_id
      where s.profile_id = (select auth.uid()) and c.deleted_at is null),
    (select c.id from public.chapters c
      where c.owner_profile_id = (select auth.uid())
        and c.status = 'active' and c.deleted_at is null
      order by c.created_at desc limit 1)
  );
$$;

create or replace function public.my_chapter_summary()
returns table (id uuid, name text) language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name from public.chapters c
   where c.id = public.my_chapter_id() and c.deleted_at is null;
$$;
revoke execute on function public.my_chapter_summary() from public, anon;
grant execute on function public.my_chapter_summary() to authenticated, service_role;

create or replace function public.enforce_chapter_seat_cap()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c public.chapters%rowtype;
begin
  select * into c from public.chapters where id = new.chapter_id for update;
  if not found or c.deleted_at is not null or c.status <> 'active' then
    raise exception 'chapter is not active' using errcode = '23514';
  end if;
  if (select count(*) from public.chapter_seats s where s.chapter_id = c.id) >= c.seats then
    raise exception 'chapter is full: all % seats are taken', c.seats using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.grant_chapter_seat(p_profile uuid, p_licence text)
returns void language plpgsql
set search_path = public, pg_temp
as $$
declare cid uuid; c public.chapters%rowtype;
begin
  select chapter_id into cid from public.chapter_seats where profile_id = p_profile;
  select * into c from public.chapters where id = cid for update;
  if not found or c.deleted_at is not null or c.status <> 'active'
     or c.licence <> p_licence
     or not exists (select 1 from public.chapter_seats where profile_id = p_profile and chapter_id = cid) then
    raise exception 'an active chapter seat is required' using errcode = '23514';
  end if;
  insert into public.entitlements (profile_id, chapter) values (p_profile, c.licence)
  on conflict (profile_id) do update set chapter = excluded.chapter;
end;
$$;

create or replace function public.set_chapter_access(p_chapter uuid, p_active boolean)
returns void language plpgsql
set search_path = public, pg_temp
as $$
declare c public.chapters%rowtype;
begin
  select * into c from public.chapters where id = p_chapter for update;
  if not found then raise exception 'chapter % does not exist', p_chapter; end if;
  if p_active and c.deleted_at is null and c.status = 'active' then
    insert into public.entitlements (profile_id, chapter)
      select s.profile_id, c.licence from public.chapter_seats s where s.chapter_id = p_chapter
    on conflict (profile_id) do update set chapter = excluded.chapter;
  else
    update public.entitlements e set chapter = null from public.chapter_seats s
     where s.chapter_id = p_chapter and e.profile_id = s.profile_id;
  end if;
end;
$$;

-- The Stripe cancellation happens before this RPC. Retrying after a lost
-- response is safe, and the retained subscription id is never a live licence.
create or replace function public.delete_chapter(p_chapter uuid)
returns boolean language plpgsql
set search_path = public, pg_temp
as $$
declare c public.chapters%rowtype;
begin
  select * into c from public.chapters where id = p_chapter for update;
  if not found then return false; end if;
  if c.deleted_at is not null then return true; end if;
  perform public.set_chapter_access(p_chapter, false);
  delete from public.chapter_seats where chapter_id = p_chapter;
  update public.chapters set status = 'lapsed', deleted_at = now(),
    name = null, organization_type = null, contact_name = null, contact_email = null
   where id = p_chapter;
  return true;
end;
$$;
revoke execute on function public.delete_chapter(uuid) from public, anon, authenticated;
grant execute on function public.delete_chapter(uuid) to service_role;

-- Removing one member shares the subscription/delete lock too. Separate
-- revoke and DELETE requests allowed a renewal between them to regrant Pro
-- permanently to someone no longer present on the roster.
create or replace function public.remove_chapter_seat(p_chapter uuid, p_profile uuid)
returns boolean language plpgsql
set search_path = public, pg_temp
as $$
declare touched boolean;
begin
  perform 1 from public.chapters where id = p_chapter for update;
  if not found then return false; end if;
  delete from public.chapter_seats where chapter_id = p_chapter and profile_id = p_profile
  returning true into touched;
  if coalesce(touched, false) then perform public.revoke_chapter_seat(p_profile); end if;
  return coalesce(touched, false);
end;
$$;
revoke execute on function public.remove_chapter_seat(uuid,uuid) from public, anon, authenticated;
grant execute on function public.remove_chapter_seat(uuid,uuid) to service_role;

-- One transaction for the subscription row and every affected entitlement.
-- ON CONFLICT acquires the same lock deletion does. Profile data is initial
-- checkout input only; renewals cannot overwrite an owner's later edits.
create or replace function public.sync_chapter_subscription(
  p_owner uuid, p_subscription text, p_licence text, p_seats integer,
  p_active boolean, p_period_end timestamptz,
  p_name text default null, p_organization_type text default null,
  p_contact_name text default null, p_contact_email text default null
)
returns uuid language plpgsql
set search_path = public, pg_temp
as $$
declare cid uuid;
begin
  insert into public.chapters as c (
    owner_profile_id, stripe_subscription_id, licence, seats, status, current_period_end,
    name, organization_type, contact_name, contact_email
  ) values (
    p_owner, p_subscription, p_licence, p_seats,
    case when p_active then 'active' else 'lapsed' end, p_period_end,
    p_name, p_organization_type, p_contact_name, p_contact_email
  ) on conflict (stripe_subscription_id) do update set
    licence = excluded.licence, seats = excluded.seats, status = excluded.status,
    current_period_end = excluded.current_period_end
  where c.deleted_at is null and c.owner_profile_id = p_owner
  returning id into cid;
  if cid is null then return null; end if;
  perform public.set_chapter_access(cid, p_active);
  return cid;
end;
$$;
revoke execute on function public.sync_chapter_subscription(uuid,text,text,integer,boolean,timestamptz,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.sync_chapter_subscription(uuid,text,text,integer,boolean,timestamptz,text,text,text,text)
  to service_role;

-- Operator checkout uses the same four required fields and commits them with
-- the grant. A failed profile write must not leave an unnamed licence behind.
create or replace function public.admin_create_comp_chapter_with_profile(
  p_owner uuid, p_licence text, p_until timestamptz, p_seats integer,
  p_name text, p_organization_type text, p_contact_name text, p_contact_email text
)
returns uuid language plpgsql
set search_path = public, pg_temp
as $$
declare cid uuid;
begin
  if p_name is null or p_organization_type is null or p_contact_name is null or p_contact_email is null then
    raise exception 'enterprise details are required' using errcode = '23514';
  end if;
  cid := public.admin_create_comp_chapter(p_owner, p_licence, p_until, p_seats);
  update public.chapters set name = p_name, organization_type = p_organization_type,
    contact_name = p_contact_name, contact_email = p_contact_email where id = cid;
  return cid;
end;
$$;
revoke execute on function public.admin_create_comp_chapter_with_profile(uuid,text,timestamptz,integer,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_create_comp_chapter_with_profile(uuid,text,timestamptz,integer,text,text,text,text)
  to service_role;

-- Explicitly restate existing service-only grants after function replacement.
revoke execute on function public.enforce_chapter_seat_cap() from public, anon, authenticated;
revoke execute on function public.grant_chapter_seat(uuid,text) from public, anon, authenticated;
revoke execute on function public.set_chapter_access(uuid,boolean) from public, anon, authenticated;
grant execute on function public.grant_chapter_seat(uuid,text) to service_role;
grant execute on function public.set_chapter_access(uuid,boolean) to service_role;

-- The public board no longer has a pre-publication human queue. Replaying
-- an equal verified score may publish a clean, never-moderated old entry,
-- including a renamed company whose tape now has a different run id.
-- Better scores under a taken-down company name retain their removal history.
create or replace function public.record_board_entry(
  p_board text, p_season text, p_run uuid, p_profile uuid, p_handle text,
  p_company text, p_industry text, p_peak numeric, p_years int,
  p_ended_by text, p_listed boolean
) returns boolean language plpgsql security definer
set search_path = public, pg_temp
as $$
declare wrote boolean;
begin
  insert into public.leaderboard_entries as e (
    board, season, run_id, profile_id, founder_display_name, company_name,
    industry, peak_valuation, years_survived, ended_by, achieved_on, listed
  ) values (
    p_board, p_season, p_run, p_profile, p_handle, p_company, p_industry,
    p_peak, p_years, p_ended_by, (now() at time zone 'utc')::date, p_listed
  ) on conflict (board, season, profile_id) do update set
    run_id = excluded.run_id, founder_display_name = excluded.founder_display_name,
    company_name = excluded.company_name, industry = excluded.industry,
    peak_valuation = excluded.peak_valuation, years_survived = excluded.years_survived,
    ended_by = excluded.ended_by,
    achieved_on = case when (e.years_survived, e.peak_valuation) = (excluded.years_survived, excluded.peak_valuation)
                       then e.achieved_on else excluded.achieved_on end,
    listed = case when lower(btrim(e.company_name)) = lower(btrim(excluded.company_name))
                       and not e.listed and (e.reports > 0 or e.unlisted_at is not null or e.moderation_note is not null)
                  then false else excluded.listed end,
    reports = case when lower(btrim(e.company_name)) = lower(btrim(excluded.company_name)) then e.reports else 0 end,
    unlisted_at = case when lower(btrim(e.company_name)) = lower(btrim(excluded.company_name)) then e.unlisted_at else null end,
    moderation_note = case when lower(btrim(e.company_name)) = lower(btrim(excluded.company_name)) then e.moderation_note else null end
  where (case p_board
    when 'survival' then (excluded.years_survived, excluded.peak_valuation) > (e.years_survived, e.peak_valuation)
    when 'valuation' then (excluded.peak_valuation, excluded.years_survived) > (e.peak_valuation, e.years_survived)
    else false end)
    or (p_listed and (e.years_survived, e.peak_valuation) = (excluded.years_survived, excluded.peak_valuation) and not e.listed
        and e.reports = 0 and e.unlisted_at is null and e.moderation_note is null)
  returning true into wrote;
  return coalesce(wrote, false);
end;
$$;
revoke execute on function public.record_board_entry(text,text,uuid,uuid,text,text,text,numeric,int,text,boolean)
  from public, anon, authenticated;
grant execute on function public.record_board_entry(text,text,uuid,uuid,text,text,text,numeric,int,text,boolean)
  to service_role;

commit;
