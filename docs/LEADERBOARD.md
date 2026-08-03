# Global leaderboard — integration guide

Two boards, one submission path.

| Board | Orders by | Existing name |
|---|---|---|
| Survival | `years_survived desc` | **Still Standing** (already used in `ProSheet.tsx`, `PlansSheet.tsx`, `BeeMail.tsx`) |
| Valuation | `peak_valuation desc` | none — pick one in copy, not here |

**This is built.** It was a plan, and the plan was followed; what follows is now a description
with the deviations marked. Read `docs/DO-NOT-TOUCH.md` first regardless — the engine is still
protected, and none of the work below opened it.

| What | Where |
|---|---|
| The tape — entry kinds, canonical JSON, hashing | `lib/leaderboard/tape.ts` |
| The shared orchestration, and the replay | `lib/leaderboard/replay.ts` |
| Bounds, moderation, handles, season pinning | `lib/leaderboard/{bounds,moderation,handles,season}.ts` |
| The verifier | `lib/leaderboard/verify.ts` |
| Routes | `app/api/leaderboard/{,submit,handle,report,moderate}/route.ts` |
| The screen | `components/screens/StillStandingScreen.tsx` |
| The recorder, wired at every commit site | `lib/leaderboard/recorder.ts`, `lib/state/GameProvider.tsx` |
| Submission path, moderation queue, report | `supabase/migrations/0006_leaderboard_submit.sql` |
| The tests | `scripts/leaderboard-test.mjs`, `supabase/tests/submit_test.sql` |

### Four places the build deviates from this document, and why

1. **The verifier does not just call `lib/engine`; it shares the ORCHESTRATION with the game.**
   §1.1 argues for one copy of the engine. That argument is only true if the sequence around the
   engine is shared too — a tap on ADVANCE MONTH is `advanceMonth()` plus four other calls, and a
   verifier that made four of them would reject honest runs for a living. So `advanceTurn`,
   `closeFiscalYear`, `buyStockAt` and friends live in `replay.ts` and `GameProvider` calls them.

2. **The tape carries more entry kinds than §7.2 listed.** Activities, transfers, retire/refresh,
   dismissals and the Pro toggle all reach the books, and a tape without them replays a different
   company. `dismiss` is the subtle one: without it a later `choice` naming the second card arrives
   at a table where the first is still face-up.

3. **The year-end deal and every cold call are RE-DERIVED, not replayed.** `SharkPanel` and
   `judgePitch` ask a model, and a model's answer is a different sentence every time. A board that
   accepted it would rank a run by whether an API key happened to be deployed on the day it was
   played — Brand Law 4 broken by an environment variable. The board replays the deterministic
   ladder `scripts/simulate.mjs` balances the game against, and `resolveCallLocally` for calls.

4. **The two §8.2 violations were already fixed** before this work started; §8.2 below is left as
   the historical record and marked. What was missing was the assertions that stop them coming
   back, and those now run in CI.

---

## 1 · The decision: Supabase

Use Supabase. Not "it depends" — for this app the argument is one-sided.

**1. Server-side validation means running the engine, and the engine is TypeScript in this repo.**
The only honest way to verify a submitted run is to replay it with `lib/engine`. With Supabase, the
verifier is a Next.js Route Handler in the same deploy that does `import { advanceMonth } from
"@/lib/engine/run"`. One copy of the engine, one `npm run check` that covers it. With Firebase you
would put the verifier in a Cloud Function — a second runtime, a second deploy, a second install of
the engine that can drift from the one players run. The moment the engine and the verifier disagree,
every honest player gets rejected. Supabase removes that failure mode by removing the second copy.

**2. Postgres can express the invariants; Firestore rules cannot.**
`check (years_survived between 1 and 60)`, `unique (board, season, profile_id)`, a `numeric(20,2)`
that cannot hold a string — these are database-level guarantees that hold even if a route handler has
a bug. Firestore security rules can validate a write's shape but cannot enforce a uniqueness
constraint or a cross-row invariant, and "one entry per player per board" is exactly a cross-row
invariant. You would end up enforcing it in application code anyway.

**3. `ORDER BY ... DESC LIMIT 100` is what a leaderboard is.**
It is one B-tree index in Postgres. Firestore does it too, via composite indexes, but you pay per
document read and the cost of a popular board is linear in traffic. Postgres reads the same 100 index
entries whether ten people or ten thousand look at it.

**4. The browser never has to talk to a third party.**
Route every call through Next.js Route Handlers and keep `@supabase/supabase-js` server-only. The
browser talks to your own origin and nothing else — no new CSP origins, no third-party cookies, no
Google-side device identifiers on a product for minors. Firebase's client SDK is the opposite shape:
it wants a long-lived connection from the browser to Google, and its default bundle pulls Analytics
in a lot of setups. See §9.

**5. `lib/engine/save.ts` already committed to it.**

