\set ON_ERROR_STOP 1
\pset pager off

-- Briefcases (0017) — the client never rolls, and never writes.
--
-- docs/BRIEFCASES.md states five rules the code is supposed to enforce rather
-- than merely document. Four of them are enforceable in the database, and
-- until this file existed all four were asserted only by the SHAPE of the
-- migration: no INSERT policy for `authenticated` anywhere, a `revoke all` on
-- every function, two CHECK constraints on the reward pool. A shape is not a
-- test — a later migration that grants `authenticated` a policy "so the client
-- can mark progress" would read as a reasonable line in review and would hand
-- out Legendary for free.
--
-- The rules, restated as claims this file makes:
--
--   1. The client never rolls: no player-writable path into daily_progress,
--      briefcases, inventory, grants, the token ledger or the pity counters,
--      and none of the security-definer functions is executable by a player.
--   2. A player reads their own rows and nobody else's, and anon reads none.
--   3. The rules of the game — templates, skins, the reward pool — are world
--      readable on purpose (§14.2 wants the odds visible in-app).
--   4. Opens are idempotent: `open_briefcase` stores what it commits and
--      replays it forever, granting nothing the second time.
--   5. No reward grants permanent Pro, and a trial is 1, 5 or 24 hours.
--
--   npm run test:db

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002');

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Case Opener'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Someone Else');

-- The content tables are already full: 0018 seeds 51 templates, 101 skins and
-- 40 rewards, and it is applied before this file runs (scripts/db-test.mjs
-- applies every migration in filename order). Seeding more here would collide
-- on the primary key, and asserting an exact count would turn "somebody added
-- a skin" into a failing security test. So the claims below are about what is
-- READABLE by whom, and the seed is the fixture.


\echo ''
\echo '=== 1. the rules of the game are world readable ==='
set role anon;
select test.ok((select count(*) from public.skins) > 0,
               'anon reads the skin catalog — the collection screen needs it');
select test.ok((select count(*) from public.achievement_templates) > 0,
               'anon reads the daily templates');
select test.ok((select count(*) from public.rewards) > 0,
               'anon reads the reward pool — published odds are the point');
select test.ok((select count(*) from public.rewards where payload ? 'pro') = 0,
               'and nothing the seed shipped hands over permanent Pro');
reset role;


\echo ''
\echo '=== 2. a player reads their own rows and nobody else"s ==='
-- Written as the owner (bypassing RLS the way the service role does), which is
-- the only way these rows are ever created in production.
select public.grant_briefcase('aaaaaaaa-0000-0000-0000-000000000001', 3, 'daily:test:1',
                              'full', array[1,2,3]) \gset case_a_
select public.grant_briefcase('bbbbbbbb-0000-0000-0000-000000000002', 1, 'daily:test:1',
                              'full', array[1,1,1]) \gset case_b_

insert into public.daily_progress (user_id, date, slot, template_id, progress, target)
values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 1, 'S1', 10, 10),
       ('bbbbbbbb-0000-0000-0000-000000000002', current_date, 1, 'S1', 3, 10);
insert into public.inventory (user_id, item_id, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'skin_001', 'skin'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'skin_002', 'skin');
insert into public.token_ledger (user_id, delta, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 500, 'test:seed'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 999, 'test:seed');
insert into public.grants (grant_id, user_id, item_id, rarity) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'skin_001', 'common'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'skin_002', 'common');
insert into public.pity_counters (user_id, since_rare) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('bbbbbbbb-0000-0000-0000-000000000002', 9);
insert into public.reward_events (user_id, date, type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'pitch.scored'),
  ('bbbbbbbb-0000-0000-0000-000000000002', current_date, 'pitch.scored');
insert into public.milestones_claimed (user_id, milestone_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'first_deal'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'first_deal');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

select test.eq((select count(*)::bigint from public.briefcases), 1::bigint,
               'a player sees only their own sealed cases');
select test.eq((select count(*)::bigint from public.daily_progress), 1::bigint,
               'a player sees only their own daily progress');
select test.eq((select count(*)::bigint from public.inventory), 1::bigint,
               'a player sees only their own inventory');
select test.eq((select count(*)::bigint from public.grants), 1::bigint,
               'a player sees only their own grants');
select test.eq((select count(*)::bigint from public.token_ledger), 1::bigint,
               'a player sees only their own token ledger');
select test.eq((select count(*)::bigint from public.pity_counters), 1::bigint,
               'a player sees only their own pity counters');
select test.eq((select count(*)::bigint from public.reward_events), 1::bigint,
               'a player sees only their own reward events');
select test.eq((select count(*)::bigint from public.milestones_claimed), 1::bigint,
               'a player sees only their own claimed milestones');
reset role;
reset request.jwt.claim.sub;

set role anon;
select test.eq((select count(*)::bigint from public.briefcases), 0::bigint,
               'anon reads no cases at all');
select test.eq((select count(*)::bigint from public.inventory), 0::bigint,
               'anon reads no inventory at all');
select test.eq((select count(*)::bigint from public.token_ledger), 0::bigint,
               'anon reads no token ledger at all');
reset role;


