\set ON_ERROR_STOP 1
\pset pager off

-- Islands (0012) — more than one company per player, and the cap that decides
-- how many.
--
-- Two claims are worth a suite of their own, because both were sold before
-- they were built:
--
--   1. The cap is enforced in the DATABASE, not only in lib/monetization.ts.
--      0002's header is blunt that localStorage is "plain JSON, and anyone who
--      opens devtools can write anything into it" — an entitlement check that
--      lives only there is a suggestion.
--   2. The daily founding ration and the island cap are now SEPARATE. Buying
--      an island must not hand out an extra founding a day, and Pro's three
--      foundings must not depend on how many islands anyone bought.
--
--   npm run test:db

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Free Player'),
  ('22222222-2222-2222-2222-222222222222', 'Pro Player');

-- A helper so each insert below reads as "found another company" rather than
-- fourteen columns of noise. Slot is explicit: the point of the suite.
create or replace function test.found(p_profile uuid, p_slot int)
returns void
language sql
as $$
  insert into public.saves
    (profile_id, slot, run_id, seed, state, company_name, industry, year, month, stage)
  values
    (p_profile, p_slot, 'run-' || p_slot, 100 + p_slot,
     jsonb_build_object('id', 'run-' || p_slot), 'Company ' || p_slot, 'TECH', 1, 1, 1);
$$;


\echo ''
\echo '=== 1. free holds TWO islands, and is refused a third ==='
select test.found('11111111-1111-1111-1111-111111111111', 0);
select test.found('11111111-1111-1111-1111-111111111111', 1);
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111'), 2::bigint,
               'a free player holds two companies at once');

-- 23514 is the check-violation class the trigger raises with, so a caller that
-- already handles a constraint failure handles this one too.
select test.throws('23514', $$
  select test.found('11111111-1111-1111-1111-111111111111', 2)
$$, 'a third island is refused at the free cap');


\echo ''
\echo '=== 2. saving an island you already hold is never capped ==='
-- The trigger is BEFORE INSERT only. A player sitting at their cap must still
-- be able to play the companies they have — an upsert onto an owned slot
-- arrives as an UPDATE and must not be touched by any of this.
update public.saves set year = 4
 where profile_id = '11111111-1111-1111-1111-111111111111' and slot = 0;
select test.eq((select year from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111' and slot = 0), 4,
               'a player at their cap can still save a company they hold');


\echo ''
\echo '=== 3. a bought island raises the cap by exactly one ==='
select public.grant_extra_island('11111111-1111-1111-1111-111111111111');
select test.found('11111111-1111-1111-1111-111111111111', 2);
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111'), 3::bigint,
               'the purchase bought exactly one more company at the same time');
select test.throws('23514', $$
  select test.found('11111111-1111-1111-1111-111111111111', 3)
$$, 'and only one — the fourth is still refused');


\echo ''
\echo '=== 4. the SKU no longer touches the daily founding ration ==='
-- This is the split. Before 0012 the same column was added to the daily
-- allowance, so the line below would have read 2.
select test.eq(public.player_allowance('11111111-1111-1111-1111-111111111111'), 1,
               'a bought island does NOT add a founding per day');


\echo ''
\echo '=== 5. Pro holds ten, and the eleventh has nowhere to go ==='
insert into public.entitlements (profile_id, pro)
values ('22222222-2222-2222-2222-222222222222', true);

select test.found('22222222-2222-2222-2222-222222222222', s)
  from generate_series(0, 9) as s;
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '22222222-2222-2222-2222-222222222222'), 10::bigint,
               'Pro holds ten companies at once');

-- Slot 10 fails on 0001's own `slot between 0 and 9` check before the cap
-- trigger has an opinion, which is the point of capping island_allowance at
-- 10: the allowance can never promise storage the table refuses.
select test.throws('23514', $$
  select test.found('22222222-2222-2222-2222-222222222222', 10)
$$, 'there is no eleventh slot to sell');

select test.eq(public.player_allowance('22222222-2222-2222-2222-222222222222'), 3,
               'Pro still founds three a day, unchanged by islands');


\echo ''
\echo '=== 6. a player cannot read another account''s allowance ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- The argument is a profile id. Granted to `authenticated`, this would answer
-- "is this other account Pro?" for any uuid a player cared to type.
select test.throws('42501', $$
  select public.island_allowance('22222222-2222-2222-2222-222222222222')
$$, 'island_allowance is not reachable over PostgREST');
select test.throws('42501', $$
  select public.grant_extra_island('11111111-1111-1111-1111-111111111111')
$$, 'a player cannot grant themselves an island');
select test.throws('42501', $$
  select public.admin_set_extra_islands('11111111-1111-1111-1111-111111111111', 20)
$$, 'a player cannot set their own island count');


\echo ''
\echo '=== 7. RLS still fences islands by owner, at every slot ==='
-- The `saves: own` policy never mentioned slot, so this held before 0012 by
-- construction. Asserted anyway: it is now the only thing standing between one
-- player and another player's ten companies.
select test.eq((select count(*)::bigint from public.saves), 3::bigint,
               'A sees only their own three, not B''s ten');

update public.saves set company_name = 'Stolen'
 where profile_id = '22222222-2222-2222-2222-222222222222';
select test.eq((select count(*)::bigint from public.saves
                where company_name = 'Stolen'), 0::bigint,
               'A cannot rename a company on B''s island');

reset role;


\echo ''
\echo '=== 8. deleting the account takes every island with it ==='
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '22222222-2222-2222-2222-222222222222'), 0::bigint,
               'ten islands cascade away with the account that held them');

\echo '=== islands_test: all checks passed ==='
