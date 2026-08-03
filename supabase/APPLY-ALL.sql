-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY ALL · the complete Novus schema (0001 → 0008), idempotently
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
  extra_run_slots  int     not null default 0 check (extra_run_slots between 0 and 20),
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
         + coalesce(e.extra_run_slots, 0)
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
                          then 3 else 1 end + coalesce(e.extra_run_slots, 0)
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

create or replace function public.grant_extra_run_slot(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_run_slots)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_run_slots = public.entitlements.extra_run_slots + 1;
$$;

revoke execute on function public.apply_subscription(uuid, boolean, text)  from public, anon, authenticated;
revoke execute on function public.grant_industry_pack(uuid, text)          from public, anon, authenticated;
revoke execute on function public.grant_extra_run_slot(uuid)               from public, anon, authenticated;

grant execute on function public.apply_subscription(uuid, boolean, text)   to service_role;
grant execute on function public.grant_industry_pack(uuid, text)           to service_role;
grant execute on function public.grant_extra_run_slot(uuid)                to service_role;


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
          and (e.pro or e.extra_run_slots > 0
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
               where n.nspname = 'public' and p.proname = 'chapter_board'))
) as t(migration, present);