\echo ''
\echo '=== 3. the client never writes — not one of these tables ==='
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 42501 rather than "an error": a typo in a column name also fails, and the
-- claim here is specifically that row-level security refused the row.
select test.throws('42501', $$
  insert into public.inventory (user_id, item_id, kind)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'skin_002', 'skin')
$$, 'a player cannot put a skin in their own inventory');

select test.throws('42501', $$
  insert into public.briefcases (user_id, tier, source)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 5, 'self:granted')
$$, 'a player cannot grant themselves a Gold case');

select test.throws('42501', $$
  insert into public.token_ledger (user_id, delta, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 100000, 'self:granted')
$$, 'a player cannot mint Shark Tokens');

select test.throws('42501', $$
  insert into public.daily_progress (user_id, date, slot, template_id, progress, target)
  values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 2, 'S1', 99, 1)
$$, 'a player cannot mark a mission done');

select test.throws('42501', $$
  insert into public.grants (grant_id, user_id, item_id, rarity)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'skin_002', 'legendary')
$$, 'a player cannot write a grant');

select test.throws('42501', $$
  insert into public.milestones_claimed (user_id, milestone_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'ten_years')
$$, 'a player cannot claim a milestone by hand');

-- UPDATE has no policy either, so the row is invisible to the statement and
-- the update matches nothing. Asserting the row is UNCHANGED is the honest
-- form of the claim: "equipped stayed false", not "an error was raised".
update public.inventory set equipped = true
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
reset request.jwt.claim.sub;
select test.eq((select count(*)::bigint from public.inventory where equipped), 0::bigint,
               'a player cannot equip by writing the row directly');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.daily_progress set progress = 999, claimed_at = null
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.token_ledger where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
reset request.jwt.claim.sub;
select test.eq((select progress::bigint from public.daily_progress
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and slot = 1),
               10::bigint,
               'a player cannot move their own progress bar');