> Persistence adapter. localStorage now; the same surface maps to Supabase tables in P5.

Do not relitigate a decision the codebase already made and documented, absent a reason. There is no
reason here.

**Where Firebase would have won, and why it does not apply.** Firebase is better when you want live
sync between clients, push notifications, or mobile SDKs with offline write queues. This leaderboard
is read-mostly, writes once per dead company, and does not need realtime. None of Firebase's
strengths are in play.

---

## 2 · What actually exists to submit

Read from `lib/engine/types.ts` and `lib/engine/save.ts`. Do not invent fields.

| Board field | Source | Notes |
|---|---|---|
| Years survived | `RunState.year` | Fiscal year, 1-based. `AutopsyReport.yearsSurvived` is the same number. |
| Company name | `RunState.companyName` | Player free text. **Moderation required** — §9. |
| Industry | `RunState.industry` | One of 12 codes in `lib/engine/constants.ts`. |
| Founder name | `RunState.founderName` | **Do not submit this.** §9 explains the substitution. |
| Ended by | `RunState.endedBy` | `chapter7 \| acquired \| ipo`, undefined while alive. |
| Seed | `RunState.seed` | The whole basis of replay. |
| Pro at submit | `RunState.pro` | Audit only. Never orders anything — §8. |

### The gap: there is no peak valuation

`RunState.stats.valuation` is the **current** valuation, recomputed by `deriveValuation()` on every
`refreshBooks()`. A company that peaked at $40M and died at $200K stores `200000`. Nothing in
`RunState` records the maximum.

`DecisionRecord.booksBefore.valuation` gives a sampled series, and `YearEndSummary.valuation` gives
one point per fiscal year, but neither is the peak.

**Do not fix this by adding a client-side peak field and trusting it.** The server replays the run
anyway (§7); have the replay track `max(state.stats.valuation)` across every month it simulates. The
peak is then a server-computed number that no client ever touched, which is exactly what you want on
a leaderboard.

If you also want the number on-screen during a live run, that is an additive
`peakValuation?: number` on `RunState` maintained in `refreshBooks()` — but `sim.ts` is protected, so
that is a separate decision with sign-off, and it must not become the number the board trusts. Filed
in §11.

---

## 3 · Setup, in order

### 3.1 Create the project

1. Create a Supabase project. Region: nearest your players, not nearest you.
2. **Authentication → Providers → Anonymous sign-ins: enable.** Leave every other provider off.
   Email, phone and OAuth providers all collect a personal identifier from a child. You want none.
3. **Authentication → Rate limits:** cap anonymous sign-ins per hour per IP. The default is generous;
   a leaderboard makes free identity creation an attack surface.
4. Note the project URL and the publishable/anon key from **Settings → API**. Copy the service role
   key too, and treat it like a password, because it bypasses every policy in §6.

### 3.2 Environment variables

`.env.local` (already covered by `.gitignore`):

```bash
# Public. Safe in a bundle — RLS is what protects the data, not this key.
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or sb_publishable_... key>

# SERVER ONLY. Bypasses RLS entirely. Never prefix with NEXT_PUBLIC_.
# Never import into a file that a Client Component can reach.
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Pins replay compatibility. Bump when the engine or the event library changes.
NOVUS_ENGINE_VERSION=1
NOVUS_LEADERBOARD_SEASON=2026-Q3
```

Commit a `.env.example` with the same keys and empty values. The existing convention in this repo is
`NEXT_PUBLIC_STT_ENDPOINT` in `lib/ai/transcribe.ts` — these match it.

**The service role key must never appear in a Client Component.** Add an ESLint rule or a
`grep -r SUPABASE_SERVICE_ROLE_KEY app components` check to CI. One `"use client"` at the top of the
wrong file publishes it to every browser.

### 3.3 Install

```bash
npm i @supabase/supabase-js
```

One dependency. `@supabase/ssr` is **not** needed under the server-only design in §5 — it exists to
manage auth cookies for browser-side sessions, and there are none here. Size justification in §11.

### 3.4 Schema

Create `supabase/migrations/0001_leaderboard.sql` with §4, then apply it:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Or paste it into the SQL editor. Either way, keep the file in the repo — a schema that exists only in
a dashboard is a schema nobody can review.

### 3.5 Files, and where they go

| Path | What it is | Runtime |
|---|---|---|
| `supabase/migrations/0001_leaderboard.sql` | §4 + §6, verbatim | — |
| `lib/leaderboard/tape.ts` | `RunTape` type + the recorder | shared |
| `lib/leaderboard/admin.ts` | service-role client, `import "server-only"` at the top | server |
| `lib/leaderboard/verify.ts` | replays a tape against `lib/engine` | server |
| `lib/leaderboard/bounds.ts` | plausibility ceilings (§7.4) | server |
| `app/api/leaderboard/session/route.ts` | mints the anonymous session cookie | server |
| `app/api/leaderboard/submit/route.ts` | POST a tape, verify, upsert | server |
| `app/api/leaderboard/route.ts` | GET the top 100 of either board | server |
| `components/screens/StillStandingScreen.tsx` | the board UI | client |

