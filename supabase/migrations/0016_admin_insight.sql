-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 · Admin insight — what "paid" means, and what the console can see
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Three complaints from the operator's desk, and each one is a claim this
-- schema was making that it could not keep:
--
--   1. **PRO · PAID reads zero while an account clearly is paying.** The tile
--      counted `entitlements.pro` alone. That column is written by exactly one
--      thing — the Stripe webhook (0003's apply_subscription) — so it is
--      false for every subscriber whose webhook never landed: an endpoint
--      added to Stripe after the first sale, a deploy where
--      STRIPE_WEBHOOK_SECRET was wrong, a `customer.subscription.*` event
--      that was never ticked in the dashboard. `billing_customers` still has
--      the truth in those cases (the checkout route writes it before Stripe
--      ever sees the customer), which is why opening the account showed a
--      live subscription while the tile above said nobody was paying.
--
--      So "paid" is now the UNION of both records — an account Stripe calls
--      active is a paying account whether or not the entitlement row agrees —
--      and the DISAGREEMENT is counted and listed rather than hidden, because
--      a subscriber whose `pro` flag is false is a player who is paying and
--      not getting Pro. That is the worst bug billing has, and until now the
--      console had no way to see it.
--
--   2. **The directory said nothing about play.** The list showed who someone
--      had paid to be, never what they had done: no runs, no companies, no
--      valuation. Every one of those numbers already existed — `legacy`,
--      `saves`, and the run's own `state` — and none of them were read.
--
--   3. **A board name could be picked once and never again.** The rename is a
--      UI change (components/screens/StillStandingScreen.tsx), but it needs
--      one thing from the database: `leaderboard_entries.founder_display_name`
--      is denormalised, so a player who changes their handle would otherwise
--      leave every row they already hold under the old name. The trigger at
--      the bottom of this file carries the rename across.
--
-- Nothing here grants anything, and nothing here can be reached by a player:
-- every function is service-role only, exactly as 0009/0010/0013 established.


-- ═══ Reading money out of a save ════════════════════════════════════════════
-- 0013 added `saves.valuation`, `peak_valuation` and `cash` — the listing
-- cache the islands picker draws its cards from, mirrored out of `state` by
-- the sync route on every write. Those columns are the right source and every
-- reader below prefers them.
--
-- They are also NULLABLE, and deliberately so: 0013 refused to backfill rows
-- written before the columns existed, because the honest value was inside
-- `state` and a confident zero would have been a lie. A console that showed a
-- dash for every company founded before that migration would be repeating the
-- same omission this file exists to fix, so these functions are the fallback —
-- the figure is read out of the blob when the column has not been filled in
-- yet, and the next save from that device fills the column in for good.
--
-- The regex guard is the whole point of these being functions. `(x)::numeric`
-- on a blob written by an older client — or by a client that stored a string,
-- or `null`, or `Infinity` — raises, and a raise inside `admin_stats` is a
-- console that shows nothing at all because one save is odd. A malformed
-- figure is simply not a figure here.
create or replace function public.save_number(p_state jsonb, variadic p_path text[])
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when (p_state #>> p_path) ~ '^-?[0-9]+(\.[0-9]+)?$'
    then (p_state #>> p_path)::numeric
  end;
$$;

/** What the books read right now. */
create or replace function public.save_valuation(p_state jsonb)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.save_number(p_state, 'stats', 'valuation');
$$;

/** The highest they ever read. Runs founded before `peakValuation` existed
    fall back to the current figure, which is what the year-end statement does
    (lib/engine/save.ts). */
create or replace function public.save_peak_valuation(p_state jsonb)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.save_number(p_state, 'peakValuation'),
    public.save_number(p_state, 'stats', 'valuation')
  );
$$;


-- ═══ Who is paying, in one place ════════════════════════════════════════════
-- The formula that was scattered across a stats tile, a badge and a detail
-- panel — each deciding for itself — is now one function every reader below
-- calls. `paid` is the union described at the top; `mismatch` is the pair of
-- ways the two records can disagree, named rather than merely counted:
--
--   'stripe-not-granted' — Stripe is charging and the entitlement is false.
--                          The player is paying and does not have Pro. Fix by
--                          re-syncing the subscription (/api/admin/reconcile).
--   'granted-not-billed' — the entitlement is true and Stripe has nothing
--                          live. Usually a legitimate history (a subscription
--                          that lapsed while the flag was never cleared), and
--                          always worth a look: it is free Pro.
--
-- `source` answers "why does this account have Pro" in the order the app
-- itself decides access (lib/admin/entitlements.ts): the role first, then
-- money, then a gift, then a classroom seat.
create or replace function public.admin_access()
returns table (
  id            uuid,
  role          text,
  ent_pro       boolean,
  stripe_pro    boolean,
  comp_pro      boolean,
  seat          boolean,
  paid          boolean,
  effective_pro boolean,
  source        text,
  mismatch      text,
  plan          text
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with base as (
    select
      p.id,
      coalesce(p.role, 'player')                              as role,
      coalesce(e.pro, false)                                  as ent_pro,
      coalesce(b.subscription_status in ('active', 'trialing', 'past_due'), false)
                                                              as stripe_pro,
      (coalesce(e.comp_pro, false)
        and (e.comp_until is null or e.comp_until > now()))    as comp_pro,
      (e.chapter is not null)                                 as seat,
      b.plan
    from public.profiles p
    left join public.entitlements e      on e.profile_id = p.id
    left join public.billing_customers b on b.profile_id = p.id
  )
  select
    b.id,
    b.role,
    b.ent_pro,
    b.stripe_pro,
    b.comp_pro,
    b.seat,
    (b.ent_pro or b.stripe_pro) as paid,
    (b.role = 'admin' or b.ent_pro or b.stripe_pro or b.comp_pro or b.seat)
      as effective_pro,
    case
      when b.role = 'admin'              then 'admin'
      when b.ent_pro or b.stripe_pro     then 'paid'
      when b.comp_pro                    then 'gift'
      when b.seat                        then 'chapter'
    end as source,
    case
      when b.stripe_pro and not b.ent_pro then 'stripe-not-granted'
      when b.ent_pro and not b.stripe_pro then 'granted-not-billed'
    end as mismatch,
    b.plan
  from base b;
$$;


-- ═══ The overview numbers, corrected and widened ════════════════════════════
-- 0013's body, with the paid family rebuilt on admin_access() and the play
-- figures the directory was missing. Keys that existed keep their names and
-- their meaning; `proPaid` is the one whose ANSWER changes, and it changes
-- from "wrong" to "right".
--
-- Money is deliberately absent: this function counts subscriptions by plan and
-- the console multiplies by the prices in lib/monetization.ts, so a price rise
-- is one edit in the place prices already live rather than a number baked into
-- a migration that nobody will remember to change.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with seen as (
    select * from public.admin_last_seen()
  ),
  access as (
    select * from public.admin_access()
  )
  select jsonb_build_object(
    'accounts',       (select count(*) from seen),
    'anonymous',      (select count(*) from auth.users u where coalesce(u.is_anonymous, false)),
    'admins',         (select count(*) from access a where a.role = 'admin'),
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

    -- ── Paid, and the evidence on both sides of it ──────────────────────────
    'proPaid',        (select count(*) from access a where a.paid),
    'proStripe',      (select count(*) from access a where a.stripe_pro),
    'proGranted',     (select count(*) from access a where a.ent_pro),
    'proComp',        (select count(*) from access a where a.comp_pro),
    'proChapter',     (select count(*) from access a where a.seat),
    'proEffective',   (select count(*) from access a where a.effective_pro),
    'proMonthly',     (select count(*) from access a where a.paid and a.plan = 'pro_monthly'),
    'proYearly',      (select count(*) from access a where a.paid and a.plan = 'pro_yearly'),
    'proUnknownPlan', (select count(*) from access a where a.paid and a.plan is null),
    'billingMismatch',(select count(*) from access a where a.mismatch is not null),
    'notGranted',     (select count(*) from access a where a.mismatch = 'stripe-not-granted'),
    'notBilled',      (select count(*) from access a where a.mismatch = 'granted-not-billed'),
    'cancelling',     (select count(*) from public.billing_customers b
                        where b.cancel_at_period_end
                          and b.subscription_status in ('active', 'trialing', 'past_due')),
    'pastDue',        (select count(*) from public.billing_customers b
                        where b.subscription_status = 'past_due'),

    'chapterSeats',   (select count(*) from public.chapter_seats),
    'chaptersActive', (select count(*) from public.chapters c where c.status = 'active'),
    'chaptersComp',   (select count(*) from public.chapters c
                        where c.status = 'active' and c.source = 'comp'),

    -- ── What has actually been played ───────────────────────────────────────
    -- `runsCompleted` is the legacy ledger's own count — companies carried to
    -- an ending, which is what "a run they have done" means to a player.
    -- `companies` counts every company ever founded that still has a save,
    -- alive or headstone. `runsToday` is starts, off the day's run_ledger.
    'runsCompleted',  (select coalesce(sum(l.runs_completed), 0) from public.legacy l),
    'runsToday',      (select coalesce(sum(r.started), 0) from public.run_ledger r
                        where r.day = (now() at time zone 'utc')::date),
    'companies',      (select count(*) from public.saves),
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'playersPlaying', (select count(distinct s.profile_id) from public.saves s where s.alive),
    'islandsSold',    (select coalesce(sum(e.extra_islands), 0) from public.entitlements e),
    'valuationLive',  (select coalesce(sum(coalesce(s.valuation, public.save_valuation(s.state))), 0)::bigint
                        from public.saves s where s.alive),
    'valuationBest',  (select coalesce(max(coalesce(s.peak_valuation, public.save_peak_valuation(s.state))), 0)::bigint
                        from public.saves s),

    'boardEntries',   (select count(*) from public.leaderboard_entries),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;


-- ═══ The daily snapshot follows the correction ══════════════════════════════
-- `pro_paid` in admin_daily was the same undercount, and a stored series is
-- worse than a wrong tile: it keeps the wrong number after the bug is fixed.
-- Today's row is rewritten on every console load, so the correction takes hold
-- from now; the history before it stays as it was recorded and is not
-- retro-edited, because inventing yesterday's number is the one thing this
-- table's own header refuses to do.
alter table public.admin_daily
  add column if not exists pro_effective  int,
  add column if not exists runs_completed int;

create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, runs_completed, pro_paid, pro_comp, pro_effective, seats,
     chapters_active, saves_alive, players_playing, board_listed, board_queue)
  select
    current_date,
    (select count(*) from public.admin_last_seen()),
    (select count(*) from public.admin_last_seen() s where s.created_at >= current_date),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '1 day'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '7 days'),
    (select count(*) from public.admin_last_seen() s where s.last_seen > now() - interval '30 days'),
    coalesce((select sum(l.started) from public.run_ledger l
               where l.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(g.runs_completed) from public.legacy g), 0),
    (select count(*) from public.admin_access() a where a.paid),
    (select count(*) from public.admin_access() a where a.comp_pro),
    (select count(*) from public.admin_access() a where a.effective_pro),
    (select count(*) from public.chapter_seats),
    (select count(*) from public.chapters c where c.status = 'active'),
    (select count(*) from public.saves s where s.alive),
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
    runs_completed  = excluded.runs_completed,
    pro_paid        = excluded.pro_paid,
    pro_comp        = excluded.pro_comp,
    pro_effective   = excluded.pro_effective,
    seats           = excluded.seats,
    chapters_active = excluded.chapters_active,
    saves_alive     = excluded.saves_alive,
    players_playing = excluded.players_playing,
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;


-- ═══ The directory learns what an account has done ══════════════════════════
-- 0013's version plus the play record, the board name, the honest paid answer
-- and the last-seen stamp. The return type changes, so the function is dropped
-- and rebuilt — the same dance 0013 did for the same reason.
--
-- The play figures come through one lateral per table rather than joins, so an
-- account with three companies stays one row: a join to `saves` here would
-- triple every account in the list and quietly break `count(*) over ()`.
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
  board_handle         text,
  role                 text,
  is_anonymous         boolean,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  last_seen            timestamptz,
  pro                  boolean,
  paid                 boolean,
  effective_pro        boolean,
  access_source        text,
  billing_mismatch     text,
  comp_pro             boolean,
  comp_until           timestamptz,
  comp_note            text,
  chapter              text,
  extra_islands        int,
  extra_year_closes    int,
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
  runs_completed       int,
  best_year            int,
  companies            int,
  companies_alive      int,
  top_valuation        bigint,
  live_valuation       bigint,
  top_company          text,
  board_entries        int,
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
    p.board_handle,
    coalesce(p.role, 'player'),
    coalesce(u.is_anonymous, false),
    u.created_at,
    u.last_sign_in_at,
    coalesce(ls.last_seen, u.last_sign_in_at, u.created_at),
    coalesce(e.pro, false),
    coalesce(ac.paid, false),
    coalesce(ac.effective_pro, false),
    ac.source,
    ac.mismatch,
    coalesce(e.comp_pro, false),
    e.comp_until,
    e.comp_note,
    e.chapter,
    coalesce(e.extra_islands, 0),
    coalesce(e.extra_year_closes, 0),
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
    coalesce(lg.runs_completed, 0),
    coalesce(lg.best_year, 0),
    coalesce(sv.companies, 0),
    coalesce(sv.alive, 0),
    coalesce(sv.top_valuation, 0)::bigint,
    coalesce(sv.live_valuation, 0)::bigint,
    sv.top_company,
    coalesce(bd.entries, 0),
    count(*) over () as total
  from auth.users u
  left join public.profiles p          on p.id = u.id
  left join public.entitlements e      on e.profile_id = u.id
  left join public.billing_customers b on b.profile_id = u.id
  left join public.legacy lg           on lg.profile_id = u.id
  -- Both of these are set-returning functions joined ONCE, not laterally per
  -- row: a lateral here would re-run the whole function for every account in
  -- the page, which is the same table scanned fifty times to answer fifty
  -- questions it could answer in one.
  left join (select * from public.admin_access())    ac on ac.id = u.id
  left join (select * from public.admin_last_seen()) ls on ls.id = u.id
  left join lateral (
    -- Every company this account has founded, folded to one row: how many,
    -- how many alive, the best figure the books ever showed and which company
    -- showed it, and what the live ones are worth together.
    select
      count(*)::int                                            as companies,
      count(*) filter (where sa.alive)::int                     as alive,
      max(coalesce(sa.peak_valuation, public.save_peak_valuation(sa.state)))
                                                                as top_valuation,
      sum(coalesce(sa.valuation, public.save_valuation(sa.state))) filter (where sa.alive)
                                                                as live_valuation,
      (array_agg(sa.company_name
                 order by coalesce(sa.peak_valuation, public.save_peak_valuation(sa.state))
                          desc nulls last))[1]                  as top_company
      from public.saves sa
     where sa.profile_id = u.id
  ) sv on true
  left join lateral (
    select count(*)::int as entries
      from public.leaderboard_entries le
     where le.profile_id = u.id
  ) bd on true
  left join lateral (
    select c.id, c.status, c.source, c.licence
      from public.chapters c
     where c.owner_profile_id = u.id
     order by (c.status = 'active') desc, c.created_at desc
     limit 1
  ) oc on true
  left join public.chapter_seats s     on s.profile_id = u.id
  cross join q
  where q.needle is null
     or u.email ilike '%' || q.needle || '%'
     or p.display_name ilike '%' || q.needle || '%'
     or p.board_handle ilike '%' || q.needle || '%'
     or u.id::text = lower(q.needle)
  order by u.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- ═══ One account's companies, with their figures ════════════════════════════
-- The detail panel listed a company's name, industry and year and stopped
-- short of the only question an operator actually asks about a company, which
-- is what it is worth. `saves.state` is up to a megabyte, so the route must
-- not select it — this function reads the blob in the database and returns the
-- three numbers out of it.
create or replace function public.admin_user_companies(p_profile uuid)
returns table (
  slot           smallint,
  company_name   text,
  industry       text,
  year           int,
  month          smallint,
  stage          smallint,
  alive          boolean,
  ended_by       text,
  valuation      bigint,
  peak_valuation bigint,
  cash           bigint,
  revenue_annual bigint,
  employees      int,
  updated_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.slot,
    s.company_name,
    s.industry,
    s.year,
    s.month,
    s.stage,
    s.alive,
    s.ended_by,
    coalesce(s.valuation, public.save_valuation(s.state), 0)::bigint,
    coalesce(s.peak_valuation, public.save_peak_valuation(s.state), 0)::bigint,
    coalesce(s.cash, public.save_number(s.state, 'stats', 'cash'), 0)::bigint,
    coalesce(s.revenue_annual, public.save_number(s.state, 'stats', 'revenueAnnual'), 0)::bigint,
    s.employees,
    s.updated_at
  from public.saves s
  where s.profile_id = p_profile
  order by s.slot;
$$;


-- ═══ The companies worth looking at ═════════════════════════════════════════
-- The console's own answer to "how is anyone actually doing" — the biggest
-- live companies in the game, by what their books read now, with the account
-- behind each one so the operator can open it.
create or replace function public.admin_top_companies(p_limit int default 10)
returns table (
  profile_id     uuid,
  email          text,
  board_handle   text,
  company_name   text,
  industry       text,
  year           int,
  stage          smallint,
  alive          boolean,
  valuation      bigint,
  peak_valuation bigint,
  updated_at     timestamptz
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    s.profile_id,
    u.email,
    p.board_handle,
    s.company_name,
    s.industry,
    s.year,
    s.stage,
    s.alive,
    coalesce(s.valuation, public.save_valuation(s.state), 0)::bigint,
    coalesce(s.peak_valuation, public.save_peak_valuation(s.state), 0)::bigint,
    s.updated_at
  from public.saves s
  left join auth.users u      on u.id = s.profile_id
  left join public.profiles p on p.id = s.profile_id
  order by coalesce(s.peak_valuation, public.save_peak_valuation(s.state)) desc nulls last,
           s.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;


-- ═══ Where the two billing records disagree ═════════════════════════════════
-- The list behind the mismatch count. Ordered worst-first: an account Stripe
-- is charging that has no Pro is a player being taken money from for nothing,
-- and it comes before an account holding Pro nobody is being charged for.
create or replace function public.admin_billing_mismatches(p_limit int default 50)
returns table (
  id                  uuid,
  email               text,
  display_name        text,
  kind                text,
  entitlement_pro     boolean,
  subscription_status text,
  plan                text,
  current_period_end  timestamptz,
  has_customer        boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    a.id,
    u.email,
    p.display_name,
    a.mismatch,
    a.ent_pro,
    b.subscription_status,
    b.plan,
    b.current_period_end,
    (b.profile_id is not null)
  from public.admin_access() a
  left join auth.users u               on u.id = a.id
  left join public.profiles p          on p.id = a.id
  left join public.billing_customers b on b.profile_id = a.id
  where a.mismatch is not null
  order by (a.mismatch = 'stripe-not-granted') desc, u.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;


-- ═══ A board name that can be changed ═══════════════════════════════════════
-- `leaderboard_entries.founder_display_name` is a copy of the handle, taken at
-- submission. That was correct while a handle was claimed once and kept
-- forever; it stops being correct the moment the player can change it, because
-- the rows they already hold would keep a name they no longer answer to — and
-- the screen finds "your" row by comparing the two strings, so their own entry
-- would stop being highlighted as theirs.
--
-- `security definer` because the writer is the PLAYER, through their own
-- session and their own RLS policy on `profiles`; nothing in 0002 lets that
-- session touch an entry row, and nothing should. The trigger carries the
-- rename across on the player's behalf and can do nothing else: it writes one
-- column, on rows already belonging to the profile being renamed.
--
-- The pool constraint on both columns is the same regex, so a rename that
-- passes on `profiles` cannot fail on `leaderboard_entries`.
create or replace function public.sync_board_handle_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.board_handle is not null
     and new.board_handle is distinct from old.board_handle then
    update public.leaderboard_entries
       set founder_display_name = new.board_handle
     where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_board_handle_rename on public.profiles;
create trigger profiles_board_handle_rename
  after update of board_handle on public.profiles
  for each row execute function public.sync_board_handle_rename();

-- Trigger plumbing, never called directly — the 0009 treatment.
revoke execute on function public.sync_board_handle_rename() from public, anon, authenticated;


-- ═══ Grants — revoke first, then exactly one role ═══════════════════════════
-- The three `save_*` readers are pure functions over a jsonb value the caller
-- already holds, so they are harmless by construction — but they are only ever
-- called from the functions below, and a function nobody needs to call is a
-- function nobody should be able to.
revoke execute on function public.save_number(jsonb, text[])        from public, anon, authenticated;
revoke execute on function public.save_valuation(jsonb)             from public, anon, authenticated;
revoke execute on function public.save_peak_valuation(jsonb)        from public, anon, authenticated;
revoke execute on function public.admin_access()                    from public, anon, authenticated;
revoke execute on function public.admin_stats()                     from public, anon, authenticated;
revoke execute on function public.admin_capture_daily()             from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, int, int)  from public, anon, authenticated;
revoke execute on function public.admin_user_companies(uuid)        from public, anon, authenticated;
revoke execute on function public.admin_top_companies(int)          from public, anon, authenticated;
revoke execute on function public.admin_billing_mismatches(int)     from public, anon, authenticated;

grant execute on function public.save_number(jsonb, text[])         to service_role;
grant execute on function public.save_valuation(jsonb)              to service_role;
grant execute on function public.save_peak_valuation(jsonb)         to service_role;
grant execute on function public.admin_access()                     to service_role;
grant execute on function public.admin_stats()                      to service_role;
grant execute on function public.admin_capture_daily()              to service_role;
grant execute on function public.admin_list_users(text, int, int)   to service_role;
grant execute on function public.admin_user_companies(uuid)         to service_role;
grant execute on function public.admin_top_companies(int)           to service_role;
grant execute on function public.admin_billing_mismatches(int)      to service_role;
