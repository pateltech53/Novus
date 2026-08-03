-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Chapters — the seat feature the chapter licences were waiting for
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0003's header promised: "They land with the seat-code feature, not before."
-- This is that feature. A chapter is 35 or 100 seats bought by one adult — a
-- teacher, a club lead, a school — as a yearly Stripe subscription, and handed
-- to students from an admin console at /chapter. Two ways to hand a seat out:
--
--   · REGISTER — the admin types (or pastes) email + password rows and the
--     accounts are created on the spot. For classrooms that use school-issued
--     addresses and want to hand out printed credentials.
--   · INVITE — the admin types emails (and optionally names); each address
--     gets an account with a random password and the existing password-reset
--     email, which for a brand-new account is simply "set your password".
--     No new email machinery: the recovery link the app already sends is the
--     invitation.
--
-- Both paths end the same way: a row in `chapter_seats` and
-- `entitlements.chapter` set on that player, which lib/monetization.ts already
-- treats as Pro for the year. Nothing else about the player changes — their
-- saves, their board entries and their scores are their own, per Brand Law 4.
--
-- ── Who writes what ────────────────────────────────────────────────────────
--
-- The browser writes NOTHING here. Seats are created by app/api/chapter/* on
-- the service role, after the route has proved the caller owns the chapter,
-- because seat creation also grants an entitlement — and 0001's position that
-- the client never writes entitlements extends to anything that implies one.
-- The owner may SELECT their own chapter and its roster (that is the admin
-- screen), and nobody else may read either table at all.
--
-- ── On the emails in chapter_seats ─────────────────────────────────────────
--
-- 0004 declined to mirror auth.users.email into public tables because no query
-- needed it. This table is the query that needs it: a roster the admin manages
-- BY address — invite, resend, remove — cannot be run against a table the
-- admin cannot read. So the address the admin typed is stored on the seat row,
-- readable only by that chapter's owner, and deleted with the seat. It is the
-- admin's own input handed back to them, not a copy of the auth record.


-- ═══ chapters ═══════════════════════════════════════════════════════════════
-- One row per licence sold. Created and updated by the Stripe webhook — the
-- same signed call that grants every other paid entitlement — never by a
-- route a browser can influence beyond paying for it.
create table public.chapters (
  id                     uuid primary key default gen_random_uuid(),

  -- The buyer. The one identity allowed to run the admin console.
  owner_profile_id       uuid not null references public.profiles(id) on delete cascade,

  -- Which licence, in lib/monetization.ts vocabulary. `seats` is denormalised
  -- from it so the cap trigger below does not need application code to know
  -- what a licence means — and so a future licence size is one row, not a
  -- migration of a check constraint.
  licence                text not null check (licence in ('chapter_35','chapter_100')),
  seats                  int  not null check (seats between 1 and 500),

  -- The subscription behind the licence, and Stripe's word on its state.
  -- `active` is derived by the webhook via the same grantsAccess() map the
  -- Pro subscription uses, so "past_due keeps access" holds for classrooms
  -- exactly as it does for players.
  stripe_subscription_id text not null unique,
  status                 text not null default 'active' check (status in ('active','lapsed')),
  current_period_end     timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger chapters_touch
  before update on public.chapters
  for each row execute function public.touch_updated_at();

-- The admin console asks "my chapter" on every load; the webhook asks by
-- subscription id (already unique above).
create index chapters_owner_idx on public.chapters (owner_profile_id);


-- ═══ chapter_seats ══════════════════════════════════════════════════════════
-- One row per seat handed out. The row IS the seat: counting them against
-- chapters.seats is the cap, deleting one frees it, and every row has a real
-- auth user behind it — both the register and the invite path create the
-- account before the seat, so there is no "pending" state that can dangle.
create table public.chapter_seats (
  id             uuid primary key default gen_random_uuid(),
  chapter_id     uuid not null references public.chapters(id) on delete cascade,

  -- The player in the seat. `unique` because entitlements.chapter is a single
  -- value: one person in two chapters would make revocation ambiguous, and a
  -- second seat grants nothing the first did not. Cascades with the account,
  -- so deleting a player frees their seat rather than wedging it.
  profile_id     uuid not null unique references public.profiles(id) on delete cascade,

  -- Normalised (lowercased, trimmed) before insert. Unique per chapter so the
  -- roster cannot hold the same address twice, and so "invite again" is a
  -- resend rather than a second seat.
  email          text not null check (length(email) between 3 and 254),

  -- What the admin typed, if anything. The player's own display_name belongs
  -- to the player; this column is the roster label and never overwrites it
  -- after account creation.
  seat_name      text check (length(btrim(seat_name)) between 1 and 24),

  -- How the seat was filled: credentials typed by the admin, or an emailed
  -- set-password link. Display only — both kinds behave identically.
  origin         text not null check (origin in ('registered','invited')),

  -- When the set-password email last went out, so the console can say "sent
  -- Tuesday" beside RESEND instead of nothing. Null for registered seats
  -- until the admin sends one (RESEND works for those too — it is the same
  -- reset email every account may ask for).
  invite_sent_at timestamptz,

  created_at     timestamptz not null default now(),

  unique (chapter_id, email)
);

create index chapter_seats_chapter_idx on public.chapter_seats (chapter_id);


-- ═══ The cap ════════════════════════════════════════════════════════════════
-- 35 seats is 35 rows. Enforced in the database rather than the route because
-- two admins (or one admin's two tabs) can insert concurrently, and a check
-- that reads-then-writes in Node is a cap that leaks under exactly that race.
-- The `for update` lock on the chapter row serialises inserts per chapter;
-- different chapters never wait on each other.
--
-- Counting >= rather than > means a licence downgraded below its current
-- roster (100 → 35 through the billing portal) keeps every seat it has and
-- refuses new ones until the roster is back under the cap — seats are never
-- silently revoked by a billing change.
--
-- `security definer` because the trigger runs as whoever is inserting, and
-- under RLS a non-service caller cannot lock the chapter row (FOR UPDATE
-- needs an UPDATE policy nobody has) — the cap check would fail with the
-- wrong error before RLS could refuse the write with the right one. As
-- definer the count is always over the real rows, and an unauthorised insert
-- still dies where it should: on the table's own (absent) INSERT policy.
create or replace function public.enforce_chapter_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cap int;
begin
  select c.seats into cap
    from public.chapters c
   where c.id = new.chapter_id
     for update;

  if cap is null then
    raise exception 'chapter % does not exist', new.chapter_id;
  end if;

  if (select count(*) from public.chapter_seats s where s.chapter_id = new.chapter_id) >= cap then
    raise exception 'chapter is full: all % seats are taken', cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger chapter_seats_cap
  before insert on public.chapter_seats
  for each row execute function public.enforce_chapter_seat_cap();


-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
-- The owner reads their chapter and its roster — that is the admin screen.
-- There are deliberately NO insert/update/delete policies: every write goes
-- through app/api/chapter/* on the service role, where the seat cap, the
-- account creation and the entitlement grant happen together or not at all.
-- Members get nothing here; their seat reaches them as entitlements.chapter,
-- which they can already read under 0001's policy.

alter table public.chapters      enable row level security;
alter table public.chapter_seats enable row level security;

create policy "chapters: owner reads" on public.chapters
  for select to authenticated
  using (owner_profile_id = (select auth.uid()));

create policy "chapter_seats: owner reads" on public.chapter_seats
  for select to authenticated
  using (exists (
    select 1 from public.chapters c
     where c.id = chapter_id
       and c.owner_profile_id = (select auth.uid())
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- Grant functions — service role only, like everything in 0003
-- ═══════════════════════════════════════════════════════════════════════════

-- ── One seat's entitlement ──────────────────────────────────────────────────
-- Upserts because a player may have an entitlements row already (a bought
-- industry pack, a lapsed Pro). The seat sets `chapter` and touches nothing
-- else — one-time purchases survive joining a classroom exactly as they
-- survive a cancelled subscription.
create or replace function public.grant_chapter_seat(
  p_profile uuid,
  p_licence text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, chapter)
  values (p_profile, p_licence)
  on conflict (profile_id) do update
    set chapter = excluded.chapter;
$$;

-- ── …and taking it back ─────────────────────────────────────────────────────
-- Removing a seat clears `chapter` and only `chapter`. A player who also pays
-- for Pro themselves keeps it; a player who bought packs keeps those.
create or replace function public.revoke_chapter_seat(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.entitlements
     set chapter = null
   where profile_id = p_profile;
$$;

-- ── The whole roster at once ────────────────────────────────────────────────
-- The webhook's tool: a licence that lapses (or resumes, or changes size
-- through the billing portal) moves every member in one statement instead of
-- N round trips that can be interrupted halfway. `p_active = true` also
-- repairs missing entitlement rows, so a member whose row was somehow lost
-- gets it back on the next renewal event rather than never.
create or replace function public.set_chapter_access(
  p_chapter uuid,
  p_active  boolean
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_licence text;
begin
  select c.licence into v_licence from public.chapters c where c.id = p_chapter;
  if v_licence is null then
    raise exception 'chapter % does not exist', p_chapter;
  end if;

  if p_active then
    insert into public.entitlements (profile_id, chapter)
    select s.profile_id, v_licence
      from public.chapter_seats s
     where s.chapter_id = p_chapter
    on conflict (profile_id) do update
      set chapter = excluded.chapter;
  else
    update public.entitlements e
       set chapter = null
      from public.chapter_seats s
     where s.chapter_id = p_chapter
       and e.profile_id = s.profile_id;
  end if;
end;
$$;

-- ── auth.users, by address ──────────────────────────────────────────────────
-- The invite path has to ask "does this email already have an account" so an
-- existing player can be given a seat instead of a colliding second account.
-- The auth schema is not reachable over PostgREST, so this is a definer
-- function — which is exactly why it is revoked from everyone below: callable
-- by a player, it is an account-existence oracle over a database of children,
-- the precise thing /api/auth/reset goes out of its way not to be.
create or replace function public.auth_user_id_for_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public, pg_temp
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and coalesce(u.is_anonymous, false) is false
   limit 1;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC. Revoke first, then
-- grant back to exactly one role — the 0003/0005 pattern, for the same reason.
revoke execute on function public.enforce_chapter_seat_cap()            from public, anon, authenticated;
revoke execute on function public.grant_chapter_seat(uuid, text)        from public, anon, authenticated;
revoke execute on function public.revoke_chapter_seat(uuid)             from public, anon, authenticated;
revoke execute on function public.set_chapter_access(uuid, boolean)     from public, anon, authenticated;
revoke execute on function public.auth_user_id_for_email(text)          from public, anon, authenticated;

grant execute on function public.grant_chapter_seat(uuid, text)         to service_role;
grant execute on function public.revoke_chapter_seat(uuid)              to service_role;
grant execute on function public.set_chapter_access(uuid, boolean)      to service_role;
grant execute on function public.auth_user_id_for_email(text)           to service_role;
