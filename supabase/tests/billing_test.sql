\set ON_ERROR_STOP 0
\pset pager off

-- Billing (0003). The properties tested here are the ones whose failure mode is
-- "Pro is free" or "the player paid and did not get it", so each is asserted
-- rather than assumed.
--
--   psql -d novus -f _supabase_shim.sql \
--                 -f ../migrations/0001_novus_core.sql \
--                 -f ../migrations/0002_leaderboard.sql \
--                 -f ../migrations/0003_billing.sql \
--                 -f billing_test.sql
--
-- Note the shim grants ALL on functions to anon/authenticated by default
-- privileges, which is MORE permissive than a real Supabase project. That
-- makes section 1 a genuinely hostile test: if the explicit REVOKE in 0003
-- were missing, these calls would succeed here.

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

set role postgres;
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Zach'),
  ('22222222-2222-2222-2222-222222222222', 'Mallory');


\echo ''
\echo '=== 1. a player CANNOT call the grant functions (should FAIL 42501 ×3) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- If any of these three succeed, Pro costs nothing: they are reachable over
-- PostgREST as POST /rest/v1/rpc/<name> by every anonymous player in the game.
select public.grant_extra_run_slot('11111111-1111-1111-1111-111111111111');
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH');
select public.apply_subscription('11111111-1111-1111-1111-111111111111', true, 'pro_yearly');


\echo ''
\echo '=== 2. a player cannot see the billing tables at all (should FAIL 42501 ×2) ==='
select * from public.billing_customers;
select * from public.billing_events;


\echo ''
\echo '=== 3. entitlements are still READ-only to the player (select ok, write FAILS) ==='
select count(*) as visible_entitlement_rows from public.entitlements;
-- 0001 gives entitlements a SELECT policy and nothing else. An insert here
-- would be a player granting themselves Pro directly. (FAIL 42501)
insert into public.entitlements (profile_id, pro)
values ('11111111-1111-1111-1111-111111111111', true);


\echo ''
\echo '=== 4. the service role CAN grant (this is the webhook) ==='
set role service_role;
set request.jwt.claim.sub = '';

select public.apply_subscription('11111111-1111-1111-1111-111111111111', true, 'pro_yearly');
select pro, intent from public.entitlements
  where profile_id = '11111111-1111-1111-1111-111111111111';


\echo ''
\echo '=== 5. industry packs are idempotent — buying TECH twice leaves one ==='
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH');
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH');
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'GAMING');
select array_length(industry_packs, 1) as packs, industry_packs
  from public.entitlements where profile_id = '11111111-1111-1111-1111-111111111111';


\echo ''
\echo '=== 6. a typo''d industry is rejected, not silently useless (FAIL 23514) ==='
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TEHC');


\echo ''
\echo '=== 7. run slots ACCUMULATE — two bought is two ==='
select public.grant_extra_run_slot('22222222-2222-2222-2222-222222222222');
select public.grant_extra_run_slot('22222222-2222-2222-2222-222222222222');
select extra_run_slots from public.entitlements
  where profile_id = '22222222-2222-2222-2222-222222222222';


\echo ''
\echo '=== 8. cancelling clears pro but KEEPS the recorded intent ==='
select public.apply_subscription('11111111-1111-1111-1111-111111111111', false, null);
select pro, intent, array_length(industry_packs, 1) as packs_kept
  from public.entitlements where profile_id = '11111111-1111-1111-1111-111111111111';
-- pro=false, intent still pro_yearly, and the packs they OWN outright survive
-- the subscription ending. A one-time purchase is not rented.


\echo ''
\echo '=== 9. webhook dedup: the same event id cannot be claimed twice (FAIL 23505) ==='
insert into public.billing_events (id, type) values ('evt_1', 'checkout.session.completed');
insert into public.billing_events (id, type) values ('evt_1', 'checkout.session.completed');


\echo ''
\echo '=== 10. one Stripe customer cannot be attached to two profiles (FAIL 23505) ==='
insert into public.billing_customers (profile_id, stripe_customer_id)
values ('11111111-1111-1111-1111-111111111111', 'cus_A');
insert into public.billing_customers (profile_id, stripe_customer_id)
values ('22222222-2222-2222-2222-222222222222', 'cus_A');


\echo ''
\echo '=== 11. deleting a player erases their billing rows (cascade) ==='
set role postgres;
delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select count(*) as customers_left from public.billing_customers
  where profile_id = '11111111-1111-1111-1111-111111111111';
select count(*) as entitlements_left from public.entitlements
  where profile_id = '11111111-1111-1111-1111-111111111111';
