\set ON_ERROR_STOP 0
\pset pager off

-- Two players.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

\echo '=== 1. player A creates a profile as `authenticated` ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.profiles (id, display_name)
values ('11111111-1111-1111-1111-111111111111', 'Zach');
select display_name from public.profiles;

\echo '=== 2. A cannot create a profile for B (should FAIL 42501) ==='
insert into public.profiles (id, display_name)
values ('22222222-2222-2222-2222-222222222222', 'Mallory');

\echo '=== 3. board_handle regex: free text rejected, pool handle accepted ==='
update public.profiles set board_handle = 'xX_sn1per_Xx';
update public.profiles set board_handle = 'Brave Otter 4417';
select board_handle from public.profiles;

\echo '=== 4. save round-trips; ended_by_iff_dead holds ==='
insert into public.saves (profile_id, run_id, seed, state, company_name, industry, year, month, stage)
values ('11111111-1111-1111-1111-111111111111','run-abc',123,'{"id":"run-abc"}','Sharkfin','TECH',3,7,2);
-- alive run claiming a cause of death (should FAIL 23514)
update public.saves set ended_by = 'chapter7';
-- proper death
update public.saves set alive = false, ended_by = 'chapter7';
select company_name, year, alive, ended_by from public.saves;

\echo '=== 5. legacy defaults: shark_respect starts at 10, not 0 ==='
insert into public.legacy (profile_id) values ('11111111-1111-1111-1111-111111111111');
select best_year, runs_completed, shark_respect from public.legacy;

\echo '=== 6. a player CANNOT grant themselves Pro (should FAIL 42501) ==='
insert into public.entitlements (profile_id, pro)
values ('11111111-1111-1111-1111-111111111111', true);

\echo '=== 7. run slots: a free player gets exactly one a day ==='
reset role;
insert into public.entitlements (profile_id, pro) values ('11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.runs_remaining_today() as remaining_before;
select public.claim_run_slot() as first_run_allowed;   -- expect t
select public.claim_run_slot() as second_run_allowed;  -- expect f  ("no redo")
select public.runs_remaining_today() as remaining_after;

\echo '=== 8. player B cannot read A''s save, legacy, or profile ==='
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_a_saves    from public.saves;
select count(*) as b_sees_a_legacy   from public.legacy;
select count(*) as b_sees_a_profiles from public.profiles;

\echo '=== 9. nobody can write the board (should FAIL 42501) ==='
insert into public.leaderboard_entries
  (board, season, run_id, profile_id, founder_display_name, company_name,
   industry, peak_valuation, years_survived, achieved_on, listed)
values ('valuation','2026-Q3', gen_random_uuid(),
        '22222222-2222-2222-2222-222222222222','Fake Winner 0001','Cheat Co',
        'TECH', 999999999, 60, current_date, true);

\echo '=== 10. service role seeds two verified entries, one unlisted ==='
reset role;
insert into public.profiles (id, display_name, board_handle)
values ('22222222-2222-2222-2222-222222222222','Mal','Quiet Heron 0002');
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values ('11111111-1111-1111-1111-111111111111', 123, '{"entries":[]}', 'hash-a', '1', 'ev1',
        'Sharkfin','TECH', 5000000, 9, 4200000, 9, 'verified', now());

\echo '--- the same tape twice is the same run twice (should FAIL 23505) ---'
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived)
values ('11111111-1111-1111-1111-111111111111', 123, '{"entries":[]}', 'hash-a', '1', 'ev1',
        'Sharkfin','TECH', 5000000, 9);

insert into public.leaderboard_entries
  (board, season, run_id, profile_id, founder_display_name, company_name,
   industry, peak_valuation, years_survived, achieved_on, listed)
select 'valuation','2026-Q3', id, profile_id, 'Brave Otter 4417', 'Sharkfin',
       'TECH', verified_peak_valuation, verified_years_survived, current_date, true
from public.runs where tape_hash = 'hash-a';

-- second entry, awaiting moderation
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values ('22222222-2222-2222-2222-222222222222', 9, '{"entries":[]}', 'hash-b', '1', 'ev1',
        'Call me 555-0134','ECOM', 100, 2, 100, 2, 'verified', now());
insert into public.leaderboard_entries
  (board, season, run_id, profile_id, founder_display_name, company_name,
   industry, peak_valuation, years_survived, achieved_on)
select 'valuation','2026-Q3', id, profile_id, 'Quiet Heron 0002', 'Call me 555-0134',
       'ECOM', 100, 2, current_date
from public.runs where tape_hash = 'hash-b';

\echo '=== 11. the public board: anon sees the listed row and NOT the unmoderated one ==='
set role anon;
select rank, founder_display_name, company_name, peak_valuation from public.board_valuation;

\echo '=== 12. one entry per player per board per season (should FAIL 23505) ==='
reset role;
insert into public.leaderboard_entries
  (board, season, run_id, profile_id, founder_display_name, company_name,
   industry, peak_valuation, years_survived, achieved_on, listed)
select 'valuation','2026-Q3', id, profile_id, 'Brave Otter 4417', 'Sharkfin2',
       'TECH', 9999999, 12, current_date, true
from public.runs where tape_hash = 'hash-a';

\echo '=== 13. absurd claims are rejected at the DB (should FAIL 23514 twice) ==='
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived)
values ('11111111-1111-1111-1111-111111111111', 1, '{}', 'h1','1','ev1','X','TECH', 1e14, 9);
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived)
values ('11111111-1111-1111-1111-111111111111', 1, '{}', 'h2','1','ev1','X','TECH', 100, 999);

\echo '=== 14. deleting the profile cascades everything (COPPA §9.7) ==='
delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select
  (select count(*) from public.saves)              as saves,
  (select count(*) from public.legacy)             as legacy,
  (select count(*) from public.runs)               as runs,
  (select count(*) from public.leaderboard_entries) as entries,
  (select count(*) from public.run_ledger)         as ledger;

\echo '=== 15. retention: tapes older than 30 days are emptied, entries survive ==='
update public.runs set verified_at = now() - interval '31 days';
select public.expire_run_tapes() as tapes_expired;
select tape, status from public.runs;
