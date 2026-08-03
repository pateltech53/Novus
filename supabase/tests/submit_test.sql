\set ON_ERROR_STOP 1
\pset pager off

-- The submission path (0006). Three claims:
--
--   1. A board keeps the BETTER run and never the later one. `unique (board,
--      season, profile_id)` says one entry per player; read-compare-write in a
--      route handler turns that into a race where the worse submission can land
--      last, so the comparison lives in the ON CONFLICT clause.
--   2. The report path takes a row down in one call, and leaves enough behind
--      that a moderator can put it back.
--   3. None of the three functions is reachable by a player.
--
--   npm run test:db          # all six suites, fresh database each

insert into auth.users (id) values ('44444444-4444-4444-4444-444444444444');
insert into public.profiles (id, display_name, board_handle)
values ('44444444-4444-4444-4444-444444444444','Robin','Patient Heron 2201');

-- Two verified runs for the same player: a long survival, and a rich short one.
insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values
  ('44444444-4444-4444-4444-444444444444', 1, '{"entries":[]}', 'hash-long','1','ev1',
   'Long Haul','TECH', 5000000, 9, 5000000, 9, 'verified', now()),
  ('44444444-4444-4444-4444-444444444444', 2, '{"entries":[]}', 'hash-rich','1','ev1',
   'Short Rich','TECH', 90000000, 3, 90000000, 3, 'verified', now());


\echo '=== 1. the first submission lands on both boards ==='

select test.ok(
  public.record_board_entry('survival','2026-Q3',
    (select id from public.runs where tape_hash='hash-long'),
    '44444444-4444-4444-4444-444444444444','Patient Heron 2201',
    'Long Haul','TECH', 5000000, 9, 'chapter7', true),
  'a first survival entry is written');

select test.ok(
  public.record_board_entry('valuation','2026-Q3',
    (select id from public.runs where tape_hash='hash-long'),
    '44444444-4444-4444-4444-444444444444','Patient Heron 2201',
    'Long Haul','TECH', 5000000, 9, 'chapter7', true),
  'a first valuation entry is written');

select test.eq((select count(*) from public.leaderboard_entries), 2::bigint,
               'one row per board, and no more');


\echo '=== 2. a WORSE run does not displace a better one ==='
-- 3 years is worse than 9 on the survival board, whatever it is worth.

select test.ok(
  not public.record_board_entry('survival','2026-Q3',
    (select id from public.runs where tape_hash='hash-rich'),
    '44444444-4444-4444-4444-444444444444','Patient Heron 2201',
    'Short Rich','TECH', 90000000, 3, 'acquired', true),
  'a shorter run is refused by the survival board');

select test.eq((select years_survived from public.leaderboard_entries
                 where board='survival')::bigint, 9::bigint,
               '...and the longer run is still the one standing');


\echo '=== 3. ...but a BETTER one on the other board does ==='
-- $90M beats $5M on the valuation board, even though it survived six fewer
-- years. Two boards, two orderings, one submission path.

select test.ok(
  public.record_board_entry('valuation','2026-Q3',
    (select id from public.runs where tape_hash='hash-rich'),
    '44444444-4444-4444-4444-444444444444','Patient Heron 2201',
    'Short Rich','TECH', 90000000, 3, 'acquired', true),
  'a richer run takes the valuation board');

select test.eq((select company_name from public.leaderboard_entries
                 where board='valuation'), 'Short Rich',
               '...and the row now names the richer company');

select test.eq((select count(*) from public.leaderboard_entries), 2::bigint,
               'one player still occupies exactly two rows');


\echo '=== 4. a reported row comes down, and can be put back ==='

select test.eq((select count(*) from public.board_valuation), 1::bigint,
               'the listed entry is on the public board');

select test.ok(
  public.report_board_entry((select id from public.leaderboard_entries where board='valuation')),
  'a report is accepted');

select test.eq((select count(*) from public.board_valuation), 0::bigint,
               'one report takes it off the board immediately');

