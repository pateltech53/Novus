# Accounts setup

Email + password accounts, and what has to be true in the Supabase dashboard
for them to work.

Accounts are optional for the player and optional for the deploy. With no
Supabase project configured the app still runs — the whole free game, on
localStorage, exactly as before. What accounts buy is portability (your
companies follow you to a new phone) and, crucially, **a durable thing for a
purchase to attach to**.

---

## 1. The SQL to run

Three migrations, in order, in the Supabase SQL editor:

```
supabase/migrations/0003_billing.sql        ← if you have not run it yet
supabase/migrations/0004_accounts.sql
supabase/migrations/0005_auth_throttle.sql
```

**Accounts themselves need no new tables and no new columns.** That is worth
saying plainly, because it is the sort of thing that looks like an omission:

- The email and password hash live in `auth.users`, which Supabase owns. We do
  not mirror the email into `public.profiles` — it would be a second copy of
  the one piece of personal information this app collects, kept in sync by
  hand, and no query needs it.
- `public.profiles` already keys on `auth.users(id) on delete cascade` and
  already holds `display_name`. A permanent user and an anonymous one are the
  same row shape, so every RLS policy in 0001 and 0002 keeps working untouched.
- Entitlements were **always** account-scoped. `entitlements.profile_id` is the
  auth user id, never a device id. "Purchases follow the account" required no
  schema change because the schema never tied them to a device.

So `0004` contains one thing: a sweep that deletes abandoned anonymous users
(see §5). `0005` is the rate limiter that stops bulk sign-ups (see §6).
Everything else about accounts is Supabase configuration and app code.

To check the migrations before trusting them, against a plain local Postgres:

```sh
createdb novus
psql -d novus -f supabase/tests/_supabase_shim.sql \
              -f supabase/migrations/0001_novus_core.sql \
              -f supabase/migrations/0002_leaderboard.sql \
              -f supabase/migrations/0003_billing.sql \
              -f supabase/migrations/0004_accounts.sql \
              -f supabase/migrations/0005_auth_throttle.sql \
              -f supabase/tests/accounts_test.sql \
              -f supabase/tests/throttle_test.sql
```

Section 1 is supposed to print a permission error — that is the assertion that
a signed-in player cannot call the sweep. If it ever succeeds, any visitor can
delete every other player in the database.

---

## 2. Dashboard settings

**Authentication → Sign In / Providers → Email**

| Setting | Value | Why |
|---|---|---|
| Email provider | **Enabled** | Otherwise sign-up returns "not enabled" |
| **Confirm email** | **OFF** | See below |
| Minimum password length | 8 or lower | The app asks 8; a higher floor here would reject passwords its own form accepted |

**Anonymous sign-ins → you can turn this OFF.** Novus no longer creates
anonymous users. A player without an account sends nothing at all: no user is
minted, no save leaves the device, and the game runs on localStorage exactly as
it does with no Supabase configured.

That is a deliberate reversal. `/api/session` used to mint an anonymous
identity on every visitor's first page load, which cost a permanent row about a
child and bought them almost nothing — an anonymous identity lives only in a
cookie, so it could not be signed back into, could not reach a second device,
and died in exactly the case a backup exists for. Leaving the setting enabled is
harmless (nothing calls it), but off is the honest match to what the app does.

### On "Confirm email: OFF"

This is a deliberate choice, and it has a cost worth understanding.

With confirmation off, `signUp()` returns a session immediately and the player
walks straight into the game. That is the flow this app is written for.

The cost: **nothing proves the address is real at sign-up.** Someone can type
a typo, or another person's address, and still get an account. Two consequences:

- A player who typos their email and forgets their password has no way back
  into an account that may have a subscription on it. The reset email is the
  only recovery path and it goes to an address that does not exist.
- The real owner of a mistyped address can claim that account later by
  requesting a password reset. That is standard behaviour, not a bug, but it
  means an unconfirmed address is not evidence of anything.

If you later decide the recovery risk outweighs the extra step, turn
confirmation **on**: the code already handles it. `/api/auth/signup` returns
`{ needsConfirmation: true }` when Supabase withholds the session, and the
front door tells the player to check their email instead of pretending they are
signed in.

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | your deployed origin, e.g. `https://novuspitch.com` |
| Redirect URLs | add `https://novuspitch.com/reset` **and** `https://novuspitch.com/join/setup` (plus the `http://localhost:3000` pair for local work) |

The reset link will not work without that redirect entry — Supabase refuses to
send players to a URL that is not on the allow-list, which is exactly the
protection you want. `/join/setup` is the second entry: chapter invites end
there rather than on `/reset`, because a student being handed a seat has never
had a password to reset (docs/CHAPTERS.md §2).

