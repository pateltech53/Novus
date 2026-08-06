-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 · Islands past ten, and a purchase that works on every tier
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- `saves.slot` has been checked `between 0 and 9` since 0001, where the column
-- comment reads "Room for more than one company later. Today the app writes
-- slot 0 only." It was a placeholder. 0013 then built the island product on
-- top of it and inherited the number as a hard ceiling — `island_allowance`
-- caps at 10, `ISLAND_CAP` in lib/monetization.ts caps at 10, and the shelf
-- stops selling there.
--
-- Two things follow from that, and both are wrong:
--
--   1. **The ceiling is an accident.** Ten was never a decision about how many
--      companies a player should be able to run. It was the width somebody
--      reserved before there was a second company to put in it.
--
--   2. **Pro made the SKU worthless.** `island_allowance` gave a Pro account a
--      flat 10 — the whole ceiling — so `10 + anything` clamped straight back
--      to 10 and a subscriber who bought an Extra Island received nothing at
--      all. Taking $1.99 for a no-op is the part of this that is not merely a
--      small number.
--
-- ── What this changes ──────────────────────────────────────────────────────
--
-- The ceiling moves to 50, and the tiers stop being the ceiling:
--
--   free   2  + bought
--   Pro   10  + bought        ← the change; Pro was a flat 10
--   both  ≤ 50
--
-- So a bought island is worth exactly one island to everybody, on every tier,
-- until the storage ceiling. Nobody's current allowance goes down: free stays
-- 2, Pro stays 10, and both can now buy their way past it.
--
-- ── Why 50 and not "no limit" ──────────────────────────────────────────────
--
-- Unlike `chapters.seats` in 0014 — a sanity bound on a typed number — this
-- one is a real resource. localStorage is the game's PRIMARY store, not a
-- nicety: lib/engine/save.ts is synchronous because screens read it during
-- render, and its header explains why that cannot change. A browser gives an
-- origin about 5 MB, and a long-lived company measures ~90 KB of JSON. Fifty
-- of them is ~4.5 MB and fits. A hundred does not, and the failure mode is the
-- worst one available: `flushRun` swallows a quota error by design, so islands
-- a player paid for would simply stop appearing on their device.
--
-- `/api/sync` is the second wall — it returns every island in one response
-- body, so the same fifty is a ~4.5 MB pull on boot.
--
-- Going meaningfully higher is possible and is a different piece of work: an
-- LRU cache in localStorage, per-island loading from the server on a cache
-- miss, and a paginated sync. Until that exists, 50 is where the honest
-- ceiling is, and a ceiling the app can actually keep is worth more than a
-- bigger number it cannot.
--
-- ── The four bounds ────────────────────────────────────────────────────────
--
--   1. `saves.slot`            0–9  → 0–49.  Stays `smallint`; it holds 32767
--                              and the type was never the limit.
--   2. `entitlements.extra_islands`  0–20 → 0–48. Forty-eight is exactly what
--      a FREE account must be able to accumulate to reach 50 (2 + 48), which
--      makes it the largest value that can ever mean anything — a Pro account
--      needs only 40 and clamps at the same ceiling.
--   3. `grant_extra_island`    the webhook's `least(…, 20)`.
--   4. `admin_set_extra_islands`  the console's `least(greatest(…), 20)`.
--
-- Every one of them has to move together. A column that accepts what a
-- function refuses is a purchase that silently fails; a function that grants
-- what the column refuses is a 500 in a Stripe webhook, which is 0009's rule
-- read in the other direction.
--
-- `enforce_island_cap` is untouched: it counts living saves against
-- `island_allowance()` and knows no numbers of its own, which is exactly why
-- it needed none changing.

begin;

-- ═══ 1 · saves.slot — room for fifty companies ═════════════════════════════
-- Postgres names this one itself, so the drop is by the generated name. `if
-- exists` rather than a lookup: a database that somehow lacks it should end
-- this migration WITH it, which is what the add below guarantees either way.
alter table public.saves
  drop constraint if exists saves_slot_check;

alter table public.saves
  add constraint saves_slot_check
  check (slot between 0 and 49);


-- ═══ 2 · entitlements.extra_islands — up to forty-eight bought ═════════════
-- Two possible names. The constraint was born in 0001 on a column called
-- `extra_run_slots`, and 0013 renamed the column and then the constraint after
-- it — but only when it found the old name, so a project first created AFTER
-- 0013 was folded into APPLY-ALL carries the new name from the start. Drop
-- both; at most one exists.
alter table public.entitlements
  drop constraint if exists entitlements_extra_run_slots_check;

alter table public.entitlements
  drop constraint if exists entitlements_extra_islands_check;

alter table public.entitlements
  add constraint entitlements_extra_islands_check
  check (extra_islands between 0 and 48);


-- ═══ 3 · island_allowance — the tier is a floor, not the ceiling ═══════════
-- 0013's version, with one change repeated in three places: every branch that
-- returned a flat 10 for a Pro-equivalent account now adds what was bought,
-- and the outer clamp moves 10 → 50.
--
-- This is the single copy of the formula that the client's `islandCapFor()`
-- has to agree with, and it still is: `min(50, tier + extraIslands)`.
--
-- The admin's `all` view stays a flat ceiling rather than an arithmetic — an
-- operator viewing everything is not modelling a purchase, they are looking at
-- the maximum the storage allows, which is the same thing ADMIN_LIMITS says on
-- the client.
create or replace function public.island_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select least(50, case
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 2 + coalesce(e.extra_islands, 0)
        when 'pro'  then 10 + coalesce(e.extra_islands, 0)
        else 50
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 10 + coalesce(e.extra_islands, 0)
           else 2 + coalesce(e.extra_islands, 0) end
  end)
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

-- Replaced at its existing signature, so 0013's revoke/grant still stand and
-- service_role remains the only caller. Restated anyway: a `create or replace`
-- that ever became a `create` would otherwise ship the default PUBLIC execute.
revoke execute on function public.island_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.island_allowance(uuid) to service_role;


-- ═══ 4 · grant_extra_island — the webhook's clamp ══════════════════════════
-- Still not idempotent, and still cannot be: two bought is two. The
-- `billing_events` row is what stops a Stripe retry from granting a third, and
-- this clamp is the backstop if that ever fails.
create or replace function public.grant_extra_island(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_islands = least(public.entitlements.extra_islands + 1, 48);
$$;

revoke execute on function public.grant_extra_island(uuid) from public, anon, authenticated;
grant  execute on function public.grant_extra_island(uuid) to service_role;


-- ═══ 5 · admin_set_extra_islands — the console's clamp ═════════════════════
-- SET rather than increment, unchanged: an admin types the number they mean.
create or replace function public.admin_set_extra_islands(
  p_profile uuid,
  p_islands int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, least(greatest(coalesce(p_islands, 0), 0), 48))
  on conflict (profile_id) do update
    set extra_islands = least(greatest(coalesce(p_islands, 0), 0), 48);
$$;

revoke execute on function public.admin_set_extra_islands(uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_set_extra_islands(uuid, int) to service_role;

commit;
