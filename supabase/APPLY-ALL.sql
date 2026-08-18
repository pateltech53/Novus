-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY ALL · the complete Novus schema (0001 → 0016), idempotently
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Paste the whole file into the Supabase SQL editor of the NOVUS project and
-- run it once. Safe on every starting state:
--
--   · a FRESH project — creates everything;
--   · a PARTIALLY-migrated project — creates only what is missing, and never
--     alters or drops anything that already exists (Novus's own policies,
--     triggers, functions and views are refreshed in place to their current
--     definitions, which is what a re-run is for);
--   · an already-complete project — a no-op that ends in the report below;
--   · the WRONG project — aborts before touching anything (see preflight).
--
-- The per-migration files in supabase/migrations/ stay the source of truth
-- and carry the full design rationale; this file is the operational artifact
-- generated from them. When a migration changes, regenerate this file too.
--
-- The final SELECT prints one row per migration with `ok` — read it.


-- ═══ Preflight — refuse the wrong database ══════════════════════════════════
-- Two ways to paste this somewhere it must not run, both refused:
--   1. Not a Supabase project at all (no auth.users to reference).
--   2. A project already carrying a DIFFERENT app's `public.profiles` —
--      detected as "profiles exists but has no display_name column". Novus
--      cannot share a project with another app's profiles table, and this
--      script will not try: it stops here having changed nothing.
do $$
begin
  if to_regclass('auth.users') is null then
    raise exception using message =
      'This is not a Supabase project (auth.users is missing). Run this in the Novus Supabase project''s SQL editor.';
  end if;

  if to_regclass('public.profiles') is not null
     and not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name = 'display_name'
     ) then
    raise exception using message =
      'public.profiles already exists here with a different shape — this looks like ANOTHER app''s database, not Novus''s. Nothing was changed. Run this in the Novus project instead.';
  end if;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Ahead of everything: 0013's one rename
-- ═══════════════════════════════════════════════════════════════════════════
-- `entitlements.extra_run_slots` became `extra_islands` in 0013, and this file
-- is a snapshot of the schema AFTER that — every section below writes the new
-- name. So a project still carrying the old one has to be converted before the
-- first function that reads it is created, which is in the 0001 section. It
-- lives here rather than down in 0013 for that reason alone; the reasoning for
-- the rename itself is in supabase/migrations/0013_islands.sql.
--
-- Guarded, so a fresh project (no table yet) and an already-converted one both
-- fall straight through. This is what makes a SECOND run of this file a no-op
-- rather than an error — the whole promise in the header.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'entitlements'
                and column_name = 'extra_run_slots') then
    alter table public.entitlements rename column extra_run_slots to extra_islands;
  end if;
end;
$$;

-- `admin_list_users` RETURNS TABLE names that column, and Postgres refuses to
-- change a function's output type with CREATE OR REPLACE — a project carrying
-- the pre-0013 version fails at the 0009 section below with "cannot change
-- return type of existing function". Dropping it here is the same move
-- supabase/migrations/0013_islands.sql makes, hoisted for the same reason the
-- rename above is: it has to happen before anything redefines it.
drop function if exists public.admin_list_users(text, int, int);


