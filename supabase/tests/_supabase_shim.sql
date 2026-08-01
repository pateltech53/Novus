-- Minimal Supabase shim — enough of auth + the roles that the migrations and
-- the tests beside this file run against a PLAIN local Postgres, with no
-- Supabase project and no network.
--
-- Supabase itself provides all of this; do not apply this file to a real
-- project. It exists so the RLS policies can be tested before they are
-- trusted, which is the only order that makes sense for a leaderboard.
--
--   createdb novus
--   psql -d novus -f _supabase_shim.sql \
--                 -f ../migrations/0001_novus_core.sql \
--                 -f ../migrations/0002_leaderboard.sql \
--                 -f schema_test.sql

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

-- The columns 0004 reads. The real auth.users has many more; these are the
-- ones the stale-anonymous sweep depends on, so these are the ones the tests
-- need in order to prove it does what it claims.
create table auth.users (
  id               uuid primary key default gen_random_uuid(),
  email            text unique,
  is_anonymous     boolean not null default false,
  created_at       timestamptz not null default now(),
  last_sign_in_at  timestamptz
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
