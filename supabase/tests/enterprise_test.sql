\set ON_ERROR_STOP 1
\pset pager off

-- Exercise ownership, privacy, deletion and delayed webhook behavior against
-- the real schema. No Stripe or mail service is involved in these transactions.
insert into auth.users (id,email) values
 ('10000000-0000-0000-0000-000000000001','owner@example.com'),
 ('10000000-0000-0000-0000-000000000002','member@example.com'),
 ('10000000-0000-0000-0000-000000000003','other@example.com');
insert into public.profiles (id,display_name) values
 ('10000000-0000-0000-0000-000000000001','Owner'),
 ('10000000-0000-0000-0000-000000000002','Member'),
 ('10000000-0000-0000-0000-000000000003','Other');

set role service_role;
select test.ok(public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000001','sub_enterprise','chapter_35',35,true,null,
 'North School','school','Pat','pat@example.com') is not null,
 'checkout atomically creates the licence and its profile');
select test.eq((select name from public.chapters where stripe_subscription_id='sub_enterprise'),
 'North School','enterprise name is persisted');
update public.chapters set name='Renamed School' where stripe_subscription_id='sub_enterprise';
select public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000001','sub_enterprise','chapter_100',100,true,null,
 'Old checkout name','school','Old contact','old@example.com');
select test.eq((select name from public.chapters where stripe_subscription_id='sub_enterprise'),
 'Renamed School','renewal preserves edits');
select test.eq((select seats from public.chapters where stripe_subscription_id='sub_enterprise'),
 100,'renewal still updates the licence');

insert into public.chapter_seats(chapter_id,profile_id,email,origin,invite_token,created_by_invite)
 select id,'10000000-0000-0000-0000-000000000002','member@example.com','invited',gen_random_uuid(),true
 from public.chapters where stripe_subscription_id='sub_enterprise';
-- Upgrade existing pending invites and prove repeated deployment preserves completion.
reset role;
\ir ../migrations/20260917054417_chapter_account_setup.sql
select test.ok((select completed_at is null from public.chapter_account_setup
 where profile_id='10000000-0000-0000-0000-000000000002'), 'legacy pending invitation is backfilled');
set role authenticated;
select test.throws('42501',$$select * from public.chapter_account_setup$$,
 'members cannot read setup records');
select test.throws('42501',$$update public.chapter_account_setup set completed_at=now()$$,
 'members cannot forge setup completion');
set role anon;
select test.throws('42501',$$select * from public.chapter_account_setup$$,
 'anonymous readers cannot inspect setup records');
set role service_role;
select public.grant_chapter_seat('10000000-0000-0000-0000-000000000002','chapter_100');
update public.entitlements set pro=true,extra_islands=2 where profile_id='10000000-0000-0000-0000-000000000002';
insert into public.saves(profile_id,slot,run_id,seed,state,company_name,industry,year,month,stage)
 values ('10000000-0000-0000-0000-000000000002',0,'run-kept',42,'{}','Keep My Company','TECH',1,1,1);

set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select test.eq((select name from public.my_chapter_summary()),'Renamed School',
 'member can read its own enterprise name');
select test.eq((select count(*) from public.chapters),0::bigint,
 'member cannot read private contact details');
select test.throws('42501',$$select public.delete_chapter(gen_random_uuid())$$,
 'member cannot call privileged deletion');
select test.throws('42501',$$select public.remove_chapter_seat(gen_random_uuid(),
 '10000000-0000-0000-0000-000000000002')$$,
 'a player cannot remove a seat through the privileged RPC');
select test.throws('42501',$$select public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000001','hax','chapter_35',35,true,null)$$,
 'a player cannot create a paid licence');
select test.throws('42501',$$select public.admin_create_comp_chapter_with_profile(
 '10000000-0000-0000-0000-000000000001','chapter_35',null,null,'A','school','B','b@example.com')$$,
 'a player cannot grant a comped enterprise');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
select test.eq((select count(*) from public.my_chapter_summary()),0::bigint,
 'stranger sees no enterprise name');

set role service_role;
set request.jwt.claim.sub='';
select public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000003','sub_other','chapter_35',35,true,null,
 'Other Enterprise','company','Jo','jo@example.com');

