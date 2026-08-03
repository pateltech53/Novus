-- ═══════════════════════════════════════════════════════════════════════════
-- RUN THIS · Novus leaderboard — the submission path
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL editor of the NOVUS project (Database → SQL
-- Editor → New query), or apply with `npx supabase db push`.
--
-- ── Before you run it ──────────────────────────────────────────────────────
--
-- This depends on 0001–0002 already being applied. Run STEP 0 first: it prints
-- one row per thing that has to exist. If any of them says MISSING, apply
-- supabase/migrations/0001_novus_core.sql through 0005_auth_throttle.sql in
-- order first, then come back.
--
-- Everything below is idempotent — running it twice is safe.


-- ═══ STEP 0 · Preflight. Read the output before continuing. ════════════════

select
  thing,
  case when present then 'ok' else 'MISSING — apply 0001–0005 first' end as status
from (
  values
    ('table: profiles',
     to_regclass('public.profiles') is not null),
    ('column: profiles.board_handle',
     exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='profiles'
                and column_name='board_handle')),
    ('table: runs',
     to_regclass('public.runs') is not null),
    ('table: leaderboard_entries',
     to_regclass('public.leaderboard_entries') is not null),
    ('table: submission_quota',
     to_regclass('public.submission_quota') is not null),
    ('view: board_survival',
     to_regclass('public.board_survival') is not null),
    ('view: board_valuation',
     to_regclass('public.board_valuation') is not null),
    ('function: claim_submission_slot',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='claim_submission_slot'))
) as t(thing, present);


-- ═══ STEP 1 · Columns a report and a review leave behind ═══════════════════
-- Unlisting has to be recoverable, or one malicious tap permanently removes a
-- legitimate #1 and nobody can tell it apart from moderation working.

alter table public.leaderboard_entries
  add column if not exists reports int not null default 0,
  add column if not exists unlisted_at timestamptz,
  add column if not exists moderation_note text;

-- The moderation queue IS this index: oldest unlisted first.
create index if not exists leaderboard_review_idx
  on public.leaderboard_entries (created_at)
  where not listed;


-- ═══ STEP 1b · The board views carry their own row id ══════════════════════
-- §9.3 asks for "a report control on every board row, and a path that unlists
-- in one click". A row cannot be reported if the page never learns which row it
-- is, and 0002's views select every column except the one that identifies them.
--
-- `id` is a random uuid and it is only ever exposed for rows that are already
-- listed — i.e. already public. It discloses nothing that was not on the page.
--
-- `security_invoker = on` is restated rather than inherited: without it a view
-- runs as its OWNER and silently bypasses the RLS on the table underneath,
-- which would turn `board: public read` into decoration. Dropping and
-- recreating a view is exactly where that flag gets lost.

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

-- Tie-breaks are all server-computed and none are purchasable: valuation ties
-- break on survival, then on the earlier date. First to get there keeps it.

grant select on public.board_valuation to anon, authenticated;
grant select on public.board_survival  to anon, authenticated;


-- ═══ STEP 2 · record_board_entry ═══════════════════════════════════════════
-- Writes a verified run onto a board, and only if it beats what is there.
--
-- Atomic on purpose. `unique (board, season, profile_id)` says one entry per
-- player per board; read-compare-write in a route handler turns that into a
-- race where two submissions in flight can leave the WORSE one standing.
-- Postgres can express "update only if this one is actually better" in the
-- ON CONFLICT clause, so it does.
--
-- The comparison mirrors the ORDER BY of the matching view, so "better" on the
-- board and "better" here can never mean two different things:
--   survival  — more years, then higher peak
--   valuation — higher peak, then more years

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
    -- Date, not timestamptz. A timestamp's time-of-day correlates with
    -- timezone, timezone is coarse location, and coarse location about a child
    -- is precisely the category to avoid (docs/LEADERBOARD.md §9.6).
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
        -- A better run starts its moderation history clean: it is a different
        -- company name on a different run, and inheriting the old row's
        -- reports would silently suppress it.
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


