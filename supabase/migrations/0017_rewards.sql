-- ════════════════════════════════════════════════════════════════════════════
-- 0017 · Briefcases — daily challenges, cases, skins, tokens
--
-- The retention loop: play → complete a daily → claim → a case whose TIER is
-- unknown until the ceremony opens it → an item → a wardrobe identity.
--
-- ── The one rule this file exists to enforce ────────────────────────────────
--
-- THE CLIENT NEVER ROLLS. Not the tier, not the rarity, not the item. Every
-- table below is either service-role-only or read-own; there is no INSERT or
-- UPDATE policy for `authenticated` anywhere in this migration, because a
-- table the browser can write is a table where Legendary is free. The API
-- routes do the rolling on the server and commit through the functions at the
-- bottom, which run as the service role.
--
-- ── Idempotency is not optional here ───────────────────────────────────────
--
-- The audience plays on school wifi. An open that half-committed — inventory
-- written, tokens not — would be a support ticket nobody can reconstruct, and
-- a retry that rolled AGAIN would hand out a second Legendary. So `briefcases`
-- stores the reveal payload the first time it is computed, and
-- `open_briefcase` returns that stored payload forever after. Re-opening is a
-- read, not a roll.
--
-- ── Brand Law 4 (cosmetics gate nothing) restated in SQL ───────────────────
--
-- `inventory` may hold a `trial` row with an `expires_at`, and NOTHING here
-- may write `entitlements.pro`. A reward can lend a pro feature for an hour;
-- only Stripe (0003) can grant it. The validator lives in TypeScript, but the
-- absence of any write path from this file to `entitlements.pro` is what makes
-- it true.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ beta access ═══════════════════════════════════════════════════════════
-- The whole system hides behind this flag until it ships. Granted per account
-- from the admin console, exactly like comp_pro — same shape, same reasoning:
-- the player cannot write it, and the flag is evidence of a decision an
-- operator made, not a derived value.
alter table public.entitlements
  add column if not exists rewards_beta boolean not null default false;


-- ═══ content ═══════════════════════════════════════════════════════════════
-- Seeded from JSON, versioned, world-readable. These are the rules of the
-- game, not player data: publishing them is the point (§14.2 wants the odds
-- visible in-app anyway).

create table if not exists public.achievement_templates (
  id            text primary key,
  category      text not null,
  text_pattern  text not null,
  params        jsonb not null default '{}'::jsonb,
  event         text not null,
  predicate     text,
  flags         text[] not null default '{}',
  cooldown_days int not null default 2,
  band_easy     boolean not null default false,
  band_medium   boolean not null default false,
  band_hard     boolean not null default false
);

create table if not exists public.skins (
  id          text primary key,
  name        text not null,
  tier        int  not null check (tier between 1 and 5),
  collection  text not null,
  outfit_spec text,
  url_novus   text,
  url_nova    text,
  in_pool     boolean not null default true
);

create table if not exists public.rewards (
  id      text primary key,
  kind    text not null check (kind in ('tokens','boost','trial','cosmetic','title','consumable')),
  rarity  text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  name    text not null,
  payload jsonb not null default '{}'::jsonb,
  flags   text[] not null default '{}',
  -- A trial may only ever be 1, 5 or 24 hours. The TypeScript validator says
  -- so too, but a constraint is the version that survives a careless seed.
  constraint trial_duration_bounded check (
    kind <> 'trial'
    or (payload ? 'duration_h' and (payload->>'duration_h')::int in (1, 5, 24))
  ),
  -- Nothing in the reward pool may hand over permanent pro. Belt and braces
  -- with the validator: this is the line that cannot be forgotten in a later
  -- seed file.
  constraint no_permanent_pro check (not (payload ? 'pro'))
);

alter table public.achievement_templates enable row level security;
alter table public.skins   enable row level security;
alter table public.rewards enable row level security;

drop policy if exists "templates: world read" on public.achievement_templates;
create policy "templates: world read" on public.achievement_templates
  for select to anon, authenticated using (true);
drop policy if exists "skins: world read" on public.skins;
create policy "skins: world read" on public.skins
  for select to anon, authenticated using (true);
drop policy if exists "rewards: world read" on public.rewards;
create policy "rewards: world read" on public.rewards
  for select to anon, authenticated using (true);


-- ═══ per player ════════════════════════════════════════════════════════════

-- Progress toward one of today's five slots. The row is created by the server
-- when progress first moves; `claimed_at` is the latch that makes a claim
-- once-per-account-per-day without a separate table.
create table if not exists public.daily_progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  slot        int  not null check (slot between 1 and 5),
  template_id text not null,
  param       jsonb not null default '{}'::jsonb,
  progress    numeric not null default 0,
  target      numeric not null default 1,
  claimed_at  timestamptz,
  primary key (user_id, date, slot)
);

