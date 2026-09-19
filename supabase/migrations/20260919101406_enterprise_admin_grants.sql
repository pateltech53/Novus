-- Supabase default table privileges include writes. Keep administrator membership read-only to clients.
revoke all on public.chapter_admins from anon, authenticated;
grant select on public.chapter_admins to authenticated;
