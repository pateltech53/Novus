-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 · Admin — a role in the database, comped access, and the console's SQL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The moderation route (app/api/leaderboard/moderate) said it out loud: "when
-- there is more than one moderator, this becomes a role on `profiles` and a
-- policy". This is that migration, and the rest of what an operator needs:
--
--   · `profiles.role` — 'player' or 'admin'. Flipped in the Supabase Table
--     Editor (or SQL editor) and NOWHERE else: there is deliberately no
--     route, no function and no policy that lets any API caller change it.
--     The dashboard is the bootstrap, exactly as the operator asked.
--   · Comped access — `entitlements.comp_pro` / `comp_until`, a gift of Pro
--     that lives BESIDE the paid flag rather than inside it. The Stripe
--     webhook owns `pro` (apply_subscription overwrites it on every event);
--     a gift written into that column would be erased by the giftee's next
--     billing event. A separate column survives every webhook by never being
--     touched by one.
--   · Comped chapters — a licence row with no Stripe subscription behind it,
--     so a classroom can be handed out without a card. Everything downstream
--     (seats, the cap, the /chapter console, entitlements.chapter) already
--     works from the row; only the "must have a subscription id" rule and a
--     `source` marker change.
--   · The console's reads — one search/list function over auth.users joined
--     to what this schema knows about each account, and one stats blob.
--     Service-role only, like every privileged function in 0003/0007.
--   · `admin_audit` — every grant, revoke and deletion an admin performs,
--     written by the routes on the service role. Reachable by no client.
--
-- ── Why the guard trigger exists ────────────────────────────────────────────
--
-- 0001 gives players UPDATE on their own profiles row ("profiles: update
-- own") and INSERT for sign-up, with no column list. The moment `role` is a
-- column on that table, an unguarded PATCH /rest/v1/profiles is a
-- self-service promotion. The trigger below refuses any change to the two
-- admin columns arriving through the API roles (`anon`, `authenticated`) —
-- while the dashboard (postgres) and the service role stay free to flip
-- them. Column-level GRANTs could say the same thing, but a trigger states
-- the rule in one place and, unlike a REVOKE, cannot be undone by the next
-- broad GRANT somebody writes.
--
-- ── What an admin's own account gets ────────────────────────────────────────
--
-- Nothing, in this schema. An admin's all-access play state is derived at
-- read time by the entitlement routes (lib/admin/entitlements.ts) and by
-- player_allowance() below — it is never WRITTEN into entitlements, so
-- demoting an admin back to 'player' in the dashboard reverts everything in
-- one cell edit, and no fake purchase rows are left behind to clean up.
-- `admin_view` is the testing switch: 'free' and 'pro' make the admin's own
-- account behave exactly like those tiers so paywalls can be tested from a
-- real session; null means 'all'.


-- ═══ profiles: the role, and the testing view ═══════════════════════════════

alter table public.profiles
  add column role text not null default 'player' check (role in ('player', 'admin'));

-- Which tier the admin's OWN account currently plays at. Meaningless (and
-- harmless) on a 'player' row. Null = 'all', so a fresh admin is fully
-- unlocked without a second edit.
alter table public.profiles
  add column admin_view text check (admin_view in ('free', 'pro', 'all'));

create or replace function public.guard_admin_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- current_user rather than a JWT claim: PostgREST executes as `anon` or
  -- `authenticated`, the dashboard as `postgres`, the admin routes as
  -- `service_role` — the role in effect IS the caller's provenance, and it
  -- is the same thing RLS itself keys on.
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.role is distinct from 'player' or new.admin_view is not null then
        raise exception 'role is set from the Supabase dashboard, not from the app'
          using errcode = '42501';
      end if;
    elsif new.role is distinct from old.role
       or new.admin_view is distinct from old.admin_view then
      raise exception 'role is set from the Supabase dashboard, not from the app'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_admin on public.profiles;
create trigger profiles_guard_admin
  before insert or update on public.profiles
  for each row execute function public.guard_admin_columns();

