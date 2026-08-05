\set ON_ERROR_STOP 1
\pset pager off

-- Admin (0009). The properties tested are the ones whose failure mode is
-- "a player made themselves admin", "a player granted themselves a gift", or
-- "the console's directory of children is readable from a browser" — each
-- asserted, none assumed.

insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-000000000001', 'ada@novus.dev'),      -- the admin
  ('90000000-0000-0000-0000-000000000002', 'pat@example.com'),    -- a player
  ('90000000-0000-0000-0000-000000000003', 'sam@example.com'),    -- the giftee
  ('90000000-0000-0000-0000-000000000004', 'tia@school.org'),     -- comp chapter owner
  ('90000000-0000-0000-0000-000000000005', 'eve@example.com');    -- signs up mid-suite

set role postgres;
insert into public.profiles (id, display_name) values
  ('90000000-0000-0000-0000-000000000001', 'Ada'),
  ('90000000-0000-0000-0000-000000000002', 'Pat'),
  ('90000000-0000-0000-0000-000000000003', 'Sam'),
  ('90000000-0000-0000-0000-000000000004', 'Tia');

-- The bootstrap this whole feature is built around: the dashboard (postgres)
-- flips the cell, and nothing else can.
update public.profiles set role = 'admin'
 where id = '90000000-0000-0000-0000-000000000001';


\echo ''
\echo '=== 1. a player cannot promote themselves ==='
set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000002';

-- The UPDATE policy on profiles allows this row; the guard trigger is what
-- must refuse the column.
select test.throws('42501', $$
  update public.profiles set role = 'admin'
   where id = '90000000-0000-0000-0000-000000000002'
$$, 'a player cannot set their own role');
select test.throws('42501', $$
  update public.profiles set admin_view = 'all'
   where id = '90000000-0000-0000-0000-000000000002'
$$, 'a player cannot set their own admin_view');

-- Sign-up must still work (default role) — and must not work as a way in.
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000005';
select test.throws('42501', $$
  insert into public.profiles (id, display_name, role)
  values ('90000000-0000-0000-0000-000000000005', 'Eve', 'admin')
$$, 'a fresh sign-up cannot arrive as admin');
insert into public.profiles (id, display_name)
values ('90000000-0000-0000-0000-000000000005', 'Eve');
select test.pass('a normal sign-up still inserts its profile');

-- …and ordinary self-service updates are untouched by the guard.
update public.profiles set display_name = 'Evie'
 where id = '90000000-0000-0000-0000-000000000005';
select test.pass('a player can still rename themselves');

-- RLS scopes every player to their own row, so the proof that the dashboard
-- edit landed has to read as the dashboard.
set role postgres;
select test.eq((select role from public.profiles
                where id = '90000000-0000-0000-0000-000000000001'), 'admin',
               'the dashboard flip landed');


\echo ''
\echo '=== 2. the admin surface is unreachable from the game ==='
set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000002';

-- Each would be POST /rest/v1/rpc/<name> if a revoke went missing — and
-- admin_set_comp_pro is Pro for free.
select test.throws('42501', $$
  select public.admin_set_comp_pro('90000000-0000-0000-0000-000000000002', true)
$$, 'a player cannot gift themselves Pro');
select test.throws('42501', $$
  select public.admin_set_extra_islands('90000000-0000-0000-0000-000000000002', 20)
$$, 'a player cannot set their own islands');
select test.throws('42501', $$
  select public.admin_set_extra_year_closes('90000000-0000-0000-0000-000000000002', 20)
$$, 'a player cannot grant themselves the pace to close more years');
select test.throws('42501', $$
  select public.admin_revoke_industry_pack('90000000-0000-0000-0000-000000000003', 'TECH')
$$, 'a player cannot strip another player''s pack');
select test.throws('42501', $$
  select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000002', 'chapter_35')
$$, 'a player cannot mint a chapter');
select test.throws('42501', $$
  select * from public.admin_list_users('a')
$$, 'a player cannot read the account directory');
select test.throws('42501', $$
  select public.admin_stats()
$$, 'a player cannot read the stats');
select test.throws('42501', $$
  select public.player_allowance('90000000-0000-0000-0000-000000000002')
$$, 'a player cannot probe another player''s allowance');

-- The comp columns are worth money; the write paths must be as closed as
-- `pro` itself (0001: SELECT and nothing else).
select test.throws('42501', $$
  insert into public.entitlements (profile_id, comp_pro)
  values ('90000000-0000-0000-0000-000000000002', true)
$$, 'a player cannot insert a comp for themselves');
select test.throws('42501', $$
  insert into public.entitlements (profile_id, extra_year_closes)
  values ('90000000-0000-0000-0000-000000000002', 20)
$$, 'a player cannot write their own year-close allowance');

