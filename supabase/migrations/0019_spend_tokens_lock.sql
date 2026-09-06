-- ════════════════════════════════════════════════════════════════════════════
-- 0019 · The token shop could never take a payment
--
-- `spend_tokens` (0017) reads the balance under a lock before writing the
-- debit, which is the right shape — checking the balance in the route and
-- inserting afterwards is a race two taps wide. It reached for that lock like
-- this:
--
--   select coalesce(sum(delta), 0)::int into v_balance
--     from public.token_ledger where user_id = p_user for update;
--
-- Postgres refuses that statement outright: `FOR UPDATE is not allowed with
-- aggregate functions` (0A000), raised at execution, every time, for every
-- caller. So the function did not merely lock the wrong thing — it threw
-- before it could do anything at all, and `/api/rewards/shop` answered 503 to
-- every purchase a player has ever attempted. It was never noticed because
-- the whole reward system spent its life behind a per-account beta flag and
-- the shop is the one screen a tester reaches last: tokens have to be earned
-- (or granted from the workbench) before there is anything to spend.
--
-- Found by supabase/tests/rewards_test.sql, which is new in the same pull
-- request that opens briefcases to every signed-in account — the first time
-- anything executed this function rather than reading it.
--
-- ── The fix, and why an advisory lock ──────────────────────────────────────
--
-- The invariant is per PLAYER, not per row: two concurrent spends must not
-- both see the same balance and both succeed. Locking the existing ledger
-- rows would nearly work and is subtly wrong at the edge that matters — a
-- player with an empty ledger has no rows to lock, and a debit inserted by a
-- concurrent transaction is a row neither statement could have locked. A
-- transaction-scoped advisory lock keyed on the player serialises every spend
-- for that player and nothing else, is released automatically at commit or
-- rollback, and costs one hash.
--
-- `hashtextextended(uuid::text, seed)` gives the bigint the advisory lock
-- wants. The seed is a fixed arbitrary constant: it only has to be stable, so
-- that the same player always maps to the same lock.
--
-- Everything else about the function is unchanged: a non-positive amount is
-- refused, an insufficient balance is refused, and the refusal writes nothing.
-- The signature is identical, so no caller changes and the `revoke all` from
-- 0017 still stands (create or replace preserves privileges).
--
-- Idempotent, like every migration here: it is one `create or replace`.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.spend_tokens(
  p_user   uuid,
  p_amount int,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_balance int;
begin
  if p_amount <= 0 then return false; end if;

  -- Serialise concurrent spends for this player, and only this player. Held
  -- until the transaction ends, so the read below and the insert after it are
  -- one decision.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select coalesce(sum(delta), 0)::int into v_balance
    from public.token_ledger where user_id = p_user;
  if v_balance < p_amount then return false; end if;

  insert into public.token_ledger (user_id, delta, reason)
  values (p_user, -p_amount, p_reason);
  return true;
end;
$$;
revoke all on function public.spend_tokens(uuid, int, text) from public, anon, authenticated;