-- Trigger plumbing, never called directly — same treatment as
-- enforce_chapter_seat_cap in 0007.
revoke execute on function public.guard_admin_columns() from public, anon, authenticated;


-- ═══ entitlements: the comp columns ═════════════════════════════════════════
-- A gift of Pro. Read together with `pro` everywhere access is decided:
-- effective Pro = pro OR (comp_pro AND (comp_until is null OR comp_until in
-- the future)). Expiry is evaluated at read time, so a lapsed gift needs no
-- sweeper — it simply stops being true.
--
-- `comp_note` is the admin's own reminder ("prize — March jam"). The player
-- can technically read it through their own entitlements row, so routes never
-- select it for players and admins are told to keep it neutral (docs/ADMIN.md).

alter table public.entitlements
  add column comp_pro   boolean not null default false,
  add column comp_until timestamptz,
  add column comp_note  text check (comp_note is null or length(comp_note) <= 280);

-- ── Granting and revoking a gift ────────────────────────────────────────────
-- One function for both directions, like apply_subscription: revoke is
-- p_active=false, and the note travels with the decision so the row always
-- explains its own state.
create or replace function public.admin_set_comp_pro(
  p_profile uuid,
  p_active  boolean,
  p_until   timestamptz default null,
  p_note    text default null
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, comp_pro, comp_until, comp_note)
  values (p_profile, p_active, p_until, left(p_note, 280))
  on conflict (profile_id) do update
    set comp_pro   = excluded.comp_pro,
        comp_until = excluded.comp_until,
        comp_note  = excluded.comp_note;
$$;

