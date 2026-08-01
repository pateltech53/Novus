-- Minimal Supabase shim — enough of auth + the roles that the migrations and
-- the tests beside this file run against a PLAIN local Postgres, with no
-- Supabase project and no network.
--
-- Supabase itself provides all of this; do not apply this file to a real
-- project. It exists so the RLS policies can be tested before they are
-- trusted, which is the only order that makes sense for a leaderboard.
--
-- Run the whole suite with `npm run test:db` (scripts/db-test.mjs). By hand:
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


-- ── Assertions ──────────────────────────────────────────────────────────────
--
-- Everything below exists so the suites beside this file can FAIL.
--
-- They used to open with `\set ON_ERROR_STOP 0` and then print. A test that
-- prints is a test that needs a human to read it and know what the number was
-- supposed to be, which is not a test — it is a report, and nothing had read
-- one in a long time. Worse, the interesting half of these suites assert that
-- something is REFUSED, so the expected outcome is an error message in the
-- output, and the difference between "refused, as designed" and "allowed, and
-- Pro is now free" was two lines of psql chatter that looked alike at a glance.
--
-- So each claim is now one call to a helper here. Every helper raises on a
-- wrong answer, the suites run with ON_ERROR_STOP on, and psql exits non-zero
-- — which is a thing CI can hold onto.
--
-- These live in their own `test` schema and are granted to PUBLIC because the
-- suites change role constantly (anon, authenticated, service_role, postgres):
-- an assertion that only some roles could call would fail as a permission
-- error and read exactly like the failure it was checking for.

create schema if not exists test;
grant usage on schema test to public;

/**
 * Records a passed check.
 *
 * NOTICE rather than a result row: the suites are read as a transcript, and a
 * notice interleaves with `\echo` section headers in the order things actually
 * happened, where a returned row would not.
 */
create or replace function test.pass(p_what text) returns void
language plpgsql as $$
begin
  raise notice '  ok   %', p_what;
end $$;

/** Asserts a condition. Null counts as a failure, never as a pass. */
create or replace function test.ok(p_condition boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAILED: % (condition was %)',
      p_what, coalesce(p_condition::text, 'null');
  end if;
  perform test.pass(p_what);
end $$;

/**
 * Asserts equality, and says both values when it does not hold.
 *
 * `is distinct from` rather than `<>` so a null on either side is a failure
 * with a readable message instead of a null that quietly passes an `if`.
 *
 * Two concrete overloads rather than one `anyelement`: a polymorphic version
 * cannot be called as `test.eq(count(*), 0, …)` at all — count() is bigint and
 * a bare 0 is integer, and anyelement refuses to unify them. Counting rows is
 * most of what these suites do, so the version that works on a count without a
 * cast is the one worth having.
 */
create or replace function test.eq(p_actual bigint, p_expected bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAILED: % — expected %, got %',
      p_what, coalesce(p_expected::text, 'null'), coalesce(p_actual::text, 'null');
  end if;
  perform test.pass(p_what);
end $$;

create or replace function test.eq(p_actual text, p_expected text, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAILED: % — expected %, got %',
      p_what, coalesce(quote_literal(p_expected), 'null'), coalesce(quote_literal(p_actual), 'null');
  end if;
  perform test.pass(p_what);
end $$;

/**
 * Asserts that a statement is REFUSED, with the SQLSTATE it must be refused by.
 *
 * The SQLSTATE is part of the claim rather than decoration. "This insert
 * fails" is satisfied by a typo in a column name; "this insert fails with
 * 42501" is satisfied only by the row-level security policy that is actually
 * the thing under test. The three that appear in these suites:
 *
 *   42501  insufficient_privilege — a REVOKE, a missing GRANT, or an RLS
 *          policy that refused the row. The security ones.
 *   23505  unique_violation — a uniqueness rule (one entry per season, one
 *          webhook event handled once).
 *   23514  check_violation — a CHECK constraint (an absurd claim, a typo'd
 *          industry code, a live run carrying a cause of death).
 *
 * Runs the statement with `execute`, so it executes as whatever role the suite
 * has currently set — which is the whole point, and would be lost if this were
 * security definer.
 */
create or replace function test.throws(p_sqlstate text, p_sql text, p_what text)
returns void language plpgsql as $$
declare
  got text;
  msg text;
begin
  begin
    execute p_sql;
  exception when others then
    got := SQLSTATE;
    msg := SQLERRM;
  end;

  if got is null then
    raise exception 'FAILED: % — expected SQLSTATE %, but the statement SUCCEEDED',
      p_what, p_sqlstate;
  end if;
  if got <> p_sqlstate then
    raise exception 'FAILED: % — expected SQLSTATE %, got % (%)',
      p_what, p_sqlstate, got, msg;
  end if;

  perform test.pass(p_what);
end $$;
