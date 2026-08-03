-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK SCHEMA · which migrations has this project actually had?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL editor of the NOVUS project. Read-only: it
-- creates nothing, changes nothing, and prints one row per migration with
-- `ok` or `MISSING — run supabase/migrations/<file>`.
--
-- Migrations apply IN ORDER — a MISSING 0003 must be run before a MISSING
-- 0007. Each file is idempotent against a database that has never seen it,
-- not against a half-applied copy of itself; when in doubt about one, check
-- its objects here first.

select
  migration,
  case when present then 'ok' else 'MISSING — run supabase/migrations/' || file end as status
from (
  values
    ('0001 novus core', '0001_novus_core.sql',
      to_regclass('public.profiles') is not null
      and to_regclass('public.entitlements') is not null
      and to_regclass('public.saves') is not null
      and to_regclass('public.legacy') is not null
      and to_regclass('public.run_ledger') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'profiles'
                     and column_name = 'board_handle')),
    ('0002 leaderboard', '0002_leaderboard.sql',
      to_regclass('public.runs') is not null
      and to_regclass('public.leaderboard_entries') is not null
      and to_regclass('public.submission_quota') is not null),
    ('0003 billing', '0003_billing.sql',
      to_regclass('public.billing_customers') is not null
      and to_regclass('public.billing_events') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'grant_extra_run_slot')),
    ('0004 accounts', '0004_accounts.sql',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'delete_stale_anonymous_users')),
    ('0005 auth throttle', '0005_auth_throttle.sql',
      to_regclass('public.auth_throttle') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'claim_auth_attempt')),
    ('0006 board submit', '0006_leaderboard_submit.sql',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'record_board_entry')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'leaderboard_entries'
                     and column_name = 'reports')),
    ('0007 chapters', '0007_chapters.sql',
      to_regclass('public.chapters') is not null
      and to_regclass('public.chapter_seats') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'chapter_seats'
                     and column_name = 'invite_token')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'grant_chapter_seat')),
    ('0008 board rank', '0008_board_rank.sql',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'my_board_rank')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'chapter_board')),
    ('0009 admin', '0009_admin.sql',
      to_regclass('public.admin_audit') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'profiles'
                     and column_name = 'role')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'entitlements'
                     and column_name = 'comp_pro')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'chapters'
                     and column_name = 'source')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_list_users'))
) as t(migration, file, present);
