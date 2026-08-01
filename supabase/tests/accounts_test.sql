\set ON_ERROR_STOP 0
\pset pager off

-- Accounts (0004). Two claims are tested, both of which fail dangerously:
--
--   1. The stale sweep must never touch a real account or a player who paid.
--      A cleanup job that deletes a paying customer is the worst bug in here.
--   2. No player may be able to CALL the sweep. It runs as its owner and
--      deletes users; reachable over PostgREST it would let any anonymous
--      visitor delete every other player in the database.
--
--   psql -d novus -f _supabase_shim.sql \
--                 -f ../migrations/0001_novus_core.sql \
--                 -f ../migrations/0002_leaderboard.sql \
--                 -f ../migrations/0003_billing.sql \
--                 -f ../migrations/0004_accounts.sql \
--                 -f accounts_test.sql

set role postgres;

-- Five users covering every branch of the WHERE clause.
insert into auth.users (id, email, is_anonymous, created_at, last_sign_in_at) values
  -- stale anonymous, nothing attached → SHOULD be swept
  ('aaaaaaaa-0000-0000-0000-000000000001', null, true,  now() - interval '200 days', now() - interval '200 days'),
  -- anonymous but ACTIVE (signed in yesterday) → must survive
  ('aaaaaaaa-0000-0000-0000-000000000002', null, true,  now() - interval '200 days', now() - interval '1 day'),
  -- a REAL account, ancient and idle → must survive, age is irrelevant
  ('aaaaaaaa-0000-0000-0000-000000000003', 'zach@example.com', false, now() - interval '900 days', now() - interval '900 days'),
  -- stale anonymous WITH entitlements → must survive (evidence of a purchase)
  ('aaaaaaaa-0000-0000-0000-000000000004', null, true,  now() - interval '400 days', now() - interval '400 days'),
  -- stale anonymous WITH a stripe customer row → must survive
  ('aaaaaaaa-0000-0000-0000-000000000005', null, true,  now() - interval '400 days', now() - interval '400 days');

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ghost'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Regular'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Zach'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Paid'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Customer');

select public.apply_subscription('aaaaaaaa-0000-0000-0000-000000000004', true, 'pro_yearly');
insert into public.billing_customers (profile_id, stripe_customer_id)
values ('aaaaaaaa-0000-0000-0000-000000000005', 'cus_keepme');

-- Some progress on the doomed one, to prove the cascade reaches it.
insert into public.legacy (profile_id, best_year) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 4);


\echo ''
\echo '=== 1. a player CANNOT call the sweep (should FAIL 42501) ==='
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
-- security definer + reachable over PostgREST would mean any visitor could
-- delete every other player. The revoke in 0004 is the only thing stopping it.
select public.delete_stale_anonymous_users();


\echo ''
\echo '=== 2. the service role can, and sweeps exactly ONE user ==='
set role service_role;
set request.jwt.claim.sub = '';
select public.delete_stale_anonymous_users() as swept;


\echo ''
\echo '=== 3. who survived (expect 4: active anon, real account, paid, customer) ==='
set role postgres;
select
  (select count(*) from auth.users) as users_left,
  (select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001') as ghost_gone_expect_0,
  (select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002') as active_anon_expect_1,
  (select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000003') as real_account_expect_1,
  (select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000004') as paid_anon_expect_1,
  (select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000005') as customer_anon_expect_1;


\echo ''
\echo '=== 4. the sweep cascaded — the ghost took its profile and legacy with it ==='
select
  (select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') as profile_expect_0,
  (select count(*) from public.legacy   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001') as legacy_expect_0;


\echo ''
\echo '=== 5. running it again is a no-op (expect 0) ==='
set role service_role;
select public.delete_stale_anonymous_users() as swept_again;


\echo ''
\echo '=== 6. deleting a real account cascades everything (the privacy promise) ==='
-- app/api/auth/delete/route.ts deletes the auth.users row and relies entirely
-- on this cascade for "the deletion is real, not a flag".
set role postgres;
insert into public.entitlements (profile_id, pro) values ('aaaaaaaa-0000-0000-0000-000000000003', true);
insert into public.preferences (profile_id) values ('aaaaaaaa-0000-0000-0000-000000000003');
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000003';
select
  (select count(*) from public.profiles     where id = 'aaaaaaaa-0000-0000-0000-000000000003') as profile_expect_0,
  (select count(*) from public.entitlements where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003') as ent_expect_0,
  (select count(*) from public.preferences  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003') as prefs_expect_0;
