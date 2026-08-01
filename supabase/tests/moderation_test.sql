\set ON_ERROR_STOP 1
\pset pager off

-- Moderation and retention (0002). The claim: nothing a player typed reaches a
-- public board until a human has looked at it, and the tape it was proved with
-- does not outlive its purpose.
--
--   npm run test:db          # all five suites, fresh database each

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
select test.eq((select count(*) from public.board_valuation), 0::bigint,
               'an unmoderated entry is invisible to the public');
reset role;
select test.eq((select count(*) from public.leaderboard_entries), 1::bigint,
               '...and it does exist — it is hidden, not missing');

\echo '=== ...and invisible to its OWN author until moderated ==='
-- Not vanity. If the author could see it listed they would believe the phone
-- number in their company name was already public, which is the wrong thing to
-- believe in either direction.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test.eq((select count(*) from public.leaderboard_entries), 0::bigint,
               'the author cannot see their own entry until it is moderated');

\echo '=== moderator lists it; now it appears ==='
reset role;
update public.leaderboard_entries set listed = true, company_name = 'Redacted Co';
set role anon;
select test.eq((select count(*) from public.board_valuation), 1::bigint,
               'once listed, the public sees it');
select test.eq((select company_name from public.board_valuation), 'Redacted Co',
               'showing what the moderator left, not what the player typed');
select test.eq((select founder_display_name from public.board_valuation), 'Silent Marten 0007',
               'under a pool handle, never a real name');

\echo '=== retention: a 31-day-old tape is emptied, the board entry survives ==='
reset role;
update public.runs set verified_at = now() - interval '31 days';
select test.eq(public.expire_run_tapes(), 1::bigint, 'the old tape expires');
select test.eq((select tape::text from public.runs), '{}', 'and is emptied');
select test.eq((select status from public.runs), 'verified',
               'the run stays verified — the proof was done, the evidence is not kept');
select test.eq((select verified_peak_valuation::text from public.runs), '99000000.00',
               'and the verified score it earned is untouched');
select test.eq((select count(*) from public.leaderboard_entries), 1::bigint,
               'the board entry outlives the tape');

\echo '=== a fresh tape (under 30 days) is NOT touched ==='
update public.runs set tape = '{"entries":[9]}', verified_at = now();
select test.eq(public.expire_run_tapes(), 0::bigint, 'a fresh tape is not swept');
select test.eq((select tape::text from public.runs), '{"entries": [9]}',
               'and is still there in full');

\echo '=== moderation_test: all checks passed ==='