`lib/engine/*` gains nothing. The engine stays pure and simulatable, which is the point of it.

### 3.6 Wire the recorder

The tape (§7.2) has to be recorded as the player plays. That is an append to
`lib/state/GameProvider.tsx` at each `commit()` site — one line per input kind. See §11; the
integrator owns that file.

---

## 4 · Schema

```sql
-- supabase/migrations/0001_leaderboard.sql

create extension if not exists pgcrypto;

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per anonymous auth user. Deliberately holds nothing about a person.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text        not null,
  created_at    timestamptz not null default now(),

  -- Handles come from a curated pool (§9), so the shape is narrow on purpose.
  -- Free text here is a moderation queue you did not budget for.
  constraint display_name_shape
    check (display_name ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$')
);

-- ── runs ────────────────────────────────────────────────────────────────────
-- The evidence. One row per submission, verified or not. Never updated by a
-- player, never deleted by anyone but a cascade.
create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,

  -- Replay inputs.
  seed           bigint not null,
  tape           jsonb  not null,
  tape_hash      text   not null,          -- sha256 of the canonical tape JSON
  engine_version text   not null,
  events_hash    text   not null,          -- sha256 of data/events.json

  -- Run identity.
  company_name   text not null,
  industry       text not null check (industry in (
                   'FOOD','ECOM','TECH','CONTENT','FASHION','GAMING',
                   'FITNESS','BEAUTY','EDTECH','SUSTAIN','TOYS','PET')),

  -- What the client claimed. Stored ONLY so you can diff it against the replay
  -- and see who is lying. Never read by any board query.
  claimed_peak_valuation numeric(20,2) not null,
  claimed_years_survived int           not null,

  -- What the server computed. Null until verified.
  verified_peak_valuation numeric(20,2),
  verified_years_survived int,
  verified_ended_by       text check (verified_ended_by in ('chapter7','acquired','ipo')),

  status        text not null default 'pending'
                check (status in ('pending','verified','rejected','flagged')),
  reject_reason text,

  -- Audit only. Enforced never to reach a board — see §8.
  pro_at_submit boolean not null default false,

  submitted_at  timestamptz not null default now(),
  verified_at   timestamptz,

  -- Cheap gates that hold even if a route handler is wrong.
  constraint tape_size     check (pg_column_size(tape) < 262144),
  constraint years_claim   check (claimed_years_survived between 1 and 60),
  constraint valuation_claim
    check (claimed_peak_valuation >= 0 and claimed_peak_valuation < 1e13),

  -- The same tape twice is the same run twice.
  constraint one_tape_per_profile unique (profile_id, tape_hash)
);

create index runs_pending_idx on public.runs (submitted_at)
  where status = 'pending';

-- ── leaderboard_entries ─────────────────────────────────────────────────────
-- What the world reads. Only verified runs land here, and only the best one per
-- player per board per season, so one player cannot occupy the top ten.
create table public.leaderboard_entries (
  id            uuid primary key default gen_random_uuid(),
  board         text not null check (board in ('valuation','survival')),
  season        text not null,

  run_id        uuid not null references public.runs(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,

  founder_display_name text not null,       -- the curated handle, NOT RunState.founderName
  company_name         text not null,       -- moderated before it is listed
  industry             text not null,

  peak_valuation numeric(20,2) not null check (peak_valuation >= 0),
  years_survived int           not null check (years_survived between 1 and 60),
  ended_by       text,

  -- Date, not timestamptz. Time-of-day correlates with timezone, and timezone
  -- is coarse location data about a child. §9.
  achieved_on   date not null,

  -- Entries land unlisted. A human or a blocklist clears company_name first.
  listed        boolean not null default false,

  created_at    timestamptz not null default now(),

  constraint one_entry_per_board unique (board, season, profile_id)
);

create index leaderboard_valuation_idx
  on public.leaderboard_entries (season, peak_valuation desc, achieved_on asc, id asc)
  where board = 'valuation' and listed;

create index leaderboard_survival_idx
  on public.leaderboard_entries (season, years_survived desc, peak_valuation desc, achieved_on asc, id asc)
  where board = 'survival' and listed;

-- ── submission_quota ────────────────────────────────────────────────────────
create table public.submission_quota (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  count      int  not null default 0
);
```

### 4.1 The board views

Ranking is computed, never stored. There is no `rank` column for anyone to write.