-- ── Taking a pack back ──────────────────────────────────────────────────────
-- The other half of 0003's grant_industry_pack, for gifts sent to the wrong
-- account. array_remove is idempotent the same way the grant is: revoking a
-- pack the player does not hold changes nothing.
create or replace function public.admin_revoke_industry_pack(
  p_profile  uuid,
  p_industry text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.entitlements
     set industry_packs = array_remove(industry_packs, p_industry)
   where profile_id = p_profile;
$$;

-- ── Setting the slot count outright ─────────────────────────────────────────
-- grant_extra_run_slot (0003) adds exactly one because a webhook delivers one
-- purchase at a time. An admin types the number they mean, so this SETS it —
-- clamped to the same 0–20 the column's own check enforces, because a
-- function that can violate its table's constraint is a 500 waiting on a typo.
create or replace function public.admin_set_extra_run_slots(
  p_profile uuid,
  p_slots   int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_run_slots)
  values (p_profile, least(greatest(coalesce(p_slots, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_run_slots = least(greatest(coalesce(p_slots, 0), 0), 20);
$$;


-- ═══ player_allowance: the run-a-day formula, in one place ══════════════════
-- claim_run_slot and runs_remaining_today (0001) each carried their own copy
-- of "what does this player's tier allow", and this migration makes the
-- formula longer (comp, admin, the view switch). Two copies of a longer
-- formula WILL drift, so both functions are replaced below to read this one.
--
-- Null when the profile does not exist; callers coalesce to the free tier's 1,
-- exactly as 0001 treated a missing entitlements row.
create or replace function public.player_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    -- An admin plays at whatever tier their view switch says. 999 rather
    -- than unbounded so the ledger arithmetic stays honest and finite.
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 1
        when 'pro'  then 3
        else 999
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 3 else 1 end
      + coalesce(e.extra_run_slots, 0)
  end
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

revoke execute on function public.player_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.player_allowance(uuid) to service_role;

-- Same contract as 0001, new formula. The security shape is unchanged:
-- definer, allowance read from the database, never trusted from a caller.
create or replace function public.claim_run_slot()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today   date := (now() at time zone 'utc')::date;
  caller  uuid := auth.uid();
  allowed int;
  used    int;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  allowed := coalesce(public.player_allowance(caller), 1);

  insert into public.run_ledger as l (profile_id, day, started)
  values (caller, today, 1)
  on conflict (profile_id) do update
    set day     = today,
        started = case when l.day = today then l.started + 1 else 1 end
  returning l.started into used;

  return used <= allowed;
end;
$$;

revoke execute on function public.claim_run_slot() from public, anon;
grant  execute on function public.claim_run_slot() to authenticated;

create or replace function public.runs_remaining_today()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  select greatest(0,
    coalesce(public.player_allowance(auth.uid()), 1)
    - coalesce((select l.started from public.run_ledger l
                 where l.profile_id = auth.uid()
                   and l.day = (now() at time zone 'utc')::date), 0)
  );
$$;

revoke execute on function public.runs_remaining_today() from public, anon;
grant  execute on function public.runs_remaining_today() to authenticated;


-- ═══ chapters: a licence without a subscription behind it ═══════════════════
-- 0007 made stripe_subscription_id NOT NULL because at the time a chapter
-- could only exist by being paid for. A comped chapter has no subscription,
-- so the column relaxes to nullable — UNIQUE keeps holding for the real ids,
-- since Postgres unique indexes never match null to null — and `source` says
-- which kind each row is. Every existing row is 'stripe' by definition.
--
-- The webhook is untouched by this: it looks chapters up BY subscription id,
-- which a comp row does not have, so no billing event can ever move one.

alter table public.chapters
  alter column stripe_subscription_id drop not null;

alter table public.chapters
  add column source text not null default 'stripe' check (source in ('stripe', 'comp'));

-- ── Creating one ────────────────────────────────────────────────────────────
-- Seats are derived from the licence here, exactly as the webhook derives
-- them from the SKU, so a comped chapter_35 and a bought one are the same
-- row shape. One active chapter per owner: ownedChapter() (lib/chapter/
-- admin.ts) administers the newest ACTIVE licence, so a second active row
-- would be a console the owner cannot see.
create or replace function public.admin_create_comp_chapter(
  p_owner   uuid,
  p_licence text,
  p_until   timestamptz default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_seats int := case p_licence when 'chapter_35'  then 35
                                when 'chapter_100' then 100 end;
  v_id uuid;
begin
  if v_seats is null then
    raise exception 'unknown licence %', p_licence using errcode = '23514';
  end if;

  if exists (select 1 from public.chapters c
              where c.owner_profile_id = p_owner and c.status = 'active') then
    raise exception 'already owns an active chapter' using errcode = '23505';
  end if;

  insert into public.chapters
    (owner_profile_id, licence, seats, source, status, current_period_end, stripe_subscription_id)
  values
    (p_owner, p_licence, v_seats, 'comp', 'active', p_until, null)
  returning id into v_id;

  return v_id;
end;
$$;

-- ── …and ending one ─────────────────────────────────────────────────────────
-- Comp rows only: a paid chapter lapses through Stripe (cancel the
-- subscription; the webhook does the rest), and a function that could lapse
-- one directly would put the row and Stripe's next event in disagreement.
-- The roster is kept and the seats go dark — set_chapter_access(false), the
-- same lever the webhook pulls — so restoring is one status flip away.
create or replace function public.admin_revoke_comp_chapter(p_chapter uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  found boolean;
begin
  update public.chapters c
     set status = 'lapsed'
   where c.id = p_chapter
     and c.source = 'comp'
     and c.status = 'active'
  returning true into found;

  if coalesce(found, false) then
    perform public.set_chapter_access(p_chapter, false);
  end if;
  return coalesce(found, false);
end;
$$;

-- ── Expiry, evaluated lazily ────────────────────────────────────────────────
-- A comped chapter given an end date has nothing to lapse it — no
-- subscription, no webhook. Rather than demand pg_cron, the stats route runs
-- this on every console load: overdue rows flip to lapsed and their seats go
-- dark, which is timely enough for a licence measured in school years.
create or replace function public.admin_lapse_expired_comp_chapters()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  doomed uuid;
  n integer := 0;
begin
  for doomed in
    select c.id from public.chapters c
     where c.source = 'comp'
       and c.status = 'active'
       and c.current_period_end is not null
       and c.current_period_end < now()
  loop
    update public.chapters set status = 'lapsed' where id = doomed;
    perform public.set_chapter_access(doomed, false);
    n := n + 1;
  end loop;
  return n;
end;
$$;


-- ═══ admin_audit ════════════════════════════════════════════════════════════
-- Every grant, revoke, view switch and deletion, written by app/api/admin/*
-- on the service role. The emails are denormalised at write time so the log
-- still reads after the account it is about is deleted — which is exactly
-- when a deletion log is wanted. No RLS policies and no grants: like
-- run_ledger, PostgREST cannot expose this table to anyone by any route.
create table public.admin_audit (
  id           bigint generated always as identity primary key,

  -- Who did it. Kept as a reference while the admin exists, kept as an email
  -- string after they are gone.
  actor        uuid references public.profiles(id) on delete set null,
  actor_email  text,

  action       text not null,

  -- Who it was done to. A bare uuid, not a foreign key, so deleting the
  -- target does not take the record of the deletion with it.
  target       uuid,
  target_email text,

  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create index admin_audit_created_idx on public.admin_audit (created_at desc);
create index admin_audit_target_idx  on public.admin_audit (target, created_at desc);


-- ═══ The console's reads ════════════════════════════════════════════════════
-- Both are `security definer` because they read auth.users — the same reason
-- as auth_user_id_for_email in 0007, and the same consequence: callable by a
-- player they would be an account directory of children, so both are revoked
-- from everything and granted to the service role alone. The routes hold the
-- only door, and the routes check profiles.role first.

-- ── Search / list ───────────────────────────────────────────────────────────
-- One row per account, everything the console's list and detail need in one
-- round trip. The needle matches email, display name, or an exact profile id.
create or replace function public.admin_list_users(
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id                   uuid,
  email                text,
  display_name         text,
  role                 text,
  is_anonymous         boolean,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  pro                  boolean,
  comp_pro             boolean,
  comp_until           timestamptz,
  comp_note            text,
  chapter              text,
  extra_run_slots      int,
  industry_packs       text[],
  intent               text,
  subscription_status  text,
  plan                 text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  owns_chapter_id      uuid,
  owns_chapter_status  text,
  owns_chapter_source  text,
  owns_chapter_licence text,
  seat_chapter_id      uuid,
  total                bigint
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as needle
  )
  select
    u.id,
    u.email,
    p.display_name,
    coalesce(p.role, 'player'),
    coalesce(u.is_anonymous, false),
    u.created_at,
    u.last_sign_in_at,
    coalesce(e.pro, false),
    coalesce(e.comp_pro, false),
    e.comp_until,
    e.comp_note,
    e.chapter,
    coalesce(e.extra_run_slots, 0),
    coalesce(e.industry_packs, '{}'),
    e.intent,
    b.subscription_status,
    b.plan,
    b.current_period_end,
    coalesce(b.cancel_at_period_end, false),
    oc.id,
    oc.status,
    oc.source,
    oc.licence,
    s.chapter_id,
    count(*) over () as total
  from auth.users u
  left join public.profiles p          on p.id = u.id
  left join public.entitlements e      on e.profile_id = u.id
  left join public.billing_customers b on b.profile_id = u.id
  left join lateral (
    -- The chapter the owner's console shows: newest active first, the same
    -- preference ownedChapter() applies.
    select c.id, c.status, c.source, c.licence
      from public.chapters c
     where c.owner_profile_id = u.id
     order by (c.status = 'active') desc, c.created_at desc
     limit 1
  ) oc on true
  left join public.chapter_seats s     on s.profile_id = u.id
  cross join q
  where q.needle is null
     or u.email ilike '%' || q.needle || '%'
     or p.display_name ilike '%' || q.needle || '%'
     or u.id::text = lower(q.needle)
  order by u.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ── The overview numbers ────────────────────────────────────────────────────
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'accounts',       (select count(*) from auth.users u where coalesce(u.is_anonymous, false) is false),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from public.profiles p where p.role = 'admin'),
    'newWeek',        (select count(*) from auth.users u
                        where coalesce(u.is_anonymous, false) is false
                          and u.created_at > now() - interval '7 days'),
    'activeWeek',     (select count(*) from auth.users u
                        where coalesce(u.is_anonymous, false) is false
                          and coalesce(u.last_sign_in_at, u.created_at) > now() - interval '7 days'),
    'activeMonth',    (select count(*) from auth.users u
                        where coalesce(u.is_anonymous, false) is false
                          and coalesce(u.last_sign_in_at, u.created_at) > now() - interval '30 days'),
    'proPaid',        (select count(*) from public.entitlements e where e.pro),
    'proComp',        (select count(*) from public.entitlements e
                        where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    'chapterSeats',   (select count(*) from public.chapter_seats),
    'chaptersActive', (select count(*) from public.chapters c where c.status = 'active'),
    'chaptersComp',   (select count(*) from public.chapters c
                        where c.status = 'active' and c.source = 'comp'),
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;


-- ═══ The stale-anonymous sweep learns about comps ═══════════════════════════
-- 0004's delete_stale_anonymous_users spares any anonymous row that shows
-- evidence of a purchase. A comped gift is the same kind of evidence — an
-- admin deliberately attached value to the account — so the guard gains the
-- comp column. Everything else is 0004, verbatim.
create or replace function public.delete_stale_anonymous_users(
  p_older_than interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  removed integer;
begin
  with doomed as (
    delete from auth.users u
    where u.is_anonymous is true
      and coalesce(u.last_sign_in_at, u.created_at) < (now() - p_older_than)
      and not exists (
        select 1 from public.entitlements e
        where e.profile_id = u.id
          and (e.pro or e.comp_pro or e.extra_run_slots > 0
               or array_length(e.industry_packs, 1) > 0
               or e.chapter is not null)
      )
      and not exists (
        select 1 from public.billing_customers b where b.profile_id = u.id
      )
    returning 1
  )
  select count(*) into removed from doomed;

  return removed;
end;
$$;

revoke execute on function public.delete_stale_anonymous_users(interval)
  from public, anon, authenticated;
grant execute on function public.delete_stale_anonymous_users(interval)
  to service_role;


-- ═══ Grants — revoke first, then exactly one role, the 0003 pattern ═════════
revoke execute on function public.admin_set_comp_pro(uuid, boolean, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.admin_revoke_industry_pack(uuid, text)               from public, anon, authenticated;
revoke execute on function public.admin_set_extra_run_slots(uuid, int)                 from public, anon, authenticated;
revoke execute on function public.admin_create_comp_chapter(uuid, text, timestamptz)   from public, anon, authenticated;
revoke execute on function public.admin_revoke_comp_chapter(uuid)                      from public, anon, authenticated;
revoke execute on function public.admin_lapse_expired_comp_chapters()                  from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, int, int)                     from public, anon, authenticated;
revoke execute on function public.admin_stats()                                        from public, anon, authenticated;

grant execute on function public.admin_set_comp_pro(uuid, boolean, timestamptz, text)  to service_role;
grant execute on function public.admin_revoke_industry_pack(uuid, text)                to service_role;
grant execute on function public.admin_set_extra_run_slots(uuid, int)                  to service_role;
grant execute on function public.admin_create_comp_chapter(uuid, text, timestamptz)    to service_role;
grant execute on function public.admin_revoke_comp_chapter(uuid)                       to service_role;
grant execute on function public.admin_lapse_expired_comp_chapters()                   to service_role;
grant execute on function public.admin_list_users(text, int, int)                      to service_role;
grant execute on function public.admin_stats()                                        to service_role;
