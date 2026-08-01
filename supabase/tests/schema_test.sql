\set ON_ERROR_STOP 1
\pset pager off

-- Core schema (0001) and the leaderboard (0002).
--
-- Every claim below is asserted by test.ok / test.eq / test.throws, so a
-- policy that stopped holding fails this file rather than printing a number
-- nobody reads. See _supabase_shim.sql for what the helpers do and why they
-- replaced the printing version.
--
--   npm run test:db          # all five suites, fresh database each
--
-- Two players.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

\echo '=== 1. player A creates a profile as `authenticated` ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.profiles (id, display_name)
values ('11111111-1111-1111-1111-111111111111', 'Zach');
select test.eq((select display_name from public.profiles), 'Zach', 'A can create their own profile');

\echo '=== 2. A cannot create a profile for B ==='
select test.throws('42501', $$
  insert into public.profiles (id, display_name)
  values ('22222222-2222-2222-2222-222222222222', 'Mallory')
$$, 'A cannot create a profile for B');

\echo '=== 3. board_handle regex: free text rejected, pool handle accepted ==='
-- The handle is what appears on a public board, so it comes from a fixed pool
-- and never from anything a child typed. The constraint is the enforcement.
select test.throws('23514', $$
  update public.profiles set board_handle = 'xX_sn1per_Xx'
$$, 'a free-text board handle is rejected');
update public.profiles set board_handle = 'Brave Otter 4417';
select test.eq((select board_handle from public.profiles), 'Brave Otter 4417',
               'a pool handle is accepted');

\echo '=== 4. save round-trips; ended_by_iff_dead holds ==='
insert into public.saves (profile_id, run_id, seed, state, company_name, industry, year, month, stage)
values ('11111111-1111-1111-1111-111111111111','run-abc',123,'{"id":"run-abc"}','Sharkfin','TECH',3,7,2);
select test.eq((select company_name from public.saves), 'Sharkfin', 'a save round-trips');

select test.throws('23514', $$
  update public.saves set ended_by = 'chapter7'
$$, 'a LIVE run cannot carry a cause of death');

update public.saves set alive = false, ended_by = 'chapter7';
select test.eq((select ended_by from public.saves), 'chapter7', 'a dead run can');

\echo '=== 5. legacy defaults: shark_respect starts at 10, not 0 ==='
insert into public.legacy (profile_id) values ('11111111-1111-1111-1111-111111111111');
select test.eq((select shark_respect from public.legacy), 10::bigint,
               'shark_respect starts at 10');
select test.eq((select best_year from public.legacy), 0::bigint, 'best_year starts at 0');
select test.eq((select runs_completed from public.legacy), 0::bigint, 'runs_completed starts at 0');

\echo '=== 6. a player CANNOT grant themselves Pro ==='
select test.throws('42501', $$
  insert into public.entitlements (profile_id, pro)
  values ('11111111-1111-1111-1111-111111111111', true)
$$, 'a player cannot insert their own entitlements');

\echo '=== 7. run slots: a free player gets exactly one a day ==='
reset role;
insert into public.entitlements (profile_id, pro) values ('11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select test.eq(public.runs_remaining_today(), 1::bigint, 'a free player starts the day with one run');
select test.ok(public.claim_run_slot(), 'the first run of the day is allowed');
select test.ok(not public.claim_run_slot(), 'the second is refused — there is no redo');
select test.eq(public.runs_remaining_today(), 0::bigint, 'and the day is spent');

\echo '=== 8. player B cannot read A''s save, legacy, or profile ==='
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select test.eq((select count(*) from public.saves),    0::bigint, 'B sees none of A''s saves');
select test.eq((select count(*) from public.legacy),   0::bigint, 'B sees none of A''s legacy');
select test.eq((select count(*) from public.profiles), 0::bigint, 'B sees none of A''s profile');

\echo '=== 9. nobody can write the board ==='
select test.throws('42501', $$
  insert into public.leaderboard_entries
    (board, season, run_id, profile_id, founder_display_name, company_name,
     industry, peak_valuation, years_survived, achieved_on, listed)
  values ('valuation','2026-Q3', gen_random_uuid(),
          '22222222-2222-2222-2222-222222222222','Fake Winner 0001','Cheat Co',
          'TECH', 999999999, 60, current_date, true)
$$, 'a player cannot write themselves onto the board');

\echo '=== 10. service role seeds two verified entries, one unlisted ==='
reset role;
insert into public.profiles (id, display_name, board_handle)
values ('22222222-2222-2222-2222-222222222222','Mal','Quiet Heron 0002');
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values ('11111111-1111-1111-1111-111111111111', 123, '{"entries":[]}', 'hash-a', '1', 'ev1',
        'Sharkfin','TECH', 5000000, 9, 4200000, 9, 'verified', now());

select test.throws('23505', $$
  insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
    company_name, industry, claimed_peak_valuation, claimed_years_survived)
  values ('11111111-1111-1111-1111-111111111111', 123, '{"entries":[]}', 'hash-a', '1', 'ev1',
          'Sharkfin','TECH', 5000000, 9)
$$, 'the same tape twice is the same run twice');

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
select test.eq((select count(*) from public.board_valuation), 1::bigint,
               'anon sees exactly the one moderated entry');
