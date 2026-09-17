-- Invitation setup belongs to an account, not to its current enterprise seat.
-- Removing a seat must not forget that its randomly generated password has
-- never been replaced. Service-only state; no email or credential is copied.
begin;
create table if not exists public.chapter_account_setup (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  completed_at timestamptz
);
alter table public.chapter_account_setup enable row level security;
revoke all on public.chapter_account_setup from public, anon, authenticated;
grant select, insert, update, delete on public.chapter_account_setup to service_role;

-- Existing pending invites retain their first-setup state. Reapplication
-- cannot undo a completion recorded after the first deployment.
insert into public.chapter_account_setup (profile_id, completed_at)
select profile_id, claimed_at from public.chapter_seats where created_by_invite
on conflict (profile_id) do nothing;
commit;
