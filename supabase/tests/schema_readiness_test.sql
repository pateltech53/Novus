-- The runner creates schema_readiness from the exact dashboard check query.
-- These fixtures only run on the runner's disposable local database.
\set ON_ERROR_STOP on
select test.ok((select count(*) from schema_readiness) = (select count from expected_migrations),
  'Readiness reports every migration, including timestamped additions');
select test.ok((select bool_and(status = 'ok') from schema_readiness),
  'The fully migrated schema passes the dashboard check');

begin;
drop view public.admin_enterprises;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'admin console workspaces'),
  'Missing enterprise directory is reported without crashing the checker');
rollback;

begin;
revoke select on public.admin_enterprises from service_role;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'admin console workspaces'),
  'An existing but unreadable enterprise directory is not ready');
rollback;

begin;
grant select on public.admin_directory to authenticated;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'admin console workspaces'),
  'Client access to private account metadata fails readiness');
rollback;

begin;
alter view public.admin_directory set (security_invoker = false);
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'admin console workspaces'),
  'Directory views must retain invoker security');
rollback;

begin;
revoke select (email) on auth.users from service_role;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'admin console workspaces'),
  'Missing underlying auth-column access fails readiness');
rollback;

begin;
drop function public.company_competition_count(uuid,text);
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'enterprise competitions'),
  'A partially applied competition migration is detected');
rollback;

begin;
grant execute on function public.record_competition_score(uuid,text,text,bigint,text) to authenticated;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'enterprise competitions'),
  'Clients cannot gain direct score-writing access');
rollback;

begin;
alter table public.competition_awards disable row level security;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'enterprise competitions'),
  'Competition tables must retain RLS');
rollback;

begin;
grant update on public.chapter_admins to authenticated;
select test.ok((select status like 'MISSING%' from schema_readiness where migration = 'enterprise admin grants'),
  'Writable enterprise administrator membership fails readiness');
rollback;

select test.ok((select bool_and(status = 'ok') from schema_readiness),
  'Failure fixtures leave the fully migrated schema intact');
\echo '=== schema_readiness_test: all checks passed ==='
