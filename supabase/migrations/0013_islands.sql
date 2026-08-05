-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 · Islands — more than one company at a time, and the SKU that says so
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0001 built `saves` with a composite primary key `(profile_id, slot)` and a
-- `slot between 0 and 9` check, under a comment that said out loud: "Room for
-- more than one company later. Today the app writes slot 0 only." This is
-- later. Nothing about the table's shape needs to change to hold ten companies
-- per player — the primary key, the check and the `saves: own` RLS policy have
-- always admitted ten rows, and the admin console already renders them keyed
-- on slot.
--
-- What this migration fixes is a naming collision that had already turned into
-- a mis-sold product.
--
-- ── The collision ──────────────────────────────────────────────────────────
--
-- "Run slot" meant two different things in two different places:
--
--   · `entitlements.extra_run_slots` + `player_allowance()` implemented a
--     DAILY FOUNDING RATION. Free founds one company a real day; Pro founds
--     three; a purchase added one more founding per day. Nothing in that
--     formula has ever read `public.saves`.
--
--   · The SKU copy, the one-time shelf and — most seriously — the Terms of
--     Service told the player they were buying CONCURRENCY: "one more company
--     running at the same time", "Pro adds more concurrent companies".
--
-- A player who paid for the second reading received the first, and spending it
-- destroyed the company they already had, because founding was the only thing
-- the app could do with it. The two readings are now two columns and two
-- functions, and neither one is named after the other:
--
--   extra_islands   → how many companies may exist AT ONCE (this migration)
--   player_allowance→ how many foundings a real day allows (tier only, no
--                     purchasable component — the SKU moved)
--
-- The Stripe price is deliberately NOT changed. The same purchase link now
-- grants an island instead of a daily founding, which is what its own product
-- description has always promised.
--
-- ── The listing cache grows ────────────────────────────────────────────────
--
-- 0001 put a handful of scalars beside the jsonb blob so "a UI needs to list
-- saves without parsing megabytes". A picker showing ten companies is exactly
-- that UI, and it needs six more numbers. They are mirrored out of `state` on
-- write and remain, as 0001 said, a CACHE that is never the truth.


-- ═══ entitlements.extra_run_slots → extra_islands ══════════════════════════
-- A rename rather than a new column: there is no data to preserve under the
-- old meaning that the new meaning would corrupt. Every player who bought one
-- was promised concurrency in writing; giving them concurrency is the fix, not
-- a migration hazard.
alter table public.entitlements
  rename column extra_run_slots to extra_islands;

-- The check travelled with the column but kept its old name, and a constraint
-- called extra_run_slots_check on a column called extra_islands is the same
-- drift this migration exists to end. Guarded rather than bare: 0001 declared
-- the check inline so its name is one Postgres chose, and a project restored
-- from a dump or built by APPLY-ALL may carry a different one. A cosmetic
-- rename must never be the thing that aborts this migration.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.entitlements'::regclass
      and conname  = 'entitlements_extra_run_slots_check'
  ) then
    alter table public.entitlements
      rename constraint entitlements_extra_run_slots_check to entitlements_extra_islands_check;
  end if;
end;
$$;


-- ═══ saves — the listing cache the picker reads ════════════════════════════
-- Nullable, because every row that exists right now was written before these
-- columns did and there is no honest value to backfill: the numbers live
-- inside `state`, and the next write from the client mirrors them out. A
-- picker that renders a dash for one boot is correct; a picker that renders a
-- confident zero is not.
alter table public.saves
  -- Current company value, dollars. Signed and wide: valuation is not bounded
  -- by anything the sim promises, and a bigint that overflows is a 500 on a
  -- save, which is the one write that must never fail.
  add column if not exists valuation      bigint,
  -- The high-water mark. A dead company's card shows what it was worth at its
  -- best, which is the thing worth remembering about it; `valuation` at the
  -- moment of Chapter 7 is approximately zero and says nothing.
  add column if not exists peak_valuation bigint,
  add column if not exists cash           bigint,
  add column if not exists revenue_annual bigint,
  add column if not exists employees      int,
  -- AvatarConfig. jsonb rather than shredded columns for the same reason
  -- `state` is jsonb: the closet gains fields, and a card that shows the wrong
  -- hair is a smaller bug than a migration per cosmetic.
  add column if not exists avatar         jsonb;


