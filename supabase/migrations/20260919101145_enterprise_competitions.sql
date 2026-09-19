-- Enterprise administrators, verified timed competitions and consumable run tickets.
-- All writes below are service-only. HTTP handlers authenticate and scope callers;
-- RLS independently prevents direct access to other enterprises or reward writes.
create schema if not exists novus_private;
revoke all on schema novus_private from public;
grant usage on schema novus_private to authenticated, service_role;

create table public.chapter_admins (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  profile_id uuid references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(chapter_id, email), unique(chapter_id, profile_id),
  check ((profile_id is null) = (accepted_at is null))
);
create index chapter_admins_profile_idx on public.chapter_admins(profile_id);
alter table public.chapter_admins enable row level security;

create function novus_private.manages_chapter(p_chapter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chapters c where c.id = p_chapter and c.deleted_at is null
    and (c.owner_profile_id = auth.uid() or exists (
      select 1 from public.chapter_admins a where a.chapter_id=c.id and a.profile_id=auth.uid()
    ))
  );
$$;
revoke all on function novus_private.manages_chapter(uuid) from public, anon;
grant execute on function novus_private.manages_chapter(uuid) to authenticated, service_role;
create policy "chapters: managers read" on public.chapters for select to authenticated
  using (novus_private.manages_chapter(id));
create policy "chapter_seats: managers read" on public.chapter_seats for select to authenticated
  using (novus_private.manages_chapter(chapter_id));
create policy "chapter_admins: managers read" on public.chapter_admins for select to authenticated
  using (novus_private.manages_chapter(chapter_id));
grant select on public.chapter_admins to authenticated;
grant all on public.chapter_admins to service_role;

alter table public.entitlements add column run_tickets integer not null default 0 check (run_tickets >= 0);

