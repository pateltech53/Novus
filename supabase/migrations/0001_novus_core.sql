-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 · Novus core — accounts, saves, legacy, entitlements, preferences
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This migration replaces the nine localStorage keys the app writes today:
--
--   novus:account:v1       → public.profiles
--   novus:profile:v1       → public.profiles + public.preferences
--   novus:run:v1           → public.saves
--   novus:legacy:v1        → public.legacy
--   novus:entitlements:v1  → public.entitlements
--   novus:runledger:v1     → public.run_ledger
--   novus:wardrobe:v1      → public.preferences.equipped_skin   (not yet wired)
--   novus:theme:v1         → public.preferences.theme           (not yet wired)
--   novus:sound:v1         → public.preferences.sound_on        (not yet wired)
--
-- The last three columns exist and are ready, but nothing writes them yet:
-- lib/theme.ts, lib/sound.ts and lib/engine/wardrobe.ts each own their own
-- storage key and none of them route through lib/engine/save.ts. They are
-- device-level taste rather than progress, so nothing is lost while they wait.
-- Reserving the columns now keeps that a one-file change later instead of a
-- migration.
--
-- Identity is Supabase ANONYMOUS auth. No email, no phone, no password, no
-- OAuth — this product is handed to minors, and the cheapest way to handle a
-- child's personal information is not to collect any (docs/LEADERBOARD.md §9).
--
-- Two fields are deliberately absent from this schema and must never be added:
--   · RunState.playerAge — local age-gating only, never transmitted (§9.4).
--   · Any IP address, device id, or geolocation (§9.6).
-- RunState.founderName is stored here because it is PRIVATE to the player's
-- own row; it must never reach the public board (that is board_handle, §9.2).

create extension if not exists pgcrypto;

-- ── updated_at housekeeping ─────────────────────────────────────────────────
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


