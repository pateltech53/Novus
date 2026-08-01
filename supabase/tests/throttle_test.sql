\set ON_ERROR_STOP 1
\pset pager off

-- Auth throttle (0005). The claims that matter:
--   1. A player cannot call it. It is security definer, so a caller could
--      otherwise spend a victim's budget and lock them out of their own account.
--   2. It actually stops at the limit, and counts the over-limit attempt too —
--      a flood must be self-limiting, not merely reported.
--   3. Buckets and keys are independent, so one classroom's NAT exhausting
--      sign-ins cannot lock out anybody's password reset.
--   4. The window expires.
--
--   npm run test:db          # all five suites, fresh database each

\echo ''
\echo '=== 1. a player CANNOT call it ==='
set role authenticated;
select test.throws('42501', $$
  select public.claim_auth_attempt('signup:ip', 'victim', 5, interval '15 minutes')
$$, 'a player cannot spend another player''s throttle budget');
select test.throws('42501', $$
  select public.prune_auth_throttle()
$$, 'a player cannot prune the throttle table');


\echo ''
\echo '=== 2. limit of 3: t,t,t then f,f (the 4th is counted, not waved through) ==='
set role service_role;
select test.ok(public.claim_auth_attempt('signup:ip', 'kA', 3), 'attempt 1 of 3 allowed');
select test.ok(public.claim_auth_attempt('signup:ip', 'kA', 3), 'attempt 2 of 3 allowed');
select test.ok(public.claim_auth_attempt('signup:ip', 'kA', 3), 'attempt 3 of 3 allowed');
select test.ok(not public.claim_auth_attempt('signup:ip', 'kA', 3), 'attempt 4 refused');
select test.ok(not public.claim_auth_attempt('signup:ip', 'kA', 3), 'attempt 5 refused');

-- The refused attempts still cost the flooder their budget. A limiter that
-- stopped counting once it started saying no would reset the moment the window
-- rolled, however hard it was being hit.
select test.eq((select attempts::bigint from public.auth_throttle
                where bucket = 'signup:ip' and key = 'kA'), 5::bigint,
               'the counter kept rising past the limit');


\echo ''
\echo '=== 3. buckets and keys are independent ==='
select test.ok(public.claim_auth_attempt('signup:ip', 'kB', 3),
               'a different key is unaffected');
select test.ok(public.claim_auth_attempt('reset:ip', 'kA', 3),
               'a different bucket is unaffected — a NAT full of sign-ups cannot block a reset');


\echo ''
\echo '=== 4. the window expires and the budget returns ==='
-- Age the row past its window rather than waiting for wall-clock time.
set role postgres;
update public.auth_throttle
   set window_start = now() - interval '20 minutes'
 where bucket = 'signup:ip' and key = 'kA';
set role service_role;
select test.ok(public.claim_auth_attempt('signup:ip', 'kA', 3),
               'the budget returns once the window closes');
select test.eq((select attempts::bigint from public.auth_throttle
                where bucket = 'signup:ip' and key = 'kA'), 1::bigint,
               'and the count restarted at 1, not continued at 6');


\echo ''
\echo '=== 5. prune deletes closed windows only ==='
set role postgres;
update public.auth_throttle set window_start = now() - interval '3 days'
 where key = 'kB';
set role service_role;
select test.eq(public.prune_auth_throttle(interval '1 day'), 1::bigint,
               'prune takes the one closed window');
select test.eq((select count(*) from public.auth_throttle), 2::bigint,
               'and leaves the two live ones alone');


\echo ''
\echo '=== 6. the table is invisible to players ==='
-- It holds one hashed key per address that has tried to sign in. Readable, it
-- would be a way to ask "has this address been here" of a database about
-- children.
set role authenticated;
select test.throws('42501', $$ select * from public.auth_throttle $$,
                   'the throttle table is invisible to a player');

\echo '=== throttle_test: all checks passed ==='