create table public.chapter_competitions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  title text not null check(length(btrim(title)) between 1 and 100),
  description text not null default '' check(length(description)<=1000),
  starts_at timestamptz not null, ends_at timestamptz not null,
  enrollment text not null check(enrollment in ('automatic','opt_in')),
  audience text not null check(audience in ('all','selected')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz, cancelled_at timestamptz,
  check(ends_at > starts_at)
);
create index chapter_competitions_chapter_idx on public.chapter_competitions(chapter_id, starts_at desc);
create index chapter_competitions_due_idx on public.chapter_competitions(ends_at) where settled_at is null and cancelled_at is null;
create table public.competition_audience (
  competition_id uuid not null references public.chapter_competitions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key(competition_id, profile_id)
);
create table public.competition_prizes (
  competition_id uuid not null references public.chapter_competitions(id) on delete cascade,
  place integer not null check(place between 1 and 100),
  kind text not null check(kind in ('chest','runs')),
  quantity integer not null check(quantity between 1 and 100),
  tier integer check(tier between 1 and 5),
  primary key(competition_id,place),
  check ((kind='chest' and tier is not null) or (kind='runs' and tier is null))
);
create table public.competition_participants (
  competition_id uuid not null references public.chapter_competitions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key(competition_id,profile_id)
);
create table public.company_starts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  seed bigint not null check(seed between 0 and 4294967295),
  run_id text not null,
  industry text not null,
  tutorial boolean not null,
  pro boolean not null,
  started_at timestamptz not null default clock_timestamp(),
  local_day date not null,
  ticket_used boolean not null default false,
  primary key(profile_id,run_id), unique(profile_id,request_id)
);
create table public.competition_scores (
  competition_id uuid not null,
  profile_id uuid not null,
  run_id text not null,
  company_name text not null,
  peak_valuation bigint not null check(peak_valuation>=0),
  achieved_at timestamptz not null,
  tape_hash text not null,
  primary key(competition_id,profile_id),
  foreign key(competition_id,profile_id) references public.competition_participants(competition_id,profile_id) on delete cascade
);
create table public.competition_awards (
  competition_id uuid not null references public.chapter_competitions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  place integer not null, kind text not null, quantity integer not null, tier integer,
  granted_at timestamptz not null default clock_timestamp(),
  primary key(competition_id,profile_id), unique(competition_id,place)
);
-- Eligibility is captured at founding, so even equal-resolution timestamps
-- cannot make a later opt-in apply to a company that already exists.
create table public.competition_company_entries (
 competition_id uuid not null, profile_id uuid not null, run_id text not null,
 primary key(competition_id,profile_id,run_id),
 foreign key(competition_id,profile_id) references public.competition_participants(competition_id,profile_id) on delete cascade,
 foreign key(profile_id,run_id) references public.company_starts(profile_id,run_id) on delete cascade
);
create index competition_company_entries_run_idx on public.competition_company_entries(profile_id,run_id);
-- No client policies: these resources only travel through scoped HTTP endpoints.
do $$ declare t text; begin
  foreach t in array array['chapter_competitions','competition_audience','competition_prizes','competition_participants','company_starts','competition_scores','competition_awards','competition_company_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create index competition_audience_profile_idx on public.competition_audience(profile_id);
create index competition_participants_profile_idx on public.competition_participants(profile_id);
create index competition_awards_profile_idx on public.competition_awards(profile_id);

create function novus_private.accept_chapter_admin(p_invitation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p_profile uuid := auth.uid(); a public.chapter_admins%rowtype; c public.chapters%rowtype;
begin
  if p_profile is null then raise exception 'Sign in to accept this invitation'; end if;
  select * into a from public.chapter_admins where id=p_invitation;
  select * into c from public.chapters where id=a.chapter_id for update;
  if not found or c.deleted_at is not null or c.status<>'active' then raise exception 'Enterprise is unavailable'; end if;
  select * into a from public.chapter_admins where id=p_invitation for update;
  if not found or not exists(select 1 from auth.users u where u.id=p_profile
    and lower(u.email)=a.email and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)) then
    raise exception 'Sign in with the verified invited email address';
  end if;
  if a.profile_id is not null and a.profile_id<>p_profile then raise exception 'Invitation already accepted'; end if;
  update public.chapter_admins set profile_id=p_profile,accepted_at=coalesce(accepted_at,clock_timestamp()) where id=a.id;
  return a.chapter_id;
end $$;

revoke all on function novus_private.accept_chapter_admin(uuid) from public,anon;
grant execute on function novus_private.accept_chapter_admin(uuid) to authenticated;
create function public.accept_chapter_admin(p_invitation uuid) returns uuid language sql set search_path='' as $$
 select novus_private.accept_chapter_admin(p_invitation);
$$;
revoke all on function public.accept_chapter_admin(uuid) from public,anon;
grant execute on function public.accept_chapter_admin(uuid) to authenticated;

create function public.join_chapter_competition(p_profile uuid,p_competition uuid)
returns void language plpgsql set search_path = '' as $$
declare c public.chapter_competitions%rowtype;
begin
  select * into c from public.chapter_competitions where id=p_competition for share;
  if not found or c.cancelled_at is not null or c.ends_at<=clock_timestamp()
    or not exists(select 1 from public.chapter_seats s join public.chapters ch on ch.id=s.chapter_id
      where s.profile_id=p_profile and s.chapter_id=c.chapter_id and ch.deleted_at is null and ch.status='active')
    or (c.audience='selected' and not exists(select 1 from public.competition_audience a where a.competition_id=c.id and a.profile_id=p_profile)) then
    raise exception 'Competition is unavailable';
  end if;
  insert into public.competition_participants(competition_id,profile_id) values(c.id,p_profile) on conflict do nothing;
end $$;

-- Registration and ticket consumption share one transaction and a per-player lock.
-- A retry reuses its request UUID and never spends another daily start or ticket.
create function public.register_company_start(p_profile uuid,p_request uuid,p_seed bigint,p_run text,
 p_industry text,p_tutorial boolean,p_pro boolean,p_day date,p_local_started integer)
returns jsonb language plpgsql set search_path = '' as $$
declare r public.company_starts%rowtype; used integer; allowance integer; ticket boolean:=false; c record;
begin
  -- Lock competitions before the player, matching settlement lock order.
  perform cmp.id from public.chapter_competitions cmp join public.chapter_seats s on s.chapter_id=cmp.chapter_id
    where s.profile_id=p_profile and cmp.starts_at<=clock_timestamp() and cmp.ends_at>clock_timestamp()
    and cmp.cancelled_at is null order by cmp.id for share of cmp;
  perform 1 from public.profiles where id=p_profile for update;
  if not found then raise exception 'Account is unavailable'; end if;
  select * into r from public.company_starts where profile_id=p_profile and request_id=p_request;
  if found then return to_jsonb(r)||jsonb_build_object('tickets',(select run_tickets from public.entitlements where profile_id=p_profile)); end if;
  if p_day<(clock_timestamp() at time zone 'utc')::date-1 or p_day>(clock_timestamp() at time zone 'utc')::date+1 then raise exception 'Check your device date'; end if;
  allowance:=coalesce(public.player_allowance(p_profile),1);
  select case when day=p_day then started else 0 end into used from public.run_ledger where profile_id=p_profile for update;
  used:=greatest(coalesce(used,0),greatest(p_local_started,0),
    (select count(*)::integer from public.company_starts where profile_id=p_profile and local_day=p_day and not ticket_used));
  if used>=allowance then
    update public.entitlements set run_tickets=run_tickets-1 where profile_id=p_profile and run_tickets>0;
    if not found then raise exception 'No starts or run tickets remaining today'; end if;
    ticket:=true;
  end if;
  insert into public.run_ledger(profile_id,day,started) values(p_profile,p_day,used+case when ticket then 0 else 1 end)
    on conflict(profile_id) do update set day=excluded.day,started=excluded.started;
  insert into public.company_starts(profile_id,request_id,seed,run_id,industry,tutorial,pro,local_day,ticket_used)
    values(p_profile,p_request,p_seed,p_run,p_industry,p_tutorial,p_pro,p_day,ticket) returning * into r;
  for c in select co.* from public.chapter_competitions co join public.chapter_seats s on s.chapter_id=co.chapter_id
    join public.chapters ch on ch.id=co.chapter_id
    where s.profile_id=p_profile and ch.status='active' and ch.deleted_at is null
    and co.starts_at<=r.started_at and co.ends_at>r.started_at and co.cancelled_at is null
    and co.enrollment='automatic' and (co.audience='all' or exists(select 1 from public.competition_audience a where a.competition_id=co.id and a.profile_id=p_profile))
  loop
    insert into public.competition_participants(competition_id,profile_id,joined_at) values(c.id,p_profile,r.started_at) on conflict do nothing;
  end loop;
  insert into public.competition_company_entries(competition_id,profile_id,run_id)
    select co.id,p_profile,r.run_id from public.chapter_competitions co
    join public.competition_participants p on p.competition_id=co.id and p.profile_id=p_profile
    join public.chapter_seats s on s.chapter_id=co.chapter_id and s.profile_id=p_profile
    join public.chapters ch on ch.id=co.chapter_id
    where ch.status='active' and ch.deleted_at is null and co.cancelled_at is null
    and co.starts_at<=r.started_at and co.ends_at>r.started_at and p.joined_at<=r.started_at
    and (co.audience='all' or exists(select 1 from public.competition_audience a where a.competition_id=co.id and a.profile_id=p_profile))
    on conflict do nothing;
  return to_jsonb(r)||jsonb_build_object('tickets',coalesce((select run_tickets from public.entitlements where profile_id=p_profile),0));
end $$;

create function public.record_competition_score(p_profile uuid,p_run text,p_name text,p_peak bigint,p_hash text)
returns integer language plpgsql set search_path = '' as $$
declare r public.company_starts%rowtype; c record; n integer:=0; stamp timestamptz;
begin
  select * into r from public.company_starts where profile_id=p_profile and run_id=p_run;
  if not found then return 0; end if;
  for c in select co.* from public.chapter_competitions co
    join public.competition_participants p on p.competition_id=co.id and p.profile_id=p_profile
    join public.competition_company_entries entry on entry.competition_id=co.id and entry.profile_id=p_profile and entry.run_id=p_run
    join public.chapter_seats s on s.chapter_id=co.chapter_id and s.profile_id=p_profile
    join public.chapters ch on ch.id=co.chapter_id
    where r.started_at>=co.starts_at and r.started_at>=p.joined_at and r.started_at<co.ends_at
    and co.cancelled_at is null and co.settled_at is null and ch.deleted_at is null
    and (co.audience='all' or exists(select 1 from public.competition_audience a where a.competition_id=co.id and a.profile_id=p_profile))
    order by co.id for share of co
  loop
    stamp:=clock_timestamp();
    if stamp>=c.ends_at then continue; end if;
    insert into public.competition_scores as s(competition_id,profile_id,run_id,company_name,peak_valuation,achieved_at,tape_hash)
      values(c.id,p_profile,p_run,left(p_name,100),p_peak,stamp,p_hash)
      on conflict(competition_id,profile_id) do update set run_id=excluded.run_id,company_name=excluded.company_name,
        peak_valuation=excluded.peak_valuation,achieved_at=excluded.achieved_at,tape_hash=excluded.tape_hash
        where excluded.peak_valuation>s.peak_valuation;
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.settle_chapter_competitions()
returns integer language plpgsql set search_path = '' as $$
declare c record; winner record; i integer; n integer:=0;
begin
  for c in select * from public.chapter_competitions where ends_at<=clock_timestamp() and settled_at is null and cancelled_at is null
    order by ends_at limit 100 for update skip locked
  loop
    for winner in
      with ranked as (
        select s.*,row_number() over(order by s.peak_valuation desc,s.achieved_at,s.profile_id)::integer place
        from public.competition_scores s join public.chapter_seats seat on seat.profile_id=s.profile_id and seat.chapter_id=c.chapter_id
        where s.competition_id=c.id
      ) select r.profile_id,r.place,p.kind,p.quantity,p.tier from ranked r
        join public.competition_prizes p on p.competition_id=c.id and p.place=r.place
    loop
      insert into public.competition_awards(competition_id,profile_id,place,kind,quantity,tier)
        values(c.id,winner.profile_id,winner.place,winner.kind,winner.quantity,winner.tier) on conflict do nothing;
      if not found then continue; end if;
      if winner.kind='runs' then
        insert into public.entitlements(profile_id,run_tickets) values(winner.profile_id,winner.quantity)
          on conflict(profile_id) do update set run_tickets=public.entitlements.run_tickets+excluded.run_tickets;
      else
        for i in 1..winner.quantity loop
          insert into public.briefcases(user_id,tier,source,preset,upgrade_path)
            values(winner.profile_id,winner.tier,'competition:'||c.id||':place:'||winner.place,'prize',array[winner.tier,winner.tier,winner.tier]);
        end loop;
      end if;
    end loop;
    update public.chapter_competitions set settled_at=clock_timestamp() where id=c.id;
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.create_chapter_competition(p_chapter uuid,p_actor uuid,p_spec jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare cid uuid; ch public.chapters%rowtype; item jsonb; member uuid;
begin
  select * into ch from public.chapters where id=p_chapter for update;
  if not found or ch.deleted_at is not null or ch.status<>'active' or
    (ch.owner_profile_id<>p_actor and not exists(select 1 from public.chapter_admins where chapter_id=ch.id and profile_id=p_actor)) then
    raise exception 'Enterprise is unavailable'; end if;
  if (p_spec->>'startsAt')::timestamptz<clock_timestamp() then raise exception 'Choose a future start time'; end if;
  insert into public.chapter_competitions(chapter_id,title,description,starts_at,ends_at,enrollment,audience,created_by)
    values(ch.id,p_spec->>'title',coalesce(p_spec->>'description',''),(p_spec->>'startsAt')::timestamptz,
      (p_spec->>'endsAt')::timestamptz,p_spec->>'enrollment',p_spec->>'audience',p_actor) returning id into cid;
  for item in select * from jsonb_array_elements(p_spec->'prizes') loop
    insert into public.competition_prizes(competition_id,place,kind,quantity,tier)
      values(cid,(item->>'place')::integer,item->>'kind',(item->>'quantity')::integer,(item->>'tier')::integer);
  end loop;
  if p_spec->>'audience'='selected' then
    if jsonb_array_length(p_spec->'students')=0 then raise exception 'Select at least one student'; end if;
    for member in select value::uuid from jsonb_array_elements_text(p_spec->'students') loop
      if not exists(select 1 from public.chapter_seats where chapter_id=ch.id and profile_id=member) then raise exception 'Student is not in this enterprise'; end if;
      insert into public.competition_audience values(cid,member) on conflict do nothing;
    end loop;
  end if;
  return cid;
end $$;

-- Scoped summaries never expose a student's save blob or global account data.
create function public.chapter_student_progress(p_chapter uuid,p_query text default '',p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable set search_path = '' as $$
 with members as (
  select s.profile_id,s.email,coalesce(s.seat_name,p.display_name) name,s.created_at,
    greatest(u.last_seen,(select max(updated_at) from public.saves where profile_id=s.profile_id),
      (select updated_at from public.preferences where profile_id=s.profile_id)) last_active,
    coalesce(l.runs_completed,0) runs_completed,coalesce(l.best_year,0) best_year,
    (select count(*) from public.saves where profile_id=s.profile_id) companies,
    coalesce((select max(peak_valuation) from public.saves where profile_id=s.profile_id),0) peak_valuation
  from public.chapter_seats s join public.profiles p on p.id=s.profile_id
  join public.admin_last_seen() u on u.id=s.profile_id left join public.legacy l on l.profile_id=s.profile_id
  where s.chapter_id=p_chapter and (p_query='' or s.email ilike '%'||p_query||'%' or coalesce(s.seat_name,p.display_name) ilike '%'||p_query||'%')
 ), page as (select * from members order by name,profile_id limit least(greatest(p_limit,1),100) offset greatest(p_offset,0))
 select jsonb_build_object('total',(select count(*) from members),'students',coalesce((select jsonb_agg(to_jsonb(page)||jsonb_build_object('companiesDetail',
   coalesce((select jsonb_agg(jsonb_build_object('name',v.company_name,'industry',v.industry,'year',v.year,'month',v.month,'alive',v.alive,
     'valuation',v.valuation,'peakValuation',v.peak_valuation,'updatedAt',v.updated_at) order by v.slot) from public.saves v where v.profile_id=page.profile_id),'[]'::jsonb))) from page),'[]'::jsonb));
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('join_chapter_competition','register_company_start','record_competition_score','settle_chapter_competitions','create_chapter_competition','chapter_student_progress')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
-- Production already has pg_cron. Local SQL suites can run without it.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('novus-enterprise-competition-awards','* * * * *','select public.settle_chapter_competitions()');
  end if;
end $$;

create function public.competition_leaderboard(p_competition uuid,p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
 with ranked as (
  select s.profile_id,coalesce(p.board_handle,'Student '||left(p.id::text,6)) handle,s.company_name,s.peak_valuation,s.achieved_at,
    row_number() over(order by s.peak_valuation desc,s.achieved_at,s.profile_id) place
  from public.competition_scores s join public.profiles p on p.id=s.profile_id
  join public.chapter_competitions c on c.id=s.competition_id
  join public.chapter_seats seat on seat.profile_id=s.profile_id and seat.chapter_id=c.chapter_id
  where s.competition_id=p_competition
 ) select jsonb_build_object('leaders',coalesce((select jsonb_agg(to_jsonb(r)-'profile_id'||jsonb_build_object('isYou',r.profile_id=p_viewer) order by r.place) from ranked r where place<=50),'[]'::jsonb),
   'yourRank',(select place from ranked where profile_id=p_viewer),'rankedCount',(select count(*) from ranked),
   'yourPrize',(select to_jsonb(a)-'profile_id' from public.competition_awards a where a.competition_id=p_competition and a.profile_id=p_viewer));
$$;
revoke all on function public.competition_leaderboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.competition_leaderboard(uuid,uuid) to service_role;

create function public.company_competition_count(p_profile uuid,p_run text)
returns bigint language sql stable set search_path='' as $$
 select count(*) from public.company_starts r join public.competition_participants p on p.profile_id=r.profile_id
 join public.chapter_competitions c on c.id=p.competition_id
 join public.competition_company_entries entry on entry.competition_id=c.id and entry.profile_id=r.profile_id and entry.run_id=r.run_id
 join public.chapter_seats s on s.chapter_id=c.chapter_id and s.profile_id=r.profile_id
 where r.profile_id=p_profile and r.run_id=p_run and r.started_at>=c.starts_at and r.started_at>=p.joined_at
 and r.started_at<c.ends_at and c.ends_at>now() and c.cancelled_at is null and c.settled_at is null;
$$;
revoke all on function public.company_competition_count(uuid,text) from public,anon,authenticated;
grant execute on function public.company_competition_count(uuid,text) to service_role;

create index chapter_admins_invited_by_idx on public.chapter_admins(invited_by);
create index chapter_competitions_creator_idx on public.chapter_competitions(created_by);
create index company_starts_daily_idx on public.company_starts(profile_id,local_day) where not ticket_used;