-- Individual removal is atomic too: renewal cannot regrant a seat between a
-- revocation request and a separate roster deletion. A stale request for a
-- different enterprise must not revoke the member's real enterprise access.
select test.ok(not (select public.remove_chapter_seat(id,
 '10000000-0000-0000-0000-000000000002') from public.chapters where stripe_subscription_id='sub_other'),
 'removal scoped to another enterprise finds no matching seat');
select test.eq((select chapter from public.entitlements
 where profile_id='10000000-0000-0000-0000-000000000002'),'chapter_100',
 'wrong-enterprise removal preserves the real membership grant');
select test.ok((select public.remove_chapter_seat(id,
 '10000000-0000-0000-0000-000000000002') from public.chapters where stripe_subscription_id='sub_enterprise'),
 'member removal deletes its matching seat');
select test.eq((select count(*) from public.chapter_seats
 where profile_id='10000000-0000-0000-0000-000000000002'),0::bigint,
 'member removal clears the roster row and invitation credential');
select test.ok((select chapter is null and pro and extra_islands=2 from public.entitlements
 where profile_id='10000000-0000-0000-0000-000000000002'),
 'member removal revokes only enterprise access and preserves personal purchases');
select test.ok(not (select public.remove_chapter_seat(id,
 '10000000-0000-0000-0000-000000000002') from public.chapters where stripe_subscription_id='sub_enterprise'),
 'repeated member removal is a no-op');
select public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000001','sub_enterprise','chapter_100',100,true,null);
select test.ok((select chapter is null from public.entitlements
 where profile_id='10000000-0000-0000-0000-000000000002'),
 'subscription renewal cannot restore a removed member');
select test.throws('23514',$$select public.grant_chapter_seat(
 '10000000-0000-0000-0000-000000000002','chapter_100')$$,
 'a stale grant cannot restore a removed member without a seat');

set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select test.eq((select count(*) from public.my_chapter_summary()),0::bigint,
 'removed member no longer sees an enterprise affiliation');
set role service_role;
set request.jwt.claim.sub='';
insert into public.chapter_seats(chapter_id,profile_id,email,origin,invite_token,created_by_invite)
 select id,'10000000-0000-0000-0000-000000000002','member@example.com','invited',gen_random_uuid(),true
 from public.chapters where stripe_subscription_id='sub_enterprise';
select public.grant_chapter_seat('10000000-0000-0000-0000-000000000002','chapter_100');
select test.eq((select chapter from public.entitlements
 where profile_id='10000000-0000-0000-0000-000000000002'),'chapter_100',
 'a legitimate new invitation can restore enterprise access after removal');

select test.ok((select public.delete_chapter(id) from public.chapters where stripe_subscription_id='sub_enterprise'),
 'owner deletion closes the enterprise');
select test.ok((select deleted_at is not null and status='lapsed' and name is null and contact_email is null
 from public.chapters where stripe_subscription_id='sub_enterprise'),
 'deleted enterprise retains only a tombstone and clears profile information');
select test.eq((select count(*) from public.chapter_seats),0::bigint,
 'deletion removes roster and all invitation credentials');
select test.ok((select chapter is null and pro and extra_islands=2 from public.entitlements
 where profile_id='10000000-0000-0000-0000-000000000002'),
 'deletion removes the chapter grant but preserves personal purchases');
select test.eq((select count(*) from public.profiles),3::bigint,'all personal accounts survive');
select test.eq((select company_name from public.saves where run_id='run-kept'),'Keep My Company',
 'game progress survives');
select test.eq((select status from public.chapters where stripe_subscription_id='sub_other'),'active',
 'another enterprise is unchanged');
select test.ok((select public.delete_chapter(id) from public.chapters where stripe_subscription_id='sub_enterprise'),
 'deletion is safely retryable');
select test.ok(public.sync_chapter_subscription(
 '10000000-0000-0000-0000-000000000001','sub_enterprise','chapter_100',100,true,null) is null,
 'a delayed renewal cannot recreate a deleted enterprise');
select test.eq((select status from public.chapters where stripe_subscription_id='sub_enterprise'),'lapsed',
 'a delayed renewal cannot reactivate the tombstone');
select test.throws('23514',$$insert into public.chapter_seats(chapter_id,profile_id,email,origin)
 select id,'10000000-0000-0000-0000-000000000002','member@example.com','invited'
 from public.chapters where stripe_subscription_id='sub_enterprise'$$,
 'a racing invite cannot insert a seat after deletion');
select test.throws('23514',$$select public.grant_chapter_seat(
 '10000000-0000-0000-0000-000000000002','chapter_100')$$,
 'a racing grant cannot restore access after deletion');