What a missing entry looks like is worth knowing: Supabase does not refuse the
link, it redirects to the **Site URL** with the session still in the fragment.
`components/AuthHashRelay.tsx` sits on the front door and forwards those to the
right page, so the flow survives a forgotten entry — but it is a net, not the
configuration.

---

## 3. What each route does

| Route | Purpose |
|---|---|
| `POST /api/auth/signup` | Create an account. Body `{ email, password, displayName }` |
| `POST /api/auth/signin` | Sign back in |
| `POST /api/auth/signout` | Clear the session on this device |
| `POST /api/auth/reset` | Send a reset email. Always answers the same, account or not |
| `POST /api/auth/reset/confirm` | Finish a reset — or set up an invited seat — using the tokens from the email link. Optional `displayName` names an account that has never been named |
| `GET /api/auth/me` | Who is signed in, and whether they are anonymous |
| `POST /api/auth/delete` | Erase the account and everything attached to it |

The browser never talks to Supabase. Credentials are posted to our own origin
and used server-side, the session lives in an httpOnly cookie no script can
read, and no third-party auth endpoint is contacted from a page a minor is
looking at — the same rule the rest of the app follows.

---

## 4. What happens to progress at sign-up and sign-in

Sign-up creates a brand-new auth user. There is nothing to convert — a player
without an account has no server-side identity at all now (§2) — and
Supabase's in-place conversion would not have been usable anyway: it requires
**manual linking (beta)** AND the email **verified before a password may be
set**, which cannot coexist with signing straight in.

The two paths deliberately do opposite things with the device:

- **Sign-up KEEPS it.** The companies in localStorage are the player's own, and
  they made an account to hold onto them. `signUp()` pushes them into the new
  account immediately (`pushLocalNow`) rather than waiting for the debounced
  write, which would never fire for someone who signs up and closes the tab.
- **Sign-in WIPES it, then pulls.** Signing in is a claim to a different
  identity, and on the machines this app is used on the data sitting there very
  often belongs to another student. Leaving it would show their companies under
  the new player's name, route past onboarding using their profile, leak their
  cached Pro, and push their save up over the cloud copy the signing-in player
  came back for.

**Purchases cannot be stranded, by construction.** `/api/billing/checkout`
refuses to sell to an anonymous identity at all, so you sign up and then you
buy, never the other way round. That refusal is the load-bearing piece, and it
still stands for old anonymous cookies that predate this build.

---

## 5. Abandoned anonymous users

Novus no longer creates these (§2), but earlier builds did — every visitor who
played without an account got an anonymous `auth.users` row, a profile, and
whatever they played, kept forever. If your project ran a build before this one,
those rows are still there.

`0004` adds a sweep for them:

```sql
select public.delete_stale_anonymous_users();                  -- 90 days
select public.delete_stale_anonymous_users(interval '30 days');
```

It only ever touches users that are anonymous, idle for the whole window, and
have no entitlements and no Stripe customer row. A real account is never
touched no matter how old, and neither is an anonymous user with any evidence
of a purchase.

Nothing of value is lost: an anonymous user cannot be signed back into by
definition, so a player whose row is swept could never have reached it again.

Run it once from the SQL editor to clear the backlog. Scheduling it is optional
now that nothing creates new anonymous users — 0004 has a `cron.schedule` call
commented out at the bottom if you want it anyway, left commented because
enabling an extension is a decision about your project, not one a migration
should make for you.

---

## 6. Bulk sign-up protection

Supabase rate-limits auth by IP. Novus never lets the browser talk to Supabase,
so Supabase sees **one** address for every player in the world: ours. Its
per-IP limit therefore protects nothing here, and without a replacement a
script could open accounts as fast as it could post.

`0005` is the replacement. The counter lives in Postgres because the app runs
serverless — an in-process counter is per-instance, resets on every cold start,
and three instances would mean three times the limit.

| Bucket | Limit | Window |
|---|---|---|
| `signup:ip` | 5 | 15 min |
| `signin:ip` | 30 | 15 min |
| `signin:email` | 10 | 15 min |
| `reset:ip` | 5 | 15 min |
| `reset:email` | 3 | 60 min |

Five sign-ups per address per fifteen minutes is far above what a real person
does — a family behind one router, a teacher setting up alongside a class — and
far below what makes bulk creation worth automating. The two sign-in buckets
cover different attacks: per-address stops one machine grinding a word list,
per-account stops a distributed attempt on one player, which is what credential
stuffing actually looks like.

**No IP address is stored.** 0001's header forbids putting one in this schema
(§9.6), and rate limiting is exactly the feature that wants to. What reaches the
database is an HMAC of the address under a server-only secret, truncated —
opaque, unreversible without the secret, lossy even with it, and deleted when
its window closes. That is a real trade rather than a clean win, and
`0005`'s header states it so the next person weighs the same thing.

