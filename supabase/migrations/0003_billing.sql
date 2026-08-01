-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Billing — Stripe customers, webhook idempotency, entitlement grants
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0001 left `public.entitlements` readable by the player and writable by
-- nobody, with the note "when a processor lands, its webhook writes here with
-- the service role". This is that migration.
--
-- Nothing here is reachable from the browser. Every table below has its grants
-- revoked and every function has EXECUTE revoked, because Postgres grants
-- EXECUTE to PUBLIC by default and a grant function callable over PostgREST is
-- a Pro button that costs nothing. The only caller is app/api/billing/*, on
-- the service role.
--
-- ── What is deliberately NOT here ──────────────────────────────────────────
--
-- Chapter licences. `entitlements.chapter` exists and 0001 describes it, but a
-- chapter is 35 or 100 SEATS bought by a teacher and handed to students, and
-- there is no enrolment-code table to hand them out with. Selling a licence the
-- app cannot deliver would take a school's money for nothing, so chapter SKUs
-- are absent from the catalogue in lib/stripe/catalogue.ts too. They land with
-- the seat-code feature, not before.
--
-- ── On what Stripe is told ─────────────────────────────────────────────────
--
-- The only Novus identifier that crosses to Stripe is the anonymous profile
-- UUID, in checkout session metadata. No display name, no board handle, no
-- founder name, and above all no RunState.playerAge — docs/LEADERBOARD.md §9.4
-- says local age-gating never leaves the device, and a payment processor is
-- very much off the device.


-- ═══ billing_customers ═════════════════════════════════════════════════════
-- The join between an anonymous Novus profile and a Stripe customer.
--
-- Separate from `entitlements` on purpose. Entitlements answer "what may this
-- player use", and the game reads that on every screen. This table answers
-- "who is paying and until when", which is billing's business and nothing
-- else's. Keeping the Stripe ids out of the table the client can SELECT means
-- a customer id is never one misconfigured RLS policy away from the browser.
--
-- One Stripe customer per profile, enforced both ways: profile_id is the key
-- and stripe_customer_id is unique, so a webhook can look the row up from
-- either side without ever matching two profiles to one customer.
create table public.billing_customers (
  profile_id           uuid primary key references public.profiles(id) on delete cascade,

  stripe_customer_id   text not null unique,

  -- Null until the player buys a subscription. One-time purchases (industry
  -- packs, run slots) create a customer row and leave these alone.
  subscription_id      text unique,

  -- Stripe's own vocabulary, stored verbatim rather than mapped to a boolean.
  -- `pro` in entitlements is the derived answer; this is the evidence, and
  -- when the two disagree it is this column that says why.
  subscription_status  text check (subscription_status in (
                         'trialing','active','past_due','canceled',
                         'incomplete','incomplete_expired','unpaid','paused')),

  plan                 text check (plan in ('pro_monthly','pro_yearly')),

  -- When access lapses if nothing renews. Kept so support can answer "why did
  -- Pro stop" without opening the Stripe dashboard.
  current_period_end   timestamptz,

  -- A player who cancelled keeps Pro until the period ends. Settings needs
  -- this to say "Pro until 3 March" instead of implying it already stopped.
  cancel_at_period_end boolean not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger billing_customers_touch
  before update on public.billing_customers
  for each row execute function public.touch_updated_at();

-- Same treatment as run_ledger in 0001: no RLS policies AND no grants, so
-- PostgREST cannot expose the table at all, to anyone, by any route.
alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;


-- ═══ billing_events ════════════════════════════════════════════════════════
-- Every Stripe event id we have already acted on.
--
-- Stripe delivers at-least-once and retries for three days on any non-2xx.
-- Without this table a retried `checkout.session.completed` for an extra run
-- slot grants the slot twice, and the player who was double-charged nothing is
-- the lucky case — the unlucky one is a refund we process twice.
--
-- The primary key IS the deduplication: the webhook inserts the event id first
-- and treats a unique violation as "already handled, acknowledge and stop".
create table public.billing_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- Retention: Stripe stops retrying after 3 days, so a row older than a month
-- has no deduplication value left. This is data about a purchase, not about a
-- player, but the smallest table is still the easiest one to be right about.
create index billing_events_received_at_idx on public.billing_events (received_at);


-- ═══════════════════════════════════════════════════════════════════════════
-- Grant functions
-- ═══════════════════════════════════════════════════════════════════════════
-- Why functions rather than upserts in the route handler: every grant below is
-- a read-modify-write on an array or a counter, and two webhooks can land at
-- once. `industry_packs = industry_packs || 'TECH'` inside the database is
-- atomic; reading the row in Node, appending, and writing it back is a lost
-- update waiting for a player who buys two packs in one minute.
--
-- These are `security invoker` (the default) deliberately. The service role
-- already bypasses RLS, so definer rights would buy nothing and would turn any
-- future accidental grant into a privilege escalation.

-- ── Subscription state → entitlements.pro ──────────────────────────────────
-- The single place that decides whether a subscription means Pro. Both the
-- webhook's create and update paths call it, so a resubscribe after a cancel
-- cannot take a different route than the first purchase did.
create or replace function public.apply_subscription(
  p_profile uuid,
  p_active  boolean,
  p_plan    text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, pro, intent)
  values (p_profile, p_active, p_plan)
  on conflict (profile_id) do update
    set pro = excluded.pro,
        -- `intent` is what the player asked for and stays the last plan they
        -- chose, even after a cancel: it is a record of the ask, not of access.
        intent = coalesce(excluded.intent, public.entitlements.intent);
$$;

-- ── One industry, kept for good ────────────────────────────────────────────
-- Idempotent by construction: buying TECH twice leaves one 'TECH' in the
-- array. That matters because the webhook's dedup is best-effort across a
-- Stripe account reset, and a duplicate here must be harmless rather than
-- merely unlikely. The entitlements check constraint rejects a typo'd code, so
-- an invalid industry fails the webhook loudly instead of unlocking nothing.
create or replace function public.grant_industry_pack(
  p_profile  uuid,
  p_industry text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, industry_packs)
  values (p_profile, array[p_industry])
  on conflict (profile_id) do update
    set industry_packs = (
      select array(
        select distinct unnest(public.entitlements.industry_packs || array[p_industry])
      )
    );
$$;

-- ── One more company at the same time ──────────────────────────────────────
-- NOT idempotent, and cannot be: two slots bought is two slots. The webhook's
-- billing_events row is what stops a retry from granting a third. The column's
-- own `between 0 and 20` check is the backstop if that ever fails.
create or replace function public.grant_extra_run_slot(p_profile uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, extra_run_slots)
  values (p_profile, 1)
  on conflict (profile_id) do update
    set extra_run_slots = public.entitlements.extra_run_slots + 1;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC. Left alone, all three of
-- these would be callable as `POST /rest/v1/rpc/grant_extra_run_slot` by any
-- anonymous player in the game — which is every player. Revoke first, then
-- grant back to exactly one role.
revoke execute on function public.apply_subscription(uuid, boolean, text)  from public, anon, authenticated;
revoke execute on function public.grant_industry_pack(uuid, text)          from public, anon, authenticated;
revoke execute on function public.grant_extra_run_slot(uuid)               from public, anon, authenticated;

grant execute on function public.apply_subscription(uuid, boolean, text)   to service_role;
grant execute on function public.grant_industry_pack(uuid, text)           to service_role;
grant execute on function public.grant_extra_run_slot(uuid)                to service_role;
