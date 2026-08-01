-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Accounts — housekeeping for email/password sign-up
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Read this before looking for the tables ────────────────────────────────
--
-- Email/password accounts need NO new tables and NO new columns. That is not
-- an oversight, it is where the data belongs:
--
--   · The email and the password hash live in `auth.users`, which Supabase
--     owns and manages. Mirroring the email into `public.profiles` would be a
--     second copy of the one piece of personal information this app collects,
--     kept in sync by hand, readable through a policy we would have to write.
--     There is no query in the app that needs it. So it is not copied.
--
--   · `public.profiles` already keys on `auth.users(id) on delete cascade` and
--     already holds display_name. A permanent user and an anonymous one are
--     the same row shape; `auth.uid()` returns the same thing for both, so
--     every RLS policy in 0001 and 0002 keeps working untouched.
--
--   · Entitlements were ALWAYS account-scoped — `entitlements.profile_id` is
--     the auth user id, not a device. "Purchases follow the account" needed no
--     schema change because the schema never tied them to a device.
--
-- What this migration DOES add is one piece of housekeeping that only becomes
-- necessary once real accounts exist.
--
--
-- ═══ Why stale anonymous users have to be cleaned up ═══════════════════════
--
-- `/api/session` USED TO mint an anonymous auth user for every visitor so their
-- save could sync before they committed to anything. That was the whole
-- identity story before this release, and it is gone: a player without an
-- account now sends nothing at all.
--
-- The rows it already made are still there, though — one auth.users row plus a
-- profile plus whatever they played, for every visitor who ever opened the
-- page, kept forever, about a child, for no purpose.
--
-- The app's own stated position (0001's header, docs/LEADERBOARD.md §9) is
-- that the cheapest way to handle a child's personal information is not to
-- have any. Retaining an abandoned anonymous identity for years is the same
-- mistake in slower motion, so this deletes them.
--
-- Nothing of value is lost. An anonymous user cannot be signed back into by
-- definition — no email, no password — so a player whose row is deleted here
-- could never have reached it again anyway.


-- ═══ delete_stale_anonymous_users ══════════════════════════════════════════
-- Deletes anonymous users untouched for `p_older_than` (default 90 days).
--
-- `security definer` because deleting from auth.users needs privileges the
-- caller does not have. That makes the EXECUTE grant below the entire access
-- control for this function, which is why it is revoked from everyone first.
--
-- Two guards, both deliberate:
--
--   · `is_anonymous` — a converted account is not anonymous and is never
--     touched, no matter how old.
--   · the entitlements check — belt and braces. Checkout refuses to sell to an
--     anonymous identity (app/api/billing/checkout/route.ts), so an anonymous
--     user with entitlements should not exist. If one somehow does, it is
--     evidence of a purchase and this function will not be the thing that
--     erases it.
--
-- Deleting from auth.users cascades to profiles and from there to every table
-- in 0001, 0002 and 0003.
create or replace function public.delete_stale_anonymous_users(
  p_older_than interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  removed integer;
begin
  with doomed as (
    delete from auth.users u
    where u.is_anonymous is true
      -- last_sign_in_at rather than created_at: a player who comes back every
      -- Tuesday for six months is active, not stale.
      and coalesce(u.last_sign_in_at, u.created_at) < (now() - p_older_than)
      and not exists (
        select 1 from public.entitlements e
        where e.profile_id = u.id
          and (e.pro or e.extra_run_slots > 0
               or array_length(e.industry_packs, 1) > 0
               or e.chapter is not null)
      )
      and not exists (
        select 1 from public.billing_customers b where b.profile_id = u.id
      )
    returning 1
  )
  select count(*) into removed from doomed;

  return removed;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC. Left alone, a function
-- that deletes users while running as its owner would be callable over
-- PostgREST by every anonymous player in the game — which would let any of
-- them delete all the others. Revoke first, then grant to nobody but the
-- service role.
revoke execute on function public.delete_stale_anonymous_users(interval)
  from public, anon, authenticated;
grant execute on function public.delete_stale_anonymous_users(interval)
  to service_role;

-- Run it on a schedule if pg_cron is enabled on the project (Database →
-- Extensions). Left commented because enabling an extension is a decision
-- about the project, not something a migration should make on your behalf:
--
--   select cron.schedule(
--     'novus-prune-anonymous',
--     '0 4 * * 0',                                   -- Sundays, 04:00 UTC
--     $$select public.delete_stale_anonymous_users()$$
--   );
--
-- Calling it by hand from the SQL editor is a perfectly good alternative:
--
--   select public.delete_stale_anonymous_users();            -- 90 days
--   select public.delete_stale_anonymous_users(interval '30 days');