-- ═══ profiles ══════════════════════════════════════════════════════════════
-- One row per anonymous auth user. Two names, on purpose:
--
--   display_name — what the player typed. Free text, PRIVATE, shown only to
--                  them, on their own screens. Never listed anywhere public.
--   board_handle — the curated handle from the word-list pool. The ONLY name
--                  that may appear on a global board. Assembled from a
--                  shuffle, never typed, so it cannot contain a real name.
--
-- Keeping both means the leaderboard can never leak the free-text one by
-- accident: the board's foreign key is to board_handle and nothing else.
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,

  -- MAX_NAME_LENGTH in lib/account.ts is 24. Enforce it here too, because a
  -- constraint holds when a route handler forgets.
  display_name        text not null check (length(btrim(display_name)) between 1 and 24),

  -- Null until the player picks one from the shuffle. The regex is the pool's
  -- shape: "Brave Otter 4417". Free text here would be a moderation queue
  -- nobody budgeted for.
  board_handle        text check (board_handle ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$'),

  -- When the privacy policy was agreed to. Optional: accounts created before
  -- the policy existed have no stamp (lib/account.ts).
  accepted_privacy_at timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One handle per player, case-insensitively. Partial, so the many nulls cost
-- nothing and do not collide with each other.
create unique index profiles_board_handle_key
  on public.profiles (lower(board_handle))
  where board_handle is not null;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ═══ preferences ═══════════════════════════════════════════════════════════
-- Device-ish settings that follow the account instead. Separate from profiles
-- because lib/engine/wardrobe.ts is explicit that the wardrobe must be
-- deletable and corruptible without any chance of taking identity, run or
-- legacy state with it. A DELETE here is a reset, not an account loss.
create table public.preferences (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,

  -- novus:profile:v1
  rookie_mode     boolean not null default false,
  onboarded       boolean not null default false,
  -- O2 volume baseline, 0..1. Null = never calibrated.
  mic_calibration real check (mic_calibration is null or mic_calibration between 0 and 1),

  -- novus:theme:v1 / novus:sound:v1 — reserved, see the header.
  theme           text not null default 'light' check (theme in ('light','dark')),
  sound_on        boolean not null default true,

  -- novus:wardrobe:v1. Text, not an enum: a save naming a renamed or removed
  -- skin must fall back to the tier portrait, never break a constraint and
  -- take the write down with it. loadWardrobe() already validates on read.
  equipped_skin   text,

  updated_at      timestamptz not null default now()
);

create trigger preferences_touch
  before update on public.preferences
  for each row execute function public.touch_updated_at();


-- ═══ saves ═════════════════════════════════════════════════════════════════
-- The active run. RunState is a deep, evolving object with ~45 fields, four
-- of them optional precisely so old saves keep loading (migrate() in
-- lib/engine/save.ts backfills on every read). Shredding it into columns would
-- mean a migration every time an authored mechanic lands, and the engine would
-- still have to backfill anyway. So: one jsonb blob, plus the handful of
-- scalars a UI needs to list saves without parsing megabytes.
--
-- The scalars are a CACHE of what is inside `state`. They are never the truth
-- and nothing on a leaderboard may read them — see 0002.
create table public.saves (
  profile_id     uuid not null references public.profiles(id) on delete cascade,

  -- Room for more than one company later. Today the app writes slot 0 only.
  slot           smallint not null default 0 check (slot between 0 and 9),

  -- RunState.id — "run-<seed base36>".
  run_id         text not null,
  seed           bigint not null,
  state          jsonb  not null,

  -- Listing cache, mirrored out of `state` on write.
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

  -- A RunState with a full log and 10 years of decisions is large but not
  -- unbounded. 1 MB is roughly 20× the biggest run the sim produces; past that
  -- something is looping, and a runaway write should fail loudly here rather
  -- than quietly cost the project's storage budget.
  constraint save_size check (pg_column_size(state) < 1048576),

  -- A dead run has a cause; a live one does not. Both directions, so neither
  -- a stale ended_by nor a silent death can survive a write.
  constraint ended_by_iff_dead check (alive = (ended_by is null))
);

create trigger saves_touch
  before update on public.saves
  for each row execute function public.touch_updated_at();


-- ═══ legacy ════════════════════════════════════════════════════════════════
-- Cross-run state — the thing that makes a second run mean something.
-- LegacyState, 1:1 with the profile.
create table public.legacy (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,

  best_year      int not null default 0  check (best_year between 0 and 60),
  runs_completed int not null default 0  check (runs_completed >= 0),

  -- Shark Respect, 0–100, carried into the next run via CreateRunOpts
  -- .carriedRespect. Default 10 matches defaultLegacy() in save.ts — a fresh
  -- player is not at zero, they are merely unknown.
  shark_respect  int not null default 10 check (shark_respect between 0 and 100),

  badges         text[] not null default '{}',

  -- [{ companyName, years, causes[] }]. GameProvider caps this at 10 on write;
  -- the check is the backstop for a caller that forgets.
  autopsies      jsonb  not null default '[]'::jsonb
                 check (jsonb_typeof(autopsies) = 'array'
                        and jsonb_array_length(autopsies) <= 50),

  updated_at     timestamptz not null default now()
);

create trigger legacy_touch
  before update on public.legacy
  for each row execute function public.touch_updated_at();


-- ═══ entitlements ══════════════════════════════════════════════════════════
-- What the player has paid for. READ-ONLY to the player — there is no client
-- write policy below, because a table the browser can write is a table where
-- Pro is free. Today nothing writes it (no billing is wired); when a processor
-- lands, its webhook writes here with the service role.
--
-- Brand Law 4: everything in this table is CONTENT. Nothing here may reach a
-- board query, and 0002 keeps it that way by never joining to it.
create table public.entitlements (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,

  pro              boolean not null default false,
  extra_run_slots  int     not null default 0 check (extra_run_slots between 0 and 20),
  industry_packs   text[]  not null default '{}',
  cosmetic_bundles text[]  not null default '{}',

  -- A chapter seat is Pro for the year, bought by the school.
  chapter          text check (chapter in ('chapter_35','chapter_100')),

  -- The plan the player ASKED for during onboarding. An intent, never a
  -- receipt — no screen may present it as a purchase.
  intent           text check (intent in ('free','pro_monthly','pro_yearly')),

  updated_at       timestamptz not null default now(),

  -- Every code is a real Industry code; a typo'd pack silently unlocks nothing.
  constraint industry_packs_valid check (
    industry_packs <@ array['FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                            'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET']::text[]
  )
);

create trigger entitlements_touch
  before update on public.entitlements
  for each row execute function public.touch_updated_at();


-- ═══ run_ledger ════════════════════════════════════════════════════════════
-- Runs STARTED per real calendar day, against runSlotsFor(). Counting starts
-- rather than completions is what makes "one run a day, no redo" true:
-- abandoning a dead company and founding again spends the day's slot.
--
-- Server-side because the localStorage version is a line of devtools away from
-- unlimited. No RLS policies at all — only claim_run_slot() below touches it.
--
-- One row per player, not one per player per day: the row is RESET when the
-- date rolls rather than appended to. A ledger that grows a row a day is an
-- audit log nobody asked for, on data about children, retained forever.
create table public.run_ledger (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  started    int  not null default 0 check (started >= 0)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
-- Enabling RLS with no policies denies everything. That is the correct
-- default; every policy below is an exception being granted on purpose.
--
-- `(select auth.uid())` rather than bare `auth.uid()` is deliberate — Postgres
-- caches the subquery as an InitPlan instead of re-evaluating it per row.

alter table public.profiles     enable row level security;
alter table public.preferences  enable row level security;
alter table public.saves        enable row level security;
alter table public.legacy       enable row level security;
alter table public.entitlements enable row level security;
alter table public.run_ledger   enable row level security;

-- ── profiles: your own row, nobody else's ──────────────────────────────────
create policy "profiles: read own"   on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No delete policy. Deletion goes through a route handler on the service role
-- so it cascades and audits in one place (§9.7).

-- ── preferences / saves / legacy: the player's own data, full control ───────
-- These are the player's device data promoted to a server. They may read,
-- write and destroy their own — including clearRun(), which is a DELETE.
create policy "preferences: own" on public.preferences for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "saves: own" on public.saves for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "legacy: own" on public.legacy for all to authenticated
  using      (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- ── entitlements: read only ────────────────────────────────────────────────
-- SELECT and nothing else. A client that could INSERT here would be a client
-- that grants itself Pro. Writes come from billing, on the service role.
create policy "entitlements: read own" on public.entitlements for select to authenticated
  using (profile_id = (select auth.uid()));

-- ── run_ledger: nobody ─────────────────────────────────────────────────────
-- Zero policies, and the grants revoked so PostgREST cannot expose it at all.
-- Only claim_run_slot() (security definer) reads or writes this table.
revoke all on public.run_ledger from anon, authenticated;


-- ═══ claim_run_slot ════════════════════════════════════════════════════════
-- Atomically spends one of today's run slots. Returns true if the run may
-- start. The caller passes the allowance because it is derived from
-- entitlements (runSlotsFor = plan allowance + bought slots) — but note the
-- allowance is read from the DB here, not trusted from the argument, or a
-- client would simply ask for a thousand.
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

  -- FREE_LIMITS.runsPerDay = 1, PRO_LIMITS.runsPerDay = 3
  -- (lib/monetization.ts). A chapter seat is Pro for the year.
  select case when coalesce(e.pro, false) or e.chapter is not null then 3 else 1 end
         + coalesce(e.extra_run_slots, 0)
    into allowed
    from public.entitlements e
   where e.profile_id = caller;

  -- No entitlements row yet is a free player, not an error.
  allowed := coalesce(allowed, 1);

  insert into public.run_ledger as l (profile_id, day, started)
  values (caller, today, 1)
  on conflict (profile_id) do update
    set day     = today,
        -- Same day: spend another slot. New day: this is the first.
        started = case when l.day = today then l.started + 1 else 1 end
  returning l.started into used;

  return used <= allowed;
end;
$$;

-- The function runs as its owner, so anything that can call it can write the
-- table it exists to protect. Grant execute narrowly and revoke the rest.
revoke execute on function public.claim_run_slot() from public, anon;
grant  execute on function public.claim_run_slot() to authenticated;

-- Runs still startable today. Read-only companion for the UI.
create or replace function public.runs_remaining_today()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  -- Both halves are coalesced: a player with no entitlements row is a free
  -- player with one slot, and a player who has never started a run has spent
  -- none. Without these, `greatest(0, null - null)` is null and the UI shows
  -- a blank where a number belongs.
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