-- ═══ STEP 3 · set_entry_listed ═════════════════════════════════════════════
-- The moderator's one verb. Listing is the moment free text a child typed
-- becomes a public page, so it is a function with an audit note rather than an
-- UPDATE somebody fires from a console without leaving a reason.

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
         -- Relisting clears the reports it was unlisted for. Leaving them would
         -- mean the next single report unlists it again with no new complaint.
         reports         = case when p_listed then 0 else reports end
   where id = p_entry
  returning true into touched;

  return coalesce(touched, false);
end;
$$;

revoke execute on function public.set_entry_listed(uuid, boolean, text)
  from public, anon, authenticated;


-- ═══ STEP 4 · report_board_entry ═══════════════════════════════════════════
-- One click unlists. Questions afterwards (docs/LEADERBOARD.md §9.3).
--
-- Deliberately grief-able, and that is the correct trade for a product for
-- minors: the cost of a false report is a legitimate entry hidden until a human
-- relists it; the cost of a slow one is a child's phone number on a public page
-- for as long as it takes somebody to notice. `reports` and `unlisted_at` are
-- what make the first case recoverable.

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


-- ═══ STEP 5 · Schedule the retention job ═══════════════════════════════════
-- `runs.tape` is verification EVIDENCE, not an archive. The entry survives; the
-- replay data does not (§9.5). 0002 wrote the function and nothing has ever
-- called it, which is a retention policy that exists in SQL and not in fact.
--
-- Needs pg_cron. If this errors with "schema cron does not exist", enable it at
-- Database → Extensions → pg_cron, then re-run just this block.

create extension if not exists pg_cron;

select cron.unschedule('novus-expire-tapes')
where exists (select 1 from cron.job where jobname = 'novus-expire-tapes');

select cron.schedule(
  'novus-expire-tapes',
  '17 3 * * *',
  $$select public.expire_run_tapes()$$
);


-- ═══ STEP 6 · Verify. Every row should say ok. ═════════════════════════════

select
  thing,
  case when present then 'ok' else 'MISSING' end as status
from (
  values
    ('function: record_board_entry',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='record_board_entry')),
    ('function: set_entry_listed',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='set_entry_listed')),
    ('function: report_board_entry',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='report_board_entry')),
    ('column: leaderboard_entries.reports',
     exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='leaderboard_entries'
                and column_name='reports')),
    ('view board_survival exposes id',
     exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='board_survival'
                and column_name='id')),
    -- Postgres stores this reloption as `security_invoker=on`, not `=true`.
    -- Matching on the literal string is how a correct view reports MISSING.
    ('board views run as the caller, not the owner',
     (select bool_and(lower(coalesce(o.option_value,'')) in ('on','true','1','yes'))
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join lateral pg_options_to_table(c.reloptions) o
               on o.option_name = 'security_invoker'
       where n.nspname='public'
         and c.relname in ('board_survival','board_valuation'))),
    ('cron job: novus-expire-tapes',
     exists (select 1 from cron.job where jobname = 'novus-expire-tapes'))
) as t(thing, present);


-- ═══ STEP 7 · The two checks worth running by hand, once ═══════════════════
--
-- 1. Prove the board cannot be written by a player. This MUST fail with 42501;
--    if it succeeds, stop and do not ship.
--
--      set role anon;
--      insert into public.leaderboard_entries
--        (board, season, run_id, profile_id, founder_display_name,
--         company_name, industry, peak_valuation, years_survived, achieved_on)
--      values ('valuation','2026-Q3', gen_random_uuid(), gen_random_uuid(),
--              'Brave Otter 4417','Hax','TECH', 999999999, 40, current_date);
--      reset role;
--
-- 2. The standing Brand Law 4 audit (§8.3). Run it monthly. Pro share of the
--    top 100 should track Pro share of submissions; a gap is a regression, not
--    a curiosity.
--
--      select r.pro_at_submit, count(*), round(avg(e.peak_valuation)) as avg_peak
--      from public.leaderboard_entries e
--      join public.runs r on r.id = e.run_id
--      where e.board = 'valuation' and e.season = '2026-Q3'
--      group by 1;
