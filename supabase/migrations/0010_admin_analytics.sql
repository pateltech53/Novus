-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 · Admin analytics — cohorts, time series, and the daily snapshot
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The console (0009) answers "what is true right now". This migration answers
-- "how is it going" — signups over time, how many players come back, how many
-- bounce — without collecting anything new about any individual player.
--
-- ── What "last seen" means here ─────────────────────────────────────────────
--
-- auth.users.last_sign_in_at alone UNDERSTATES activity: sessions live in a
-- refresh-token cookie, so a player who returns every day may not "sign in"
-- for weeks. But playing writes rows this schema already has — saves on every
-- sync, preferences and legacy on their own updates — each carrying an
-- updated_at. `last seen` is therefore the greatest of the sign-in stamp and
-- those three, which is the honest approximation available without an event
-- log. (An event log is the thing this schema deliberately refuses to keep:
-- per-player activity history, about children, retained forever — run_ledger's
-- own header says why. Everything below aggregates to counts before it is
-- stored or returned.)
--
-- ── What can and cannot be reconstructed ────────────────────────────────────
--
--   · Signups per day        — exact, from auth.users.created_at.
--   · Board entries per day  — exact, from leaderboard_entries.created_at.
--   · Cohort retention/bounce — honest, from created_at vs last-seen: "was
--     this account seen at least N days after it was made".
--   · Actives per day, runs per day — NOT reconstructable (only the latest
--     timestamp per player exists). So `admin_daily` snapshots today's counts
--     — counts only, no ids — every time the console loads, and the series
--     builds itself from the day this migration lands. Days the console never
--     loads stay null and the charts show the gap rather than inventing data.


-- ═══ admin_daily — one row of COUNTS per day, written lazily ════════════════
-- The console's stats route upserts today's row on every load. No per-player
-- anything: this table could be printed in public without naming a soul,
-- though like every operator surface it is still service-role only.
create table public.admin_daily (
  day             date primary key,

  accounts        int not null,
  new_accounts    int not null,
  active_1d       int not null,
  active_7d       int not null,
  active_30d      int not null,

  -- Today's run starts, summed off run_ledger before its rows roll over.
  runs_started    int not null,

  pro_paid        int not null,
  pro_comp        int not null,
  seats           int not null,
  chapters_active int not null,
  saves_alive     int not null,
  board_listed    int not null,
  board_queue     int not null,

  captured_at     timestamptz not null default now()
);

alter table public.admin_daily enable row level security;
revoke all on public.admin_daily from anon, authenticated;


-- ═══ The last-seen expression, once ═════════════════════════════════════════
-- Every reader below needs the same answer to "when was this account last
-- seen", so it is one definer function rather than four drifting CTEs.
-- Returns non-anonymous accounts only — the analytics population.
create or replace function public.admin_last_seen()
returns table (id uuid, created_at timestamptz, last_seen timestamptz)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    u.id,
    u.created_at,
    greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce((select max(s.updated_at) from public.saves s where s.profile_id = u.id), u.created_at),
      coalesce((select p.updated_at from public.preferences p where p.profile_id = u.id), u.created_at),
      coalesce((select l.updated_at from public.legacy l where l.profile_id = u.id), u.created_at)
    ) as last_seen
  from auth.users u
  where coalesce(u.is_anonymous, false) is false;
$$;