-- ═══ island_allowance — how many companies may exist at once ═══════════════
-- The concurrency counterpart to player_allowance below. Same shape on
-- purpose: definer-only, read from the database, never trusted from a caller,
-- and one copy of the formula so the client's version in lib/monetization.ts
-- has exactly one thing to agree with.
--
-- Capped at 10 whatever the arithmetic says, because `saves.slot` is checked
-- `between 0 and 9` and an allowance that exceeds its own storage is a promise
-- the insert below would have to break.
create or replace function public.island_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select least(10, case
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 2 + coalesce(e.extra_islands, 0)
        when 'pro'  then 10
        else 10
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 10
           else 2 + coalesce(e.extra_islands, 0) end
  end)
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

-- Service role only, and NOT readable by the player, even about themselves.
-- The argument is a profile id, so a function `authenticated` could call would
-- answer "is this other account Pro?" for any uuid a player cared to type —
-- 0002's rule is that entitlements never leave their own row, and a convenience
-- grant here would be the hole. The picker does not need it: the client already
-- receives its own entitlements through /api/sync and computes the same cap in
-- lib/monetization.ts. The trigger below reaches it as a definer, not a caller.
revoke execute on function public.island_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.island_allowance(uuid) to service_role;


-- ═══ The cap, enforced where it cannot be edited ═══════════════════════════
-- lib/monetization.ts enforces this client-side, and the client is a browser.
-- 0002's header is blunt about what that is worth: localStorage is "plain
-- JSON, and anyone who opens devtools can write anything into it".
--
-- BEFORE INSERT only. An upsert onto a slot the player already owns arrives as
-- an UPDATE through `on conflict do update` and must stay free — a player at
-- their cap still has to be able to save the companies they have.
--
-- ── Only LIVING companies count ────────────────────────────────────────────
--
-- A company that reached Chapter 7, an acquisition or an IPO keeps its row and
-- keeps its island, as a headstone the player can go back and read. It does
-- NOT spend the allowance. Counting the dead would mean a free player's two
-- islands fill with two graves and the game politely stops, which is the
-- shape of a limit designed to sell something rather than to mean something.
--
-- The rows still cost a slot, and `slot between 0 and 9` still caps those at
-- ten. The client evicts the oldest headstone when a founding needs the room
-- (firstFreeIsland in lib/engine/save.ts); this function's job is only to stop
-- an eleventh LIVE company, which is the thing that was actually sold.
create or replace function public.enforce_island_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed int;
  held    int;
begin
  -- A dead company arriving as a fresh INSERT cannot exceed a living-company
  -- allowance, and refusing it would strand a headstone the client is trying
  -- to restore from the cloud.
  if new.alive is false then
    return new;
  end if;

  allowed := coalesce(public.island_allowance(new.profile_id), 2);
  select count(*) into held
    from public.saves s
   where s.profile_id = new.profile_id and s.alive;

  if held >= allowed then
    raise exception 'island allowance exhausted (% of %)', held, allowed
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists saves_island_cap on public.saves;
create trigger saves_island_cap
  before insert on public.saves
  for each row execute function public.enforce_island_cap();


-- ═══ grant_extra_run_slot → grant_extra_island ═════════════════════════════
-- Same Stripe price, same webhook, same non-idempotency for the same reason:
-- two bought is two. What changed is only what the player receives, and it is
-- now what the product description always said they were buying.
drop function if exists public.grant_extra_run_slot(uuid);

