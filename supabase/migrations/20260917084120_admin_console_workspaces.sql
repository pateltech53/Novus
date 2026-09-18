-- Operator workspaces use service-only, invoker-security views. Filtering,
-- sorting and counting now happen BEFORE pagination, so a paying account
-- beyond the first 200 rows is visible. No new client role can read a view;
-- all HTTP access still proves the operator session through adminGate.
begin;
-- Invoker views need only these auth metadata columns. Never grant access to
-- password hashes, recovery tokens or other authentication credentials.
grant usage on schema auth to service_role;
grant select (id, email, is_anonymous, created_at, last_sign_in_at) on auth.users to service_role;
create or replace view public.admin_directory
(id, email, display_name, board_handle, role, is_anonymous, created_at, last_sign_in_at, last_seen, pro, paid, effective_pro, access_source, billing_mismatch, comp_pro, comp_until, comp_note, chapter, extra_islands, extra_year_closes, industry_packs, intent, subscription_status, plan, current_period_end, cancel_at_period_end, owns_chapter_id, owns_chapter_status, owns_chapter_source, owns_chapter_licence, seat_chapter_id, runs_completed, best_year, companies, companies_alive, top_valuation, live_valuation, top_company, board_entries)
with (security_invoker = true) as
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
    coalesce(ac.comp_pro, false),
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
    coalesce(bd.entries, 0)
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
     where c.owner_profile_id = u.id and c.deleted_at is null
     order by (c.status = 'active') desc, c.created_at desc
     limit 1
  ) oc on true
  left join public.chapter_seats s     on s.profile_id = u.id;

create or replace view public.admin_enterprises with (security_invoker = true) as
select c.id, c.owner_profile_id, c.name, c.organization_type, c.contact_name,
       c.contact_email, c.licence, c.seats, c.status, c.source,
       c.current_period_end, c.created_at, u.email as owner_email,
       coalesce(roster.occupied, 0) as occupied,
       coalesce(roster.pending, 0) as pending,
       greatest(0, c.seats - coalesce(roster.occupied, 0)) as available
from public.chapters c
left join auth.users u on u.id = c.owner_profile_id
left join lateral (
  select count(*)::int as occupied,
         count(*) filter (where case when setup.profile_id is not null
           then setup.completed_at is null
           else cs.created_by_invite and cs.claimed_at is null end)::int as pending
  from public.chapter_seats cs
  left join public.chapter_account_setup setup on setup.profile_id = cs.profile_id
  where cs.chapter_id = c.id
) roster on true
where c.deleted_at is null;

revoke all on public.admin_directory, public.admin_enterprises from public, anon, authenticated;
grant select on public.admin_directory, public.admin_enterprises to service_role;
create index if not exists admin_audit_created_id_idx on public.admin_audit (created_at desc, id desc);
commit;
