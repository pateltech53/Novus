\set ON_ERROR_STOP 0
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
--   psql -d novus -f _supabase_shim.sql -f ../migrations/0001_novus_core.sql \
--                 -f ../migrations/0002_leaderboard.sql \
--                 -f ../migrations/0003_billing.sql \
--                 -f ../migrations/0004_accounts.sql \
--                 -f ../migrations/0005_auth_throttle.sql \
--                 -f throttle_test.sql

\echo ''
\echo '=== 1. a player CANNOT call it (should FAIL 42501 x2) ==='
set role authenticated;
select public.claim_auth_attempt('signup:ip', 'victim', 5, interval '15 minutes');
select public.prune_auth_throttle();


\echo ''
\echo '=== 2. limit of 3: t,t,t then f,f (the 4th is counted, not waved through) ==='
set role service_role;
select
  public.claim_auth_attempt('signup:ip', 'kA', 3) as a1,
  public.claim_auth_attempt('signup:ip', 'kA', 3) as a2,
  public.claim_auth_attempt('signup:ip', 'kA', 3) as a3,
  public.claim_auth_attempt('signup:ip', 'kA', 3) as a4_expect_f,
  public.claim_auth_attempt('signup:ip', 'kA', 3) as a5_expect_f;

\echo '--- and the counter kept rising past the limit (expect 5) ---'
select attempts from public.auth_throttle where bucket = 'signup:ip' and key = 'kA';


\echo ''
\echo '=== 3. a different KEY is unaffected (expect t) ==='
select public.claim_auth_attempt('signup:ip', 'kB', 3) as other_key;

\echo '=== 3b. a different BUCKET is unaffected (expect t) ==='
select public.claim_auth_attempt('reset:ip', 'kA', 3) as other_bucket;


\echo ''
\echo '=== 4. the window expires and the budget returns (expect t) ==='
-- Age the row past its window rather than waiting for wall-clock time.
set role postgres;
update public.auth_throttle
   set window_start = now() - interval '20 minutes'
 where bucket = 'signup:ip' and key = 'kA';
set role service_role;
select public.claim_auth_attempt('signup:ip', 'kA', 3) as after_window_expect_t;

\echo '--- and the count restarted at 1, not continued at 6 ---'
select attempts as expect_1 from public.auth_throttle
 where bucket = 'signup:ip' and key = 'kA';


\echo ''
\echo '=== 5. prune deletes closed windows only ==='
set role postgres;
update public.auth_throttle set window_start = now() - interval '3 days'
 where key = 'kB';
set role service_role;
select public.prune_auth_throttle(interval '1 day') as pruned_expect_1;
select count(*) as remaining_expect_2 from public.auth_throttle;


\echo ''
\echo '=== 6. the table is invisible to players (should FAIL 42501) ==='
set role authenticated;
select * from public.auth_throttle;