select test.eq((select count(*)::bigint from public.token_ledger
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1::bigint,
               'a player cannot delete a debit out of their ledger');


\echo ''
\echo '=== 4. and cannot call the functions that do the writing ==='
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.throws('42501', $$
  select public.grant_briefcase('aaaaaaaa-0000-0000-0000-000000000001', 5, 'self', 'full', '{}')
$$, 'grant_briefcase is not executable by a player');
select test.throws('42501', $$
  select public.open_briefcase(gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', '{}'::jsonb)
$$, 'open_briefcase is not executable by a player');
select test.throws('42501', $$
  select public.spend_tokens('aaaaaaaa-0000-0000-0000-000000000001', -100, 'self')
$$, 'spend_tokens is not executable by a player');
select test.throws('42501', $$
  select public.equip_item('aaaaaaaa-0000-0000-0000-000000000001', 'skin_002')
$$, 'equip_item is not executable by a player');
select test.throws('42501', $$
  select public.admin_set_rewards_beta('aaaaaaaa-0000-0000-0000-000000000001', true)
$$, 'admin_set_rewards_beta is not executable by a player');
reset role;
reset request.jwt.claim.sub;

set role anon;
select test.throws('42501', $$
  select public.admin_set_rewards_beta('aaaaaaaa-0000-0000-0000-000000000001', true)
$$, 'admin_set_rewards_beta is not executable by anon either');
reset role;


\echo ''
\echo '=== 5. opening a case is idempotent — a retry replays, never re-rolls ==='
-- The payload is what the route would have computed: one fresh skin worth no
-- tokens. Opening twice must leave exactly one grant, one inventory row and
-- one ledger entry, and must hand back the same reveal both times.
select public.open_briefcase(
  :'case_a_grant_briefcase'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001',
  jsonb_build_object(
    'briefcaseId', :'case_a_grant_briefcase',
    'tier', 3,
    'items', jsonb_build_array(jsonb_build_object(
      'grantId', 'dddddddd-0000-0000-0000-000000000001',
      'itemId', 'skin_002', 'kind', 'skin', 'rarity', 'rare',
      'wasDupe', false, 'tokens', 0)),
    'pity', jsonb_build_object('sinceRare', 0, 'sinceLegendary', 7)
  )
) \gset first_

-- The same call again, as a flaky connection would make it — with a DIFFERENT
-- payload, to prove the second call cannot overwrite the first with anything.
select public.open_briefcase(
  :'case_a_grant_briefcase'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001',
  jsonb_build_object(
    'briefcaseId', :'case_a_grant_briefcase',
    'tier', 5,
    'items', jsonb_build_array(jsonb_build_object(
      'grantId', 'dddddddd-0000-0000-0000-000000000002',
      'itemId', 'skin_001', 'kind', 'skin', 'rarity', 'legendary',
      'wasDupe', false, 'tokens', 5000)),
    'pity', jsonb_build_object('sinceRare', 0, 'sinceLegendary', 0)
  )
) \gset second_

select test.eq(:'first_open_briefcase'::text, :'second_open_briefcase'::text,
               'the second open replays the stored reveal byte for byte');
select test.eq((select count(*)::bigint from public.grants
                 where briefcase_id = :'case_a_grant_briefcase'::uuid), 1::bigint,
               'a re-opened case writes exactly one grant, not two');
select test.eq((select count(*)::bigint from public.inventory
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2::bigint,
               'the seeded skin plus the one that was opened — nothing from the retry');
select test.eq((select coalesce(sum(delta), 0)::bigint from public.token_ledger
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 500::bigint,
               'the retry pays no tokens — the balance is the seed alone');
select test.eq(public.token_balance('aaaaaaaa-0000-0000-0000-000000000001')::bigint, 500::bigint,
               'token_balance agrees with the ledger it is derived from');


\echo ''
\echo '=== 6. equipping wears one thing, and only what you own ==='
select test.ok(public.equip_item('aaaaaaaa-0000-0000-0000-000000000001', 'skin_001'),
               'a player equips a skin they own');
select test.ok(public.equip_item('aaaaaaaa-0000-0000-0000-000000000001', 'skin_002'),
               'and equips another one');
select test.eq((select count(*)::bigint from public.inventory
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and equipped), 1::bigint,
               'exactly one skin is worn at a time');
select test.ok(public.equip_item('aaaaaaaa-0000-0000-0000-000000000001', 'skin_999') = false,
               'equipping something you do not own is refused, not granted');
-- The take-off the API performs for `itemId: null` is a plain update on the
-- service role; asserted here because a player must be able to get back to the
-- tier portrait.
update public.inventory set equipped = false
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and equipped;
select test.eq((select count(*)::bigint from public.inventory
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and equipped), 0::bigint,
               'taking everything off leaves nothing equipped');


\echo ''
\echo '=== 7. spending tokens cannot go negative ==='
select test.ok(public.spend_tokens('aaaaaaaa-0000-0000-0000-000000000001', 200, 'shop:test'),
               'a player spends tokens they have');
select test.eq(public.token_balance('aaaaaaaa-0000-0000-0000-000000000001')::bigint, 300::bigint,
               'the balance falls by exactly what was spent');
select test.ok(public.spend_tokens('aaaaaaaa-0000-0000-0000-000000000001', 400, 'shop:test') = false,
               'spending more than the balance is refused');
select test.eq(public.token_balance('aaaaaaaa-0000-0000-0000-000000000001')::bigint, 300::bigint,
               'and the refusal writes nothing');


\echo ''
\echo '=== 8. no reward may hand over permanent Pro ==='
-- Brand Law 4 as two constraints. The TypeScript validator says the same
-- thing; this is the half that cannot be forgotten in a later seed file.
select test.throws('23514', $$
  insert into public.rewards (id, kind, rarity, name, payload)
  values ('bad_pro', 'cosmetic', 'legendary', 'Pro forever', '{"pro":true}'::jsonb)
$$, 'a reward carrying `pro` is refused by the database');
select test.throws('23514', $$
  insert into public.rewards (id, kind, rarity, name, payload)
  values ('bad_trial', 'trial', 'rare', 'Pro for a week', '{"duration_h":168}'::jsonb)
$$, 'a trial longer than 24 hours is refused');
select test.throws('23514', $$
  insert into public.rewards (id, kind, rarity, name, payload)
  values ('bad_trial2', 'trial', 'rare', 'Pro for nothing', '{}'::jsonb)
$$, 'a trial with no duration at all is refused');


\echo ''
\echo '=== 9. the tester flag is an operator decision, written by nobody else ==='
-- The operator creates the row first, false, via the real function (an
-- upsert) — so the player's write attempt below has an EXISTING row to fail
-- against. An UPDATE against a row that does not exist yet affects zero rows
-- whether or not a hole exists in the policy set, which would make this
-- section's whole reason to exist pass for the wrong reason.
select public.admin_set_rewards_beta('aaaaaaaa-0000-0000-0000-000000000001', false);
select test.eq((select count(*)::bigint from public.entitlements
                 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   and rewards_beta), 0::bigint,
               'no account is a tester by default');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.entitlements set rewards_beta = true
 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
reset request.jwt.claim.sub;
select test.eq((select count(*)::bigint from public.entitlements
                 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   and rewards_beta), 0::bigint,
               'and a player cannot flag themselves');

select public.admin_set_rewards_beta('aaaaaaaa-0000-0000-0000-000000000001', true);
select test.eq((select count(*)::bigint from public.entitlements
                 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   and rewards_beta), 1::bigint,
               'the console can flag one account as a tester');
select public.admin_set_rewards_beta('aaaaaaaa-0000-0000-0000-000000000001', false);
select test.eq((select count(*)::bigint from public.entitlements
                 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   and rewards_beta), 0::bigint,
               'and can take it back in one tap');


\echo ''
\echo '=== 10. deleting the account takes the whole collection with it ==='
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.eq((select count(*)::bigint from public.briefcases
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
               'the cases cascade away with the account');
select test.eq((select count(*)::bigint from public.inventory
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
               'so does the wardrobe');
select test.eq((select count(*)::bigint from public.token_ledger
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
               'so does the ledger');
select test.eq((select count(*)::bigint from public.grants
                 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
               'so does every grant it was ever paid');

\echo '=== rewards_test: all checks passed ==='