select test.eq((select company_name from public.board_valuation), 'Sharkfin',
               'and it is the listed one, not the phone number');
select test.eq((select founder_display_name from public.board_valuation), 'Brave Otter 4417',
               'shown under a pool handle, never a real name');

\echo '=== 12. one entry per player per board per season ==='
reset role;
select test.throws('23505', $$
  insert into public.leaderboard_entries
    (board, season, run_id, profile_id, founder_display_name, company_name,
     industry, peak_valuation, years_survived, achieved_on, listed)
  select 'valuation','2026-Q3', id, profile_id, 'Brave Otter 4417', 'Sharkfin2',
         'TECH', 9999999, 12, current_date, true
  from public.runs where tape_hash = 'hash-a'
$$, 'one entry per player per board per season');

\echo '=== 13. absurd claims are rejected at the DB ==='
select test.throws('23514', $$
  insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
    company_name, industry, claimed_peak_valuation, claimed_years_survived)
  values ('11111111-1111-1111-1111-111111111111', 1, '{}', 'h1','1','ev1','X','TECH', 1e14, 9)
$$, 'a $100tn valuation is refused by the schema');
select test.throws('23514', $$
  insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
    company_name, industry, claimed_peak_valuation, claimed_years_survived)
  values ('11111111-1111-1111-1111-111111111111', 1, '{}', 'h2','1','ev1','X','TECH', 100, 999)
$$, 'a 999-year run is refused by the schema');

\echo '=== 14. deleting the profile cascades everything (COPPA §9.7) ==='
-- Named per player rather than counted across the table. The unqualified
-- counts this used to print were `runs 1, entries 1` on a PASSING run — B's
-- rows, which are supposed to survive — and there was no way to tell that from
-- a failure to cascade without rebuilding the fixture in your head.
delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';

select test.eq((select count(*) from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'A''s saves are gone');
select test.eq((select count(*) from public.legacy
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'A''s legacy is gone');
select test.eq((select count(*) from public.runs
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'A''s run tapes are gone');
select test.eq((select count(*) from public.leaderboard_entries
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'A''s board entries are gone');
select test.eq((select count(*) from public.run_ledger
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'A''s run ledger is gone');

-- ...and the cascade stopped at A. A delete that took the whole table with it
-- would satisfy every assertion above.
select test.eq((select count(*) from public.runs
                where profile_id = '22222222-2222-2222-2222-222222222222'), 1::bigint,
               'B''s run is untouched');
select test.eq((select count(*) from public.leaderboard_entries
                where profile_id = '22222222-2222-2222-2222-222222222222'), 1::bigint,
               'B''s board entry is untouched');

\echo '=== 15. retention: tapes older than 30 days are emptied, entries survive ==='
update public.runs set tape = '{"entries":[1,2,3]}', verified_at = now() - interval '31 days';
select test.eq(public.expire_run_tapes(), 1::bigint, 'one tape expired');
select test.eq((select tape::text from public.runs), '{}', 'the tape is emptied');
select test.eq((select status from public.runs), 'verified', 'but the run stays verified');
select test.eq((select count(*) from public.leaderboard_entries), 1::bigint,
               'and the board entry survives the tape');

\echo '=== schema_test: all checks passed ==='