```sql
create view public.board_valuation
with (security_invoker = on) as
select
  row_number() over (order by peak_valuation desc, achieved_on asc, id asc) as rank,
  founder_display_name, company_name, industry,
  peak_valuation, years_survived, achieved_on, season
from public.leaderboard_entries
where board = 'valuation' and listed;

create view public.board_survival
with (security_invoker = on) as
select
  row_number() over (order by years_survived desc, peak_valuation desc, achieved_on asc, id asc) as rank,
  founder_display_name, company_name, industry,
  years_survived, peak_valuation, ended_by, achieved_on, season
from public.leaderboard_entries
where board = 'survival' and listed;
```

`security_invoker = on` matters. Without it a view runs as its owner and silently bypasses the RLS on
the table underneath, which turns your carefully written policies into decoration.

**Tie-breaks are all server-computed and none are purchasable:** valuation ties break on survival,
then on the earlier date. First to get there keeps it.

---

## 5 · The request path

Browser → your Next.js Route Handler → Supabase. The browser never holds a Supabase URL, a key, or a
session for Supabase itself.

```
POST /api/leaderboard/session   → anonymous sign-in, refresh token into an httpOnly cookie
POST /api/leaderboard/submit    → { tape, seed, companyName, industry, claimed… }
GET  /api/leaderboard?board=survival&season=2026-Q3  → top 100
```

The session route calls `supabase.auth.signInAnonymously()` **server-side** with the anon key, then
sets the refresh token in an `httpOnly; Secure; SameSite=Lax` cookie. Every later request rehydrates
the session from that cookie server-side. The player has a durable identity, and no script on the
page — yours or an injected one — can read the token.

`GET /api/leaderboard` can use the anon key and rely on the read policy in §6. `POST
/api/leaderboard/submit` needs the service role key to write a verified entry, because no player is
allowed to write one (that is the whole design).

---

## 6 · Row-level security

A leaderboard with open writes is a leaderboard of whoever found the endpoint. Write these before you
write the UI.

```sql
alter table public.profiles            enable row level security;
alter table public.runs                enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.submission_quota    enable row level security;
```

Enabling RLS with no policies denies everything. That is the correct default; every policy below is
an exception you are choosing to grant.

### 6.1 profiles — you touch your own row and nobody else's

```sql
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles: rename own"
  on public.profiles for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));
```

No delete policy. Account deletion goes through a route handler using the service role, so it can
cascade and audit in one place.

`(select auth.uid())` rather than bare `auth.uid()` is deliberate — Postgres caches the subquery as an
InitPlan instead of re-evaluating per row. On a table this small it does not matter; get the habit
right anyway.

### 6.2 runs — append-only, private

```sql
create policy "runs: submit own"
  on public.runs for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    -- You may submit evidence. You may not submit a verdict.
    and status = 'pending'
    and verified_peak_valuation is null
    and verified_years_survived is null
    and verified_ended_by       is null
    and verified_at             is null
    and reject_reason           is null
  );

create policy "runs: read own"
  on public.runs for select to authenticated
  using (profile_id = (select auth.uid()));
```

**No update policy and no delete policy exist.** A player cannot edit a submitted run, cannot mark it
verified, cannot delete a rejected one to hide it, and cannot read anyone else's tape. Only the
service role, which bypasses RLS, promotes a run to `verified`.

If you would rather not expose the insert at all, drop `runs: submit own` and have the submit route
insert with the service role after checking the quota. That is one fewer surface; the policy above is
the belt to that suspenders.

### 6.3 leaderboard_entries — world-readable, nobody writes

```sql
revoke all on public.leaderboard_entries from anon, authenticated;
grant select on public.leaderboard_entries to anon, authenticated;

create policy "board: public read"
  on public.leaderboard_entries for select to anon, authenticated
  using (listed = true);
```

That is the entire policy set. There is deliberately no insert, update or delete policy for `anon` or
`authenticated`. Anyone who finds the REST endpoint and POSTs to it gets a `42501`. The only writer is
the verifier holding the service role key, and the only thing that key is used for is writing rows the
server computed itself.

`using (listed = true)` also means an unmoderated entry is invisible to everyone, including its own
author, until it clears §9.

### 6.4 submission_quota — nobody, not even you

```sql
-- No policies. RLS on, zero exceptions: only the service role reads or writes this.
```

### 6.5 The rate limiter

```sql
create or replace function public.claim_submission_slot(p_profile uuid, p_max int default 10)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'utc')::date;
  used  int;
begin
  insert into public.submission_quota as q (profile_id, day, count)
  values (p_profile, today, 1)
  on conflict (profile_id) do update
    set day   = today,
        count = case when q.day = today then q.count + 1 else 1 end
  returning q.count into used;

  return used <= p_max;
end;
$$;

revoke execute on function public.claim_submission_slot(uuid, int) from public, anon, authenticated;
```

`set search_path` is not optional on a `security definer` function. Without it a caller can put a
malicious schema ahead of `public` and have your elevated function call their table.

The revoke matters as much as the grant: this function runs as its owner, so anything that can call it
can write the quota table it was meant to protect.

