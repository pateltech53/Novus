# Chapters — seats for classrooms and clubs

A chapter is seats bought by one adult as a yearly subscription — a fixed 35
or 100, or any size the buyer types. Every seat is Pro for the licence year.
This document is the operator's view: what to run, what to configure, and how
the flow behaves end to end.

The licences: **$299 / year for 35 seats** and **$599 / year for 100 seats**
(`chapter_35`, `chapter_100` in `lib/monetization.ts`). The live Stripe
product ids ship as in-code defaults — see `docs/STRIPE-SETUP.md` §2.

**Custom sizes** (`chapter_custom`, 10–500 seats): the buyer types a seat
count on the pricing page and reads the exact yearly price it computes to —
below 35 seats the 35-seat per-seat rate, 35→100 a straight line between the
two tier prices, above 100 the 100-seat rate carried on, rounded to whole
dollars (`customChapterPriceCents`). At exactly 35 or 100 it equals the tier
price to the cent. No Stripe product or env var to set up: checkout sends the
server-computed amount as `price_data`, and the webhook reads the size back
off the subscription's metadata. The one thing the client ever chooses is the
seat COUNT — the price is computed server-side from it, by the same function
the screen displayed. Custom sizes are changed by support (cancel and rebuy,
or edit the subscription in Stripe), not by the portal's plan switcher, which
only knows the two fixed prices.

---

## 1. What to run

One file: **`supabase/APPLY-ALL.sql`** — the whole schema, 0001 → 0011, safe
on any starting state. Paste it into the Supabase SQL editor of the NOVUS
project and run it once: it creates whatever is missing, changes nothing
that already exists, refuses outright if pasted into the wrong project, and
ends by printing one `ok` row per migration.

`supabase/CHECK-SCHEMA.sql` is the read-only companion — it only reports
which migrations a project has. The numbered files in `supabase/migrations/`
remain the per-change source of truth; chapters specifically are 0007, 0008
and 0011 (custom sizes — without it, a custom purchase's webhook write is
refused by the licence check constraint and Stripe retries until it lands).

`supabase/tests/chapters_test.sql` checks the schema against a local Postgres
the same way `billing_test.sql` does (`npm run test:db`).

## 2. The email setup

**Invites are sent through Resend** (resend.com) — they are the app's own
mail, at classroom volume, which is exactly what Supabase's built-in auth
mailer is not for. Three steps:

1. resend.com → create an API key → `RESEND_API_KEY`.
2. Resend → Domains → verify your sending domain, then set `RESEND_FROM`
   (e.g. `Novus <chapters@novuspitch.com>`). An unverified domain refuses
   every send — the console shows the refusal per row.
3. Supabase → Authentication → URL Configuration must include
   `https://<your-domain>/reset` — the invite's claim step hands the student
   a link that ends there (it is the same set-password page the ordinary
   password reset uses).

With Resend configured, **no chapter email touches Supabase's mailer at
all**: the invite goes out through Resend, and the choose-your-password link
is minted server-side (`auth.admin.generateLink`) and delivered through
Resend too.

With `RESEND_API_KEY`/`RESEND_FROM` unset, invites fall back to Supabase's
own **invite** email (`auth.admin.inviteUserByEmail` — the "You have been
invited" template, whose link lands on `/reset`): zero extra setup, fine for
a handful of seats, throttled far below classroom volume. The console
reports each address either way, and says which mailer carried the batch.
The fallback never sends the **recovery** template to a fresh invitee —
"we received a request to reset your password" to someone who never asked
reads as a phish. Recovery mail appears only where it is true: a RESEND to
a seat whose account is already claimed. If you use the fallback, give the
"Invite user" template a once-over in Supabase → Auth → Email Templates so
its copy matches your voice.

## 3. How a chapter comes to exist

1. A signed-in buyer presses START 35/100 SEATS — or types a size into the
   CUSTOM row and starts that — in the pricing section. Checkout refuses
   anonymous identities, exactly as it does for Pro.
2. Stripe's webhook (`checkout.session.completed`) creates the `chapters`
   row. The buyer's own entitlements are untouched — a teacher does not
   become Pro by buying seats for students. The success redirect lands on
   `/chapter`, which polls briefly while the webhook races it.
3. Renewals, lapses, portal plan-changes (35 ↔ 100) arrive as
   `customer.subscription.*` events. A lapse turns every seat off in one
   statement and keeps the roster; renewal turns the same seats back on.
   `past_due` keeps access, same as Pro (`lib/stripe/subscription.ts`).

## 4. Handing out seats — /chapter

Two paths, both per-row (one typo fails one row, never the paste):

- **INVITE BY EMAIL** — `email` or `email, name`, one per line. New
  addresses get an account (random password, never shown) and a Resend
  invite email whose link lands on `/join?code=<token>`: the student
  confirms their email and name, and is handed straight into `/reset` to
  choose a password — signed in at the end, seat lit. The token only exists
  for accounts the invite itself created, so a claim can never open an
  account somebody already owned. Addresses that already have a Novus
  account are granted the seat with **no email** — their password is their
  business. Re-pasting an address resends the right email for its state
  (claim link while unclaimed, choose-a-password link after); so does the
  RESEND button on the roster.
- **REGISTER WITH PASSWORDS** — `email, password` or `email, password,
  name`, typed or imported from a CSV. Accounts work immediately; nothing is
  emailed. An address that already has an account is refused on this path —
  registering must never overwrite an existing password — and the row says
  to invite instead.

REMOVE frees the seat and clears the entitlement. The player's account,
saves and board entries survive; free Novus is still the whole game.

The seat cap is enforced in the database (`enforce_chapter_seat_cap`), so a
licence downgraded below its roster keeps every existing seat and refuses
new ones until it is back under the cap.

## 5. What a seat changes, and what it never does

`entitlements.chapter` is set for each member, and `isPro()` already treats
that as Pro — industries, The Room, three runs a day. Brand Law 4 holds:
nothing about a seat touches score, survival, revives or board position.

The board gains one thing: members (and the owner) see a **MY CHAPTER**
toggle on Still Standing that re-ranks the same public rows within the
chapter. Nothing unlisted becomes visible, and nothing about a player is
shown there that the global board does not already show.

## 6. Privacy notes, because a classroom is the audience

- `chapter_seats.email` is the address **the admin typed**, readable only by
  that chapter's owner (RLS) and deleted with the seat. It is not a copy of
  `auth.users` — 0004's position stands.
- Students never see each other's emails; a member's only view of the
  chapter is their own entitlement and the board toggle.
- The invite email is the app's own (lib/chapter/emails.ts) — plain HTML,
  no images, no tracking pixel, nothing that phones home. In fallback mode
  it is Supabase's standard invite mail instead; customising that copy
  (Auth → Email Templates → "Invite user") is optional and safe.
