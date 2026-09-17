-- Service-only views must keep filtering and pagination truthful while
-- refusing every client role, including a signed-in platform administrator.
\set ON_ERROR_STOP on
insert into auth.users (id, email, created_at)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'workspace' || n || '@example.test', now() - n * interval '1 day'
from generate_series(1,260) n;
insert into public.profiles (id, display_name)
select id, 'Workspace fixture' from auth.users where email like 'workspace%@example.test';
insert into public.entitlements (profile_id, pro, comp_pro, comp_until)
select id, email = 'workspace260@example.test', email = 'workspace2@example.test', now() - interval '1 day'
from auth.users where email like 'workspace%@example.test'
on conflict (profile_id) do update set pro = excluded.pro, comp_pro = excluded.comp_pro, comp_until = excluded.comp_until;
select test.ok((select count(*) from public.admin_directory) = 260, 'Directory spans more than the old 200-row ceiling');
set role service_role;
select test.ok((select count(*) from public.admin_directory where paid) = 1, 'Service role can find the oldest paying account');
select test.ok((select count(*) from public.admin_directory where comp_pro) = 0, 'Expired gifts are excluded from the gifted filter');
select test.ok((select count(*) from (select id from public.admin_directory order by created_at desc, id limit 50 offset 250) p) = 10, 'The last page is complete');
reset role;
select test.ok(not has_table_privilege('anon', 'public.admin_directory', 'select'), 'Anonymous callers cannot read directory');
select test.ok(not has_table_privilege('authenticated', 'public.admin_directory', 'select'), 'Session clients cannot read directory');
select test.ok(not has_table_privilege('authenticated', 'public.admin_enterprises', 'select'), 'Session clients cannot read enterprises');
select test.ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.admin_directory'::regclass), 'Directory obeys invoker privileges');
select test.ok(not has_column_privilege('service_role','auth.users','email','update'), 'New grants do not allow auth writes');

insert into public.chapters (id, owner_profile_id, licence, seats, stripe_subscription_id, status, source, name)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','chapter_35',35,'workspace_sub','active','stripe','Workspace School');
insert into public.chapter_seats (chapter_id, profile_id, email, origin, created_by_invite, claimed_at)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','workspace3@example.test','invited',false,null),
       ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','workspace4@example.test','invited',true,null);
-- A re-invited account can have created_by_invite=false yet still need setup.
insert into public.chapter_account_setup (profile_id,completed_at)
values ('10000000-0000-4000-8000-000000000003',null),('10000000-0000-4000-8000-000000000004',now());
set role service_role;
select test.ok((select occupied=2 and pending=1 and available=33 from public.admin_enterprises where name='Workspace School'), 'Seat counts use the authoritative account setup state');
reset role;
select public.delete_chapter('20000000-0000-4000-8000-000000000001');
select test.ok((select count(*) from public.admin_enterprises)=0, 'Deleted enterprise is absent');
select test.ok((select owns_chapter_id is null from public.admin_directory where email='workspace1@example.test'), 'Deleted ownership does not survive in directory');
\echo '=== admin_workspace_test: all checks passed ==='
