\set ON_ERROR_STOP 1
\pset pager off

-- Billing (0003). The properties tested here are the ones whose failure mode is
-- "Pro is free" or "the player paid and did not get it", so each is asserted
-- rather than assumed.
--
--   npm run test:db          # all five suites, fresh database each
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
\echo '=== 1. a player CANNOT call the grant functions ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- If any of these three succeed, Pro costs nothing: they are reachable over
-- PostgREST as POST /rest/v1/rpc/<name> by every player in the game.
select test.throws('42501', $$
  select public.grant_extra_island('11111111-1111-1111-1111-111111111111')
$$, 'a player cannot grant themselves an island');
select test.throws('42501', $$
  select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH')
$$, 'a player cannot grant themselves an industry pack');
select test.throws('42501', $$
  select public.apply_subscription('11111111-1111-1111-1111-111111111111', true, 'pro_yearly')
$$, 'a player cannot grant themselves Pro');


\echo ''
\echo '=== 2. a player cannot see the billing tables at all ==='
select test.throws('42501', $$ select * from public.billing_customers $$,
                   'billing_customers is invisible to a player');
select test.throws('42501', $$ select * from public.billing_events $$,
                   'billing_events is invisible to a player');


\echo ''
\echo '=== 3. entitlements are still READ-only to the player ==='
select test.eq((select count(*) from public.entitlements), 0::bigint,
               'a player with no purchase sees no entitlement row');
-- 0001 gives entitlements a SELECT policy and nothing else. An insert here
-- would be a player granting themselves Pro directly.
select test.throws('42501', $$
  insert into public.entitlements (profile_id, pro)
  values ('11111111-1111-1111-1111-111111111111', true)
$$, 'entitlements are read-only to the player');


\echo ''
\echo '=== 4. the service role CAN grant (this is the webhook) ==='
set role service_role;
set request.jwt.claim.sub = '';

select public.apply_subscription('11111111-1111-1111-1111-111111111111', true, 'pro_yearly');
select test.ok((select pro from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'),
               'the webhook can grant Pro');
select test.eq((select intent from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'), 'pro_yearly',
               'and the plan is recorded');


\echo ''
\echo '=== 5. industry packs are idempotent — buying TECH twice leaves one ==='
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH');
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TECH');
select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'GAMING');
select test.eq((select array_length(industry_packs, 1)::bigint from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'), 2::bigint,
               'TECH bought twice is one pack, not two');
select test.ok((select industry_packs @> array['TECH','GAMING'] from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'),
               'and both packs are actually there');


\echo ''
\echo '=== 6. a typo''d industry is rejected, not silently useless ==='
select test.throws('23514', $$
  select public.grant_industry_pack('11111111-1111-1111-1111-111111111111', 'TEHC')
$$, 'an industry code that is not real is refused loudly');


\echo ''
\echo '=== 7. islands ACCUMULATE — two bought is two ==='
select public.grant_extra_island('22222222-2222-2222-2222-222222222222');
select public.grant_extra_island('22222222-2222-2222-2222-222222222222');
select test.eq((select extra_islands::bigint from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), 2::bigint,
               'two islands bought is two islands');


\echo ''
\echo '=== 8. cancelling clears pro but KEEPS the recorded intent ==='
select public.apply_subscription('11111111-1111-1111-1111-111111111111', false, null);
select test.ok((select not pro from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'),
               'cancelling clears Pro');
select test.eq((select intent from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'), 'pro_yearly',
               'but the plan they had is still recorded');
-- A one-time purchase is not rented: the packs they OWN survive the
-- subscription ending.
select test.eq((select array_length(industry_packs, 1)::bigint from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'), 2::bigint,
               'and the packs they own outright survive it');


\echo ''
\echo '=== 9. webhook dedup: the same event id cannot be claimed twice ==='
insert into public.billing_events (id, type) values ('evt_1', 'checkout.session.completed');
select test.throws('23505', $$
  insert into public.billing_events (id, type) values ('evt_1', 'checkout.session.completed')
$$, 'a redelivered Stripe event cannot be handled twice');


\echo ''
\echo '=== 10. one Stripe customer cannot be attached to two profiles ==='
insert into public.billing_customers (profile_id, stripe_customer_id)
values ('11111111-1111-1111-1111-111111111111', 'cus_A');
select test.throws('23505', $$
  insert into public.billing_customers (profile_id, stripe_customer_id)
  values ('22222222-2222-2222-2222-222222222222', 'cus_A')
$$, 'one Stripe customer belongs to one profile');


\echo ''
\echo '=== 11. deleting a player erases their billing rows (cascade) ==='
set role postgres;
delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select test.eq((select count(*) from public.billing_customers
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'the Stripe link is gone');
select test.eq((select count(*) from public.entitlements
                where profile_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
               'the entitlements are gone');
-- ...and only theirs. The other player paid too.
select test.eq((select count(*) from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), 1::bigint,
               'the other player''s purchase is untouched');

\echo '=== billing_test: all checks passed ==='
