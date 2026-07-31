-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · Leaderboard — submissions, verification, the two public boards
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Implements docs/LEADERBOARD.md §4, §6 and §8 against the profiles table
-- created in 0001. Read that document before changing anything here; every
-- constraint below is load-bearing for either anti-cheat or COPPA.
--
-- Two boards, one submission path:
--   survival  — years_survived desc   ("Still Standing")
--   valuation — peak_valuation desc
--
-- The shape of the whole thing in one line: a player submits INPUTS, the
-- server replays them against lib/engine and writes the OUTPUTS. Nothing a
-- client sends ever reaches a board query.


-- ═══ runs ══════════════════════════════════════════════════════════════════
-- The evidence. One row per submission, verified or not. Never updated by a
-- player, never deleted by anyone but a cascade.
create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,

  -- ── Replay inputs ──────────────────────────────────────────────────────
  -- The engine is deterministic: runRng(seed, year, month, salt) is position-
  -- seeded, so every draw, branch and luck-band jitter is a pure function of
  -- (seed, year, month, eventId). Given the seed and the player's inputs the
  -- server reproduces the run exactly — the same property scripts/simulate.mjs
  -- relies on. So the tape carries choices, not consequences.
  seed           bigint not null,
  tape           jsonb  not null,
  tape_hash      text   not null,   -- sha256 of the canonical tape JSON
  engine_version text   not null,
  events_hash    text   not null,   -- sha256 of data/events.json

  -- ── Run identity ───────────────────────────────────────────────────────
  company_name   text not null,
  industry       text not null check (industry in (
                   'FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                   'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET')),

  -- ── What the client CLAIMED ────────────────────────────────────────────
  -- lib/engine/save.ts writes the whole RunState to localStorage as plain
  -- JSON. A player opens devtools, sets valuation to 1e12, and the app
  -- believes them — correctly, because that is what a local save is for.
  -- These columns exist ONLY so the verifier can diff claim against truth and
  -- measure who is lying. No board query reads them.
  claimed_peak_valuation numeric(20,2) not null,
  claimed_years_survived int           not null,

  -- ── What the SERVER computed ─────────────────────────────────────────
  -- Null until the replay runs. Peak valuation exists nowhere in RunState —
  -- stats.valuation is the CURRENT value, recomputed by deriveValuation() on
  -- every refreshBooks(), so a company that peaked at $40M and died at $200K
  -- stores 200000. The replay tracks max(stats.valuation) across every month
  -- it simulates, which makes the peak a number no client ever touched.
  verified_peak_valuation numeric(20,2),
  verified_years_survived int,
  verified_ended_by       text check (verified_ended_by in ('chapter7','acquired','ipo')),

  status        text not null default 'pending'
                check (status in ('pending','verified','rejected','flagged')),
  reject_reason text,

  -- Audit only. Enforced never to reach a board — see the note at the bottom.
  pro_at_submit boolean not null default false,

  submitted_at  timestamptz not null default now(),
  verified_at   timestamptz,

  -- Cheap gates that hold even when a route handler is wrong.
  constraint tape_size   check (pg_column_size(tape) < 262144),
  constraint years_claim check (claimed_years_survived between 1 and 60),
  constraint valuation_claim
    check (claimed_peak_valuation >= 0 and claimed_peak_valuation < 1e13),

  -- The same tape twice is the same run twice. Resubmitting is a 23505,
  -- not a second entry.
  constraint one_tape_per_profile unique (profile_id, tape_hash)
);

create index runs_pending_idx on public.runs (submitted_at) where status = 'pending';
create index runs_profile_idx on public.runs (profile_id, submitted_at desc);


-- ═══ leaderboard_entries ═════════════════════════════════════════════════
-- What the world reads. Only verified runs land here, and only the best one
-- per player per board per season, so one player cannot occupy the top ten.
create table public.leaderboard_entries (
  id            uuid primary key default gen_random_uuid(),
  board         text not null check (board in ('valuation','survival')),
  season        text not null,

  run_id        uuid not null references public.runs(id)     on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,

  -- The CURATED handle from profiles.board_handle — never profiles
  -- .display_name and never RunState.founderName. For a nine-year-old the
  -- founder name is their first name, often their full one, and publishing it
  -- next to a company name that might identify a school is the exact pattern
  -- COPPA exists to prevent (docs/LEADERBOARD.md §9.2).
  founder_display_name text not null
    check (founder_display_name ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$'),

  company_name         text not null,   -- moderated before it is listed
  industry             text not null,

  peak_valuation numeric(20,2) not null check (peak_valuation >= 0),
  years_survived int           not null check (years_survived between 1 and 60),
  ended_by       text,

  -- Date, not timestamptz. A timestamp's time-of-day correlates with timezone,
  -- timezone is coarse location, and coarse location about a child is
  -- precisely the category to avoid (§9.6).
  achieved_on   date not null,

  -- Entries land UNLISTED. company_name is free text a child typed; across
  -- enough players it will contain real names, school names, phone numbers and
  -- slurs. A blocklist pass and a human queue clear it first (§9.3).
  listed        boolean not null default false,

  created_at    timestamptz not null default now(),

  constraint one_entry_per_board unique (board, season, profile_id)
);

-- The boards ARE these two indexes. Partial on `listed` so an unmoderated
-- entry costs nothing and is invisible even to its own author.
create index leaderboard_valuation_idx
  on public.leaderboard_entries (season, peak_valuation desc, achieved_on asc, id asc)
  where board = 'valuation' and listed;

create index leaderboard_survival_idx
  on public.leaderboard_entries (season, years_survived desc, peak_valuation desc, achieved_on asc, id asc)
  where board = 'survival' and listed;

-- The moderation queue, as a query.
create index leaderboard_unlisted_idx
  on public.leaderboard_entries (created_at) where not listed;


-- ═══ submission_quota ════════════════════════════════════════════════════
create table public.submission_quota (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  count      int  not null default 0
);


-- ═══════════════════════════════════════════════════════════════════════════
-- The board views — ranking is COMPUTED, never stored
-- ═══════════════════════════════════════════════════════════════════════════
-- There is no rank column, so there is nothing to write, buy or boost.
--
-- security_invoker = on matters. Without it a view runs as its OWNER and
-- silently bypasses the RLS on the table underneath, which turns every policy
-- below into decoration.

create view public.board_valuation
with (security_invoker = on) as
select
  row_number() over (order by peak_valuation desc, achieved_on asc, id asc) as rank,
  founder_display_name, company_name, industry,
  peak_valuation, years_survived, achieved_on, season
from public.leaderboard_entries
where board = 'valuation' and listed;

create view public.board_survival
with (security_invoker = on) as
select
  row_number() over (order by years_survived desc, peak_valuation desc, achieved_on asc, id asc) as rank,
  founder_display_name, company_name, industry,
  years_survived, peak_valuation, ended_by, achieved_on, season
from public.leaderboard_entries
where board = 'survival' and listed;

-- Tie-breaks are all server-computed and none are purchasable: valuation ties
-- break on survival, then on the earlier date. First to get there keeps it.


-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
-- A leaderboard with open writes is a leaderboard of whoever found the
-- endpoint. These exist before any UI does.

alter table public.runs                enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.submission_quota    enable row level security;

-- ── runs: append-only, private ─────────────────────────────────────────────
create policy "runs: submit own"
  on public.runs for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    -- You may submit evidence. You may not submit a verdict.
    and status = 'pending'
    and verified_peak_valuation is null
    and verified_years_survived is null
    and verified_ended_by       is null
    and verified_at             is null
    and reject_reason           is null
  );

create policy "runs: read own"
  on public.runs for select to authenticated
  using (profile_id = (select auth.uid()));

-- No UPDATE policy and no DELETE policy exist, deliberately. A player cannot
-- edit a submitted run, cannot mark it verified, cannot delete a rejected one
-- to hide it, and cannot read anyone else's tape. Only the service role, which
-- bypasses RLS, promotes a run to 'verified'.

-- ── leaderboard_entries: world-readable, nobody writes ───────────────────────
revoke all    on public.leaderboard_entries from anon, authenticated;
grant  select on public.leaderboard_entries to   anon, authenticated;

create policy "board: public read"
  on public.leaderboard_entries for select to anon, authenticated
  using (listed = true);

-- That is the entire policy set. There is no insert, update or delete policy
-- for anon or authenticated: anyone who finds the REST endpoint and POSTs to
-- it gets a 42501. The only writer is the verifier holding the service role
-- key, and the only thing that key writes is numbers the server computed.

-- ── submission_quota: nobody, not even you ─────────────────────────────────
revoke all on public.submission_quota from anon, authenticated;


-- ═══ claim_submission_slot ══════════════════════════════════════════════════
-- Ten submissions per profile per UTC day. A legitimate player finishes a run
-- in far more time than that.
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

-- The revoke matters as much as the grant: this function runs as its owner,
-- so anything that can call it can write the table it was meant to protect.
-- Only the service role calls this, and the service role bypasses grants.
revoke execute on function public.claim_submission_slot(uuid, int)
  from public, anon, authenticated;


-- ═══ Retention (docs/LEADERBOARD.md §9.5) ══════════════════════════════════
-- runs.tape is verification EVIDENCE, not an archive. The entry survives; the
-- replay data does not. Written now rather than later, because retention
-- policies added later are retention policies that never get added.
--
-- Schedule it with pg_cron in the Supabase dashboard (Database → Cron):
--   select cron.schedule('novus-expire-tapes', '17 3 * * *',
--                        $$select public.expire_run_tapes()$$);
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
-- Brand Law 4, as schema
-- ═══════════════════════════════════════════════════════════════════════════
-- "Cosmetics, run slots and scenario packs are purchasable. Score, survival,
--  revives and leaderboard position NEVER are. This is a product for minors —
--  a legal constraint, not a taste one."
--
-- How the schema holds the line:
--   · There is no rank column. Position is row_number() over a computed
--     ordering. There is nothing to write, buy or boost.
--   · The ordering keys — peak_valuation, years_survived — come out of the
--     replay, not out of a submission.
--   · pro_at_submit lives on `runs`, never on leaderboard_entries. It is in
--     neither view, no index and no ORDER BY. It exists only so the audit
--     query below can prove the law holds.
--   · No policy lets a player write an entry. There is no code path where
--     money reaches the board, because there is no path where a client does.
--   · No Pro-only board and no Pro tie-break.
--
-- The standing audit, monthly. Pro share of the top 100 should track Pro share
-- of submissions; a gap is a regression, not a curiosity.
--
--   select r.pro_at_submit, count(*), round(avg(e.peak_valuation)) as avg_peak
--   from public.leaderboard_entries e
--   join public.runs r on r.id = e.run_id
--   where e.board = 'valuation' and e.season = '2026-Q3'
--   group by 1;
--
-- NOTE — two live engine violations this board would expose, documented in
-- docs/LEADERBOARD.md §8.2 and NOT fixed by this migration:
--   1. lib/engine/people.ts — Pro candidates roll performance 72–96 vs 48–78
--      free; the hire aura moves qual and brand, which deriveValuation() reads
--      directly. Pro buys valuation today.
--   2. lib/engine/holdings.ts — `art` is Pro-only at 0.11 appreciation vs the
--      best free asset at 0.09, and valuation is floored at cash.
-- Fix both before the board is public, not after somebody screenshots it.
