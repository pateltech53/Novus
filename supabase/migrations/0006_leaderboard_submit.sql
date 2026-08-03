-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Leaderboard — the submission path, the moderation queue, the report
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0002 built the tables, the views, the policies and the quota. It stopped
-- short of the three things a live board needs, and this is those three:
--
--   1. An ATOMIC "keep the better run" upsert. `unique (board, season,
--      profile_id)` says one entry per player per board. Read-compare-write in
--      a route handler turns that into a race — two submissions in flight and
--      the worse one can land last. Postgres can express "update only if this
--      one is actually better" in the ON CONFLICT clause, so it does.
--
--   2. The MODERATION queue, as a function rather than as a direct UPDATE.
--      Listing an entry is the single most consequential write in this schema:
--      it is the moment free text a child typed becomes a public page.
--
--   3. The REPORT path. docs/LEADERBOARD.md §9.3 asks for "a report control on
--      every board row, and a path that unlists in one click and asks
--      questions after". That is what `report_board_entry` is.
--
-- Everything below is `security definer` and revoked from anon and
-- authenticated. Only the service role calls these, and the service role
-- bypasses grants — the revokes exist so that a future policy change cannot
-- accidentally expose a function that writes the board.


-- ═══ leaderboard_entries — what a report leaves behind ═════════════════════
-- Unlisting has to be recoverable, or one malicious tap permanently removes a
-- legitimate #1 and nobody can tell it apart from moderation working. The
-- counter and the timestamp are what a moderator reads before relisting.
alter table public.leaderboard_entries
  add column if not exists reports int not null default 0,
  add column if not exists unlisted_at timestamptz,
  -- Why a human listed or unlisted it. Never shown to a player.
  add column if not exists moderation_note text;

-- The moderation queue IS this index: oldest unlisted first.
create index if not exists leaderboard_review_idx
  on public.leaderboard_entries (created_at)
  where not listed;


-- ═══ The board views carry their own row id ════════════════════════════════
-- §9.3 asks for "a report control on every board row, and a path that unlists
-- in one click". A row cannot be reported if the page never learns which row it
-- is, and 0002's views select every column except the one that identifies them.
--
-- `id` is a random uuid and is only ever exposed for rows that are already
-- listed — i.e. already public. It discloses nothing that was not on the page.
--
-- `security_invoker = on` is restated rather than inherited: without it a view
-- runs as its OWNER and silently bypasses the RLS on the table underneath,
-- which turns `board: public read` into decoration. Dropping and recreating a
-- view is exactly where that flag gets lost.

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


-- ═══ record_board_entry ════════════════════════════════════════════════════
-- Writes a verified run onto a board, and only if it beats what is there.
--
-- The comparison is per-board and deliberately mirrors the ORDER BY of the
-- matching view, so "better" on the board and "better" here can never mean two
-- different things:
--
--   survival  — more years, then higher peak
--   valuation — higher peak, then more years
--
-- Returns true when the row was written or improved, false when the player
-- already had a better run. False is not an error: it is the answer to "did
-- this beat your best?", and the route says so out loud.
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


-- ═══ set_entry_listed ══════════════════════════════════════════════════════
-- The moderator's one verb. Listing is the moment a name a child typed becomes
-- a public page, so it is a function with an audit note rather than an UPDATE
-- somebody can fire from a SQL console without leaving a reason.
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


-- ═══ report_board_entry ════════════════════════════════════════════════════
-- One click unlists. Questions afterwards.
--
-- This is deliberately grief-able and that is the correct trade for a product
-- for minors: the cost of a false report is a legitimate entry hidden until a
-- human relists it, and the cost of a slow one is a child's phone number on a
-- public page for as long as it takes somebody to notice. `reports` and
-- `unlisted_at` are what make the first case recoverable — a moderator sees
-- exactly what happened and calls `set_entry_listed(id, true)`.
--
-- Rate limiting lives at the route, not here: this function is the effect, and
-- an effect that argues about who is allowed to trigger it is one that
-- eventually lets the wrong caller through because the argument had a bug.
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


-- ═══ Retention ═════════════════════════════════════════════════════════════
-- `expire_run_tapes()` is unchanged from 0002 and correct as written: a
-- `RunTape` serialises to a JSON OBJECT, so setting `tape = '{}'` and guarding
-- on `tape <> '{}'` expires each row exactly once and never rewrites it again.
--
-- It is still not SCHEDULED by anything in this repo, because pg_cron is a
-- dashboard action rather than a migration. Until somebody runs the line 0002
-- documents, every tape is kept forever — which is a retention policy that
-- exists in SQL and not in fact:
--
--   select cron.schedule('novus-expire-tapes', '17 3 * * *',
--                        $$select public.expire_run_tapes()$$);
--
-- docs/SUPABASE-SETUP.md carries the same instruction beside the rest of the
-- one-time project setup.