-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 · Novus core — profiles, preferences, saves, legacy, entitlements
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null check (length(btrim(display_name)) between 1 and 24),
  board_handle        text check (board_handle ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$'),
  accepted_privacy_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists profiles_board_handle_key
  on public.profiles (lower(board_handle))
  where board_handle is not null;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── preferences ─────────────────────────────────────────────────────────────
create table if not exists public.preferences (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  rookie_mode     boolean not null default false,
  onboarded       boolean not null default false,
  mic_calibration real check (mic_calibration is null or mic_calibration between 0 and 1),
  theme           text not null default 'light' check (theme in ('light','dark')),
  sound_on        boolean not null default true,
  equipped_skin   text,
  updated_at      timestamptz not null default now()
);

drop trigger if exists preferences_touch on public.preferences;
create trigger preferences_touch
  before update on public.preferences
  for each row execute function public.touch_updated_at();

-- ── saves ───────────────────────────────────────────────────────────────────
create table if not exists public.saves (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  slot           smallint not null default 0 check (slot between 0 and 9),
  run_id         text not null,
  seed           bigint not null,
  state          jsonb  not null,
  company_name   text not null,
  industry       text not null check (industry in (
                   'FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                   'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET')),
  year           int      not null check (year between 1 and 60),
  month          smallint not null check (month between 1 and 12),
  stage          smallint not null check (stage between 1 and 5),
  alive          boolean  not null default true,
  ended_by       text check (ended_by in ('chapter7','acquired','ipo')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (profile_id, slot),
  constraint save_size check (pg_column_size(state) < 1048576),
  constraint ended_by_iff_dead check (alive = (ended_by is null))
);

drop trigger if exists saves_touch on public.saves;
create trigger saves_touch
  before update on public.saves
  for each row execute function public.touch_updated_at();

-- ── legacy ──────────────────────────────────────────────────────────────────
create table if not exists public.legacy (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  best_year      int not null default 0  check (best_year between 0 and 60),
  runs_completed int not null default 0  check (runs_completed >= 0),
  shark_respect  int not null default 10 check (shark_respect between 0 and 100),
  badges         text[] not null default '{}',
  autopsies      jsonb  not null default '[]'::jsonb
                 check (jsonb_typeof(autopsies) = 'array'
                        and jsonb_array_length(autopsies) <= 50),
  updated_at     timestamptz not null default now()
);

drop trigger if exists legacy_touch on public.legacy;
create trigger legacy_touch
  before update on public.legacy
  for each row execute function public.touch_updated_at();

-- ── entitlements ────────────────────────────────────────────────────────────
create table if not exists public.entitlements (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  pro              boolean not null default false,
  extra_islands  int     not null default 0 check (extra_islands between 0 and 20),
  industry_packs   text[]  not null default '{}',
  cosmetic_bundles text[]  not null default '{}',
  chapter          text check (chapter in ('chapter_35','chapter_100')),
  intent           text check (intent in ('free','pro_monthly','pro_yearly')),
  updated_at       timestamptz not null default now(),
  constraint industry_packs_valid check (
    industry_packs <@ array['FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                            'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET']::text[]
  )
);

drop trigger if exists entitlements_touch on public.entitlements;
create trigger entitlements_touch
  before update on public.entitlements
  for each row execute function public.touch_updated_at();

-- ── run_ledger ──────────────────────────────────────────────────────────────
create table if not exists public.run_ledger (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  started    int  not null default 0 check (started >= 0)
);

-- ── 0001 row-level security ────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.preferences  enable row level security;
alter table public.saves        enable row level security;
alter table public.legacy       enable row level security;
alter table public.entitlements enable row level security;
alter table public.run_ledger   enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
create policy "profiles: read own"   on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "preferences: own" on public.preferences;
create policy "preferences: own" on public.preferences for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "saves: own" on public.saves;
create policy "saves: own" on public.saves for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "legacy: own" on public.legacy;
create policy "legacy: own" on public.legacy for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "entitlements: read own" on public.entitlements;
create policy "entitlements: read own" on public.entitlements for select to authenticated
  using (profile_id = (select auth.uid()));

revoke all on public.run_ledger from anon, authenticated;

-- ── claim_run_slot / runs_remaining_today ──────────────────────────────────
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

  select case when coalesce(e.pro, false) or e.chapter is not null then 3 else 1 end
    into allowed
    from public.entitlements e
   where e.profile_id = caller;

  allowed := coalesce(allowed, 1);

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
    coalesce((select case when coalesce(e.pro, false) or e.chapter is not null
                          then 3 else 1 end
                from public.entitlements e where e.profile_id = auth.uid()), 1)
    - coalesce((select l.started from public.run_ledger l
                 where l.profile_id = auth.uid()
                   and l.day = (now() at time zone 'utc')::date), 0)
  );
$$;

revoke execute on function public.runs_remaining_today() from public, anon;
grant  execute on function public.runs_remaining_today() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · Leaderboard — runs, entries, quota (views arrive in the 0006 block)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.runs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  seed           bigint not null,
  tape           jsonb  not null,
  tape_hash      text   not null,
  engine_version text   not null,
  events_hash    text   not null,
  company_name   text not null,
  industry       text not null check (industry in (
                   'FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                   'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET')),
  claimed_peak_valuation numeric(20,2) not null,
  claimed_years_survived int           not null,
  verified_peak_valuation numeric(20,2),
  verified_years_survived int,
  verified_ended_by       text check (verified_ended_by in ('chapter7','acquired','ipo')),
  status        text not null default 'pending'
                check (status in ('pending','verified','rejected','flagged')),
  reject_reason text,
  pro_at_submit boolean not null default false,
  submitted_at  timestamptz not null default now(),
  verified_at   timestamptz,
  constraint tape_size   check (pg_column_size(tape) < 262144),
  constraint years_claim check (claimed_years_survived between 1 and 60),
  constraint valuation_claim
    check (claimed_peak_valuation >= 0 and claimed_peak_valuation < 1e13),
  constraint one_tape_per_profile unique (profile_id, tape_hash)
);

create index if not exists runs_pending_idx on public.runs (submitted_at) where status = 'pending';
create index if not exists runs_profile_idx on public.runs (profile_id, submitted_at desc);

create table if not exists public.leaderboard_entries (
  id            uuid primary key default gen_random_uuid(),
  board         text not null check (board in ('valuation','survival')),
  season        text not null,
  run_id        uuid not null references public.runs(id)     on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  founder_display_name text not null
    check (founder_display_name ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$'),
  company_name         text not null,
  industry             text not null,
  peak_valuation numeric(20,2) not null check (peak_valuation >= 0),
  years_survived int           not null check (years_survived between 1 and 60),
  ended_by       text,
  achieved_on   date not null,
  listed        boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint one_entry_per_board unique (board, season, profile_id)
);

create index if not exists leaderboard_valuation_idx
  on public.leaderboard_entries (season, peak_valuation desc, achieved_on asc, id asc)
  where board = 'valuation' and listed;

create index if not exists leaderboard_survival_idx
  on public.leaderboard_entries (season, years_survived desc, peak_valuation desc, achieved_on asc, id asc)
  where board = 'survival' and listed;

create index if not exists leaderboard_unlisted_idx
  on public.leaderboard_entries (created_at) where not listed;

create table if not exists public.submission_quota (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  count      int  not null default 0
);

-- ── 0002 row-level security ────────────────────────────────────────────────
alter table public.runs                enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.submission_quota    enable row level security;

drop policy if exists "runs: submit own" on public.runs;
create policy "runs: submit own"
  on public.runs for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and status = 'pending'
    and verified_peak_valuation is null
    and verified_years_survived is null
    and verified_ended_by       is null
    and verified_at             is null
    and reject_reason           is null
  );

drop policy if exists "runs: read own" on public.runs;
create policy "runs: read own"
  on public.runs for select to authenticated
  using (profile_id = (select auth.uid()));

revoke all    on public.leaderboard_entries from anon, authenticated;
grant  select on public.leaderboard_entries to   anon, authenticated;

drop policy if exists "board: public read" on public.leaderboard_entries;
create policy "board: public read"
  on public.leaderboard_entries for select to anon, authenticated
  using (listed = true);

revoke all on public.submission_quota from anon, authenticated;

-- ── claim_submission_slot / expire_run_tapes ───────────────────────────────
create or replace function public.claim_submission_slot(p_profile uuid, p_max int default 10)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'utc')::date;
  used  int;
begin
  insert into public.submission_quota as q (profile_id, day, count)
  values (p_profile, today, 1)
  on conflict (profile_id) do update
    set day   = today,
        count = case when q.day = today then q.count + 1 else 1 end
  returning q.count into used;

  return used <= p_max;
end;
$$;

revoke execute on function public.claim_submission_slot(uuid, int)
  from public, anon, authenticated;

create or replace function public.expire_run_tapes()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with expired as (
    update public.runs
       set tape = '{}'::jsonb
     where tape <> '{}'::jsonb
       and coalesce(verified_at, submitted_at) < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from expired;
$$;

revoke execute on function public.expire_run_tapes() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Billing — Stripe customers, webhook idempotency, grant functions
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.billing_customers (
  profile_id           uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id   text not null unique,
  subscription_id      text unique,
  subscription_status  text check (subscription_status in (
                         'trialing','active','past_due','canceled',
                         'incomplete','incomplete_expired','unpaid','paused')),
  plan                 text check (plan in ('pro_monthly','pro_yearly')),
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists billing_customers_touch on public.billing_customers;
create trigger billing_customers_touch
  before update on public.billing_customers
  for each row execute function public.touch_updated_at();

alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;

create table if not exists public.billing_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

create index if not exists billing_events_received_at_idx on public.billing_events (received_at);

create or replace function public.apply_subscription(
  p_profile uuid,
  p_active  boolean,
  p_plan    text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, pro, intent)
  values (p_profile, p_active, p_plan)
  on conflict (profile_id) do update
    set pro = excluded.pro,
        intent = coalesce(excluded.intent, public.entitlements.intent);
$$;

create or replace function public.grant_industry_pack(
  p_profile  uuid,
  p_industry text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, industry_packs)
  values (p_profile, array[p_industry])
  on conflict (profile_id) do update
    set industry_packs = (
      select array(
        select distinct unnest(public.entitlements.industry_packs || array[p_industry])
      )
    );
$$;

create or replace function public.grant_extra_island(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_islands = public.entitlements.extra_islands + 1;
$$;

revoke execute on function public.apply_subscription(uuid, boolean, text)  from public, anon, authenticated;
revoke execute on function public.grant_industry_pack(uuid, text)          from public, anon, authenticated;
revoke execute on function public.grant_extra_island(uuid)               from public, anon, authenticated;

grant execute on function public.apply_subscription(uuid, boolean, text)   to service_role;
grant execute on function public.grant_industry_pack(uuid, text)           to service_role;
grant execute on function public.grant_extra_island(uuid)                to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Accounts — stale anonymous-user cleanup
-- ═══════════════════════════════════════════════════════════════════════════

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
          and (e.pro or e.extra_islands > 0
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 · Auth throttle
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.auth_throttle (
  bucket       text        not null,
  key          text        not null,
  window_start timestamptz not null default now(),
  attempts     int         not null default 1,
  primary key (bucket, key)
);

create index if not exists auth_throttle_window_idx on public.auth_throttle (window_start);

alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;

create or replace function public.claim_auth_attempt(
  p_bucket text,
  p_key    text,
  p_limit  int,
  p_window interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used int;
begin
  insert into public.auth_throttle as t (bucket, key, window_start, attempts)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    set window_start = case
                         when t.window_start < (now() - p_window) then now()
                         else t.window_start
                       end,
        attempts     = case
                         when t.window_start < (now() - p_window) then 1
                         else t.attempts + 1
                       end
  returning t.attempts into used;

  return used <= p_limit;
end;
$$;

create or replace function public.prune_auth_throttle(
  p_older_than interval default interval '1 day'
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed int;
begin
  delete from public.auth_throttle where window_start < (now() - p_older_than);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.claim_auth_attempt(text, text, int, interval)
  from public, anon, authenticated;
revoke execute on function public.prune_auth_throttle(interval)
  from public, anon, authenticated;

grant execute on function public.claim_auth_attempt(text, text, int, interval)
  to service_role;
grant execute on function public.prune_auth_throttle(interval)
  to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Leaderboard submission — moderation columns, final views, functions
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.leaderboard_entries
  add column if not exists reports int not null default 0,
  add column if not exists unlisted_at timestamptz,
  add column if not exists moderation_note text;

create index if not exists leaderboard_review_idx
  on public.leaderboard_entries (created_at)
  where not listed;

-- The final (0006) shape of both views, id column included. security_invoker
-- is restated on purpose: without it a recreated view runs as its owner and
-- silently bypasses the RLS underneath.
drop view if exists public.board_valuation;
create view public.board_valuation
with (security_invoker = on) as
select
  row_number() over (order by peak_valuation desc, achieved_on asc, id asc) as rank,
  id,
  founder_display_name, company_name, industry,
  peak_valuation, years_survived, achieved_on, season
from public.leaderboard_entries
where board = 'valuation' and listed;

drop view if exists public.board_survival;
create view public.board_survival
with (security_invoker = on) as
select
  row_number() over (order by years_survived desc, peak_valuation desc, achieved_on asc, id asc) as rank,
  id,
  founder_display_name, company_name, industry,
  years_survived, peak_valuation, ended_by, achieved_on, season
from public.leaderboard_entries
where board = 'survival' and listed;

grant select on public.board_valuation to anon, authenticated;
grant select on public.board_survival  to anon, authenticated;

create or replace function public.record_board_entry(
  p_board       text,
  p_season      text,
  p_run         uuid,
  p_profile     uuid,
  p_handle      text,
  p_company     text,
  p_industry    text,
  p_peak        numeric,
  p_years       int,
  p_ended_by    text,
  p_listed      boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wrote boolean;
begin
  insert into public.leaderboard_entries as e (
    board, season, run_id, profile_id, founder_display_name,
    company_name, industry, peak_valuation, years_survived, ended_by,
    achieved_on, listed
  )
  values (
    p_board, p_season, p_run, p_profile, p_handle,
    p_company, p_industry, p_peak, p_years, p_ended_by,
    (now() at time zone 'utc')::date, p_listed
  )
  on conflict (board, season, profile_id) do update
    set run_id               = excluded.run_id,
        founder_display_name = excluded.founder_display_name,
        company_name         = excluded.company_name,
        industry             = excluded.industry,
        peak_valuation       = excluded.peak_valuation,
        years_survived       = excluded.years_survived,
        ended_by             = excluded.ended_by,
        achieved_on          = excluded.achieved_on,
        listed               = excluded.listed,
        reports              = 0,
        unlisted_at          = null,
        moderation_note      = null
  where
    case p_board
      when 'survival' then
        (excluded.years_survived, excluded.peak_valuation)
          > (e.years_survived, e.peak_valuation)
      when 'valuation' then
        (excluded.peak_valuation, excluded.years_survived)
          > (e.peak_valuation, e.years_survived)
      else false
    end
  returning true into wrote;

  return coalesce(wrote, false);
end;
$$;

revoke execute on function public.record_board_entry(
  text, text, uuid, uuid, text, text, text, numeric, int, text, boolean
) from public, anon, authenticated;

create or replace function public.set_entry_listed(
  p_entry uuid,
  p_listed boolean,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched boolean;
begin
  update public.leaderboard_entries
     set listed          = p_listed,
         moderation_note = p_note,
         unlisted_at     = case when p_listed then null else now() end,
         reports         = case when p_listed then 0 else reports end
   where id = p_entry
  returning true into touched;

  return coalesce(touched, false);
end;
$$;

revoke execute on function public.set_entry_listed(uuid, boolean, text)
  from public, anon, authenticated;

create or replace function public.report_board_entry(p_entry uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched boolean;
begin
  update public.leaderboard_entries
     set listed      = false,
         reports     = reports + 1,
         unlisted_at = coalesce(unlisted_at, now())
   where id = p_entry
  returning true into touched;

  return coalesce(touched, false);
end;
$$;

revoke execute on function public.report_board_entry(uuid)
  from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Chapters — the seat feature
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.chapters (
  id                     uuid primary key default gen_random_uuid(),
  owner_profile_id       uuid not null references public.profiles(id) on delete cascade,
  licence                text not null check (licence in ('chapter_35','chapter_100')),
  seats                  int  not null check (seats between 1 and 500),
  stripe_subscription_id text not null unique,
  status                 text not null default 'active' check (status in ('active','lapsed')),
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists chapters_touch on public.chapters;
create trigger chapters_touch
  before update on public.chapters
  for each row execute function public.touch_updated_at();

create index if not exists chapters_owner_idx on public.chapters (owner_profile_id);

create table if not exists public.chapter_seats (
  id                uuid primary key default gen_random_uuid(),
  chapter_id        uuid not null references public.chapters(id) on delete cascade,
  profile_id        uuid not null unique references public.profiles(id) on delete cascade,
  email             text not null check (length(email) between 3 and 254),
  seat_name         text check (length(btrim(seat_name)) between 1 and 24),
  origin            text not null check (origin in ('registered','invited')),
  invite_sent_at    timestamptz,
  invite_token      uuid unique,
  created_by_invite boolean not null default false,
  claimed_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (chapter_id, email)
);

-- A project that ran the first cut of 0007 gains the claim columns here.
alter table public.chapter_seats
  add column if not exists invite_token      uuid unique,
  add column if not exists created_by_invite boolean not null default false,
  add column if not exists claimed_at        timestamptz;

create index if not exists chapter_seats_chapter_idx on public.chapter_seats (chapter_id);

create or replace function public.enforce_chapter_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cap int;
begin
  select c.seats into cap
    from public.chapters c
   where c.id = new.chapter_id
     for update;

  if cap is null then
    raise exception 'chapter % does not exist', new.chapter_id;
  end if;

  if (select count(*) from public.chapter_seats s where s.chapter_id = new.chapter_id) >= cap then
    raise exception 'chapter is full: all % seats are taken', cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists chapter_seats_cap on public.chapter_seats;
create trigger chapter_seats_cap
  before insert on public.chapter_seats
  for each row execute function public.enforce_chapter_seat_cap();

alter table public.chapters      enable row level security;
alter table public.chapter_seats enable row level security;

drop policy if exists "chapters: owner reads" on public.chapters;
create policy "chapters: owner reads" on public.chapters
  for select to authenticated
  using (owner_profile_id = (select auth.uid()));

drop policy if exists "chapter_seats: owner reads" on public.chapter_seats;
create policy "chapter_seats: owner reads" on public.chapter_seats
  for select to authenticated
  using (exists (
    select 1 from public.chapters c
     where c.id = chapter_id
       and c.owner_profile_id = (select auth.uid())
  ));

create or replace function public.grant_chapter_seat(
  p_profile uuid,
  p_licence text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, chapter)
  values (p_profile, p_licence)
  on conflict (profile_id) do update
    set chapter = excluded.chapter;
$$;

create or replace function public.revoke_chapter_seat(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.entitlements
     set chapter = null
   where profile_id = p_profile;
$$;

create or replace function public.set_chapter_access(
  p_chapter uuid,
  p_active  boolean
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_licence text;
begin
  select c.licence into v_licence from public.chapters c where c.id = p_chapter;
  if v_licence is null then
    raise exception 'chapter % does not exist', p_chapter;
  end if;

  if p_active then
    insert into public.entitlements (profile_id, chapter)
    select s.profile_id, v_licence
      from public.chapter_seats s
     where s.chapter_id = p_chapter
    on conflict (profile_id) do update
      set chapter = excluded.chapter;
  else
    update public.entitlements e
       set chapter = null
      from public.chapter_seats s
     where s.chapter_id = p_chapter
       and e.profile_id = s.profile_id;
  end if;
end;
$$;

create or replace function public.auth_user_id_for_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public, pg_temp
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and coalesce(u.is_anonymous, false) is false
   limit 1;
$$;

revoke execute on function public.enforce_chapter_seat_cap()            from public, anon, authenticated;
revoke execute on function public.grant_chapter_seat(uuid, text)        from public, anon, authenticated;
revoke execute on function public.revoke_chapter_seat(uuid)             from public, anon, authenticated;
revoke execute on function public.set_chapter_access(uuid, boolean)     from public, anon, authenticated;
revoke execute on function public.auth_user_id_for_email(text)          from public, anon, authenticated;

grant execute on function public.grant_chapter_seat(uuid, text)         to service_role;
grant execute on function public.revoke_chapter_seat(uuid)              to service_role;
grant execute on function public.set_chapter_access(uuid, boolean)      to service_role;
grant execute on function public.auth_user_id_for_email(text)           to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 · Board rank — "where am I", and the chapter's own board
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.my_board_rank(p_board text, p_season text)
returns table (
  rank                 bigint,
  total                bigint,
  founder_display_name text,
  company_name         text,
  industry             text,
  peak_valuation       numeric(20,2),
  years_survived       int,
  ended_by             text,
  achieved_on          date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      e.profile_id,
      e.founder_display_name,
      e.company_name,
      e.industry,
      e.peak_valuation,
      e.years_survived,
      e.ended_by,
      e.achieved_on,
      case p_board
        when 'valuation' then
          row_number() over (order by e.peak_valuation desc, e.achieved_on asc, e.id asc)
        else
          row_number() over (order by e.years_survived desc, e.peak_valuation desc, e.achieved_on asc, e.id asc)
      end as rn,
      count(*) over () as everyone
    from public.leaderboard_entries e
    where e.board = p_board
      and e.season = p_season
      and e.listed
  )
  select
    r.rn,
    r.everyone,
    r.founder_display_name,
    r.company_name,
    r.industry,
    r.peak_valuation,
    r.years_survived,
    r.ended_by,
    r.achieved_on
  from ranked r
  where r.profile_id = (select auth.uid());
$$;

create or replace function public.my_chapter_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.chapter_id
       from public.chapter_seats s
      where s.profile_id = (select auth.uid())),
    (select c.id
       from public.chapters c
      where c.owner_profile_id = (select auth.uid())
        and c.status = 'active'
      order by c.created_at desc
      limit 1)
  );
$$;

create or replace function public.chapter_board(p_board text, p_season text)
returns table (
  rank                 bigint,
  id                   uuid,
  founder_display_name text,
  company_name         text,
  industry             text,
  peak_valuation       numeric(20,2),
  years_survived       int,
  ended_by             text,
  achieved_on          date,
  season               text,
  is_me                boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select public.my_chapter_id() as cid
  ),
  members as (
    select s.profile_id
      from public.chapter_seats s, mine
     where s.chapter_id = mine.cid
    union
    select c.owner_profile_id
      from public.chapters c, mine
     where c.id = mine.cid
  )
  select
    case p_board
      when 'valuation' then
        row_number() over (order by e.peak_valuation desc, e.achieved_on asc, e.id asc)
      else
        row_number() over (order by e.years_survived desc, e.peak_valuation desc, e.achieved_on asc, e.id asc)
    end as rank,
    e.id,
    e.founder_display_name,
    e.company_name,
    e.industry,
    e.peak_valuation,
    e.years_survived,
    e.ended_by,
    e.achieved_on,
    e.season,
    (e.profile_id = (select auth.uid())) as is_me
  from public.leaderboard_entries e
  where e.board = p_board
    and e.season = p_season
    and e.listed
    and e.profile_id in (select profile_id from members)
  order by 1;
$$;

revoke execute on function public.my_board_rank(text, text) from public, anon;
revoke execute on function public.my_chapter_id()           from public, anon;
revoke execute on function public.chapter_board(text, text) from public, anon;

grant execute on function public.my_board_rank(text, text) to authenticated, service_role;
grant execute on function public.my_chapter_id()           to authenticated, service_role;
grant execute on function public.chapter_board(text, text) to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 · Admin — role on profiles, comped access, console SQL
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles: role + testing view, guarded against self-promotion ──────────
alter table public.profiles
  add column if not exists role text not null default 'player'
    check (role in ('player', 'admin'));
alter table public.profiles
  add column if not exists admin_view text
    check (admin_view in ('free', 'pro', 'all'));

create or replace function public.guard_admin_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

revoke execute on function public.guard_admin_columns() from public, anon, authenticated;

-- ── entitlements: the comp columns ─────────────────────────────────────────
alter table public.entitlements
  add column if not exists comp_pro boolean not null default false;
alter table public.entitlements
  add column if not exists comp_until timestamptz;
alter table public.entitlements
  add column if not exists comp_note text
    check (comp_note is null or length(comp_note) <= 280);

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

create or replace function public.admin_set_extra_islands(
  p_profile uuid,
  p_islands int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, least(greatest(coalesce(p_islands, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_islands = least(greatest(coalesce(p_islands, 0), 0), 20);
$$;

-- ── player_allowance: one copy of the run-a-day formula ────────────────────
create or replace function public.player_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case
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
  end
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

revoke execute on function public.player_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.player_allowance(uuid) to service_role;

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

-- ── chapters: comped licences ──────────────────────────────────────────────
alter table public.chapters
  alter column stripe_subscription_id drop not null;
alter table public.chapters
  add column if not exists source text not null default 'stripe'
    check (source in ('stripe', 'comp'));

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

-- ── admin_audit ────────────────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  actor        uuid references public.profiles(id) on delete set null,
  actor_email  text,
  action       text not null,
  target       uuid,
  target_email text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_target_idx  on public.admin_audit (target, created_at desc);

-- ── The console's reads ────────────────────────────────────────────────────
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
  extra_islands      int,
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
    coalesce(e.extra_islands, 0),
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

-- ── The stale-anonymous sweep learns about comps (0004, one guard wider) ───
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
          and (e.pro or e.comp_pro or e.extra_islands > 0
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

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke execute on function public.admin_set_comp_pro(uuid, boolean, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.admin_revoke_industry_pack(uuid, text)               from public, anon, authenticated;
revoke execute on function public.admin_set_extra_islands(uuid, int)                 from public, anon, authenticated;
revoke execute on function public.admin_create_comp_chapter(uuid, text, timestamptz)   from public, anon, authenticated;
revoke execute on function public.admin_revoke_comp_chapter(uuid)                      from public, anon, authenticated;
revoke execute on function public.admin_lapse_expired_comp_chapters()                  from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, int, int)                     from public, anon, authenticated;
revoke execute on function public.admin_stats()                                        from public, anon, authenticated;

grant execute on function public.admin_set_comp_pro(uuid, boolean, timestamptz, text)  to service_role;
grant execute on function public.admin_revoke_industry_pack(uuid, text)                to service_role;
grant execute on function public.admin_set_extra_islands(uuid, int)                  to service_role;
grant execute on function public.admin_create_comp_chapter(uuid, text, timestamptz)    to service_role;
grant execute on function public.admin_revoke_comp_chapter(uuid)                       to service_role;
grant execute on function public.admin_lapse_expired_comp_chapters()                   to service_role;
grant execute on function public.admin_list_users(text, int, int)                      to service_role;
grant execute on function public.admin_stats()                                        to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 · Admin analytics — cohorts, time series, and the daily snapshot
-- ═══════════════════════════════════════════════════════════════════════════

-- ── admin_daily: one row of COUNTS per day, written lazily ─────────────────
create table if not exists public.admin_daily (
  day             date primary key,
  accounts        int not null,
  new_accounts    int not null,
  active_1d       int not null,
  active_7d       int not null,
  active_30d      int not null,
  runs_started    int not null,
  pro_paid        int not null,
  pro_comp        int not null,
  seats           int not null,
  chapters_active int not null,
  saves_alive     int not null,
  board_listed    int not null,
  board_queue     int not null,
  captured_at     timestamptz not null default now()
);

alter table public.admin_daily enable row level security;
revoke all on public.admin_daily from anon, authenticated;

-- ── The last-seen expression, once ─────────────────────────────────────────
create or replace function public.admin_last_seen()
returns table (id uuid, created_at timestamptz, last_seen timestamptz)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    u.id,
    u.created_at,
    greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce((select max(s.updated_at) from public.saves s where s.profile_id = u.id), u.created_at),
      coalesce((select p.updated_at from public.preferences p where p.profile_id = u.id), u.created_at),
      coalesce((select l.updated_at from public.legacy l where l.profile_id = u.id), u.created_at)
    ) as last_seen
  from auth.users u
  where coalesce(u.is_anonymous, false) is false;
$$;

-- ── admin_timeseries ───────────────────────────────────────────────────────
create or replace function public.admin_timeseries(p_days int default 60)
returns table (
  day          date,
  signups      bigint,
  submissions  bigint,
  actives      int,
  runs_started int
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with span as (
    select generate_series(
      current_date - (least(greatest(coalesce(p_days, 60), 7), 365) - 1),
      current_date,
      interval '1 day'
    )::date as day
  ),
  signups as (
    select u.created_at::date as day, count(*) as n
      from auth.users u
     where coalesce(u.is_anonymous, false) is false
     group by 1
  ),
  submissions as (
    select e.created_at::date as day, count(*) as n
      from public.leaderboard_entries e
     group by 1
  )
  select
    span.day,
    coalesce(signups.n, 0),
    coalesce(submissions.n, 0),
    d.active_1d,
    d.runs_started
  from span
  left join signups     on signups.day = span.day
  left join submissions on submissions.day = span.day
  left join public.admin_daily d on d.day = span.day
  order by span.day;
$$;

-- ── admin_cohorts ──────────────────────────────────────────────────────────
create or replace function public.admin_cohorts(p_weeks int default 12)
returns table (
  week        date,
  cohort      bigint,
  bounced     bigint,
  retained_7  bigint,
  retained_30 bigint
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    date_trunc('week', s.created_at)::date as week,
    count(*) as cohort,
    count(*) filter (where s.last_seen <  s.created_at + interval '1 day')  as bounced,
    count(*) filter (where s.last_seen >= s.created_at + interval '7 days') as retained_7,
    count(*) filter (where s.last_seen >= s.created_at + interval '30 days') as retained_30
  from public.admin_last_seen() s
  where s.created_at >= date_trunc('week', now())
                        - (least(greatest(coalesce(p_weeks, 12), 1), 52) - 1) * interval '1 week'
  group by 1
  order by 1;
$$;

-- ── admin_capture_daily ────────────────────────────────────────────────────
create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, pro_paid, pro_comp, seats, chapters_active,
     saves_alive, board_listed, board_queue)
  select
    current_date,
    (select count(*) from public.admin_last_seen()),
    (select count(*) from public.admin_last_seen() s where s.created_at >= current_date),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '1 day'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '7 days'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '30 days'),
    coalesce((select sum(l.started) from public.run_ledger l
               where l.day = (now() at time zone 'utc')::date), 0),
    (select count(*) from public.entitlements e where e.pro),
    (select count(*) from public.entitlements e
      where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    (select count(*) from public.chapter_seats),
    (select count(*) from public.chapters c where c.status = 'active'),
    (select count(*) from public.saves s where s.alive),
    (select count(*) from public.leaderboard_entries l where l.listed),
    (select count(*) from public.leaderboard_entries l where l.listed is false)
  on conflict (day) do update set
    accounts        = excluded.accounts,
    new_accounts    = excluded.new_accounts,
    active_1d       = excluded.active_1d,
    active_7d       = excluded.active_7d,
    active_30d      = excluded.active_30d,
    runs_started    = excluded.runs_started,
    pro_paid        = excluded.pro_paid,
    pro_comp        = excluded.pro_comp,
    seats           = excluded.seats,
    chapters_active = excluded.chapters_active,
    saves_alive     = excluded.saves_alive,
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;

-- ── admin_stats learns what "seen" means ───────────────────────────────────
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with seen as (
    select * from public.admin_last_seen()
  )
  select jsonb_build_object(
    'accounts',       (select count(*) from seen),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from public.profiles p where p.role = 'admin'),
    'newWeek',        (select count(*) from seen s where s.created_at > now() - interval '7 days'),
    'activeToday',    (select count(*) from seen s where s.last_seen > now() - interval '1 day'),
    'activeWeek',     (select count(*) from seen s where s.last_seen > now() - interval '7 days'),
    'activeMonth',    (select count(*) from seen s where s.last_seen > now() - interval '30 days'),
    'activity',       (select jsonb_build_object(
                        'd1',    count(*) filter (where s.last_seen >  now() - interval '1 day'),
                        'd7',    count(*) filter (where s.last_seen <= now() - interval '1 day'
                                              and s.last_seen >  now() - interval '7 days'),
                        'd30',   count(*) filter (where s.last_seen <= now() - interval '7 days'
                                              and s.last_seen >  now() - interval '30 days'),
                        'd90',   count(*) filter (where s.last_seen <= now() - interval '30 days'
                                              and s.last_seen >  now() - interval '90 days'),
                        'older', count(*) filter (where s.last_seen <= now() - interval '90 days')
                      ) from seen s),
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

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke execute on function public.admin_last_seen()        from public, anon, authenticated;
revoke execute on function public.admin_timeseries(int)    from public, anon, authenticated;
revoke execute on function public.admin_cohorts(int)       from public, anon, authenticated;
revoke execute on function public.admin_capture_daily()    from public, anon, authenticated;
revoke execute on function public.admin_stats()            from public, anon, authenticated;

grant execute on function public.admin_last_seen()         to service_role;
grant execute on function public.admin_timeseries(int)     to service_role;
grant execute on function public.admin_cohorts(int)        to service_role;
grant execute on function public.admin_capture_daily()     to service_role;
grant execute on function public.admin_stats()             to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 · Custom chapters — a licence sized by the buyer
-- ═══════════════════════════════════════════════════════════════════════════
-- `chapter_custom`: a chapter whose seat count the buyer typed (the app
-- offers 10–500), priced by lib/monetization.ts and sold through the same
-- checkout, webhook and console as the fixed sizes. Two check constraints
-- named the two fixed licences; both widen. admin_create_comp_chapter learns
-- an optional p_seats so operators can comp custom sizes too. The full
-- reasoning lives in supabase/migrations/0011_custom_chapters.sql.

alter table public.chapters
  drop constraint if exists chapters_licence_check;
alter table public.chapters
  add constraint chapters_licence_check
  check (licence in ('chapter_35', 'chapter_100', 'chapter_custom'));

alter table public.entitlements
  drop constraint if exists entitlements_chapter_check;
alter table public.entitlements
  add constraint entitlements_chapter_check
  check (chapter in ('chapter_35', 'chapter_100', 'chapter_custom'));

-- The old three-argument signature is dropped rather than overloaded: two
-- candidates differing only by a defaulted trailing parameter make every
-- named-argument RPC call ambiguous. (0009 above recreated it; this section
-- always runs after, so the script converges on the four-argument one.)
drop function if exists public.admin_create_comp_chapter(uuid, text, timestamptz);

create or replace function public.admin_create_comp_chapter(
  p_owner   uuid,
  p_licence text,
  p_until   timestamptz default null,
  p_seats   int default null
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
  if p_licence = 'chapter_custom' then
    if p_seats is null or p_seats < 1 or p_seats > 500 then
      raise exception 'a custom chapter needs p_seats between 1 and 500'
        using errcode = '23514';
    end if;
    v_seats := p_seats;
  elsif v_seats is null then
    raise exception 'unknown licence %', p_licence using errcode = '23514';
  elsif p_seats is not null and p_seats <> v_seats then
    raise exception '% is % seats — p_seats is only for chapter_custom', p_licence, v_seats
      using errcode = '23514';
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

revoke execute on function public.admin_create_comp_chapter(uuid, text, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.admin_create_comp_chapter(uuid, text, timestamptz, int)
  to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 · Gifted pace — extra fiscal-year closes a day
-- ═══════════════════════════════════════════════════════════════════════════
-- Free closes four fiscal years a real day, Pro as many as it can pitch, and
-- between them an operator now has one account-sized dial: `extra_year_closes`
-- stacks on top of the tier's allowance, set outright, 0–20 — the shape
-- `extra_run_slots` already has. Pace is what Pro sells, so it is giftable; a
-- score, a survival and a place on the board still are not. The full reasoning
-- lives in supabase/migrations/0012_year_closes.sql.

alter table public.entitlements
  add column if not exists extra_year_closes int not null default 0;

alter table public.entitlements
  drop constraint if exists entitlements_extra_year_closes_check;
alter table public.entitlements
  add constraint entitlements_extra_year_closes_check
  check (extra_year_closes between 0 and 20);

create or replace function public.admin_set_extra_year_closes(
  p_profile uuid,
  p_closes  int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_year_closes)
  values (p_profile, least(greatest(coalesce(p_closes, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_year_closes = least(greatest(coalesce(p_closes, 0), 0), 20);
$$;

revoke execute on function public.admin_set_extra_year_closes(uuid, int)
  from public, anon, authenticated;
grant execute on function public.admin_set_extra_year_closes(uuid, int)
  to service_role;

-- The stale-anonymous sweep spares a granted allowance, exactly as it spares a
-- comp: 0009's version of this function above, plus the new column.
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
          and (e.pro or e.comp_pro or e.extra_islands > 0
               or e.extra_year_closes > 0
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



-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 · Islands — more than one company at a time, and the SKU that says so
-- ═══════════════════════════════════════════════════════════════════════════
-- `entitlements.extra_run_slots` fed the DAILY FOUNDING ration while the SKU
-- beside it, the one-time shelf and the Terms of Service all promised
-- CONCURRENCY. The column becomes what it was sold as (`extra_islands`), the
-- daily ration keeps the half that was always honest (tier only), and 0001's
-- `saves.slot` — reserved for ten companies since the first migration and
-- never used past zero — starts carrying them. Adds island_allowance() and a
-- BEFORE INSERT cap trigger that counts only LIVING companies, six listing
-- cache columns for the picker, and splits `savesAlive` from `playersPlaying`
-- so the stored analytics series does not change meaning underneath itself.
-- Its delete_stale_anonymous_users carries 0012's gifted-pace clause forward.
-- The full reasoning lives in supabase/migrations/0013_islands.sql.

-- ═══ entitlements.extra_run_slots → extra_islands ══════════════════════════
-- A rename rather than a new column: there is no data to preserve under the
-- old meaning that the new meaning would corrupt. Every player who bought one
-- was promised concurrency in writing; giving them concurrency is the fix, not
-- a migration hazard.
-- The check travelled with the column but kept its old name, and a constraint
-- called extra_run_slots_check on a column called extra_islands is the same
-- drift this migration exists to end. Guarded rather than bare: 0001 declared
-- the check inline so its name is one Postgres chose, and a project restored
-- from a dump or built by APPLY-ALL may carry a different one. A cosmetic
-- rename must never be the thing that aborts this migration.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.entitlements'::regclass
      and conname  = 'entitlements_extra_run_slots_check'
  ) then
    alter table public.entitlements
      rename constraint entitlements_extra_run_slots_check to entitlements_extra_islands_check;
  end if;
end;
$$;


-- ═══ saves — the listing cache the picker reads ════════════════════════════
-- Nullable, because every row that exists right now was written before these
-- columns did and there is no honest value to backfill: the numbers live
-- inside `state`, and the next write from the client mirrors them out. A
-- picker that renders a dash for one boot is correct; a picker that renders a
-- confident zero is not.
alter table public.saves
  -- Current company value, dollars. Signed and wide: valuation is not bounded
  -- by anything the sim promises, and a bigint that overflows is a 500 on a
  -- save, which is the one write that must never fail.
  add column if not exists valuation      bigint,
  -- The high-water mark. A dead company's card shows what it was worth at its
  -- best, which is the thing worth remembering about it; `valuation` at the
  -- moment of Chapter 7 is approximately zero and says nothing.
  add column if not exists peak_valuation bigint,
  add column if not exists cash           bigint,
  add column if not exists revenue_annual bigint,
  add column if not exists employees      int,
  -- AvatarConfig. jsonb rather than shredded columns for the same reason
  -- `state` is jsonb: the closet gains fields, and a card that shows the wrong
  -- hair is a smaller bug than a migration per cosmetic.
  add column if not exists avatar         jsonb;


-- ═══ island_allowance — how many companies may exist at once ═══════════════
-- The concurrency counterpart to player_allowance below. Same shape on
-- purpose: definer-only, read from the database, never trusted from a caller,
-- and one copy of the formula so the client's version in lib/monetization.ts
-- has exactly one thing to agree with.
--
-- Capped at 10 whatever the arithmetic says, because `saves.slot` is checked
-- `between 0 and 9` and an allowance that exceeds its own storage is a promise
-- the insert below would have to break.
create or replace function public.island_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select least(10, case
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 2 + coalesce(e.extra_islands, 0)
        when 'pro'  then 10
        else 10
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 10
           else 2 + coalesce(e.extra_islands, 0) end
  end)
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

-- Service role only, and NOT readable by the player, even about themselves.
-- The argument is a profile id, so a function `authenticated` could call would
-- answer "is this other account Pro?" for any uuid a player cared to type —
-- 0002's rule is that entitlements never leave their own row, and a convenience
-- grant here would be the hole. The picker does not need it: the client already
-- receives its own entitlements through /api/sync and computes the same cap in
-- lib/monetization.ts. The trigger below reaches it as a definer, not a caller.
revoke execute on function public.island_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.island_allowance(uuid) to service_role;


-- ═══ The cap, enforced where it cannot be edited ═══════════════════════════
-- lib/monetization.ts enforces this client-side, and the client is a browser.
-- 0002's header is blunt about what that is worth: localStorage is "plain
-- JSON, and anyone who opens devtools can write anything into it".
--
-- BEFORE INSERT only. An upsert onto a slot the player already owns arrives as
-- an UPDATE through `on conflict do update` and must stay free — a player at
-- their cap still has to be able to save the companies they have.
--
-- ── Only LIVING companies count ────────────────────────────────────────────
--
-- A company that reached Chapter 7, an acquisition or an IPO keeps its row and
-- keeps its island, as a headstone the player can go back and read. It does
-- NOT spend the allowance. Counting the dead would mean a free player's two
-- islands fill with two graves and the game politely stops, which is the
-- shape of a limit designed to sell something rather than to mean something.
--
-- The rows still cost a slot, and `slot between 0 and 9` still caps those at
-- ten. The client evicts the oldest headstone when a founding needs the room
-- (firstFreeIsland in lib/engine/save.ts); this function's job is only to stop
-- an eleventh LIVE company, which is the thing that was actually sold.
create or replace function public.enforce_island_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed int;
  held    int;
begin
  -- A dead company arriving as a fresh INSERT cannot exceed a living-company
  -- allowance, and refusing it would strand a headstone the client is trying
  -- to restore from the cloud.
  if new.alive is false then
    return new;
  end if;

  allowed := coalesce(public.island_allowance(new.profile_id), 2);
  select count(*) into held
    from public.saves s
   where s.profile_id = new.profile_id and s.alive;

  if held >= allowed then
    raise exception 'island allowance exhausted (% of %)', held, allowed
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists saves_island_cap on public.saves;
create trigger saves_island_cap
  before insert on public.saves
  for each row execute function public.enforce_island_cap();


-- ═══ grant_extra_run_slot → grant_extra_island ═════════════════════════════
-- Same Stripe price, same webhook, same non-idempotency for the same reason:
-- two bought is two. What changed is only what the player receives, and it is
-- now what the product description always said they were buying.
drop function if exists public.grant_extra_run_slot(uuid);

create or replace function public.grant_extra_island(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_islands = least(public.entitlements.extra_islands + 1, 20);
$$;

revoke execute on function public.grant_extra_island(uuid) from public, anon, authenticated;
grant  execute on function public.grant_extra_island(uuid) to service_role;


-- ═══ admin_set_extra_run_slots → admin_set_extra_islands ═══════════════════
drop function if exists public.admin_set_extra_run_slots(uuid, int);

create or replace function public.admin_set_extra_islands(
  p_profile uuid,
  p_islands int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, least(greatest(coalesce(p_islands, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_islands = least(greatest(coalesce(p_islands, 0), 0), 20);
$$;

revoke execute on function public.admin_set_extra_islands(uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_set_extra_islands(uuid, int) to service_role;


-- ═══ player_allowance loses its purchasable component ══════════════════════
-- 0009's version was `tier + coalesce(e.extra_run_slots, 0)`. The purchase
-- moved to islands, so the daily ration is now tier alone: free one founding a
-- day, Pro three. Everything else — the admin view switch, the comp window,
-- the chapter seat, the finite 999 — is 0009 verbatim.
--
-- Note for whoever reads this next: this function and claim_run_slot() have
-- ZERO TypeScript callers today. The run-a-day rule is enforced only in
-- lib/state/GameProvider.tsx against localStorage. That was true before this
-- migration and is not made worse by it, but it is the reason a determined
-- player can still found more often than the pricing page says.
create or replace function public.player_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case
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
  end
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

revoke execute on function public.player_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.player_allowance(uuid) to service_role;


-- ═══ The stale-anonymous sweep follows the rename ══════════════════════════
-- 0012's version, with the one column renamed.
--
-- 0012 replaced this function to spare an account holding GIFTED PACE, and
-- this migration replaces it again — so its clause has to be carried forward
-- here or the gift stops protecting anything the moment islands land. Two
-- migrations owning one function is how a feature regresses without a single
-- line of its own code changing.
--
-- An anonymous account holding a bought island is evidence of a purchase, and
-- one holding gifted year-closes is evidence an operator attached value to it.
-- Neither may be swept.
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
          and (e.pro or e.comp_pro or e.extra_islands > 0
               or e.extra_year_closes > 0
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

revoke execute on function public.delete_stale_anonymous_users(interval) from public, anon, authenticated;
grant  execute on function public.delete_stale_anonymous_users(interval) to service_role;


-- ═══ admin_list_users follows the rename ═══════════════════════════════════
-- DROP then CREATE rather than CREATE OR REPLACE: the rename is in the RETURNS
-- TABLE column list, and Postgres refuses to replace a function whose output
-- type changed. The body is 0009's, with the one column renamed.
drop function if exists public.admin_list_users(text, int, int);

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
  extra_islands        int,
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
    coalesce(e.extra_islands, 0),
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
  left join public.chapters oc         on oc.owner_profile_id = u.id and oc.status = 'active'
  left join public.chapter_seats s     on s.profile_id = u.id
  cross join q
  where q.needle is null
     or u.email ilike '%' || q.needle || '%'
     or p.display_name ilike '%' || q.needle || '%'
     or u.id::text = q.needle
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.admin_list_users(text, int, int) from public, anon, authenticated;
grant  execute on function public.admin_list_users(text, int, int) to service_role;


-- ═══ savesAlive stops meaning two things ═══════════════════════════════════
-- `count(*) from saves where alive` was written when one player was one save,
-- so the console could label it LIVE COMPANIES and mean players by it. The day
-- slot 1 is first written those diverge, silently, inside a stored time series
-- with no way to tell the old rows from the new.
--
-- Both numbers are now recorded under names that can only mean one thing.
alter table public.admin_daily
  add column if not exists players_playing int;

create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, pro_paid, pro_comp, seats, chapters_active,
     saves_alive, players_playing, board_listed, board_queue)
  select
    current_date,
    (select count(*) from public.admin_last_seen()),
    (select count(*) from public.admin_last_seen() s where s.created_at >= current_date),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '1 day'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '7 days'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '30 days'),
    coalesce((select sum(l.started) from public.run_ledger l
               where l.day = (now() at time zone 'utc')::date), 0),
    (select count(*) from public.entitlements e where e.pro),
    (select count(*) from public.entitlements e
      where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    (select count(*) from public.chapter_seats),
    (select count(*) from public.chapters c where c.status = 'active'),
    -- Companies.
    (select count(*) from public.saves s where s.alive),
    -- People. Before islands these two were the same number by construction.
    (select count(distinct s.profile_id) from public.saves s where s.alive),
    (select count(*) from public.leaderboard_entries l where l.listed),
    (select count(*) from public.leaderboard_entries l where l.listed is false)
  on conflict (day) do update set
    accounts        = excluded.accounts,
    new_accounts    = excluded.new_accounts,
    active_1d       = excluded.active_1d,
    active_7d       = excluded.active_7d,
    active_30d      = excluded.active_30d,
    runs_started    = excluded.runs_started,
    pro_paid        = excluded.pro_paid,
    pro_comp        = excluded.pro_comp,
    seats           = excluded.seats,
    chapters_active = excluded.chapters_active,
    saves_alive     = excluded.saves_alive,
    players_playing = excluded.players_playing,
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;

revoke execute on function public.admin_capture_daily() from public, anon, authenticated;
grant  execute on function public.admin_capture_daily() to service_role;


-- ═══ admin_stats gains the same distinction ════════════════════════════════
-- 0010's body, with `playersPlaying` beside `savesAlive` and `islandsSold`
-- replacing nothing — it is new, and it is the number that says whether the
-- re-pointed SKU is selling.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with seen as (
    select * from public.admin_last_seen()
  )
  select jsonb_build_object(
    'accounts',       (select count(*) from seen),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from public.profiles p where p.role = 'admin'),
    'newWeek',        (select count(*) from seen s where s.created_at > now() - interval '7 days'),
    'activeToday',    (select count(*) from seen s where s.last_seen > now() - interval '1 day'),
    'activeWeek',     (select count(*) from seen s where s.last_seen > now() - interval '7 days'),
    'activeMonth',    (select count(*) from seen s where s.last_seen > now() - interval '30 days'),
    'activity',       (select jsonb_build_object(
                        'd1',    count(*) filter (where s.last_seen >  now() - interval '1 day'),
                        'd7',    count(*) filter (where s.last_seen <= now() - interval '1 day'
                                              and s.last_seen >  now() - interval '7 days'),
                        'd30',   count(*) filter (where s.last_seen <= now() - interval '7 days'
                                              and s.last_seen >  now() - interval '30 days'),
                        'd90',   count(*) filter (where s.last_seen <= now() - interval '30 days'
                                              and s.last_seen >  now() - interval '90 days'),
                        'older', count(*) filter (where s.last_seen <= now() - interval '90 days')
                      ) from seen s),
    'proPaid',        (select count(*) from public.entitlements e where e.pro),
    'proComp',        (select count(*) from public.entitlements e
                        where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    'chapterSeats',   (select count(*) from public.chapter_seats),
    'chaptersActive', (select count(*) from public.chapters c where c.status = 'active'),
    'chaptersComp',   (select count(*) from public.chapters c
                        where c.status = 'active' and c.source = 'comp'),
    -- Companies, then the people running them. See admin_capture_daily.
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'playersPlaying', (select count(distinct s.profile_id) from public.saves s where s.alive),
    'islandsSold',    (select coalesce(sum(e.extra_islands), 0) from public.entitlements e),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;

revoke execute on function public.admin_stats() from public, anon, authenticated;
grant  execute on function public.admin_stats() to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 · Chapters bigger than a classroom
-- ═══════════════════════════════════════════════════════════════════════════
-- Folded in late: this file stopped at 0013 while two migrations went past it,
-- so an operator pasting it got a database that refused the seat counts and
-- the island counts the app had already shipped. The header above says "when a
-- migration changes, regenerate this file too" — this is that, for both.
--
-- Both bounds move to 10,000. The reasoning is in the migration; the short
-- version is that 500 was 0007's sanity bound, not a size anybody decided a
-- chapter stops at, and it was refusing the largest cheque on the page.

alter table public.chapters
  drop constraint if exists chapters_seats_check;

alter table public.chapters
  add constraint chapters_seats_check
  check (seats between 1 and 10000);

create or replace function public.admin_create_comp_chapter(
  p_owner   uuid,
  p_licence text,
  p_until   timestamptz default null,
  p_seats   int default null
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
  if p_licence = 'chapter_custom' then
    if p_seats is null or p_seats < 1 or p_seats > 10000 then
      raise exception 'a custom chapter needs p_seats between 1 and 10000'
        using errcode = '23514';
    end if;
    v_seats := p_seats;
  elsif v_seats is null then
    raise exception 'unknown licence %', p_licence using errcode = '23514';
  elsif p_seats is not null and p_seats <> v_seats then
    raise exception '% is % seats — p_seats is only for chapter_custom', p_licence, v_seats
      using errcode = '23514';
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 · Islands past ten, and a purchase that works on every tier
-- ═══════════════════════════════════════════════════════════════════════════
-- The ceiling moves 10 → 50, and the tier stops BEING the ceiling: free is
-- 2 + bought, Pro is 10 + bought, both clamp at 50. Pro used to receive a flat
-- 10 — the whole ceiling — so a subscriber's Extra Island purchased nothing at
-- all. Full reasoning, including why 50 and not "no limit", is in the
-- migration; the short version is that localStorage is the game's primary
-- store and gives an origin about 5 MB against ~90 KB a company.

alter table public.saves
  drop constraint if exists saves_slot_check;

alter table public.saves
  add constraint saves_slot_check
  check (slot between 0 and 49);

-- Two possible names: the constraint was born in 0001 on `extra_run_slots` and
-- renamed by 0013 only where the old name was found. At most one exists.
alter table public.entitlements
  drop constraint if exists entitlements_extra_run_slots_check;

alter table public.entitlements
  drop constraint if exists entitlements_extra_islands_check;

alter table public.entitlements
  add constraint entitlements_extra_islands_check
  check (extra_islands between 0 and 48);

create or replace function public.island_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select least(50, case
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 2 + coalesce(e.extra_islands, 0)
        when 'pro'  then 10 + coalesce(e.extra_islands, 0)
        else 50
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 10 + coalesce(e.extra_islands, 0)
           else 2 + coalesce(e.extra_islands, 0) end
  end)
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

revoke execute on function public.island_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.island_allowance(uuid) to service_role;

create or replace function public.grant_extra_island(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_islands = least(public.entitlements.extra_islands + 1, 48);
$$;

revoke execute on function public.grant_extra_island(uuid) from public, anon, authenticated;
grant  execute on function public.grant_extra_island(uuid) to service_role;

create or replace function public.admin_set_extra_islands(
  p_profile uuid,
  p_islands int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, least(greatest(coalesce(p_islands, 0), 0), 48))
  on conflict (profile_id) do update
    set extra_islands = least(greatest(coalesce(p_islands, 0), 0), 48);
$$;

revoke execute on function public.admin_set_extra_islands(uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_set_extra_islands(uuid, int) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 · Admin insight — what "paid" means, and what the console can see
-- ═══════════════════════════════════════════════════════════════════════════
-- PRO · PAID counted `entitlements.pro` alone, which is written by the Stripe
-- webhook and by nothing else — so it read zero for every subscriber whose
-- webhook never landed, while `billing_customers` (written by the checkout
-- route, before Stripe ever sees the customer) had the truth the whole time.
-- "Paid" is now the union of both records and the disagreement between them is
-- counted and listed rather than hidden. The directory learns what an account
-- has actually done — runs, companies, what those companies are worth — and a
-- board handle can be changed without stranding the rows already carrying it.
--
-- The full reasoning lives in supabase/migrations/0016_admin_insight.sql.

-- ═══ Reading money out of a save ════════════════════════════════════════════
-- 0013 added `saves.valuation`, `peak_valuation` and `cash` — the listing
-- cache the islands picker draws its cards from, mirrored out of `state` by
-- the sync route on every write. Those columns are the right source and every
-- reader below prefers them.
--
-- They are also NULLABLE, and deliberately so: 0013 refused to backfill rows
-- written before the columns existed, because the honest value was inside
-- `state` and a confident zero would have been a lie. A console that showed a
-- dash for every company founded before that migration would be repeating the
-- same omission this file exists to fix, so these functions are the fallback —
-- the figure is read out of the blob when the column has not been filled in
-- yet, and the next save from that device fills the column in for good.
--
-- The regex guard is the whole point of these being functions. `(x)::numeric`
-- on a blob written by an older client — or by a client that stored a string,
-- or `null`, or `Infinity` — raises, and a raise inside `admin_stats` is a
-- console that shows nothing at all because one save is odd. A malformed
-- figure is simply not a figure here.
create or replace function public.save_number(p_state jsonb, variadic p_path text[])
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when (p_state #>> p_path) ~ '^-?[0-9]+(\.[0-9]+)?$'
    then (p_state #>> p_path)::numeric
  end;
$$;

/** What the books read right now. */
create or replace function public.save_valuation(p_state jsonb)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.save_number(p_state, 'stats', 'valuation');
$$;

/** The highest they ever read. Runs founded before `peakValuation` existed
    fall back to the current figure, which is what the year-end statement does
    (lib/engine/save.ts). */
create or replace function public.save_peak_valuation(p_state jsonb)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.save_number(p_state, 'peakValuation'),
    public.save_number(p_state, 'stats', 'valuation')
  );
$$;


-- ═══ Who is paying, in one place ════════════════════════════════════════════
-- The formula that was scattered across a stats tile, a badge and a detail
-- panel — each deciding for itself — is now one function every reader below
-- calls. `paid` is the union described at the top; `mismatch` is the pair of
-- ways the two records can disagree, named rather than merely counted:
--
--   'stripe-not-granted' — Stripe is charging and the entitlement is false.
--                          The player is paying and does not have Pro. Fix by
--                          re-syncing the subscription (/api/admin/reconcile).
--   'granted-not-billed' — the entitlement is true and Stripe has nothing
--                          live. Usually a legitimate history (a subscription
--                          that lapsed while the flag was never cleared), and
--                          always worth a look: it is free Pro.
--
-- `source` answers "why does this account have Pro" in the order the app
-- itself decides access (lib/admin/entitlements.ts): the role first, then
-- money, then a gift, then a classroom seat.
create or replace function public.admin_access()
returns table (
  id            uuid,
  role          text,
  ent_pro       boolean,
  stripe_pro    boolean,
  comp_pro      boolean,
  seat          boolean,
  paid          boolean,
  effective_pro boolean,
  source        text,
  mismatch      text,
  plan          text
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with base as (
    select
      p.id,
      coalesce(p.role, 'player')                              as role,
      coalesce(e.pro, false)                                  as ent_pro,
      coalesce(b.subscription_status in ('active', 'trialing', 'past_due'), false)
                                                              as stripe_pro,
      (coalesce(e.comp_pro, false)
        and (e.comp_until is null or e.comp_until > now()))    as comp_pro,
      (e.chapter is not null)                                 as seat,
      b.plan
    from public.profiles p
    left join public.entitlements e      on e.profile_id = p.id
    left join public.billing_customers b on b.profile_id = p.id
  )
  select
    b.id,
    b.role,
    b.ent_pro,
    b.stripe_pro,
    b.comp_pro,
    b.seat,
    (b.ent_pro or b.stripe_pro) as paid,
    (b.role = 'admin' or b.ent_pro or b.stripe_pro or b.comp_pro or b.seat)
      as effective_pro,
    case
      when b.role = 'admin'              then 'admin'
      when b.ent_pro or b.stripe_pro     then 'paid'
      when b.comp_pro                    then 'gift'
      when b.seat                        then 'chapter'
    end as source,
    case
      when b.stripe_pro and not b.ent_pro then 'stripe-not-granted'
      when b.ent_pro and not b.stripe_pro then 'granted-not-billed'
    end as mismatch,
    b.plan
  from base b;
$$;


-- ═══ The overview numbers, corrected and widened ════════════════════════════
-- 0013's body, with the paid family rebuilt on admin_access() and the play
-- figures the directory was missing. Keys that existed keep their names and
-- their meaning; `proPaid` is the one whose ANSWER changes, and it changes
-- from "wrong" to "right".
--
-- Money is deliberately absent: this function counts subscriptions by plan and
-- the console multiplies by the prices in lib/monetization.ts, so a price rise
-- is one edit in the place prices already live rather than a number baked into
-- a migration that nobody will remember to change.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with seen as (
    select * from public.admin_last_seen()
  ),
  access as (
    select * from public.admin_access()
  )
  select jsonb_build_object(
    'accounts',       (select count(*) from seen),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from access a where a.role = 'admin'),
    'newWeek',        (select count(*) from seen s where s.created_at > now() - interval '7 days'),
    'activeToday',    (select count(*) from seen s where s.last_seen > now() - interval '1 day'),
    'activeWeek',     (select count(*) from seen s where s.last_seen > now() - interval '7 days'),
    'activeMonth',    (select count(*) from seen s where s.last_seen > now() - interval '30 days'),
    'activity',       (select jsonb_build_object(
                        'd1',    count(*) filter (where s.last_seen >  now() - interval '1 day'),
                        'd7',    count(*) filter (where s.last_seen <= now() - interval '1 day'
                                              and s.last_seen >  now() - interval '7 days'),
                        'd30',   count(*) filter (where s.last_seen <= now() - interval '7 days'
                                              and s.last_seen >  now() - interval '30 days'),
                        'd90',   count(*) filter (where s.last_seen <= now() - interval '30 days'
                                              and s.last_seen >  now() - interval '90 days'),
                        'older', count(*) filter (where s.last_seen <= now() - interval '90 days')
                      ) from seen s),

    -- ── Paid, and the evidence on both sides of it ──────────────────────────
    'proPaid',        (select count(*) from access a where a.paid),
    'proStripe',      (select count(*) from access a where a.stripe_pro),
    'proGranted',     (select count(*) from access a where a.ent_pro),
    'proComp',        (select count(*) from access a where a.comp_pro),
    'proChapter',     (select count(*) from access a where a.seat),
    'proEffective',   (select count(*) from access a where a.effective_pro),
    'proMonthly',     (select count(*) from access a where a.paid and a.plan = 'pro_monthly'),
    'proYearly',      (select count(*) from access a where a.paid and a.plan = 'pro_yearly'),
    'proUnknownPlan', (select count(*) from access a where a.paid and a.plan is null),
    'billingMismatch',(select count(*) from access a where a.mismatch is not null),
    'notGranted',     (select count(*) from access a where a.mismatch = 'stripe-not-granted'),
    'notBilled',      (select count(*) from access a where a.mismatch = 'granted-not-billed'),
    'cancelling',     (select count(*) from public.billing_customers b
                        where b.cancel_at_period_end
                          and b.subscription_status in ('active', 'trialing', 'past_due')),
    'pastDue',        (select count(*) from public.billing_customers b
                        where b.subscription_status = 'past_due'),

    'chapterSeats',   (select count(*) from public.chapter_seats),
    'chaptersActive', (select count(*) from public.chapters c where c.status = 'active'),
    'chaptersComp',   (select count(*) from public.chapters c
                        where c.status = 'active' and c.source = 'comp'),

    -- ── What has actually been played ───────────────────────────────────────
    -- `runsCompleted` is the legacy ledger's own count — companies carried to
    -- an ending, which is what "a run they have done" means to a player.
    -- `companies` counts every company ever founded that still has a save,
    -- alive or headstone. `runsToday` is starts, off the day's run_ledger.
    'runsCompleted',  (select coalesce(sum(l.runs_completed), 0) from public.legacy l),
    'runsToday',      (select coalesce(sum(r.started), 0) from public.run_ledger r
                        where r.day = (now() at time zone 'utc')::date),
    'companies',      (select count(*) from public.saves),
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'playersPlaying', (select count(distinct s.profile_id) from public.saves s where s.alive),
    'islandsSold',    (select coalesce(sum(e.extra_islands), 0) from public.entitlements e),
    'valuationLive',  (select coalesce(sum(coalesce(s.valuation, public.save_valuation(s.state))), 0)::bigint
                        from public.saves s where s.alive),
    'valuationBest',  (select coalesce(max(coalesce(s.peak_valuation, public.save_peak_valuation(s.state))), 0)::bigint
                        from public.saves s),

    'boardEntries',   (select count(*) from public.leaderboard_entries),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;


-- ═══ The daily snapshot follows the correction ══════════════════════════════
-- `pro_paid` in admin_daily was the same undercount, and a stored series is
-- worse than a wrong tile: it keeps the wrong number after the bug is fixed.
-- Today's row is rewritten on every console load, so the correction takes hold
-- from now; the history before it stays as it was recorded and is not
-- retro-edited, because inventing yesterday's number is the one thing this
-- table's own header refuses to do.
alter table public.admin_daily
  add column if not exists pro_effective  int,
  add column if not exists runs_completed int;

create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, runs_completed, pro_paid, pro_comp, pro_effective, seats,
     chapters_active, saves_alive, players_playing, board_listed, board_queue)
  select
    current_date,
    (select count(*) from public.admin_last_seen()),
    (select count(*) from public.admin_last_seen() s where s.created_at >= current_date),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '1 day'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '7 days'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '30 days'),
    coalesce((select sum(l.started) from public.run_ledger l
               where l.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(g.runs_completed) from public.legacy g), 0),
    (select count(*) from public.admin_access() a where a.paid),
    (select count(*) from public.admin_access() a where a.comp_pro),
    (select count(*) from public.admin_access() a where a.effective_pro),
    (select count(*) from public.chapter_seats),
    (select count(*) from public.chapters c where c.status = 'active'),
    (select count(*) from public.saves s where s.alive),
    (select count(distinct s.profile_id) from public.saves s where s.alive),
    (select count(*) from public.leaderboard_entries l where l.listed),
    (select count(*) from public.leaderboard_entries l where l.listed is false)
  on conflict (day) do update set
    accounts        = excluded.accounts,
    new_accounts    = excluded.new_accounts,
    active_1d       = excluded.active_1d,
    active_7d       = excluded.active_7d,
    active_30d      = excluded.active_30d,
    runs_started    = excluded.runs_started,
    runs_completed  = excluded.runs_completed,
    pro_paid        = excluded.pro_paid,
    pro_comp        = excluded.pro_comp,
    pro_effective   = excluded.pro_effective,
    seats           = excluded.seats,
    chapters_active = excluded.chapters_active,
    saves_alive     = excluded.saves_alive,
    players_playing = excluded.players_playing,
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;


-- ═══ The directory learns what an account has done ══════════════════════════
-- 0013's version plus the play record, the board name, the honest paid answer
-- and the last-seen stamp. The return type changes, so the function is dropped
-- and rebuilt — the same dance 0013 did for the same reason.
--
-- The play figures come through one lateral per table rather than joins, so an
-- account with three companies stays one row: a join to `saves` here would
-- triple every account in the list and quietly break `count(*) over ()`.
drop function if exists public.admin_list_users(text, int, int);

create or replace function public.admin_list_users(
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id                   uuid,
  email                text,
  display_name         text,
  board_handle         text,
  role                 text,
  is_anonymous         boolean,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  last_seen            timestamptz,
  pro                  boolean,
  paid                 boolean,
  effective_pro        boolean,
  access_source        text,
  billing_mismatch     text,
  comp_pro             boolean,
  comp_until           timestamptz,
  comp_note            text,
  chapter              text,
  extra_islands        int,
  extra_year_closes    int,
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
  runs_completed       int,
  best_year            int,
  companies            int,
  companies_alive      int,
  top_valuation        bigint,
  live_valuation       bigint,
  top_company          text,
  board_entries        int,
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
    p.board_handle,
    coalesce(p.role, 'player'),
    coalesce(u.is_anonymous, false),
    u.created_at,
    u.last_sign_in_at,
    coalesce(ls.last_seen, u.last_sign_in_at, u.created_at),
    coalesce(e.pro, false),
    coalesce(ac.paid, false),
    coalesce(ac.effective_pro, false),
    ac.source,
    ac.mismatch,
    coalesce(e.comp_pro, false),
    e.comp_until,
    e.comp_note,
    e.chapter,
    coalesce(e.extra_islands, 0),
    coalesce(e.extra_year_closes, 0),
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
    coalesce(lg.runs_completed, 0),
    coalesce(lg.best_year, 0),
    coalesce(sv.companies, 0),
    coalesce(sv.alive, 0),
    coalesce(sv.top_valuation, 0)::bigint,
    coalesce(sv.live_valuation, 0)::bigint,
    sv.top_company,
    coalesce(bd.entries, 0),
    count(*) over () as total
  from auth.users u
  left join public.profiles p          on p.id = u.id
  left join public.entitlements e      on e.profile_id = u.id
  left join public.billing_customers b on b.profile_id = u.id
  left join public.legacy lg           on lg.profile_id = u.id
  -- Both of these are set-returning functions joined ONCE, not laterally per
  -- row: a lateral here would re-run the whole function for every account in
  -- the page, which is the same table scanned fifty times to answer fifty
  -- questions it could answer in one.
  left join (select * from public.admin_access())    ac on ac.id = u.id
  left join (select * from public.admin_last_seen()) ls on ls.id = u.id
  left join lateral (
    -- Every company this account has founded, folded to one row: how many,
    -- how many alive, the best figure the books ever showed and which company
    -- showed it, and what the live ones are worth together.
    select
      count(*)::int                                            as companies,
      count(*) filter (where sa.alive)::int                     as alive,
      max(coalesce(sa.peak_valuation, public.save_peak_valuation(sa.state)))
                                                                as top_valuation,
      sum(coalesce(sa.valuation, public.save_valuation(sa.state))) filter (where sa.alive)
                                                                as live_valuation,
      (array_agg(sa.company_name
                 order by coalesce(sa.peak_valuation, public.save_peak_valuation(sa.state))
                          desc nulls last))[1]                  as top_company
      from public.saves sa
     where sa.profile_id = u.id
  ) sv on true
  left join lateral (
    select count(*)::int as entries
      from public.leaderboard_entries le
     where le.profile_id = u.id
  ) bd on true
  left join lateral (
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
     or p.board_handle ilike '%' || q.needle || '%'
     or u.id::text = lower(q.needle)
  order by u.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- ═══ One account's companies, with their figures ════════════════════════════
-- The detail panel listed a company's name, industry and year and stopped
-- short of the only question an operator actually asks about a company, which
-- is what it is worth. `saves.state` is up to a megabyte, so the route must
-- not select it — this function reads the blob in the database and returns the
-- three numbers out of it.
create or replace function public.admin_user_companies(p_profile uuid)
returns table (
  slot           smallint,
  company_name   text,
  industry       text,
  year           int,
  month          smallint,
  stage          smallint,
  alive          boolean,
  ended_by       text,
  valuation      bigint,
  peak_valuation bigint,
  cash           bigint,
  revenue_annual bigint,
  employees      int,
  updated_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.slot,
    s.company_name,
    s.industry,
    s.year,
    s.month,
    s.stage,
    s.alive,
    s.ended_by,
    coalesce(s.valuation, public.save_valuation(s.state), 0)::bigint,
    coalesce(s.peak_valuation, public.save_peak_valuation(s.state), 0)::bigint,
    coalesce(s.cash, public.save_number(s.state, 'stats', 'cash'), 0)::bigint,
    coalesce(s.revenue_annual, public.save_number(s.state, 'stats', 'revenueAnnual'), 0)::bigint,
    s.employees,
    s.updated_at
  from public.saves s
  where s.profile_id = p_profile
  order by s.slot;
$$;


-- ═══ The companies worth looking at ═════════════════════════════════════════
-- The console's own answer to "how is anyone actually doing" — the biggest
-- live companies in the game, by what their books read now, with the account
-- behind each one so the operator can open it.
create or replace function public.admin_top_companies(p_limit int default 10)
returns table (
  profile_id     uuid,
  email          text,
  board_handle   text,
  company_name   text,
  industry       text,
  year           int,
  stage          smallint,
  alive          boolean,
  valuation      bigint,
  peak_valuation bigint,
  updated_at     timestamptz
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    s.profile_id,
    u.email,
    p.board_handle,
    s.company_name,
    s.industry,
    s.year,
    s.stage,
    s.alive,
    coalesce(s.valuation, public.save_valuation(s.state), 0)::bigint,
    coalesce(s.peak_valuation, public.save_peak_valuation(s.state), 0)::bigint,
    s.updated_at
  from public.saves s
  left join auth.users u      on u.id = s.profile_id
  left join public.profiles p on p.id = s.profile_id
  order by coalesce(s.peak_valuation, public.save_peak_valuation(s.state)) desc nulls last,
           s.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;


-- ═══ Where the two billing records disagree ═════════════════════════════════
-- The list behind the mismatch count. Ordered worst-first: an account Stripe
-- is charging that has no Pro is a player being taken money from for nothing,
-- and it comes before an account holding Pro nobody is being charged for.
create or replace function public.admin_billing_mismatches(p_limit int default 50)
returns table (
  id                  uuid,
  email               text,
  display_name        text,
  kind                text,
  entitlement_pro     boolean,
  subscription_status text,
  plan                text,
  current_period_end  timestamptz,
  has_customer        boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    a.id,
    u.email,
    p.display_name,
    a.mismatch,
    a.ent_pro,
    b.subscription_status,
    b.plan,
    b.current_period_end,
    (b.profile_id is not null)
  from public.admin_access() a
  left join auth.users u               on u.id = a.id
  left join public.profiles p          on p.id = a.id
  left join public.billing_customers b on b.profile_id = a.id
  where a.mismatch is not null
  order by (a.mismatch = 'stripe-not-granted') desc, u.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;


-- ═══ A board name that can be changed ═══════════════════════════════════════
-- `leaderboard_entries.founder_display_name` is a copy of the handle, taken at
-- submission. That was correct while a handle was claimed once and kept
-- forever; it stops being correct the moment the player can change it, because
-- the rows they already hold would keep a name they no longer answer to — and
-- the screen finds "your" row by comparing the two strings, so their own entry
-- would stop being highlighted as theirs.
--
-- `security definer` because the writer is the PLAYER, through their own
-- session and their own RLS policy on `profiles`; nothing in 0002 lets that
-- session touch an entry row, and nothing should. The trigger carries the
-- rename across on the player's behalf and can do nothing else: it writes one
-- column, on rows already belonging to the profile being renamed.
--
-- The pool constraint on both columns is the same regex, so a rename that
-- passes on `profiles` cannot fail on `leaderboard_entries`.
create or replace function public.sync_board_handle_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.board_handle is not null
     and new.board_handle is distinct from old.board_handle then
    update public.leaderboard_entries
       set founder_display_name = new.board_handle
     where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_board_handle_rename on public.profiles;
create trigger profiles_board_handle_rename
  after update of board_handle on public.profiles
  for each row execute function public.sync_board_handle_rename();

-- Trigger plumbing, never called directly — the 0009 treatment.
revoke execute on function public.sync_board_handle_rename() from public, anon, authenticated;


-- ═══ Grants — revoke first, then exactly one role ═══════════════════════════
-- The three `save_*` readers are pure functions over a jsonb value the caller
-- already holds, so they are harmless by construction — but they are only ever
-- called from the functions below, and a function nobody needs to call is a
-- function nobody should be able to.
revoke execute on function public.save_number(jsonb, text[])        from public, anon, authenticated;
revoke execute on function public.save_valuation(jsonb)             from public, anon, authenticated;
revoke execute on function public.save_peak_valuation(jsonb)        from public, anon, authenticated;
revoke execute on function public.admin_access()                    from public, anon, authenticated;
revoke execute on function public.admin_stats()                     from public, anon, authenticated;
revoke execute on function public.admin_capture_daily()             from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, int, int)  from public, anon, authenticated;
revoke execute on function public.admin_user_companies(uuid)        from public, anon, authenticated;
revoke execute on function public.admin_top_companies(int)          from public, anon, authenticated;
revoke execute on function public.admin_billing_mismatches(int)     from public, anon, authenticated;

grant execute on function public.save_number(jsonb, text[])         to service_role;
grant execute on function public.save_valuation(jsonb)              to service_role;
grant execute on function public.save_peak_valuation(jsonb)         to service_role;
grant execute on function public.admin_access()                     to service_role;
grant execute on function public.admin_stats()                      to service_role;
grant execute on function public.admin_capture_daily()              to service_role;
grant execute on function public.admin_list_users(text, int, int)   to service_role;
grant execute on function public.admin_user_companies(uuid)         to service_role;
grant execute on function public.admin_top_companies(int)           to service_role;
grant execute on function public.admin_billing_mismatches(int)      to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- The report — read this before closing the tab
-- ═══════════════════════════════════════════════════════════════════════════

select
  migration,
  case when present then 'ok' else 'MISSING — something above failed' end as status
from (
  values
    ('0001 novus core',
      to_regclass('public.profiles') is not null
      and to_regclass('public.entitlements') is not null
      and to_regclass('public.saves') is not null),
    ('0002 leaderboard',
      to_regclass('public.runs') is not null
      and to_regclass('public.leaderboard_entries') is not null),
    ('0003 billing',
      to_regclass('public.billing_customers') is not null
      and to_regclass('public.billing_events') is not null),
    ('0004 accounts',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'delete_stale_anonymous_users')),
    ('0005 auth throttle',
      to_regclass('public.auth_throttle') is not null),
    ('0006 board submit',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'record_board_entry')),
    ('0007 chapters',
      to_regclass('public.chapters') is not null
      and to_regclass('public.chapter_seats') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'chapter_seats'
                     and column_name = 'invite_token')),
    ('0008 board rank',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'chapter_board')),
    ('0009 admin',
      to_regclass('public.admin_audit') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'profiles'
                     and column_name = 'role')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'entitlements'
                     and column_name = 'comp_pro')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_list_users')),
    ('0010 admin analytics',
      to_regclass('public.admin_daily') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_cohorts')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_timeseries')),
    ('0011 custom chapters',
      exists (select 1 from pg_constraint c
               where c.conname = 'chapters_licence_check'
                 and pg_get_constraintdef(c.oid) like '%chapter_custom%')
      and exists (select 1 from pg_constraint c
                   where c.conname = 'entitlements_chapter_check'
                     and pg_get_constraintdef(c.oid) like '%chapter_custom%')),
    ('0012 year closes',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'entitlements'
                 and column_name = 'extra_year_closes')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_set_extra_year_closes')),
    ('0013 islands',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'entitlements'
                 and column_name = 'extra_islands')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'saves'
                     and column_name = 'peak_valuation')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'island_allowance')
      and exists (select 1 from pg_trigger g
                   where g.tgname = 'saves_island_cap' and not g.tgisinternal)),
    ('0014 chapter seats ceiling',
      exists (select 1 from pg_constraint c
               where c.conname = 'chapters_seats_check'
                 and pg_get_constraintdef(c.oid) like '%10000%')),
    ('0015 island ceiling',
      exists (select 1 from pg_constraint c
               where c.conname = 'saves_slot_check'
                 and pg_get_constraintdef(c.oid) like '%49%')
      and exists (select 1 from pg_constraint c
                   where c.conname = 'entitlements_extra_islands_check'
                     and pg_get_constraintdef(c.oid) like '%48%')),
    ('0016 admin insight',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'admin_access')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_billing_mismatches')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'admin_daily'
                     and column_name = 'pro_effective')
      and exists (select 1 from pg_trigger g
                   where g.tgname = 'profiles_board_handle_rename' and not g.tgisinternal))
) as t(migration, present);
