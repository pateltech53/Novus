\set ON_ERROR_STOP 1
\pset pager off

-- Chapters (0007) and board rank (0008). The properties tested are the ones
-- whose failure mode is "a seat is free", "a stranger reads a roster", or
-- "the cap leaks" — each asserted, none assumed.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@school.org'),
  ('22222222-2222-2222-2222-222222222222', 'student-a@school.org'),
  ('33333333-3333-3333-3333-333333333333', 'student-b@school.org'),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com');

set role postgres;
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Teacher'),
  ('22222222-2222-2222-2222-222222222222', 'Sam'),
  ('33333333-3333-3333-3333-333333333333', 'Riley'),
  ('44444444-4444-4444-4444-444444444444', 'Mallory');


\echo ''
\echo '=== 1. a player CANNOT call the seat functions ==='
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

-- Reachable over PostgREST as POST /rest/v1/rpc/<name> if the revoke in 0007
-- ever went missing — and grant_chapter_seat is Pro for free.
select test.throws('42501', $$
  select public.grant_chapter_seat('44444444-4444-4444-4444-444444444444', 'chapter_35')
$$, 'a player cannot grant themselves a seat');
select test.throws('42501', $$
  select public.revoke_chapter_seat('22222222-2222-2222-2222-222222222222')
$$, 'a player cannot revoke another player''s seat');
select test.throws('42501', $$
  select public.set_chapter_access('00000000-0000-0000-0000-000000000000', true)
$$, 'a player cannot flip a whole chapter');
-- ...and the auth.users lookup would be an account-existence oracle.
select test.throws('42501', $$
  select public.auth_user_id_for_email('student-a@school.org')
$$, 'a player cannot look up accounts by email');


\echo ''
\echo '=== 2. the service role builds a chapter (this is the webhook) ==='
set role service_role;
set request.jwt.claim.sub = '';

-- seats=2 rather than 35: the cap trigger reads chapters.seats, so a small
-- number makes "the cap holds" testable in two inserts instead of thirty-six.
insert into public.chapters (id, owner_profile_id, licence, seats, stripe_subscription_id, status)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'chapter_35', 2, 'sub_test_1', 'active');

insert into public.chapter_seats (chapter_id, profile_id, email, origin)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222',
        'student-a@school.org', 'invited');
select public.grant_chapter_seat('22222222-2222-2222-2222-222222222222', 'chapter_35');

select test.eq((select chapter from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), 'chapter_35',
               'a seat sets entitlements.chapter');


\echo ''
\echo '=== 3. one seat per player, anywhere ==='
select test.throws('23505', $$
  insert into public.chapter_seats (chapter_id, profile_id, email, origin)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222',
          'student-a-again@school.org', 'invited')
$$, 'the same player cannot hold two seats');


\echo ''
\echo '=== 4. one email per roster ==='
select test.throws('23505', $$
  insert into public.chapter_seats (chapter_id, profile_id, email, origin)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
          'student-a@school.org', 'invited')
$$, 'the same address cannot take two seats on one roster');


\echo ''
\echo '=== 5. the cap holds — seat 3 of 2 is refused ==='
insert into public.chapter_seats (chapter_id, profile_id, email, origin)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
        'student-b@school.org', 'registered');
select public.grant_chapter_seat('33333333-3333-3333-3333-333333333333', 'chapter_35');

select test.throws('23514', $$
  insert into public.chapter_seats (chapter_id, profile_id, email, origin)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444',
          'stranger@example.com', 'invited')
$$, 'a full chapter refuses the next seat');


\echo ''
\echo '=== 6. a lapse turns every seat off and keeps the roster ==='
select public.set_chapter_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select test.eq((select count(*) from public.entitlements
                where chapter is not null), 0::bigint,
               'no member keeps chapter access through a lapse');
select test.eq((select count(*) from public.chapter_seats
                where chapter_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 2::bigint,
               'the roster itself survives');

-- ...and renewal lights the same seats back up, repairing any missing rows.
select public.set_chapter_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select test.eq((select count(*) from public.entitlements
                where chapter = 'chapter_35'), 2::bigint,
               'renewal restores every member');


\echo ''
\echo '=== 7. revoking one seat clears chapter and ONLY chapter ==='
select public.grant_extra_run_slot('22222222-2222-2222-2222-222222222222');
select public.revoke_chapter_seat('22222222-2222-2222-2222-222222222222');
select test.eq((select chapter from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), null::text,
               'the seat''s access is gone');
select test.eq((select extra_run_slots from public.entitlements
                where profile_id = '22222222-2222-2222-2222-222222222222'), 1,
               'a bought run slot survives losing the seat');


\echo ''
\echo '=== 8. the owner reads their roster; a stranger reads nothing ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test.eq((select count(*) from public.chapters), 1::bigint,
               'the owner sees their chapter');
select test.eq((select count(*) from public.chapter_seats), 2::bigint,
               'the owner sees their roster');

set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select test.eq((select count(*) from public.chapters), 0::bigint,
               'a stranger sees no chapter');
select test.eq((select count(*) from public.chapter_seats), 0::bigint,
               'a stranger sees no roster — and no emails');
-- A member is not the owner: the roster (and its addresses) is not theirs.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select test.eq((select count(*) from public.chapter_seats), 0::bigint,
               'a member cannot read the other members'' emails');

-- Writes are nobody's but the service role's — asserted against a chapter
-- WITH ROOM, or the cap trigger refuses first and the RLS refusal this is
-- actually about never gets its turn.
set role service_role;
set request.jwt.claim.sub = '';
insert into public.chapters (id, owner_profile_id, licence, seats, stripe_subscription_id, status)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '11111111-1111-1111-1111-111111111111', 'chapter_35', 5, 'sub_test_2', 'active');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select test.throws('42501', $$
  insert into public.chapter_seats (chapter_id, profile_id, email, origin)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444',
          'mallory@example.com', 'invited')
$$, 'even the owner cannot write seats directly');


\echo ''
\echo '=== 9. deleting a player frees their seat (cascade) ==='
set role postgres;
delete from public.profiles where id = '33333333-3333-3333-3333-333333333333';
select test.eq((select count(*) from public.chapter_seats
                where profile_id = '33333333-3333-3333-3333-333333333333'), 0::bigint,
               'the seat row is gone with the account');

\echo '=== chapters_test: all checks passed ==='