---

## 7 · Anti-cheat

### 7.1 What can be trusted: nothing from the client

`lib/engine/save.ts` writes the entire `RunState` to `localStorage` under `novus:run:v1` as plain
JSON. A player opens devtools, sets `stats.valuation` to `1e12` and `year` to `50`, reloads, and the
app believes them — correctly, because that is what a local save is for. Treat every number the client
sends as a claim, and store it in the `claimed_*` columns purely so you can measure how often it
differs from the truth.

### 7.2 What can be recomputed: everything that matters

The engine is deterministic, and that is the whole game here. `lib/engine/rng.ts`:

```ts
export function runRng(seed: number, year: number, month: number, salt = 0): Rng {
  return mulberry32((seed ^ (year * 2654435761) ^ (month * 40503) ^ salt) >>> 0);
}
```

Position-seeded, not sequential. Every draw, every branch, every luck-band jitter is a pure function
of `(seed, year, month, eventId)`. Given the seed and the player's inputs, the server can reproduce
the run exactly — this is the same property `scripts/simulate.mjs` relies on, which is why the sim
harness is byte-identical across timezones.

So submit **inputs**, not outcomes. The tape:

```ts
// lib/leaderboard/tape.ts
export type TapeEntry =
  | { t: "advance";    atISO: string }                         // Today's Market is date-seeded
  | { t: "choice";     eventId: string; choice: number }
  | { t: "perform";    kind: PerformType; transcript: string } // the words, not the score
  | { t: "allocation"; pick: Allocation }
  | { t: "hire";       index: number }                         // index into the deterministic pool
  | { t: "fire";       index: number }
  | { t: "buy-asset";  defId: string }
  | { t: "sell-asset"; index: number }
  | { t: "product";    name: string; priceCents: number }
  | { t: "trade";      symbol: string; qty: number; minute: number }
  | { t: "coldcall";   investorId: string; transcript: string; atISO: string };

export interface RunTape {
  seed: number;
  founderName: "";        // deliberately empty — §9
  companyName: string;
  industry: Industry;
  entries: TapeEntry[];
}
```

Two details that make this work:

- **Hires carry an index, not a candidate.** `candidatePool()` in `lib/engine/people.ts` is seeded on
  `${state.id}:hire:${year}:${month}`, so the server regenerates the same five candidates and picks
  the same one. A client cannot invent a candidate with `performance: 100`.
- **Trades carry a minute, not a price.** `priceAt(ticker, minute)` in `lib/engine/market.ts` is a
  pure function of ticker and minute-since-epoch. The server recomputes the fill price. A client
  cannot claim it bought FINN at $0.01.

The verifier constructs a fresh run from `seed`, replays `entries` through the real `advanceMonth()`
and `resolveChoice()`, tracks `max(state.stats.valuation)` on the way, and compares its result to the
claim. Mismatch beyond floating-point tolerance means the tape is not what produced that number.

### 7.3 Performance scores: rescore, do not accept

`PerformResult.score` is computed on the client and gates the fiscal year (Brand Law 1) with a
multiplier of `0.4 + 0.12 × score`. Never take the submitted number.

`scorePitchContent(transcript, state, wants)` in `lib/ai/pitch-content.ts` is a pure function of the
transcript and the run's own books. Call it server-side during the replay and use **its** output.
Discard whatever the client said the score was.

This works cleanly because of Brand Law 5. The scorer only reads content — coverage, whether there is
a figure in it, and whether claims like "we're profitable" survive a check against the books. Nothing
about audio matters to the score, so a text transcript is the complete input. There is no audio to
upload, which is also the right privacy answer (§9).

**What this does not close:** a player can type a perfect pitch instead of speaking one. You cannot
close that without breaking the text-entry path, and `lib/ai/transcribe.ts` is explicit that typing is
a first-class route because a player who cannot be transcribed must never score worse. Accept it, and
note the ceiling: the exploit is worth the gap between an average pitch and a perfect one, which is a
multiplier of at most 1.6× on one year's deal. It cannot manufacture a decade of survival.

### 7.4 Plausibility bounds: the cheap gate before the expensive one

Replay costs CPU. Reject the absurd first.

```ts
// lib/leaderboard/bounds.ts — reject, flag, or pass, before any replay runs.
```

- `years_survived` outside `1..60` — reject. The `check` constraint catches it too.
- `peak_valuation` above the ceiling for the industry and year count — reject. Derive the ceiling
  from `scripts/simulate.mjs`, which reports a median valuation of $28.3M at 8 years on seed 1. Set
  the hard ceiling at roughly 100× the observed p99 so it only ever catches nonsense, and **flag**
  rather than reject anything above p99 so a genuinely exceptional run gets a human look instead of a
  door in the face.
- Tape length inconsistent with the claim — a 40-year run needs at least 480 `advance` entries.
  Reject a 40-year claim carried by 12.