create or replace function public.grant_extra_island(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_islands = least(public.entitlements.extra_islands + 1, 20);
$$;

revoke execute on function public.grant_extra_island(uuid) from public, anon, authenticated;
grant  execute on function public.grant_extra_island(uuid) to service_role;


-- ═══ admin_set_extra_run_slots → admin_set_extra_islands ═══════════════════
drop function if exists public.admin_set_extra_run_slots(uuid, int);

create or replace function public.admin_set_extra_islands(
  p_profile uuid,
  p_islands int
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_islands)
  values (p_profile, least(greatest(coalesce(p_islands, 0), 0), 20))
  on conflict (profile_id) do update
    set extra_islands = least(greatest(coalesce(p_islands, 0), 0), 20);
$$;

revoke execute on function public.admin_set_extra_islands(uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_set_extra_islands(uuid, int) to service_role;


-- ═══ player_allowance loses its purchasable component ══════════════════════
-- 0009's version was `tier + coalesce(e.extra_run_slots, 0)`. The purchase
-- moved to islands, so the daily ration is now tier alone: free one founding a
-- day, Pro three. Everything else — the admin view switch, the comp window,
-- the chapter seat, the finite 999 — is 0009 verbatim.
--
-- Note for whoever reads this next: this function and claim_run_slot() have
-- ZERO TypeScript callers today. The run-a-day rule is enforced only in
-- lib/state/GameProvider.tsx against localStorage. That was true before this
-- migration and is not made worse by it, but it is the reason a determined
-- player can still found more often than the pricing page says.
create or replace function public.player_allowance(p_profile uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p.role = 'admin' then
      case coalesce(p.admin_view, 'all')
        when 'free' then 1
        when 'pro'  then 3
        else 999
      end
    else
      case when coalesce(e.pro, false)
             or (coalesce(e.comp_pro, false)
                 and (e.comp_until is null or e.comp_until > now()))
             or e.chapter is not null
           then 3 else 1 end
  end
  from public.profiles p
  left join public.entitlements e on e.profile_id = p.id
  where p.id = p_profile;
$$;

revoke execute on function public.player_allowance(uuid) from public, anon, authenticated;
grant  execute on function public.player_allowance(uuid) to service_role;


-- ═══ The stale-anonymous sweep follows the rename ══════════════════════════
-- 0012's version, with the one column renamed.
--
-- 0012 replaced this function to spare an account holding GIFTED PACE, and
-- this migration replaces it again — so its clause has to be carried forward
-- here or the gift stops protecting anything the moment islands land. Two
-- migrations owning one function is how a feature regresses without a single
-- line of its own code changing.
--
-- An anonymous account holding a bought island is evidence of a purchase, and
-- one holding gifted year-closes is evidence an operator attached value to it.
-- Neither may be swept.
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
          and (e.pro or e.comp_pro or e.extra_islands > 0
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

revoke execute on function public.delete_stale_anonymous_users(interval) from public, anon, authenticated;
grant  execute on function public.delete_stale_anonymous_users(interval) to service_role;


-- ═══ admin_list_users follows the rename ═══════════════════════════════════
-- DROP then CREATE rather than CREATE OR REPLACE: the rename is in the RETURNS
-- TABLE column list, and Postgres refuses to replace a function whose output
-- type changed. The body is 0009's, with the one column renamed.
drop function if exists public.admin_list_users(text, int, int);

create or replace function public.admin_list_users(
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id                   uuid,
  email                text,
  display_name         text,
  role                 text,
  is_anonymous         boolean,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  pro                  boolean,
  comp_pro             boolean,
  comp_until           timestamptz,
  comp_note            text,
  chapter              text,
  extra_islands        int,
  industry_packs       text[],
  intent               text,
  subscription_status  text,
  plan                 text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  owns_chapter_id      uuid,
  owns_chapter_status  text,
  owns_chapter_source  text,
  owns_chapter_licence text,
  seat_chapter_id      uuid,
  total                bigint
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as needle
  )
  select
    u.id,
    u.email,
    p.display_name,
    coalesce(p.role, 'player'),
    coalesce(u.is_anonymous, false),
    u.created_at,
    u.last_sign_in_at,
    coalesce(e.pro, false),
    coalesce(e.comp_pro, false),
    e.comp_until,
    e.comp_note,
    e.chapter,
    coalesce(e.extra_islands, 0),
    coalesce(e.industry_packs, '{}'),
    e.intent,
    b.subscription_status,
    b.plan,
    b.current_period_end,
    coalesce(b.cancel_at_period_end, false),
    oc.id,
    oc.status,
    oc.source,
    oc.licence,
    s.chapter_id,
    count(*) over () as total
  from auth.users u
  left join public.profiles p          on p.id = u.id
  left join public.entitlements e      on e.profile_id = u.id
  left join public.billing_customers b on b.profile_id = u.id
  left join public.chapters oc         on oc.owner_profile_id = u.id and oc.status = 'active'
  left join public.chapter_seats s     on s.profile_id = u.id
  cross join q
  where q.needle is null
     or u.email ilike '%' || q.needle || '%'
     or p.display_name ilike '%' || q.needle || '%'
     or u.id::text = q.needle
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.admin_list_users(text, int, int) from public, anon, authenticated;
grant  execute on function public.admin_list_users(text, int, int) to service_role;


-- ═══ savesAlive stops meaning two things ═══════════════════════════════════
-- `count(*) from saves where alive` was written when one player was one save,
-- so the console could label it LIVE COMPANIES and mean players by it. The day
-- slot 1 is first written those diverge, silently, inside a stored time series
-- with no way to tell the old rows from the new.
--
-- Both numbers are now recorded under names that can only mean one thing.
alter table public.admin_daily
  add column if not exists players_playing int;

create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, pro_paid, pro_comp, seats, chapters_active,
     saves_alive, players_playing, board_listed, board_queue)
  select
    current_date,
    (select count(*) from public.admin_last_seen()),
    (select count(*) from public.admin_last_seen() s where s.created_at >= current_date),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '1 day'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '7 days'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '30 days'),
    coalesce((select sum(l.started) from public.run_ledger l
               where l.day = (now() at time zone 'utc')::date), 0),
    (select count(*) from public.entitlements e where e.pro),
    (select count(*) from public.entitlements e
      where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    (select count(*) from public.chapter_seats),
    (select count(*) from public.chapters c where c.status = 'active'),
    -- Companies.
    (select count(*) from public.saves s where s.alive),
    -- People. Before islands these two were the same number by construction.
    (select count(distinct s.profile_id) from public.saves s where s.alive),
    (select count(*) from public.leaderboard_entries l where l.listed),
    (select count(*) from public.leaderboard_entries l where l.listed is false)
  on conflict (day) do update set
    accounts        = excluded.accounts,
    new_accounts    = excluded.new_accounts,
    active_1d       = excluded.active_1d,
    active_7d       = excluded.active_7d,
    active_30d      = excluded.active_30d,
    runs_started    = excluded.runs_started,
    pro_paid        = excluded.pro_paid,
    pro_comp        = excluded.pro_comp,
    seats           = excluded.seats,
    chapters_active = excluded.chapters_active,
    saves_alive     = excluded.saves_alive,
    players_playing = excluded.players_playing,
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;

revoke execute on function public.admin_capture_daily() from public, anon, authenticated;
grant  execute on function public.admin_capture_daily() to service_role;


-- ═══ admin_stats gains the same distinction ════════════════════════════════
-- 0010's body, with `playersPlaying` beside `savesAlive` and `islandsSold`
-- replacing nothing — it is new, and it is the number that says whether the
-- re-pointed SKU is selling.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with seen as (
    select * from public.admin_last_seen()
  )
  select jsonb_build_object(
    'accounts',       (select count(*) from seen),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from public.profiles p where p.role = 'admin'),
    'newWeek',        (select count(*) from seen s where s.created_at > now() - interval '7 days'),
    'activeToday',    (select count(*) from seen s where s.last_seen > now() - interval '1 day'),
    'activeWeek',     (select count(*) from seen s where s.last_seen > now() - interval '7 days'),
    'activeMonth',    (select count(*) from seen s where s.last_seen > now() - interval '30 days'),
    'activity',       (select jsonb_build_object(
                        'd1',    count(*) filter (where s.last_seen >  now() - interval '1 day'),
                        'd7',    count(*) filter (where s.last_seen <= now() - interval '1 day'
                                              and s.last_seen >  now() - interval '7 days'),
                        'd30',   count(*) filter (where s.last_seen <= now() - interval '7 days'
                                              and s.last_seen >  now() - interval '30 days'),
                        'd90',   count(*) filter (where s.last_seen <= now() - interval '30 days'
                                              and s.last_seen >  now() - interval '90 days'),
                        'older', count(*) filter (where s.last_seen <= now() - interval '90 days')
                      ) from seen s),
    'proPaid',        (select count(*) from public.entitlements e where e.pro),
    'proComp',        (select count(*) from public.entitlements e
                        where e.comp_pro and (e.comp_until is null or e.comp_until > now())),
    'chapterSeats',   (select count(*) from public.chapter_seats),
    'chaptersActive', (select count(*) from public.chapters c where c.status = 'active'),
    'chaptersComp',   (select count(*) from public.chapters c
                        where c.status = 'active' and c.source = 'comp'),
    -- Companies, then the people running them. See admin_capture_daily.
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'playersPlaying', (select count(distinct s.profile_id) from public.saves s where s.alive),
    'islandsSold',    (select coalesce(sum(e.extra_islands), 0) from public.entitlements e),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;

revoke execute on function public.admin_stats() from public, anon, authenticated;
grant  execute on function public.admin_stats() to service_role;
