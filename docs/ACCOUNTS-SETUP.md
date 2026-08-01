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

Two migrations, in order, in the Supabase SQL editor:

```
supabase/migrations/0003_billing.sql     ← if you have not run it yet
supabase/migrations/0004_accounts.sql
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
(see §5). Everything else about accounts is Supabase configuration and app code.

To check the migrations before trusting them, against a plain local Postgres:

```sh
createdb novus
psql -d novus -f supabase/tests/_supabase_shim.sql \
              -f supabase/migrations/0001_novus_core.sql \
              -f supabase/migrations/0002_leaderboard.sql \
              -f supabase/migrations/0003_billing.sql \
              -f supabase/migrations/0004_accounts.sql \
              -f supabase/tests/accounts_test.sql
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

**Anonymous sign-ins → keep Enabled.** They are still how a player without an
account gets their save synced. Turning them off does not break the game (it
falls back to localStorage) but it does remove cloud backup for free players.

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
| Redirect URLs | add `https://novuspitch.com/reset` (and `http://localhost:3000/reset` for local work) |

The reset link will not work without that redirect entry — Supabase refuses to
send players to a URL that is not on the allow-list, which is exactly the
protection you want.

---

## 3. What each route does

| Route | Purpose |
|---|---|
| `POST /api/auth/signup` | Create an account. Body `{ email, password, displayName }` |
| `POST /api/auth/signin` | Sign back in |
| `POST /api/auth/signout` | Clear the session on this device |
| `POST /api/auth/reset` | Send a reset email. Always answers the same, account or not |
| `POST /api/auth/reset/confirm` | Finish a reset using the tokens from the email link |
| `GET /api/auth/me` | Who is signed in, and whether they are anonymous |
| `POST /api/auth/delete` | Erase the account and everything attached to it |

The browser never talks to Supabase. Credentials are posted to our own origin
and used server-side, the session lives in an httpOnly cookie no script can
read, and no third-party auth endpoint is contacted from a page a minor is
looking at — the same rule the rest of the app follows.

---

## 4. Sign-up mints a NEW identity, and why that is fine

Signing up does not convert the device's existing anonymous user. It creates a
separate one.

That is not a shortcut — Supabase's in-place conversion requires **manual
linking (beta)** to be enabled AND the email to be **verified before a password
may be set**, which is incompatible with signing straight in (§2). So the
anonymous user is left behind.

Nothing important is stranded, because of what each thing is:

- **Saves follow the player anyway.** `lib/cloud/sync.ts` treats localStorage as
  the source of truth and pushes it up to whatever account is signed in. The
  companies on the device carry across to the new account by themselves.
- **Purchases cannot be stranded, by construction.**
  `/api/billing/checkout` refuses to sell to an anonymous identity at all. You
  sign up, then you buy — never the other way round. An anonymous player who
  taps CHOOSE PRO is told to make an account first.

That refusal is the load-bearing piece. An anonymous identity exists only as
long as its cookie; selling a subscription to one would mean the player loses
it the first time they clear their browser, with no email, no password, and no
way on earth to prove they paid.

---

## 5. Abandoned anonymous users

Every visitor who plays without an account gets an anonymous `auth.users` row so
their save can sync. Most will never come back. Each one is a row, plus a
profile, plus whatever they played — kept forever, about a child, for no
purpose.

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

Run it by hand from the SQL editor, or schedule it with `pg_cron` — 0004 has the
`cron.schedule` call commented out at the bottom, left commented because
enabling an extension is a decision about your project, not one a migration
should make for you.

---

## 6. What is NOT built

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

## 7. Minors, honestly

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

- The free game needs **no account at all**, so a younger player never has to
  give an email to play.
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