- Timestamps: every `atISO` monotonically non-decreasing, none in the future, none before the app
  shipped. `advance` dates must be non-decreasing, because `todaysMarketSeed()` is seeded on the UTC
  date and a run cannot go back in time.
- Cold calls: `RunState` rations them to three per real day (`coldCallDayISO`, `coldCallsUsed`). More
  than three `coldcall` entries sharing a date is a forged tape.
- `tape` over 256 kB — rejected by the `check` constraint before it costs you anything.

Log every rejection with its reason. A spike in one reason is either an exploit going around or a bug
you shipped, and you want to know which within the hour.

### 7.5 Rate limits and replay-of-submission

- `claim_submission_slot()` (§6.5): ten submissions per profile per UTC day. A legitimate player
  finishes a run in far more time than that.
- `unique (profile_id, tape_hash)`: resubmitting the same tape is a `23505`, not a second entry.
- `unique (board, season, profile_id)`: one row per player per board. Upsert only when the new run
  beats the old. One player cannot own the top ten no matter how many runs they finish.
- Cap anonymous sign-ins per IP in the Supabase dashboard (§3.1), because an unlimited identity
  factory defeats every per-profile limit above. Do not persist the IP — check it at the edge and drop
  it (§9).
- Bound the verifier: reject tapes above the size constraint, cap replay wall time, and run
  verification in the request rather than a queue until volume says otherwise.

### 7.6 Season pinning

Store `engine_version` and `events_hash` (sha256 of `data/events.json`) on every run. When either
changes, old tapes no longer replay to the same numbers — the event library moved underneath them.

Handle this with seasons rather than heroics: a season pins an engine version, boards reset when the
season does, and entries from a previous season are archived read-only rather than re-verified. This
is also why `NOVUS_LEADERBOARD_SEASON` is an env var and `season` is a column.

### 7.7 The line

Reject impossible states, not skilled ones. A player who scripts an optimal run against the real
engine is playing the game well, and the tape they submit is genuine. Deterministic replay draws
exactly the right line: it catches states the engine could not have produced, and nothing else.

---

## 8 · Brand Law 4 — position is never purchasable

> Cosmetics, run slots and scenario packs are purchasable. Score, survival, revives and leaderboard
> position **never** are. This is a product for minors — a legal constraint, not a taste one.

The app already promises this in copy: `ProSheet.tsx` lists "Score, survival, leaderboard — Free:
Identical, Pro: Identical", and `PlansSheet.tsx` says "Leaderboard — Same for everyone". Shipping a
board makes that promise testable by anyone with a spreadsheet.

### 8.1 How the schema enforces it

- **There is no rank column.** Position is `row_number()` over a computed ordering (§4.1). There is
  nothing to write, buy, or boost.
- **The ordering keys are server-computed only.** `peak_valuation` and `years_survived` come out of
  the replay, not out of a submission.
- **`pro_at_submit` lives on `runs`, never on `leaderboard_entries`.** It is not in either view, not
  in any index, and not in any `ORDER BY`. It exists so you can run §8.3 and prove the law holds.
- **No policy lets a player write an entry** (§6.3). There is no code path where money reaches the
  board, because there is no code path where a client reaches the board.
- **No revive, no retry-for-position.** A dead run submits once. `unique (profile_id, tape_hash)` and
  the per-board unique constraint mean a second attempt has to be a genuinely better run.
- **No Pro-only board and no Pro tie-break.** Ties break on survival, then date (§4.1).

### 8.2 Two violations that were live when this was written — both now fixed

> **Historical.** Both were repaired in the engine before the board was built. They are left here
> because the reasoning is what the CI assertions in §8.3 encode, and because a reader who finds
> them again will want to know they were found once already. `npm run test:board` fails if either
> comes back.

**1. `lib/engine/people.ts` — the Pro talent pool is mechanically better.**

```ts
const pro = i >= count - 2; // the last two are the Pro-tier talent
const performance = Math.round((pro ? 72 : 48) + rng() * (pro ? 24 : 30));
```

Pro candidates roll 72–96, free candidates 48–78. `hire()` calls `applyAura()`, whose amount scales
with `performance / 70`, and the aura moves `qual`, `brand`, `csat` and `gm_pt`. `deriveValuation()`
in `sim.ts` reads `qual` and `brand` directly:

```ts
const quality = 0.6 + state.stats.qual / 200 + state.stats.brand / 200;
```

So Pro buys valuation, today. `ProSheet.tsx` already describes the correct version of this feature —
"LinkedOut pool: Full talent pool" — which is a *choice* benefit, not a *quality* one. Make the
performance distribution identical for both tiers and let Pro buy more candidates, better filtering
and named specialists. Then the copy is true.

**2. `lib/engine/holdings.ts` — the best-appreciating asset is Pro-only.**

