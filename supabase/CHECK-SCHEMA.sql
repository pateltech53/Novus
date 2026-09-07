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
    -- 0003 wrote `grant_extra_run_slot`; 0013 renamed it `grant_extra_island`.
    -- Either name proves 0003 ran — a project sitting between the two used to
    -- be reported as missing 0003 by this row.
    ('0003 billing', '0003_billing.sql',
      to_regclass('public.billing_customers') is not null
      and to_regclass('public.billing_events') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('grant_extra_island', 'grant_extra_run_slot'))),
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
                   where n.nspname = 'public' and p.proname = 'admin_list_users')),
    ('0010 admin analytics', '0010_admin_analytics.sql',
      to_regclass('public.admin_daily') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_cohorts')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_timeseries')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_capture_daily')),
    ('0011 custom chapters', '0011_custom_chapters.sql',
      exists (select 1 from pg_constraint c
               where c.conname = 'chapters_licence_check'
                 and pg_get_constraintdef(c.oid) like '%chapter_custom%')
      and exists (select 1 from pg_constraint c
                   where c.conname = 'entitlements_chapter_check'
                     and pg_get_constraintdef(c.oid) like '%chapter_custom%')),
    ('0012 year closes', '0012_year_closes.sql',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'entitlements'
                 and column_name = 'extra_year_closes')),
    ('0013 islands', '0013_islands.sql',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'entitlements'
                 and column_name = 'extra_islands')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'saves'
                     and column_name = 'peak_valuation')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'island_allowance')
      and exists (select 1 from pg_trigger g
                   where g.tgname = 'saves_island_cap' and not g.tgisinternal)),
    ('0014 chapter seats ceiling', '0014_chapter_seats_ceiling.sql',
      exists (select 1 from pg_constraint c
               where c.conname = 'chapters_seats_check'
                 and pg_get_constraintdef(c.oid) like '%10000%')),
    ('0015 island ceiling', '0015_island_ceiling.sql',
      exists (select 1 from pg_constraint c
               where c.conname = 'saves_slot_check'
                 and pg_get_constraintdef(c.oid) like '%49%')
      and exists (select 1 from pg_constraint c
                   where c.conname = 'entitlements_extra_islands_check'
                     and pg_get_constraintdef(c.oid) like '%48%')),
    ('0016 admin insight', '0016_admin_insight.sql',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'admin_access')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_user_companies')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_billing_mismatches')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'admin_daily'
                     and column_name = 'pro_effective')
      and exists (select 1 from pg_trigger g
                   where g.tgname = 'profiles_board_handle_rename' and not g.tgisinternal)),
    ('0017 rewards', '0017_rewards.sql',
      to_regclass('public.achievement_templates') is not null
      and to_regclass('public.skins') is not null
      and to_regclass('public.rewards') is not null
      and to_regclass('public.briefcases') is not null
      and to_regclass('public.inventory') is not null
      and to_regclass('public.token_ledger') is not null
      and to_regclass('public.reward_events') is not null
      and to_regclass('public.milestones_claimed') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'entitlements'
                     and column_name = 'rewards_beta')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'open_briefcase')),
    -- The seed is counted through query_to_xml: a bare `select count(*)` from
    -- a table that does not exist fails at parse time, before any `case` could
    -- guard it, and this file promises to run on a project that has nothing.
    ('0018 rewards seed', '0018_rewards_seed.sql',
      case when to_regclass('public.achievement_templates') is null then false
           else (xpath('/row/c/text()', query_to_xml(
                   'select count(*) as c from public.achievement_templates',
                   false, true, '')))[1]::text::int > 0 end
      and case when to_regclass('public.rewards') is null then false
           else (xpath('/row/c/text()', query_to_xml(
                   'select count(*) as c from public.rewards',
                   false, true, '')))[1]::text::int > 0 end
      and case when to_regclass('public.skins') is null then false
           else (xpath('/row/c/text()', query_to_xml(
                   'select count(*) as c from public.skins',
                   false, true, '')))[1]::text::int > 0 end)
) as t(migration, file, present);
