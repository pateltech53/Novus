-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 · Gifted pace — extra fiscal-year closes a day
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Free closes four fiscal years a real day (FREE_LIMITS.yearClosesPerDay in
-- lib/monetization.ts); Pro closes as many as it can pitch. Between those two
-- there was nothing an operator could hand ONE account — a classroom being
-- demoed, a support case, a player who lost an afternoon to a bug — short of
-- gifting Pro outright, which is a much bigger thing than "you may play on
-- today".
--
-- This migration is that middle: `extra_year_closes`, an allowance that
-- stacks on top of whatever tier the account plays at, set outright by an
-- operator. It is shaped deliberately like `extra_run_slots` (0001, and 0009's
-- admin_set_extra_run_slots): the same 0–20 bound on the column, the same
-- SET-not-increment function clamped to that bound, the same service-role-only
-- door. An operator who knows one knows the other.
--
-- ── Why this is giftable at all ─────────────────────────────────────────────
--
-- Brand Law 4 (docs/ADMIN.md §11) forbids an operator granting a score, a
-- survival, a revive, or a place on Still Standing. Pace is none of those: how
-- many years a player may CLOSE in one real day is exactly what Pro already
-- sells, and a gift here buys nothing that money cannot. The year still has to
-- be played and the pitch still has to be given.
--
-- ── Where the counting lives ────────────────────────────────────────────────
--
-- The ration itself is counted on the DEVICE (novus:yearcloses:v1), because it
-- is a pace limit rather than a ledger of things owned — there is no
-- server-side year-close table to add to. This column is the ALLOWANCE that
-- count is measured against, and it reaches the client the way every other
-- entitlement does: /api/sync and /api/billing/entitlements, through
-- lib/admin/entitlements.ts.

alter table public.entitlements
  add column if not exists extra_year_closes int not null default 0;

-- Named explicitly rather than left inline, so a re-run of this file replaces
-- the constraint instead of stacking a second identical one beside it. The
-- name is the one Postgres would have assigned to an inline check, which is
-- what every other constraint in this schema is called.
alter table public.entitlements
  drop constraint if exists entitlements_extra_year_closes_check;
alter table public.entitlements
  add constraint entitlements_extra_year_closes_check
  check (extra_year_closes between 0 and 20);


-- ═══ Setting the allowance outright ═════════════════════════════════════════
-- SET, not increment, for admin_set_extra_run_slots' reason: an admin types
-- the number they mean, and typing 0 has to be how a gift is taken back.
-- Clamped to the same 0–20 the column's own check enforces, because a function
-- that can violate its table's constraint is a 500 waiting on a typo.
create or replace function public.admin_set_extra_year_closes(
  p_profile uuid,
  p_closes  int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_year_closes)
  values (p_profile, least(greatest(coalesce(p_closes, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_year_closes = least(greatest(coalesce(p_closes, 0), 0), 20);
$$;

revoke execute on function public.admin_set_extra_year_closes(uuid, int)
  from public, anon, authenticated;
grant execute on function public.admin_set_extra_year_closes(uuid, int)
  to service_role;


-- ═══ The stale-anonymous sweep learns about gifted pace ═════════════════════
-- 0004's sweep spares any anonymous row that shows evidence of a purchase, and
-- 0009 widened that to comps for the same reason: deleting an account somebody
-- was given something on is deleting a gift. A granted year allowance is that
-- same evidence. Everything else here is 0009's version, verbatim.
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
      and coalesce(u.last_sign_in_at, u.created_at) < (now() - p_older_than)
      and not exists (
        select 1 from public.entitlements e
        where e.profile_id = u.id
          and (e.pro or e.comp_pro or e.extra_run_slots > 0
               or e.extra_year_closes > 0
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

revoke execute on function public.delete_stale_anonymous_users(interval)
  from public, anon, authenticated;
grant execute on function public.delete_stale_anonymous_users(interval)
  to service_role;