-- An unopened case is a promise the player can see in the Vault. `tier` is
-- written at CLAIM (the roll happens then, server-side) but the player is not
-- told it until the ceremony's burst — the API withholds it, which is why
-- `tier` is not in the read-own policy's way: the Vault endpoint selects
-- columns explicitly.
create table if not exists public.briefcases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tier        int  not null check (tier between 1 and 5),
  source      text not null,
  preset      text not null default 'full' check (preset in ('full','prize','short')),
  -- The 3-tap upgrade path, pre-rolled at claim. The client animates it; it
  -- never decides it. [tierAfterTap1, tierAfterTap2, tierAfterTap3].
  upgrade_path int[] not null default '{}',
  granted_at  timestamptz not null default now(),
  opened_at   timestamptz,
  -- The reveal, computed once on first open and returned verbatim on every
  -- retry. This column is what makes the open idempotent.
  reveal      jsonb
);
create index if not exists briefcases_user_unopened
  on public.briefcases (user_id, granted_at desc) where opened_at is null;

create table if not exists public.inventory (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  item_id     text not null,
  kind        text not null,
  acquired_at timestamptz not null default now(),
  equipped    boolean not null default false,
  -- Set only for `trial` items. A NULL here means permanent, which is correct
  -- for cosmetics and impossible for trials (the validator refuses them).
  expires_at  timestamptz,
  primary key (user_id, item_id)
);

create table if not exists public.grants (
  grant_id       uuid primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  briefcase_id   uuid references public.briefcases(id) on delete set null,
  item_id        text not null,
  rarity         text not null,
  was_dupe       boolean not null default false,
  tokens_awarded int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists grants_user on public.grants (user_id, created_at desc);

create table if not exists public.token_ledger (
  id      bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta   int  not null,
  reason  text not null,
  at      timestamptz not null default now()
);
create index if not exists token_ledger_user on public.token_ledger (user_id, at desc);

create table if not exists public.pity_counters (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  since_rare       int not null default 0,
  since_legendary  int not null default 0
);

alter table public.daily_progress enable row level security;
alter table public.briefcases     enable row level security;
alter table public.inventory      enable row level security;
alter table public.grants         enable row level security;
alter table public.token_ledger   enable row level security;
alter table public.pity_counters  enable row level security;

-- Read-own everywhere, write nowhere. The server writes through the functions
-- below on the service role; a player reading their own vault is fine, a
-- player writing it is the whole attack.
drop policy if exists "daily: read own" on public.daily_progress;
create policy "daily: read own" on public.daily_progress
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "briefcases: read own" on public.briefcases;
create policy "briefcases: read own" on public.briefcases
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "inventory: read own" on public.inventory;
create policy "inventory: read own" on public.inventory
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "grants: read own" on public.grants;
create policy "grants: read own" on public.grants
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "ledger: read own" on public.token_ledger;
create policy "ledger: read own" on public.token_ledger
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "pity: read own" on public.pity_counters;
create policy "pity: read own" on public.pity_counters
  for select to authenticated using (user_id = auth.uid());


-- ═══ token balance ═════════════════════════════════════════════════════════
-- Derived from the ledger rather than stored: a balance column and a ledger
-- disagree eventually, and when they do the ledger is the one that can be
-- audited. Cheap at this size (one index scan per player).
create or replace function public.token_balance(p_user uuid)
returns int
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(delta), 0)::int from public.token_ledger where user_id = p_user;
$$;


