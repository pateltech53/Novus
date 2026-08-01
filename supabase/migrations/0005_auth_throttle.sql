-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 · Auth throttle — stopping bulk sign-ups and credential stuffing
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── The hole this closes ───────────────────────────────────────────────────
--
-- Supabase rate-limits auth by IP. Novus never lets the browser talk to
-- Supabase — credentials are posted to our own routes and used server-side, so
-- that no third-party auth endpoint is contacted from a page a minor is
-- looking at. The cost of that choice is that Supabase sees ONE address for
-- every player in the world: ours. Its per-IP limit protects nothing, and a
-- script can open ten thousand accounts as fast as it can post.
--
-- So the limit has to live here, on the only side that can still tell callers
-- apart.
--
-- ── Why a table and not memory ─────────────────────────────────────────────
--
-- The app runs serverless. An in-process counter is per-instance, resets on
-- every cold start, and is trivially defeated by concurrency — three instances
-- means three times the limit. Postgres is the only thing all instances share,
-- and `claim_run_slot` (0001) and `claim_submission_slot` (0002) already
-- establish the pattern: one atomic upsert that both records the attempt and
-- returns the verdict, so two simultaneous requests cannot both be told yes.
--
-- ── The privacy problem, and what is actually stored ───────────────────────
--
-- 0001's header is unambiguous: "Any IP address, device id, or geolocation"
-- must never be added to this schema (§9.6). Rate limiting by caller is
-- exactly the feature that wants an IP column, so it does not get one.
--
-- `key` holds an HMAC of the address, computed in the route handler with a
-- server-only secret the database never sees, then truncated. It is not an
-- address and cannot be turned back into one: reversing it needs the secret,
-- and even with the secret the truncation is lossy. The rows are also
-- ephemeral — a window is minutes long, and prune_auth_throttle() deletes
-- anything past it. Nothing here survives long enough to be a record of who
-- visited.
--
-- That is a real trade rather than a clean win, and it is written down so the
-- next person weighs the same thing: an opaque, expiring, unreversible bucket
-- key against letting anyone mint accounts in a database of children.

create table public.auth_throttle (
  -- What is being limited: 'signup:ip', 'signin:ip', 'signin:email',
  -- 'reset:ip', 'reset:email'. Separate buckets so a shared school NAT
  -- exhausting sign-ins cannot also lock out password resets.
  bucket       text        not null,

  -- The HMAC described above, or a normalised email for the per-email buckets.
  key          text        not null,

  window_start timestamptz not null default now(),
  attempts     int         not null default 1,

  primary key (bucket, key)
);

-- Prune scans by age, so it gets the index rather than the primary key.
create index auth_throttle_window_idx on public.auth_throttle (window_start);

-- Same treatment as run_ledger (0001) and the billing tables (0003): RLS on,
-- and grants revoked so PostgREST cannot expose it to anyone by any route.
-- Only claim_auth_attempt() touches it.
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;


-- ═══ claim_auth_attempt ════════════════════════════════════════════════════
-- Records one attempt and says whether it may proceed.
--
-- Returns TRUE while the caller is under the limit, FALSE once over. The
-- attempt is counted either way — that is what makes a flood self-limiting
-- rather than merely reported.
--
-- A fixed window rather than a sliding one. A sliding log is more precise and
-- needs a row per attempt, which is a row per attempt about a visitor; the
-- fixed window keeps exactly one row per bucket per key and still bounds the
-- rate to `p_limit` per window. Precision is not what this is for.
create or replace function public.claim_auth_attempt(
  p_bucket text,
  p_key    text,
  p_limit  int,
  p_window interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used int;
begin
  insert into public.auth_throttle as t (bucket, key, window_start, attempts)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    -- Expired window: start a new one at 1. Live window: increment. Done in
    -- one statement so two concurrent requests cannot both read "0 so far".
    set window_start = case
                         when t.window_start < (now() - p_window) then now()
                         else t.window_start
                       end,
        attempts     = case
                         when t.window_start < (now() - p_window) then 1
                         else t.attempts + 1
                       end
  returning t.attempts into used;

  return used <= p_limit;
end;
$$;


-- ═══ prune_auth_throttle ═══════════════════════════════════════════════════
-- Deletes rows whose window has closed. Retention, not housekeeping: these
-- keys are derived from visitors, and the justification for holding them at
-- all is that they expire.
create or replace function public.prune_auth_throttle(
  p_older_than interval default interval '1 day'
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed int;
begin
  delete from public.auth_throttle where window_start < (now() - p_older_than);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- The revoke matters as much as the grant: these run as their owner, so
-- anything that can call claim_auth_attempt can also spend someone else's
-- budget — pin a victim's email bucket to the limit and they cannot sign in.
-- Only the service role calls them.
revoke execute on function public.claim_auth_attempt(text, text, int, interval)
  from public, anon, authenticated;
revoke execute on function public.prune_auth_throttle(interval)
  from public, anon, authenticated;

grant execute on function public.claim_auth_attempt(text, text, int, interval)
  to service_role;
grant execute on function public.prune_auth_throttle(interval)
  to service_role;

-- Schedule the prune if pg_cron is enabled (Database → Extensions). Left
-- commented because enabling an extension is a decision about your project.
-- The table stays small without it — one row per bucket per key, reused — but
-- old rows are retained data, and retention policies added later are
-- retention policies that never get added.
--
--   select cron.schedule('novus-prune-auth-throttle', '23 * * * *',
--                        $$select public.prune_auth_throttle()$$);