-- ...and the audit log is nobody's to read.
select test.throws('42501', $$
  select * from public.admin_audit
$$, 'a player cannot read the audit log');
select test.throws('42501', $$
  insert into public.admin_audit (action) values ('forged')
$$, 'a player cannot write the audit log');


\echo ''
\echo '=== 3. a gift is Pro, until it is not ==='
set role service_role;
set request.jwt.claim.sub = '';

select public.admin_set_comp_pro('90000000-0000-0000-0000-000000000003', true, null, 'prize — test jam');

set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000003';
select test.eq((select public.runs_remaining_today()), 3::bigint,
               'a comped player has Pro''s three runs');

-- The gift lives beside the paid flag, never inside it — the webhook's next
-- apply_subscription must have nothing to overwrite.
select test.ok((select pro is false from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'),
               'the gift does not touch the paid pro flag');

-- An expired gift is a free player again, with no sweeper involved.
set role service_role;
set request.jwt.claim.sub = '';
select public.admin_set_comp_pro('90000000-0000-0000-0000-000000000003', true,
                                 now() - interval '1 hour', 'expired');
set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000003';
select test.eq((select public.runs_remaining_today()), 1::bigint,
               'an expired gift no longer grants anything');

-- Revoked is revoked.
set role service_role;
set request.jwt.claim.sub = '';
select public.admin_set_comp_pro('90000000-0000-0000-0000-000000000003', false);
set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000003';
select test.eq((select public.runs_remaining_today()), 1::bigint,
               'a revoked gift no longer grants anything');

-- Gifted pace (0012). The allowance is a number on the row that the client
-- reads at the year gate, so the properties that matter are: it lands, it
-- cannot leave the column's 0–20 bound however it is called, the giftee can
-- READ their own (the gate is client-side), and zero takes it back.
set role service_role;
set request.jwt.claim.sub = '';
select public.admin_set_extra_year_closes('90000000-0000-0000-0000-000000000003', 6);
select test.eq((select extra_year_closes from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'), 6,
               'an operator grants extra year closes');

select public.admin_set_extra_year_closes('90000000-0000-0000-0000-000000000003', 999);
select test.eq((select extra_year_closes from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'), 20,
               'a fat-fingered grant clamps to the column''s bound, it does not throw');

-- A profile with no entitlements row yet: the function inserts one, the same
-- way admin_set_extra_run_slots does.
select public.admin_set_extra_year_closes('90000000-0000-0000-0000-000000000005', 4);
select test.eq((select extra_year_closes from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000005'), 4,
               'granting to an account with no entitlements row creates one');

set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000003';
select test.eq((select extra_year_closes from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'), 20,
               'the giftee reads their own allowance, which is how the gate sees it');

set role service_role;
set request.jwt.claim.sub = '';
select public.admin_set_extra_year_closes('90000000-0000-0000-0000-000000000003', 0);
select test.eq((select extra_year_closes from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'), 0,
               'zero takes the pace back');


\echo ''
\echo '=== 4. the admin plays at whatever tier the view switch says ==='
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000001';
select test.eq((select public.runs_remaining_today()), 999::bigint,
               'an admin with no view set is fully unlocked');

set role service_role;
set request.jwt.claim.sub = '';
update public.profiles set admin_view = 'free'
 where id = '90000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000001';
select test.eq((select public.runs_remaining_today()), 1::bigint,
               'viewing as free plays at free''s one run');

set role service_role;
set request.jwt.claim.sub = '';
update public.profiles set admin_view = 'pro'
 where id = '90000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000001';
select test.eq((select public.runs_remaining_today()), 3::bigint,
               'viewing as pro plays at pro''s three runs');

-- claim_run_slot spends against the same formula.
select test.ok((select public.claim_run_slot()), 'run 1 of 3 starts');
select test.ok((select public.claim_run_slot()), 'run 2 of 3 starts');
select test.ok((select public.claim_run_slot()), 'run 3 of 3 starts');
select test.ok((select not public.claim_run_slot()), 'run 4 is refused at pro''s cap');


\echo ''
\echo '=== 5. a comped chapter is a chapter, minus the card ==='
set role service_role;
set request.jwt.claim.sub = '';

select test.throws('23514', $$
  select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000004', 'chapter_9000')
$$, 'an unknown licence is refused');

-- The custom size (0011): the buyer's number is the row's seat count —
-- required for chapter_custom, refused beside a licence that IS its size.
select test.throws('23514', $$
  select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000001', 'chapter_custom')
$$, 'a custom chapter without its seat count is refused');
select test.throws('23514', $$
  select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000001', 'chapter_35', null, 80)
$$, 'p_seats beside a fixed licence is refused');
select test.ok(
  (select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000001', 'chapter_custom', null, 60)
     is not null),
  'the service role can mint a custom-sized comp chapter');
select test.eq((select c.seats from public.chapters c
                where c.owner_profile_id = '90000000-0000-0000-0000-000000000001'), 60,
               '…and the row carries the typed seat count');

-- …and the licence value survives the whole grant path: entitlements'
-- own check constraint admits it, exactly as chapters' does.
select public.grant_chapter_seat('90000000-0000-0000-0000-000000000005', 'chapter_custom');
select test.eq((select chapter from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000005'), 'chapter_custom',
               'entitlements.chapter accepts the custom licence');
select public.revoke_chapter_seat('90000000-0000-0000-0000-000000000005');

select test.ok(
  (select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000004', 'chapter_35')
     is not null),
  'the service role can mint a comp chapter');

select test.ok((select c.stripe_subscription_id is null
                  and c.source = 'comp'
                  and c.status = 'active'
                  and c.seats = 35
                 from public.chapters c
                where c.owner_profile_id = '90000000-0000-0000-0000-000000000004'),
               'the comp row has no subscription and the licence''s seats');

select test.throws('23505', $$
  select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000004', 'chapter_100')
$$, 'one active chapter per owner');

-- A seat in it grants exactly what a paid seat grants.
insert into public.chapter_seats (chapter_id, profile_id, email, origin)
select c.id, '90000000-0000-0000-0000-000000000003', 'sam@example.com', 'invited'
  from public.chapters c
 where c.owner_profile_id = '90000000-0000-0000-0000-000000000004';
select public.grant_chapter_seat('90000000-0000-0000-0000-000000000003', 'chapter_35');

select test.eq((select chapter from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'), 'chapter_35',
               'a comp seat sets entitlements.chapter');

-- Revoking keeps the roster and turns the seats off — the webhook's own lapse
-- shape, without a webhook.
select test.ok((select public.admin_revoke_comp_chapter(c.id)
                 from public.chapters c
                where c.owner_profile_id = '90000000-0000-0000-0000-000000000004'),
               'the service role can revoke a comp chapter');
select test.eq((select status from public.chapters
                where owner_profile_id = '90000000-0000-0000-0000-000000000004'), 'lapsed',
               'the revoked chapter reads lapsed');
select test.ok((select chapter is null from public.entitlements
                where profile_id = '90000000-0000-0000-0000-000000000003'),
               'the seats went dark with it');
select test.eq((select count(*) from public.chapter_seats s
                 join public.chapters c on c.id = s.chapter_id
                where c.owner_profile_id = '90000000-0000-0000-0000-000000000004'), 1::bigint,
               'the roster is kept');

-- Revoke is comp-only: a paid chapter must lapse through Stripe.
insert into public.chapters (id, owner_profile_id, licence, seats, stripe_subscription_id, status)
values ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '90000000-0000-0000-0000-000000000002', 'chapter_35', 35, 'sub_admin_test', 'active');
select test.ok((select not public.admin_revoke_comp_chapter('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
               'a paid chapter cannot be revoked by hand');
select test.eq((select status from public.chapters
                where id = '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'active',
               '…and it is untouched');

-- An expiry date lapses on the next sweep, not never.
select public.admin_create_comp_chapter('90000000-0000-0000-0000-000000000005', 'chapter_35',
                                        now() - interval '1 day');
select test.eq((select public.admin_lapse_expired_comp_chapters()), 1,
               'the sweep lapses exactly the overdue comp chapter');
select test.eq((select status from public.chapters
                where owner_profile_id = '90000000-0000-0000-0000-000000000005'), 'lapsed',
               '…and it reads lapsed');


\echo ''
\echo '=== 6. the console reads answer to the service role alone ==='
select test.eq((select count(*) from public.admin_list_users('pat')), 1::bigint,
               'the directory finds a player by email fragment');
select test.eq((select email from public.admin_list_users('90000000-0000-0000-0000-000000000001')),
               'ada@novus.dev',
               'the directory finds a player by exact id');
select test.eq((select (public.admin_stats()->>'admins')::bigint), 1::bigint,
               'the stats count one admin');

insert into public.admin_audit (actor, actor_email, action, target, detail)
values ('90000000-0000-0000-0000-000000000001', 'ada@novus.dev', 'comp_pro_grant',
        '90000000-0000-0000-0000-000000000003', '{"until": null}'::jsonb);
select test.eq((select count(*) from public.admin_audit), 1::bigint,
               'the service role writes the audit log');


\echo ''
\echo '=== 7. the stale sweep spares a comped anonymous account ==='
set role postgres;
insert into auth.users (id, is_anonymous, created_at, last_sign_in_at)
values ('90000000-0000-0000-0000-00000000000a', true,
        now() - interval '200 days', now() - interval '200 days');
insert into public.profiles (id, display_name)
values ('90000000-0000-0000-0000-00000000000a', 'Ghost');

set role service_role;
set request.jwt.claim.sub = '';
select public.admin_set_comp_pro('90000000-0000-0000-0000-00000000000a', true);
select test.eq((select public.delete_stale_anonymous_users()), 0,
               'an anonymous account holding a gift is not swept');

select public.admin_set_comp_pro('90000000-0000-0000-0000-00000000000a', false);
select test.eq((select public.delete_stale_anonymous_users()), 1,
               'the same account with the gift revoked is swept');


\echo ''
\echo '=== 8. demotion is one cell edit, and total ==='
set role postgres;
update public.profiles set role = 'player', admin_view = null
 where id = '90000000-0000-0000-0000-000000000001';

-- player_allowance rather than runs_remaining_today: the ledger still holds
-- the three runs Ada spent above, which is its own kind of proof — nothing an
-- admin does is written anywhere a demotion has to chase down.
select test.eq((select public.player_allowance('90000000-0000-0000-0000-000000000001')), 1::bigint,
               'a demoted admin is a free player — nothing was written to revert');


\echo ''
\echo '=== 9. the analytics (0010) answer to the service role alone ==='
set role authenticated;
set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000002';

select test.throws('42501', $$
  select * from public.admin_timeseries(7)
$$, 'a player cannot read the time series');
select test.throws('42501', $$
  select * from public.admin_cohorts(4)
$$, 'a player cannot read the cohorts');
select test.throws('42501', $$
  select public.admin_capture_daily()
$$, 'a player cannot write the daily snapshot');
select test.throws('42501', $$
  select * from public.admin_last_seen()
$$, 'a player cannot read last-seen times');
select test.throws('42501', $$
  select * from public.admin_daily
$$, 'a player cannot read the daily table');


\echo ''
\echo '=== 10. the snapshot and the series ==='
set role service_role;
set request.jwt.claim.sub = '';

select public.admin_capture_daily();
select test.eq((select count(*) from public.admin_daily where day = current_date), 1::bigint,
               'the capture writes today''s row');
select test.eq((select count(*) from public.admin_timeseries(7)), 7::bigint,
               'the series returns one row per day asked for');
select test.ok((select t.actives is not null from public.admin_timeseries(7) t
                where t.day = current_date),
               'today''s actives are tracked once captured');
select test.ok((select t.runs_started is not null from public.admin_timeseries(7) t
                where t.day = current_date),
               'today''s run starts are tracked once captured');

select public.admin_capture_daily();
select test.eq((select count(*) from public.admin_daily), 1::bigint,
               'a second capture refreshes the row, never duplicates it');

select test.ok((select public.admin_stats() ? 'activity'),
               'the stats carry the recency histogram');


\echo ''
\echo '=== 11. cohorts: bounce and retention, from last-seen ==='
-- Two accounts in the same three-weeks-ago cohort: one never came back after
-- its first day, one was seen eleven days later. The whole point of the
-- last-seen basis is that these classify correctly with no event log.
set role postgres;
insert into auth.users (id, email, created_at, last_sign_in_at) values
  ('90000000-0000-0000-0000-00000000000b', 'bounce@example.com',
   now() - interval '21 days', now() - interval '21 days'),
  ('90000000-0000-0000-0000-00000000000c', 'return@example.com',
   now() - interval '21 days', now() - interval '10 days');

set role service_role;
set request.jwt.claim.sub = '';
select test.eq((select c.cohort from public.admin_cohorts(12) c
                where c.week = date_trunc('week', now() - interval '21 days')::date), 2::bigint,
               'the cohort counts both accounts');
select test.eq((select c.bounced from public.admin_cohorts(12) c
                where c.week = date_trunc('week', now() - interval '21 days')::date), 1::bigint,
               'one bounced — never seen after day one');
select test.eq((select c.retained_7 from public.admin_cohorts(12) c
                where c.week = date_trunc('week', now() - interval '21 days')::date), 1::bigint,
               'one retained at seven days');
select test.eq((select c.retained_30 from public.admin_cohorts(12) c
                where c.week = date_trunc('week', now() - interval '21 days')::date), 0::bigint,
               'nobody has answered the thirty-day question yet');

\echo '=== admin_test: all checks passed ==='