-- ═══ the open ══════════════════════════════════════════════════════════════
-- One transaction: grants + inventory + ledger + pity + the stored reveal.
--
-- `p_payload` is the roll the API route already computed (server-side, seeded
-- by the case id). This function does NOT roll — it commits, and it refuses to
-- commit twice. The first caller to reach the UPDATE wins; every later caller,
-- including a retry from the same flaky connection, reads the stored reveal
-- back out and gets a byte-identical answer.
create or replace function public.open_briefcase(
  p_case    uuid,
  p_user    uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_item     jsonb;
begin
  -- Lock the row: two taps on a slow connection are the common case, not the
  -- exotic one.
  select reveal into v_existing
    from public.briefcases
   where id = p_case and user_id = p_user
   for update;

  if not found then
    raise exception 'no such briefcase' using errcode = 'no_data_found';
  end if;
  if v_existing is not null then
    return v_existing;                       -- already opened: replay, do not roll
  end if;

  update public.briefcases
     set opened_at = now(), reveal = p_payload
   where id = p_case;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.grants (grant_id, user_id, briefcase_id, item_id, rarity,
                               was_dupe, tokens_awarded)
    values ((v_item->>'grantId')::uuid, p_user, p_case, v_item->>'itemId',
            v_item->>'rarity', coalesce((v_item->>'wasDupe')::boolean, false),
            coalesce((v_item->>'tokens')::int, 0))
    on conflict (grant_id) do nothing;

    -- A dupe pays tokens instead of a second copy; a fresh item lands in the
    -- wardrobe. `do nothing` because the dupe case has already inserted it.
    if coalesce((v_item->>'wasDupe')::boolean, false) = false then
      insert into public.inventory (user_id, item_id, kind, expires_at)
      values (p_user, v_item->>'itemId', v_item->>'kind',
              case when v_item ? 'expiresAt'
                   then (v_item->>'expiresAt')::timestamptz end)
      on conflict (user_id, item_id) do nothing;
    end if;

    if coalesce((v_item->>'tokens')::int, 0) <> 0 then
      insert into public.token_ledger (user_id, delta, reason)
      values (p_user, (v_item->>'tokens')::int,
              case when coalesce((v_item->>'wasDupe')::boolean, false)
                   then 'dupe:' || (v_item->>'itemId') else 'drop:' || (v_item->>'itemId') end);
    end if;
  end loop;

  insert into public.pity_counters (user_id, since_rare, since_legendary)
  values (p_user,
          coalesce((p_payload->'pity'->>'sinceRare')::int, 0),
          coalesce((p_payload->'pity'->>'sinceLegendary')::int, 0))
  on conflict (user_id) do update
    set since_rare      = excluded.since_rare,
        since_legendary = excluded.since_legendary;

  return p_payload;
end;
$$;
revoke all on function public.open_briefcase(uuid, uuid, jsonb) from public, anon, authenticated;


-- ═══ granting a case ═══════════════════════════════════════════════════════
-- Every source funnels here: a daily claim, a milestone, a leaderboard prize,
-- a pitch that went well. Rule 5 of the build prompt — no item ever appears in
-- inventory without a case around it — is enforced by this being the only way
-- in.
create or replace function public.grant_briefcase(
  p_user    uuid,
  p_tier    int,
  p_source  text,
  p_preset  text default 'full',
  p_path    int[] default '{}'
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.briefcases (user_id, tier, source, preset, upgrade_path)
  values (p_user, p_tier, p_source, p_preset, p_path)
  returning id;
$$;
revoke all on function public.grant_briefcase(uuid, int, text, text, int[]) from public, anon, authenticated;


-- ═══ spending tokens ═══════════════════════════════════════════════════════
-- Refuses to go negative INSIDE the transaction. Checking the balance in the
-- route and inserting after is a race two taps wide.
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
  select coalesce(sum(delta), 0)::int into v_balance
    from public.token_ledger where user_id = p_user for update;
  if v_balance < p_amount then return false; end if;
  insert into public.token_ledger (user_id, delta, reason)
  values (p_user, -p_amount, p_reason);
  return true;
end;
$$;
revoke all on function public.spend_tokens(uuid, int, text) from public, anon, authenticated;


-- ═══ equipping ═════════════════════════════════════════════════════════════
-- One equipped skin at a time. Done in SQL so the "unequip the old one" half
-- cannot be skipped by a client that only sends the second call.
create or replace function public.equip_item(p_user uuid, p_item text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_kind text;
begin
  select kind into v_kind from public.inventory
   where user_id = p_user and item_id = p_item;
  if not found then return false; end if;

  update public.inventory set equipped = false
   where user_id = p_user and kind = v_kind and equipped;
  update public.inventory set equipped = true
   where user_id = p_user and item_id = p_item;
  return true;
end;
$$;
revoke all on function public.equip_item(uuid, text) from public, anon, authenticated;


-- ═══ admin: the beta flag ══════════════════════════════════════════════════
-- Same shape as admin_set_comp_pro (0009) so the console's grant band can
-- treat them alike.
create or replace function public.admin_set_rewards_beta(
  p_profile uuid,
  p_active  boolean
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.entitlements (profile_id, rewards_beta)
  values (p_profile, p_active)
  on conflict (profile_id) do update set rewards_beta = excluded.rewards_beta;
$$;
revoke all on function public.admin_set_rewards_beta(uuid, boolean) from public, anon, authenticated;


-- ═══ the event ledger ══════════════════════════════════════════════════════
-- What a player's day actually looked like, and the thing the per-day caps in
-- /api/rewards/progress count against. Two jobs in one table: without it the
-- cap could only be enforced inside a single request, and a script would just
-- send more requests.
--
-- Deliberately thin — a type and a day, no payload. It exists to be COUNTED,
-- and storing what the client claimed would invite reading it back as if it
-- were true.
create table if not exists public.reward_events (
  id      bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date    date not null,
  type    text not null,
  at      timestamptz not null default now()
);
create index if not exists reward_events_user_day
  on public.reward_events (user_id, date);

alter table public.reward_events enable row level security;
drop policy if exists "reward events: read own" on public.reward_events;
create policy "reward events: read own" on public.reward_events
  for select to authenticated using (user_id = auth.uid());
