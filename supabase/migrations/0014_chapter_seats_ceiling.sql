-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 · Chapters bigger than a classroom
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- `chapters.seats` has been bounded at 500 since 0007, where it was written as
-- a sanity bound rather than a product decision — 0011 says so in as many
-- words: "the row keeps 0007's own 1–500". `CHAPTER_CUSTOM_MAX_SEATS` in
-- lib/monetization.ts then adopted that number as the ceiling on the buyer's
-- own seat field, and the sanity bound quietly became the biggest chapter
-- anybody could buy.
--
-- It is too small. A secondary school putting a year group through the
-- programme, a district running it across campuses, a summer programme with a
-- thousand places — each of them types their real number into the seat field
-- and is told it is invalid. That is the largest cheque on the page being
-- refused by a constraint nobody meant as a limit.
--
-- ── What this changes ──────────────────────────────────────────────────────
--
-- Both database bounds move to 10,000, matching the constant the app now
-- validates against. Two of them, because there are two ways a chapter row is
-- born and each enforces its own limit:
--
--   1. `chapters.seats` — the constraint every write passes through, whether
--      it came from the Stripe webhook or from the console.
--   2. `admin_create_comp_chapter` — its own `p_seats > 500` guard. 0009's
--      rule is that a function which can violate its table's constraint is a
--      500 waiting on a typo; the inverse is just as true, and a function that
--      refuses what the table would accept is a comp'd chapter an operator
--      cannot create.
--
-- The function is replaced at its existing signature, so 0011's revoke/grant
-- still stand and service_role remains the only caller. Everything inside it
-- is 0011's, unchanged, except the two bounds in the one guard.
--
-- ── Why there is still a ceiling ───────────────────────────────────────────
--
-- Removing the bound entirely would be simpler and worse. Seats are priced per
-- seat and charged on the spot, so an unbounded field is one doubled keystroke
-- away from a six-figure invoice, and `chapter_seats_cap` would happily let a
-- 900,000-seat roster fill behind it. 10,000 sits far above any real buyer and
-- far below a pasted phone number, so it now only ever catches mistakes —
-- which is what a sanity bound is for.
--
-- `chapter_seats` is unaffected: the cap trigger counts rows against whatever
-- `chapters.seats` says, so a bigger chapter needs nothing from it.

begin;

alter table public.chapters
  drop constraint if exists chapters_seats_check;

alter table public.chapters
  add constraint chapters_seats_check
  check (seats between 1 and 10000);

create or replace function public.admin_create_comp_chapter(
  p_owner   uuid,
  p_licence text,
  p_until   timestamptz default null,
  p_seats   int default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_seats int := case p_licence when 'chapter_35'  then 35
                                when 'chapter_100' then 100 end;
  v_id uuid;
begin
  if p_licence = 'chapter_custom' then
    if p_seats is null or p_seats < 1 or p_seats > 10000 then
      raise exception 'a custom chapter needs p_seats between 1 and 10000'
        using errcode = '23514';
    end if;
    v_seats := p_seats;
  elsif v_seats is null then
    raise exception 'unknown licence %', p_licence using errcode = '23514';
  elsif p_seats is not null and p_seats <> v_seats then
    raise exception '% is % seats — p_seats is only for chapter_custom', p_licence, v_seats
      using errcode = '23514';
  end if;

  if exists (select 1 from public.chapters c
              where c.owner_profile_id = p_owner and c.status = 'active') then
    raise exception 'already owns an active chapter' using errcode = '23505';
  end if;

  insert into public.chapters
    (owner_profile_id, licence, seats, source, status, current_period_end, stripe_subscription_id)
  values
    (p_owner, p_licence, v_seats, 'comp', 'active', p_until, null)
  returning id into v_id;

  return v_id;
end;
$$;

commit;
