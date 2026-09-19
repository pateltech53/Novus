\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','owner@example.test',now()),
 ('22222222-2222-4222-8222-222222222222','teacher@example.test',now()),
 ('33333333-3333-4333-8333-333333333333','student1@example.test',now()),
 ('44444444-4444-4444-8444-444444444444','student2@example.test',now()),
 ('55555555-5555-4555-8555-555555555555','outsider@example.test',now());
insert into public.profiles(id,display_name) select id,split_part(email,'@',1) from auth.users where email like '%@example.test' on conflict do nothing;
insert into public.chapters(id,owner_profile_id,licence,seats,status,source) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','chapter_35',35,'active','comp'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','55555555-5555-4555-8555-555555555555','chapter_35',35,'active','comp');
insert into public.chapter_seats(chapter_id,profile_id,email,origin) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','student1@example.test','registered'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','student2@example.test','registered');
insert into public.chapter_admins(id,chapter_id,email,invited_by) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','teacher@example.test','11111111-1111-4111-8111-111111111111');
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select test.eq((select count(*)::integer from public.chapters),1,'outsider sees only own enterprise');
select test.eq((select count(*)::integer from public.chapter_seats),0,'outsider cannot read student roster');
select test.ok(not has_table_privilege('authenticated','public.chapter_admins','INSERT'),'clients cannot grant themselves administrator access');
select test.ok(not has_table_privilege('authenticated','public.chapter_admins','TRUNCATE'),'clients cannot truncate administrator membership');
select test.ok(not has_table_privilege('authenticated','public.competition_scores','INSERT'),'students cannot forge scores');
select test.ok(not has_function_privilege('authenticated','public.settle_chapter_competitions()','EXECUTE'),'students cannot trigger prize grants');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select test.eq((select count(*)::integer from public.chapters),0,'pending invite has no access');
select public.accept_chapter_admin('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select test.eq((select count(*)::integer from public.chapters),1,'accepted administrator reads enterprise');
select test.eq((select count(*)::integer from public.chapter_seats),2,'administrator reads all students in own enterprise');
reset role;
select test.eq((select count(*)::integer from public.chapter_seats),2,'administrator does not consume a student seat');
set local role service_role;
select test.eq((public.chapter_student_progress('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'total')::integer,2,'service can read scoped student progress');
reset role;
-- Active fixtures stand for competitions published earlier; creation API disallows past starts.
insert into public.chapter_competitions(id,chapter_id,title,starts_at,ends_at,enrollment,audience) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Automatic',now()-interval '1 hour',now()+interval '1 hour','automatic','all'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sign up',now()-interval '1 hour',now()+interval '1 hour','opt_in','all'),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccce','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Selected',now()-interval '1 hour',now()+interval '1 hour','automatic','selected');
insert into public.competition_audience values ('cccccccc-cccc-4ccc-8ccc-ccccccccccce','33333333-3333-4333-8333-333333333333');
insert into public.competition_prizes values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1,'runs',3,null),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',2,'chest',2,4);
select public.join_chapter_competition('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccd');
select public.register_company_start('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',123,'run-3f','FOOD',false,false,current_date,0);
select public.register_company_start('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',999,'run-rr','FOOD',false,false,current_date,0);
select test.eq((select count(*)::integer from public.company_starts),1,'founding retry registers only one company');
select test.eq((select count(*)::integer from public.competition_participants),3,'automatic and selected enroll, opt-in remains enrolled');
select test.eq(public.record_competition_score('33333333-3333-4333-8333-333333333333','run-3f','NewCo',10000,'hash1'),3,'one new company scores in overlapping competitions');
select test.eq(public.record_competition_score('33333333-3333-4333-8333-333333333333','old-company','OldCo',999999,'oldhash'),0,'unregistered existing companies cannot enter');
select public.record_competition_score('33333333-3333-4333-8333-333333333333','run-3f','NewCo',10,'hash2');
select test.eq((select min(peak_valuation)::integer from public.competition_scores),10000,'lower later scores preserve the peak');
select public.register_company_start('44444444-4444-4444-8444-444444444444','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',124,'run-3g','FOOD',false,false,current_date,0);
select test.eq(public.record_competition_score('44444444-4444-4444-8444-444444444444','run-3g','SecondCo',10000,'hash3'),1,'nonselected and nonjoined student only enters automatic competition');
select public.join_chapter_competition('44444444-4444-4444-8444-444444444444','cccccccc-cccc-4ccc-8ccc-cccccccccccd');
select test.eq(public.record_competition_score('44444444-4444-4444-8444-444444444444','run-3g','SecondCo',10000,'hash3'),1,'joining after company creation does not retroactively qualify');
select test.eq((public.competition_leaderboard('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333')->>'yourRank')::integer,1,'first received equal score wins');
update public.chapter_competitions set ends_at=clock_timestamp()-interval '1 microsecond';
select test.eq(public.record_competition_score('33333333-3333-4333-8333-333333333333','run-3f','NewCo',999999,'late'),0,'postdeadline scores refused');
select test.eq(public.settle_chapter_competitions(),3,'expired competitions settle');
select test.eq(public.settle_chapter_competitions(),0,'repeated settlement does not grant twice');
select test.eq((select run_tickets from public.entitlements where profile_id='33333333-3333-4333-8333-333333333333'),3,'winner receives three run tickets');
select test.eq((select count(*)::integer from public.briefcases where user_id='44444444-4444-4444-8444-444444444444'),2,'second place receives two chests');
select public.register_company_start('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea',125,'run-3h','FOOD',false,false,current_date,1);
select test.eq((select run_tickets from public.entitlements where profile_id='33333333-3333-4333-8333-333333333333'),2,'ticket consumed after ordinary daily allowance');
select public.register_company_start('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea',125,'run-3h','FOOD',false,false,current_date,1);
select test.eq((select run_tickets from public.entitlements where profile_id='33333333-3333-4333-8333-333333333333'),2,'ticket consumption is idempotent');
delete from public.chapter_admins where profile_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select test.eq((select count(*)::integer from public.chapters),0,'removal revokes administrator access immediately');
reset role;
rollback;
