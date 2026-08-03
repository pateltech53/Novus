-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 · Custom chapters — a licence sized by the buyer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0007 denormalised `seats` onto the chapter row precisely so that "what a
-- licence means" lived in data rather than in a check constraint. This
-- migration collects on that: `chapter_custom` is a licence whose seat count
-- the buyer typed (the app offers 10–500; the row keeps 0007's own 1–500
-- sanity bound), priced by lib/monetization.ts's customChapterPriceCents and
-- sold through the same checkout, webhook, console and seat machinery as the
-- two fixed sizes. Nothing that reads seats off the row — the cap trigger,
-- set_chapter_access, the console — changes at all.
--
-- Three statements of substance:
--   1. `chapters.licence` admits 'chapter_custom'.
--   2. `entitlements.chapter` admits it too — grant_chapter_seat copies the
--      licence value onto every member, so the two constraints must agree or
--      every seat grant on a custom chapter dies half-done.
--   3. admin_create_comp_chapter learns an optional p_seats, so an operator
--      can comp (or checkout-skip) a custom-sized classroom exactly as they
--      can a 35 or 100.
--
-- The constraint names are the ones Postgres auto-assigns to the inline
-- checks in 0001 and 0007 (<table>_<column>_check) — every database built
-- from this repo has them under those names.

alter table public.chapters
  drop constraint if exists chapters_licence_check;
alter table public.chapters
  add constraint chapters_licence_check
  check (licence in ('chapter_35', 'chapter_100', 'chapter_custom'));

alter table public.entitlements
  drop constraint if exists entitlements_chapter_check;
alter table public.entitlements
  add constraint entitlements_chapter_check
  check (chapter in ('chapter_35', 'chapter_100', 'chapter_custom'));


-- ═══ admin_create_comp_chapter, now size-aware ══════════════════════════════
-- The old three-argument signature is dropped rather than overloaded: two
-- candidates that differ only by a defaulted trailing parameter make every
-- named-argument RPC call ambiguous. (Re-running 0009 on its own would
-- recreate the old signature beside this one; APPLY-ALL runs 0009 → 0011 in
-- order, so it always converges back to this single function.)
--
-- p_seats is REQUIRED for 'chapter_custom' and refused for the fixed
-- licences, whose seat counts are the licence — an operator who could comp a
-- "chapter_35" with 80 seats would put the row and the name in disagreement.
drop function if exists public.admin_create_comp_chapter(uuid, text, timestamptz);

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
    if p_seats is null or p_seats < 1 or p_seats > 500 then
      raise exception 'a custom chapter needs p_seats between 1 and 500'
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

-- Service-role only, exactly as 0009 held the three-argument version.
revoke execute on function public.admin_create_comp_chapter(uuid, text, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.admin_create_comp_chapter(uuid, text, timestamptz, int)
  to service_role;