`art` is `pro: true` with `appreciation: 0.11`. The best free asset is `watch` at `0.09`. Assets
compound yearly in `tickHoldings()` and `sellHolding()` returns cash to `stats.cash`, and
`deriveValuation()` floors valuation at `Math.max(hyped, cash)`. For a pre-revenue or low-revenue
company, cash **is** the valuation, so a faster-appreciating Pro asset raises the board number
directly.

Either move `art` to free, or drop its appreciation to `0.09` or below so no purchasable asset
out-compounds a free one. Its own blurb — "The best-performing asset on this list" — makes the
problem hard to miss once you go looking.

**One thing that is already clean:** `TECH` has the highest valuation multiple in the catalogue
(`multiple: 8`) and is `free: true`. The best industry for a valuation board is not behind Pro. That
looks deliberate. Keep it that way with a test.

### 8.3 The tests that keep it honest

CI assertion, in the existing test path:

```ts
// The best valuation multiple must never be purchasable.
const best     = Math.max(...INDUSTRIES.map((i) => i.multiple));
const bestFree = Math.max(...INDUSTRIES.filter((i) => i.free).map((i) => i.multiple));
if (bestFree < best) throw new Error("Brand Law 4: a Pro industry out-values every free one");

// Same rule for assets.
const bestAsset     = Math.max(...ASSET_CATALOG.map((a) => a.appreciation));
const bestFreeAsset = Math.max(...ASSET_CATALOG.filter((a) => !a.pro).map((a) => a.appreciation));
if (bestFreeAsset < bestAsset) throw new Error("Brand Law 4: a Pro asset out-compounds every free one");
```

Both now pass, and they run on every pull request — see the "Leaderboard replay + Brand Law 4"
step in `.github/workflows/ci.yml`. The suite also samples a year of hiring pools and asserts that
a free candidate can be as good as any Pro one, which is the version of this check that the
`INDUSTRIES`/`ASSET_CATALOG` maxima cannot see.

Simulation assertion, using the harness that already exists: run `sim 30 8 1` with `pro: true` and
with `pro: false`. At a fixed seed the valuation and survival tables must be **identical**. This is
the same gate `docs/BUILD-PROMPT.md` specifies for cosmetics, applied to the thing that actually
threatens the law.

Standing audit query, run monthly:

```sql
-- Pro share of the top 100 should track Pro share of submissions.
-- A gap is a Brand Law 4 regression, not a curiosity.
select r.pro_at_submit, count(*), round(avg(e.peak_valuation)) as avg_peak
from public.leaderboard_entries e
join public.runs r on r.id = e.run_id
where e.board = 'valuation' and e.season = current_setting('app.season', true)
group by 1;
```

---

## 9 · COPPA and minors

This is a school product for players under 13. The engineering posture below is what keeps you out of
the COPPA consent regime rather than compliant within it — the cheapest way to handle personal
information from children is not to collect any. Have counsel confirm the result; do not have them
discover it.

### 9.1 What you store

| Field | Store it? | Why |
|---|---|---|
| Anonymous `auth.uid()` | Yes | Random UUID. Links to no person, no email, no device. |
| `display_name` (curated handle) | Yes | Assembled from a word list, not typed. |
| `company_name` | Yes, **moderated** | Player free text. See §9.3. |
| `industry`, `years_survived`, `peak_valuation`, `ended_by` | Yes | Game outcomes. Not personal information. |
| `achieved_on` (date) | Yes | Date only. |
| `seed`, `tape` | Yes, then expire | Needed for verification. See §9.5. |
| `RunState.founderName` | **No** | §9.2. |
| `RunState.playerAge` | **No** | §9.4. |
| Email, phone, password | **No** | Anonymous auth means there is nothing to collect. |
| Audio recordings | **No** | Already the rule in `lib/ai/transcribe.ts`: audio is processed and discarded. Do not break it for a leaderboard. |
| IP address, geolocation, device id | **No** | §9.6. |
| `timestamptz` on public rows | **No** | §9.6. |

### 9.2 Founder name: substitute it, do not publish it

`RunState.founderName` is what the player typed when they founded the company. For a nine-year-old
that is their first name, and often their full name. Publishing it on a world-readable board, next to
a company name that might identify a school, is the exact pattern COPPA exists to prevent.

The board column is `founder_display_name`, and it comes from a curated pool — an adjective, a noun
and four digits, generated client-side and validated server-side against the same word list by the
regex in §4. The player picks from a shuffle; they never type it. The tape carries
`founderName: ""` so the real name cannot be submitted by accident.

Show the real founder name locally, in the player's own run, on their own device, wherever the app
already shows it. That is theirs. The global board is not the place for it.

### 9.3 Company name: moderate before you list

`companyName` is free text a child typed. Across enough players it will contain real names, school
names, phone numbers, and slurs. A board that publishes it the instant it is submitted is a liability
you will find out about from a parent.