set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select test.eq((select count(*) from public.my_chapter_summary()),0::bigint,
 'deleted membership disappears from the player interface');
select test.eq((select count(*) from public.chapter_board('survival','2026-Q3')),0::bigint,
 'deleted membership grants no enterprise board access');

set role service_role;
set request.jwt.claim.sub='';
select test.ok(public.admin_create_comp_chapter_with_profile(
 '10000000-0000-0000-0000-000000000001','chapter_35',null,null,
 'New Club','club','Alex','alex@example.com') is not null,
 'the owner can create a new enterprise after deletion');
select test.eq((select name from public.chapters where source='comp'),'New Club',
 'operator creation also records basic information atomically');

-- Publishing a formerly queued run cannot change a score or clear a takedown.
insert into public.runs(profile_id,seed,tape,tape_hash,engine_version,events_hash,company_name,industry,
 claimed_peak_valuation,claimed_years_survived,verified_peak_valuation,verified_years_survived,status,verified_at)
 values ('10000000-0000-0000-0000-000000000002',42,'{}','enterprise-run','1','ev','Keep My Company',
 'TECH',100,1,100,1,'verified',now());
select public.record_board_entry('survival','2026-Q3',(select id from public.runs where tape_hash='enterprise-run'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Keep My Company','TECH',100,1,null,false);
select test.ok(public.record_board_entry('survival','2026-Q3',(select id from public.runs where tape_hash='enterprise-run'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Keep My Company','TECH',100,1,null,true),
 'the same clean verified run can leave the retired manual queue');
select public.report_board_entry((select id from public.leaderboard_entries where board='survival'));
select test.ok(not public.record_board_entry('survival','2026-Q3',(select id from public.runs where tape_hash='enterprise-run'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Keep My Company','TECH',100,1,null,true),
 'an identical retry cannot relist a reported entry');
select public.record_board_entry('survival','2026-Q3',(select id from public.runs where tape_hash='enterprise-run'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Keep My Company','TECH',200,2,null,true);
select test.ok((select not listed and reports=1 and unlisted_at is not null from public.leaderboard_entries),
 'a better score under the same name cannot bypass a takedown');

-- Renaming a company changes the tape hash, but must not require beating an
-- already-finished run's score to escape a retired pre-publication queue.
insert into public.runs(profile_id,seed,tape,tape_hash,engine_version,events_hash,company_name,industry,
 claimed_peak_valuation,claimed_years_survived,verified_peak_valuation,verified_years_survived,status,verified_at)
 values ('10000000-0000-0000-0000-000000000002',42,'{}','enterprise-old-name','1','ev','Sarah Mitchell',
 'TECH',100,1,100,1,'verified',now());
select public.record_board_entry('survival','2026-Q4',(select id from public.runs where tape_hash='enterprise-old-name'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Sarah Mitchell','TECH',100,1,null,false);
update public.leaderboard_entries set achieved_on='2026-01-01' where season='2026-Q4';
select test.ok(public.record_board_entry('survival','2026-Q4',(select id from public.runs where tape_hash='enterprise-run'),
 '10000000-0000-0000-0000-000000000002','Patient Heron 2201','Keep My Company','TECH',100,1,null,true),
 'a safe rename can publish an equal old queued score with a new run id');
select test.ok((select listed and company_name='Keep My Company' and achieved_on='2026-01-01'
 from public.leaderboard_entries where season='2026-Q4'),
 'renaming a queued score preserves its achievement date');

set role service_role;
select test.ok((select completed_at is null from public.chapter_account_setup
 where profile_id='10000000-0000-0000-0000-000000000002'), 'pending setup survives seat and enterprise removal');
update public.chapter_account_setup set completed_at='2026-09-17T00:00:00Z'
 where profile_id='10000000-0000-0000-0000-000000000002';
reset role;
\ir ../migrations/20260917054417_chapter_account_setup.sql
select test.ok((select completed_at from public.chapter_account_setup
 where profile_id='10000000-0000-0000-0000-000000000002') =
 '2026-09-17T00:00:00Z'::timestamptz, 'reapplying the migration preserves completed setup');
delete from auth.users where id='10000000-0000-0000-0000-000000000002';
select test.eq((select count(*) from public.chapter_account_setup),0::bigint,
 'account deletion cascades setup state');

\echo '=== enterprise_test: all checks passed ==='