**It needs `SUPABASE_SERVICE_ROLE_KEY`.** Without it there is no admin client
and no HMAC secret, so nothing can be counted and the throttle allows
everything. That is the local-development case; a deploy missing that variable
has **no rate limiting at all**, which is said here plainly because a
protection you have to be told about is worth more than one you assume.

Optional: schedule `select public.prune_auth_throttle();` with `pg_cron` to
clear closed windows. The table stays small without it, but old rows are
retained data.

---

## 7. The human check on sign-up (Cloudflare Turnstile)

Optional, free, and off until you set two environment variables. Three
minutes:

1. `dash.cloudflare.com` → **Turnstile** → **Add site**
2. Add your domain, and `localhost` too if you want it locally
3. Copy the two keys into your environment:

```sh
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x...    # public, goes in the page
TURNSTILE_SECRET_KEY=0x...              # server only, never NEXT_PUBLIC_
```

That is the whole setup. Unset either one and the widget does not render and
the server requires nothing, which is how local development runs.

**Leave Supabase's own Attack Protection OFF.** Turning it on applies a captcha
requirement to *every* auth endpoint at once — sign-in and password reset would
each need their own widget or simply stop working. Sign-up is the door worth
guarding, because creating accounts in bulk is the abuse, so the token is
verified in `/api/auth/signup` instead.

### Where it sits relative to the rate limiter

They are different defences and both are worth having. The limiter (§6) bounds
how fast *anything* can happen and works even when Cloudflare is unreachable.
The captcha raises the cost of each individual attempt. A script that solves
one still hits five sign-ups per address per fifteen minutes.

Order in the route is deliberate: the limiter runs first, because it is a
single cheap upsert and the captcha is a round trip to Cloudflare — a flood
should be stopped by the cheap thing.

### It fails closed

If Cloudflare cannot be reached, sign-up is refused rather than waved through.
The alternative would mean anyone wanting unlimited accounts need only stop our
server reaching `challenges.cloudflare.com`, which turns a dependency into the
bypass. The blast radius of a Cloudflare outage is "new sign-ups pause" —
playing, signing in and everything else are untouched.

### The third-party script exception

`docs/LEADERBOARD.md` §1.4 and §9.6 rule out third-party scripts on pages shown
to minors, and the rest of the app holds that line: Supabase and Stripe are both
reached through our own origin for exactly this reason. This is the one
exception, kept as narrow as it can be:

- The script loads **only when the sign-up form is opened**. A visitor who reads
  the landing page, or plays the whole free game without an account, never
  contacts Cloudflare — the tag does not exist for them.
- Turnstile sets no cookies and builds no cross-site profile. That is why it,
  and not reCAPTCHA, is the one that is defensible in front of children.

---

## 8. What is NOT built

- **Changing your email.** There is no route for it. It needs the same
  verification dance as anonymous conversion, and doing it badly means locking
  someone out of a paid account.
- **Merging two accounts.** Signing in on a device that was playing anonymously
  takes over; the anonymous progress is not merged in. Merging would mean
  choosing which company survives, and there is no answer to that a player
  would thank us for.
- **Any account requirement for playing.** The free game needs no account, and
  the pricing copy that promises this ("Free is the whole game") stays true.

---

## 9. Minors, honestly

This is the part to read before launch, not after.

The app now collects an email address and a password from people who may be
children, and `docs/STRIPE-SETUP.md` §7 records the decision that minors may see
a checkout button. Those two decisions together have legal weight:

- **COPPA (US)** requires verifiable parental consent before collecting
  personal information from a child under 13, and an email address is personal
  information. "Verifiable" means more than a checkbox.
- **UK/EU** rules set the age of consent for data processing between 13 and 16
  depending on the country, with the UK's Age Appropriate Design Code applying
  on top for services likely to be accessed by children.

What the code does to limit exposure, all of it deliberate:

- The free game needs **no account at all**, and playing without one transmits
  nothing whatsoever — no email, no identifier, no save. A younger player can
  use the whole product without us holding a single field about them.
- The only fields collected are a display name the player invents, an email,
  and a password. No age is stored server-side — `RunState.playerAge` is used
  for local gating and never transmitted (`docs/LEADERBOARD.md` §9.4). No phone,
  no address, no school, no photo.
- The privacy policy asks parents of under-13s to create the account themselves
  with their own address, and `/api/auth/delete` makes deletion real and
  immediate rather than a support ticket.
- The only identifier Stripe receives is the anonymous profile UUID.

None of that is the same as compliance, and this file is not legal advice. If
Novus is going to be handed to under-13s in the US, the honest options are a
real parental-consent flow, an age gate that routes younger players to the
account-free path, or school-mediated accounts under COPPA's schools exception.
That is a decision to make knowingly rather than by default.
