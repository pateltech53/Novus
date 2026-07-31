\set ON_ERROR_STOP 1
\pset pager off

insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333');
insert into public.profiles (id, display_name, board_handle)
values ('33333333-3333-3333-3333-333333333333','Mal','Silent Marten 0007');

-- A verified run whose company_name is a phone number — exactly what §9.3 says
-- moderation is for. It lands unlisted.
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values ('33333333-3333-3333-3333-333333333333', 9, '{"entries":[1,2,3]}', 'hash-b','1','ev1',
        'Call me 555-0134','ECOM', 99000000, 2, 99000000, 2, 'verified', now());

insert into public.leaderboard_entries
  (board, season, run_id, profile_id, founder_display_name, company_name,
   industry, peak_valuation, years_survived, achieved_on)   -- listed defaults false
select 'valuation','2026-Q3', id, profile_id, 'Silent Marten 0007', company_name,
       'ECOM', verified_peak_valuation, verified_years_survived, current_date
from public.runs where tape_hash = 'hash-b';

\echo '=== unmoderated entry is invisible to anon, even though it would rank #1 ==='
set role anon;
select count(*) as rows_anon_sees from public.board_valuation;
reset role;
select count(*) as rows_that_actually_exist from public.leaderboard_entries;

\echo '=== ...and invisible to its OWN author until moderated ==='
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) as author_sees from public.leaderboard_entries;

\echo '=== moderator lists it; now it appears and outranks nothing but itself ==='
reset role;
update public.leaderboard_entries set listed = true, company_name = 'Redacted Co';
set role anon;
select rank, founder_display_name, company_name from public.board_valuation;

\echo '=== retention: a 31-day-old tape is emptied, the board entry survives ==='
reset role;
update public.runs set verified_at = now() - interval '31 days';
select public.expire_run_tapes() as tapes_expired;
select tape, status, verified_peak_valuation from public.runs;
select count(*) as entries_still_standing from public.leaderboard_entries;

\echo '=== a fresh tape (under 30 days) is NOT touched ==='
update public.runs set tape = '{"entries":[9]}', verified_at = now();
select public.expire_run_tapes() as tapes_expired_second_pass;
select tape from public.runs;