-- ═══ admin_timeseries — the per-day chart data ══════════════════════════════
-- One row per calendar day for the last p_days (7–365, default 60):
--   signups      exact count of accounts created that day
--   submissions  exact count of board entries created that day
--   actives      admin_daily.active_1d for that day — null before tracking
--   runs_started admin_daily.runs_started            — began, or on gap days
create or replace function public.admin_timeseries(p_days int default 60)
returns table (
  day          date,
  signups      bigint,
  submissions  bigint,
  actives      int,
  runs_started int
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with span as (
    select generate_series(
      current_date - (least(greatest(coalesce(p_days, 60), 7), 365) - 1),
      current_date,
      interval '1 day'
    )::date as day
  ),
  signups as (
    select u.created_at::date as day, count(*) as n
      from auth.users u
     where coalesce(u.is_anonymous, false) is false
     group by 1
  ),
  submissions as (
    select e.created_at::date as day, count(*) as n
      from public.leaderboard_entries e
     group by 1
  )
  select
    span.day,
    coalesce(signups.n, 0),
    coalesce(submissions.n, 0),
    d.active_1d,
    d.runs_started
  from span
  left join signups     on signups.day = span.day
  left join submissions on submissions.day = span.day
  left join public.admin_daily d on d.day = span.day
  order by span.day;
$$;


-- ═══ admin_cohorts — retention and bounce by signup week ════════════════════
-- One row per weekly cohort (week starts Monday, date_trunc's rule) over the
-- last p_weeks (default 12):
--   cohort      accounts created that week
--   bounced     never seen again after their first day  (last_seen < +1 day)
--   retained_7  seen at least 7 days after signup       (last_seen ≥ +7 days)
--   retained_30 seen at least 30 days after signup      (last_seen ≥ +30 days)
--
-- The client is expected to grey out windows a cohort has not lived through
-- yet — a cohort three days old has answered none of these questions.
create or replace function public.admin_cohorts(p_weeks int default 12)
returns table (
  week        date,
  cohort      bigint,
  bounced     bigint,
  retained_7  bigint,
  retained_30 bigint
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    date_trunc('week', s.created_at)::date as week,
    count(*) as cohort,
    count(*) filter (where s.last_seen <  s.created_at + interval '1 day')  as bounced,
    count(*) filter (where s.last_seen >= s.created_at + interval '7 days') as retained_7,
    count(*) filter (where s.last_seen >= s.created_at + interval '30 days') as retained_30
  from public.admin_last_seen() s
  where s.created_at >= date_trunc('week', now())
                        - (least(greatest(coalesce(p_weeks, 12), 1), 52) - 1) * interval '1 week'
  group by 1
  order by 1;
$$;


-- ═══ admin_capture_daily — today's counts, upserted ═════════════════════════
-- Runs on every console load. Within a day the numbers only move forward, so
-- last-write-wins is correct; across a reload the row is simply refreshed.
create or replace function public.admin_capture_daily()
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  insert into public.admin_daily as d
    (day, accounts, new_accounts, active_1d, active_7d, active_30d,
     runs_started, pro_paid, pro_comp, seats, chapters_active,
     saves_alive, board_listed, board_queue)
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
    (select count(*) from public.saves s where s.alive),
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
    board_listed    = excluded.board_listed,
    board_queue     = excluded.board_queue,
    captured_at     = now();
$$;


-- ═══ admin_stats learns what "seen" means ═══════════════════════════════════
-- Same shape as 0009 plus two additions, and one correction: the active
-- counts now use last-seen rather than last_sign_in_at alone, which was
-- undercounting every player whose cookie kept them signed in.
--   activeToday — seen in the last 24h
--   activity    — the recency histogram the console charts: seen within 1d,
--                 1–7d, 7–30d, 30–90d, older (exclusive buckets, non-anon)
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
    'savesAlive',     (select count(*) from public.saves s where s.alive),
    'boardListed',    (select count(*) from public.leaderboard_entries l where l.listed),
    'boardQueue',     (select count(*) from public.leaderboard_entries l where l.listed is false)
  );
$$;


-- ═══ Grants — revoke first, then exactly one role ═══════════════════════════
revoke execute on function public.admin_last_seen()        from public, anon, authenticated;
revoke execute on function public.admin_timeseries(int)    from public, anon, authenticated;
revoke execute on function public.admin_cohorts(int)       from public, anon, authenticated;
revoke execute on function public.admin_capture_daily()    from public, anon, authenticated;
revoke execute on function public.admin_stats()            from public, anon, authenticated;

grant execute on function public.admin_last_seen()         to service_role;
grant execute on function public.admin_timeseries(int)     to service_role;
grant execute on function public.admin_cohorts(int)        to service_role;
grant execute on function public.admin_capture_daily()     to service_role;
grant execute on function public.admin_stats()             to service_role;