select test.eq((select reports from public.leaderboard_entries where board='valuation')::bigint,
               1::bigint,
               '...and leaves a count behind, so it is recoverable');

select test.ok(
  (select unlisted_at is not null from public.leaderboard_entries where board='valuation'),
  '...and a timestamp');

select test.ok(
  public.set_entry_listed(
    (select id from public.leaderboard_entries where board='valuation'), true, 'checked, fine'),
  'a moderator can put it back');

select test.eq((select count(*) from public.board_valuation), 1::bigint,
               '...and it returns to the public board');

select test.eq((select reports from public.leaderboard_entries where board='valuation')::bigint,
               0::bigint,
               'relisting clears the reports it was taken down for');


\echo '=== 5. an entry written UNLISTED is invisible until a human lists it ==='

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');
insert into public.profiles (id, display_name, board_handle)
values ('55555555-5555-5555-5555-555555555555','Sam','Careful Lynx 8080');

insert into public.runs (profile_id, seed, tape, tape_hash, engine_version, events_hash,
  company_name, industry, claimed_peak_valuation, claimed_years_survived,
  verified_peak_valuation, verified_years_survived, status, verified_at)
values ('55555555-5555-5555-5555-555555555555', 3, '{"entries":[]}', 'hash-wait','1','ev1',
        'Waiting Room','ECOM', 1000000000, 12, 1000000000, 12, 'verified', now());

select test.ok(
  public.record_board_entry('valuation','2026-Q3',
    (select id from public.runs where tape_hash='hash-wait'),
    '55555555-5555-5555-5555-555555555555','Careful Lynx 8080',
    'Waiting Room','ECOM', 1000000000, 12, null, false),
  'an unlisted entry is still written');

set role anon;
select test.eq((select count(*) from public.board_valuation), 1::bigint,
               'the unlisted entry is invisible to the public, though it would rank #1');
reset role;

select test.eq((select count(*) from public.leaderboard_entries where not listed), 1::bigint,
               '...and it does exist — it is hidden, not missing');


\echo '=== 6. the board view exposes an id, and still runs as the caller ==='
-- The id is what the report control reports. security_invoker is what stops the
-- view bypassing the RLS underneath it — dropping and recreating a view is
-- exactly where that flag gets lost.

select test.ok(
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='board_survival' and column_name='id'),
  'board_survival carries its own row id');

select test.ok(
  (select lower(coalesce(o.option_value,'')) in ('on','true','1','yes')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join lateral pg_options_to_table(c.reloptions) o
            on o.option_name = 'security_invoker'
    where n.nspname='public' and c.relname='board_survival'),
  'board_survival runs as the caller, not as its owner');


\echo '=== 7. no player can call any of the three functions ==='
-- security definer means these run as their owner. Anything that can call them
-- can write the board they exist to protect.

set role authenticated;
select test.throws('42501', $$
  select public.record_board_entry('survival','2026-Q3', gen_random_uuid(), gen_random_uuid(),
    'Brave Otter 4417','Hax','TECH', 999999999, 40, null, true)
$$, 'a player cannot write themselves onto a board');

select test.throws('42501', $$
  select public.set_entry_listed(gen_random_uuid(), true, null)
$$, 'a player cannot list their own entry');

select test.throws('42501', $$
  select public.report_board_entry(gen_random_uuid())
$$, 'a player cannot call the report function directly');
reset role;


\echo '=== 8. deleting the player takes the whole trail with them ==='
-- §9.7: a parent can demand deletion, and with anonymous-shaped data there is
-- nobody to authenticate — so the path is in-app and it has to cascade.

delete from public.profiles where id = '44444444-4444-4444-4444-444444444444';

select test.eq((select count(*) from public.leaderboard_entries
                 where profile_id = '44444444-4444-4444-4444-444444444444'), 0::bigint,
               'their board entries are gone');
select test.eq((select count(*) from public.runs
                 where profile_id = '44444444-4444-4444-4444-444444444444'), 0::bigint,
               'their runs and tapes are gone');

\echo '=== submit_test: all checks passed ==='
