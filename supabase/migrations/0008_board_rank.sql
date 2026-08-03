-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 · Board rank — "where am I", and the chapter's own board
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Depends on 0007 (chapters). Two reads the board screen could not answer:
--
--   · A player outside the top 100 saw the board with no highlight and no
--     hint they were on it at all. `my_board_rank` answers "#147 of 2,431"
--     — for the caller, about the caller, and nobody else.
--   · A classroom wants to stand its own members next to each other.
--     `chapter_board` is the same public rows the global board already
--     shows, filtered to the caller's chapter and re-ranked within it.
--
-- Both are `security definer` so they can rank over ALL listed rows (the
-- read policy would otherwise scope the window to what the caller may see —
-- which is also all listed rows, but the definer makes that a fact about the
-- function rather than a coincidence of policy). Both give the caller
-- nothing that is not either already public or already theirs:
--
--   · Only `listed` rows are ranked or returned. The moderation queue stays
--     as invisible here as everywhere else — including the caller's OWN
--     pending entry, deliberately: §9.3's "unlisted is invisible to
--     everyone" has no carve-outs, and this migration does not add one.
--   · `my_board_rank` returns at most the caller's own row.
--   · `chapter_board` returns rows that are on the public board already,
--     to callers who are members of the same chapter.
--
-- Ranking stays computed, never stored — no rank column is added anywhere
-- (docs/LEADERBOARD.md §4.1), and the ORDER BY here mirrors the two views
-- exactly, because a rank that disagrees with the board it points into is
-- worse than no rank.


-- ═══ my_board_rank ══════════════════════════════════════════════════════════
-- The caller's place on one board, or no rows when they are not on it.
create or replace function public.my_board_rank(p_board text, p_season text)
returns table (
  rank                 bigint,
  total                bigint,
  founder_display_name text,
  company_name         text,
  industry             text,
  peak_valuation       numeric(20,2),
  years_survived       int,
  ended_by             text,
  achieved_on          date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      e.profile_id,
      e.founder_display_name,
      e.company_name,
      e.industry,
      e.peak_valuation,
      e.years_survived,
      e.ended_by,
      e.achieved_on,
      case p_board
        when 'valuation' then
          row_number() over (order by e.peak_valuation desc, e.achieved_on asc, e.id asc)
        else
          row_number() over (order by e.years_survived desc, e.peak_valuation desc, e.achieved_on asc, e.id asc)
      end as rn,
      count(*) over () as everyone
    from public.leaderboard_entries e
    where e.board = p_board
      and e.season = p_season
      and e.listed
  )
  select
    r.rn,
    r.everyone,
    r.founder_display_name,
    r.company_name,
    r.industry,
    r.peak_valuation,
    r.years_survived,
    r.ended_by,
    r.achieved_on
  from ranked r
  where r.profile_id = (select auth.uid());
$$;


-- ═══ my_chapter_id ══════════════════════════════════════════════════════════
-- The chapter the caller belongs to — a seat first, an owned licence second —
-- or null. One opaque uuid about the caller themselves; it exists so the
-- board screen knows whether to offer the chapter scope at all.
create or replace function public.my_chapter_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.chapter_id
       from public.chapter_seats s
      where s.profile_id = (select auth.uid())),
    (select c.id
       from public.chapters c
      where c.owner_profile_id = (select auth.uid())
        and c.status = 'active'
      order by c.created_at desc
      limit 1)
  );
$$;


-- ═══ chapter_board ══════════════════════════════════════════════════════════
-- The global board's rows, cut down to the caller's chapter and re-ranked
-- within it. `is_me` marks the caller's row directly — handles are unique
-- per season but matching strings in the client is a coincidence, not a key.
create or replace function public.chapter_board(p_board text, p_season text)
returns table (
  rank                 bigint,
  id                   uuid,
  founder_display_name text,
  company_name         text,
  industry             text,
  peak_valuation       numeric(20,2),
  years_survived       int,
  ended_by             text,
  achieved_on          date,
  season               text,
  is_me                boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select public.my_chapter_id() as cid
  ),
  members as (
    select s.profile_id
      from public.chapter_seats s, mine
     where s.chapter_id = mine.cid
    union
    select c.owner_profile_id
      from public.chapters c, mine
     where c.id = mine.cid
  )
  select
    case p_board
      when 'valuation' then
        row_number() over (order by e.peak_valuation desc, e.achieved_on asc, e.id asc)
      else
        row_number() over (order by e.years_survived desc, e.peak_valuation desc, e.achieved_on asc, e.id asc)
    end as rank,
    e.id,
    e.founder_display_name,
    e.company_name,
    e.industry,
    e.peak_valuation,
    e.years_survived,
    e.ended_by,
    e.achieved_on,
    e.season,
    (e.profile_id = (select auth.uid())) as is_me
  from public.leaderboard_entries e
  where e.board = p_board
    and e.season = p_season
    and e.listed
    and e.profile_id in (select profile_id from members)
  order by 1;
$$;


-- All three are called BY PLAYERS, through their own session — that is the
-- point of them — so `authenticated` keeps EXECUTE. `anon` and PUBLIC do
-- not: auth.uid() would be null and every one of them would return nothing,
-- but "harmlessly callable" is still a bigger surface than "not callable".
revoke execute on function public.my_board_rank(text, text) from public, anon;
revoke execute on function public.my_chapter_id()           from public, anon;
revoke execute on function public.chapter_board(text, text) from public, anon;

grant execute on function public.my_board_rank(text, text) to authenticated, service_role;
grant execute on function public.my_chapter_id()           to authenticated, service_role;
grant execute on function public.chapter_board(text, text) to authenticated, service_role;
