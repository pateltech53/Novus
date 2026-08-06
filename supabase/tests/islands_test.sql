\set ON_ERROR_STOP 1
\pset pager off

-- Islands (0013) — more than one company per player, and the cap that decides
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
\echo '=== 3b. a company that ENDED keeps its island and spends no allowance ==='
-- The headstone rule. A free player whose two companies both went under must
-- be able to found again — a limit that fills with graves is a limit that
-- stops the game rather than shaping it.
update public.saves set alive = false, ended_by = 'chapter7'
 where profile_id = '11111111-1111-1111-1111-111111111111';
select test.found('11111111-1111-1111-1111-111111111111', 3);
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111'), 4::bigint,
               'three headstones and a living company share the archipelago');

-- ...and the living ones still count. The allowance is 3 here (2 free + the
-- one bought in section 3), so the fourth LIVING company is the refused one,
-- with three headstones sitting beside it costing nothing.
select test.found('11111111-1111-1111-1111-111111111111', 4);
select test.found('11111111-1111-1111-1111-111111111111', 5);
select test.throws('23514', $$
  select test.found('11111111-1111-1111-1111-111111111111', 6)
$$, 'a fourth LIVING company is refused at 2 + 1 bought');
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '11111111-1111-1111-1111-111111111111'
                  and alive), 3::bigint,
               'three living, and the graves did not take a place from them');

-- Put the fixture back the way section 4 onwards expects it.
delete from public.saves
 where profile_id = '11111111-1111-1111-1111-111111111111' and slot in (3, 4, 5);


\echo ''
\echo '=== 4. the SKU no longer touches the daily founding ration ==='
-- This is the split. Before 0013 the same column was added to the daily
-- allowance, so the line below would have read 2.
select test.eq(public.player_allowance('11111111-1111-1111-1111-111111111111'), 1,
               'a bought island does NOT add a founding per day');


\echo ''
\echo '=== 5. Pro holds ten, and an eleventh needs buying ==='
insert into public.entitlements (profile_id, pro)
values ('22222222-2222-2222-2222-222222222222', true);

select test.found('22222222-2222-2222-2222-222222222222', s)
  from generate_series(0, 9) as s;
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '22222222-2222-2222-2222-222222222222'), 10::bigint,
               'Pro holds ten companies at once');

-- 0015 moved the storage ceiling to 50, so slot 10 now clears 0001's own
-- column check and is refused by the CAP TRIGGER instead — same errcode, a
-- different and more interesting reason. Before 0015 the tier WAS the ceiling,
-- so this line could not distinguish "Pro's allowance is spent" from "the
-- table has no room", and the two are now different facts.
select test.throws('23514', $$
  select test.found('22222222-2222-2222-2222-222222222222', 10)
$$, 'Pro stops at ten until an island is bought');

select test.eq(public.player_allowance('22222222-2222-2222-2222-222222222222'), 3,
               'Pro still founds three a day, unchanged by islands');


\echo ''
\echo '=== 5b. a bought island works ON PRO — the 0015 fix ==='
-- The bug this proves gone: `island_allowance` handed a Pro account a flat 10,
-- which was the whole ceiling, so `least(10, 10 + bought)` was 10 for any
-- number bought and a subscriber's $1.99 purchased nothing whatsoever.
select test.eq(public.island_allowance('22222222-2222-2222-2222-222222222222'), 10,
               'Pro alone allows ten islands');

select public.grant_extra_island('22222222-2222-2222-2222-222222222222');
select test.eq(public.island_allowance('22222222-2222-2222-2222-222222222222'), 11,
               'a bought island raises a PRO account''s allowance');

-- And the eleventh company now actually lands, which is the thing that was
-- being sold.
select test.found('22222222-2222-2222-2222-222222222222', 10);
select test.eq((select count(*)::bigint from public.saves
                where profile_id = '22222222-2222-2222-2222-222222222222'), 11::bigint,
               'the island that was bought holds a company');

-- The ceiling is still real, and it is the storage one rather than a tier.
select public.admin_set_extra_islands('22222222-2222-2222-2222-222222222222', 48);
select test.eq(public.island_allowance('22222222-2222-2222-2222-222222222222'), 50,
               'fifty is the ceiling, whatever the arithmetic says');
select test.eq((select extra_islands from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), 48,
               'forty-eight is the most that can be held');

-- Slot 50 fails on the column check — the allowance can never promise storage
-- the table refuses, which is the invariant the outer `least(50, …)` exists
-- for.
select test.throws('23514', $$
  select test.found('22222222-2222-2222-2222-222222222222', 50)
$$, 'there is no fifty-first slot to sell');


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
-- The `saves: own` policy never mentioned slot, so this held before 0013 by
-- construction. Asserted anyway: it is now the only thing standing between one
-- player and another player's ten companies.
select test.eq((select count(*)::bigint from public.saves), 3::bigint,
               'A sees only their own three, not B''s eleven');

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
               'every island cascades away with the account that held them');

\echo '=== islands_test: all checks passed ==='