Entries land with `listed = false` (§4), which the read policy in §6.3 makes invisible to everyone.
Promotion to `listed` requires:

1. A blocklist pass at submit — profanity, and anything matching a phone number, an email, a URL, or a
   long digit run.
2. A length and character-class check. Nothing outside the printable range you actually render.
3. A human queue for everything that survives, until volume forces something smarter.
4. A report control on every board row, and a path that unlists in one click and asks questions after.

If moderation is more than you want to own, offer a curated company-name builder instead — the same
shape as the logo builder already proposed in `docs/BUILD-PROMPT.md`. Free text is a permanent
operational cost; a word list is not.

### 9.4 Player age: collected locally, never transmitted

`RunState.playerAge` exists for in-app age gating. Sending it to a server converts a local preference
into stored data about a child, held against a persistent identifier. Do not put it in the tape, the
runs table, or any log line. If you ever need age-band analytics, the honest answer is that you do not.

### 9.5 Retention

- `runs.tape` is verification evidence, not an archive. Delete it 30 days after `verified_at` via a
  scheduled job. The entry survives; the replay data does not.
- Rejected and flagged runs: keep the reason and the hash, drop the tape on the same schedule.
- Season rollover archives entries; it does not resurrect tapes.

Write the job when you write the schema. Retention policies that are added later are retention
policies that never get added.

### 9.6 What never touches the database

- **No IP addresses.** Rate-limit on IP at the edge if you must, and drop it. Do not write it to a
  row or a log you keep.
- **No `timestamptz` on public rows.** `achieved_on` is a `date`. A timestamp's time-of-day
  correlates with timezone, timezone is coarse location, and coarse location about a child is
  precisely the category to avoid. `runs.submitted_at` stays internal.
- **No analytics SDK on the leaderboard screen.** No third-party fonts, no CDN, no pixel. This is also
  why §1.4 matters: the board should add zero new origins to the app's network profile.
- **No profile-building.** Do not join board data against anything, do not compute per-player
  behavioural profiles, do not build recommendations from it. If this ships into schools, FERPA and
  state student-privacy laws (California's SOPIPA, and its equivalents) prohibit exactly that.

### 9.7 Deletion

A parent can demand deletion of a child's data. With anonymous auth there is nobody to authenticate,
so the path has to be in-app and on the device: a "remove me from the board" control that calls a
route handler which deletes the `profiles` row. The cascades in §4 take the runs and the entries with
it.

Making deletion easy is only possible because you collected almost nothing. That is the argument for
§9 in one line.

---

## 10 · Order of work

1. Fix the two Brand Law 4 violations in §8.2. Do this **before** the board exists, not after
   somebody screenshots the top ten.
2. Migration (§4) and policies (§6). Verify with the anon key that you cannot write
   `leaderboard_entries`. Try it. Watch it fail with `42501`.
3. `lib/leaderboard/tape.ts` and the recorder in `GameProvider` (§3.6).
4. `lib/leaderboard/verify.ts`. Test it against `scripts/simulate.mjs` output: a tape produced by the
   sim must verify, and the same tape with one number edited must not.
5. Session and submit routes (§5). Rate limits on from day one, not day thirty.
6. Moderation queue (§9.3) before a single entry is `listed`.
7. The board screen.
8. The CI assertions in §8.3 and the retention job in §9.5.

---

## 11 · Open items — what is still not done

Three of the five below were closed by the build. The two that remain are marked.

- ✅ **Tape recording** — done. `lib/state/GameProvider.tsx` appends inside every mutation, before
  `commit()`.
- ✅ **Brand Law 4 fixes** — already repaired in the engine; the assertions that keep them repaired
  now run in CI (§8.3).
- ✅ **The valuation board's name** — "Peak Valuation". The screen is titled *Still Standing* and the
  survival board keeps that name as its segment.
- ✅ **Dependency** — no new one. `@supabase/supabase-js` was already here for saves and billing, and
  `@supabase/ssr` is still not needed.

**Still open:**

- **Peak valuation on screen during a live run.** No `RunState` field records it (§2), and the
  server computes it during replay, so the board is correct without one. A player cannot see their
  own peak while playing. Closing that is an additive `peakValuation?: number` maintained in
  `refreshBooks()` in `lib/engine/sim.ts` — protected, needs sign-off, and the board must not trust
  it either way.

- **The recorder and the shared orchestration can still drift.** `scripts/leaderboard-test.mjs`
  drives the same functions `GameProvider` drives and proves a recorded tape replays to the company
  that produced it — but its driver is not `GameProvider`. If somebody adds a mutation to the
  provider and forgets the `record` call beside it, that suite still passes and the tape silently
  stops describing the run. Sharing the orchestration shrinks the surface; it does not remove it.
  The real fix is a provider-level test, which needs React in the harness.
