# Chapters — seats for classrooms and clubs

A chapter is seats bought by one adult as a yearly subscription — a fixed 35
or 100. Every seat is Pro for the licence year. This document is the
operator's view: what to run, what to configure, and how the flow behaves end
to end.

The licences: **$799 / year for 35 seats** and **$1,599 / year for 100 seats**
(`chapter_35`, `chapter_100` in `lib/monetization.ts`). The live Stripe
product ids ship as in-code defaults — see `docs/STRIPE-SETUP.md` §2.

**Custom sizes** (`chapter_custom`, 10–10,000 seats) **are not self-serve.**
The pricing page used to carry a seat-count field that quoted any size on the
spot and opened checkout on it. That generator is gone, and
`/api/billing/checkout` now refuses `chapter_custom` outright with the team
address: a buyer big enough to need their own number needs a purchase order,
an invoice, a data-protection answer and a start date, and a form that takes
their card before any of that has been said answers none of it.

What remains of `chapter_custom` is the operator's half, and it still works:

* **Granting one** — the console (`/admin`, or `POST /api/admin/chapters`
  with `licence: "chapter_custom"` and a `seats` count) creates the chapter
  directly. `isCustomSeatCount` still bounds the number at 10–10,000.
* **Billing one** — raise the invoice or subscription in Stripe with
  `novus_sku: chapter_custom` and a `seats` metadata value.
  `customChapterPriceCents` is still the house formula to quote from: below 35
  seats the 35-seat per-seat rate, 35→100 a straight line between the two tier
  prices, above 100 the 100-seat rate carried on, rounded to whole dollars. At
  exactly 35 or 100 it equals the tier price to the cent.
* **Reading one back** — `lib/stripe/chapter.ts` still resolves the seat count
  off a subscription's metadata, so licences already sold this way keep
  renewing and keep their seats.

Custom sizes are changed by support (edit the subscription in Stripe), not by
the portal's plan switcher, which only knows the two fixed prices.

---

## Native access

The iOS/Android app manages an existing enterprise; enterprise registration
and payment remain on the web. Owners and platform administrators enter a
Console / Island chooser after native sign-in or cold start. Owners open
`/chapter`; platform administrators open `/admin`, with MY ENTERPRISE when
both roles apply. Ordinary members continue into their game. The chooser uses
live ownership, includes lapsed licences, excludes deleted ones, and does not
replace either console's authorization. Details, member invitation/resend and
removal remain available in the owner console. `/chapter/new` in the app only
explains the account arrangement and links to the existing enterprise console.

## 1. What to run

Before this release, apply **`20260917054417_chapter_account_setup.sql`** after 0020. It creates service-only account setup state and backfills existing invitations. Deploy the migration before the web app; without it invitation and password setup fail closed.

One file: **`supabase/APPLY-ALL.sql`** — the whole schema, 0001 → 0020 plus account setup, safe
on any starting state. Paste it into the Supabase SQL editor of the NOVUS
project and run it once: it creates whatever is missing, changes nothing
that already exists, refuses outright if pasted into the wrong project, and
ends by printing one `ok` row per migration.

`supabase/CHECK-SCHEMA.sql` is the read-only companion — it only reports
which migrations a project has. The numbered files in `supabase/migrations/`
remain the per-change source of truth; chapters specifically are 0007, 0008
and 0011 (custom sizes — without it, a custom purchase's webhook write is
refused by the licence check constraint and Stripe retries until it lands).
Migration **0020 must be deployed before this web release**: it adds enterprise
profiles, the member-safe name read, atomic subscription sync/removal, and the
deletion tombstone. An existing project through 0019 must run
`0020_enterprise_lifecycle.sql` and then the account-setup migration above;
APPLY-ALL also supports a fresh project.

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
3. Supabase → Authentication → URL Configuration must include **both**
   `https://<your-domain>/join/setup` and `https://<your-domain>/reset` (and
   the `http://localhost:3000` pair for local work). `/join/setup` is the
   welcome screen every invite ends on; `/reset` is where an ordinary
   password reset lands.

   Supabase does not fail loudly on a missing entry — it redirects to the
   Site URL instead, session and all. `AuthHashRelay` on the front door
   catches that and forwards the link to the right page, so a forgotten
   entry does not cost a student their seat, but the entry is still the
   thing to set.

With Resend configured, **no chapter email touches Supabase's mailer at
all**: the invite goes out through Resend, and the choose-your-password link
is minted server-side (`auth.admin.generateLink`) and delivered through
Resend too.

With `RESEND_API_KEY`/`RESEND_FROM` unset, invites fall back to Supabase's
own **invite** email (`auth.admin.inviteUserByEmail` — the "You have been
invited" template, whose link lands on `/join/setup`): zero extra setup, fine for
a handful of seats, throttled far below classroom volume. The console
reports each address either way, and says which mailer carried the batch.
The fallback never sends the **recovery** template to a fresh invitee —
"we received a request to reset your password" to someone who never asked
reads as a phish. For confirmed accounts that still need first-time setup, the fallback uses
Supabase recovery delivery with `/join/setup` as the destination. If you use the fallback, give the
"Invite user" template a once-over in Supabase → Auth → Email Templates so
its copy matches your voice.

## 3. How a chapter comes to exist

1. START 35/100 SEATS opens `/chapter/new`. After signing in, the buyer enters
   enterprise name, organisation type, contact name and contact email, then
   continues to Stripe. These fields are validated again on the server and
   carried in checkout/subscription metadata. Other sizes remain contact-led.
2. Stripe's webhook (`checkout.session.completed`) creates the `chapters`
   row. The buyer's own entitlements are untouched — a teacher does not
   become Pro by buying seats for students. The success redirect lands on
   `/chapter`, which polls briefly while the webhook races it.
3. Renewals, lapses, portal plan-changes (35 ↔ 100) arrive as
   `customer.subscription.*` events. A lapse turns every seat off in one
   statement and keeps the roster; renewal turns the same seats back on.
   `past_due` keeps access, same as Pro (`lib/stripe/subscription.ts`).
   Current Stripe prices determine fixed-tier changes, even if old SKU
   metadata remains on the subscription. Renewals preserve profile edits.

The owner can edit details on `/chapter`. Legacy or operator-created chapters
without details must finish that form before inviting or registering members.
Only the enterprise name is visible to members; contact details remain
owner-only. Operator checkout skips use the same registration fields.

## 4. Handing out seats — /chapter

Two paths, both per-row (one typo fails one row, never the paste):

- **INVITE BY EMAIL** — `email` or `email, name`, one per line. New
  addresses get an account with a random password and a mailbox-only,
  one-time setup link. Both mailers land on `/join/setup`, where the student
  chooses their name and password. A removed but unfinished account receives
  another setup email when invited again. Established accounts get their
  seat with no email or password change. RESEND uses setup mail while pending
  and ordinary reset mail after completion. Old `/join?code=…` links remain
  usable to request a fresh setup email; they never return a recovery URL
  or rename an account, even if a request overlaps setup completion.
- **REGISTER WITH PASSWORDS** — `email, password` or `email, password,
  name`, typed or imported from a CSV. Accounts work immediately; nothing is
  emailed. An address that already has an account is refused on this path —
  registering must never overwrite an existing password — and the row says
  to invite instead.

REMOVE atomically frees the seat and clears the entitlement. The player's account,
saves and board entries survive; free Novus is still the whole game.

The service-only `chapter_account_setup` row follows the account, survives
seat/enterprise removal, and disappears when the account is deleted. Its
completion write can be retried with the same password if interrupted.

An invitation's `invite_sent_at` records acceptance by the mail API, only after
success; it does not assert inbox delivery. Failed sends keep their row and
explicit retry warning. `claimed_at` now means password setup completed, on
both mailer paths. Merely opening `/join` does not claim anything. Completing
setup retires the original invite token immediately. The old one-hour
post-claim reopening window is removed. A password-write/DB-write interruption
returns a retryable error without changing the browser's existing account.
Rotated handover credentials stay with the form for retry, under the original
expiry; only complete success adopts the invited account and clears local data.

The password-page handover survives refresh in tab-scoped sessionStorage for
at most 15 minutes; success, expiry, sign-out and account switches clear it.

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
The actual enterprise name appears beside that scope. Scores with acceptable
names publish after server verification, without pre-publication human
approval; `NOVUS_BOARD_AUTOLIST` is retired. Missing scores/nicknames and failed
verification still prevent listing. Reports and operator takedowns remain.

## 6. Deleting an enterprise

The owner opens the deletion section on `/chapter`, types `DELETE`, and confirms.
The server proves ownership of that exact enterprise again. A paid subscription
is cancelled first, without automatic proration/refund. If Stripe cannot confirm
cancellation, nothing is deleted. A failure after cancellation can be retried.

The database then removes all member seats and their enterprise-only access in
one transaction. Personal accounts, saves, public scores and separately bought
Pro/packs remain. Basic information is cleared. A minimal deleted licence row
retains its subscription reference so delayed/retried webhooks cannot recreate
the enterprise; it is excluded from ownership and membership views. Seat grants,
member removal, enterprise deletion and subscription updates share a row lock.

Deleting the owner account, through Settings or the operator console, uses
this same cancellation/tombstone sequence for every owned enterprise, including
lapsed access records. Unknown billing state, a failed chapter query or failed
atomic cleanup blocks account deletion and preserves a retry path. Cleanup no
longer ignores a database error or revokes seats before cancellation succeeds.

## 7. Privacy notes, because a classroom is the audience

- `chapter_seats.email` is the address **the admin typed**, readable only by
  that chapter's owner (RLS) and deleted with the seat. It is not a copy of
  `auth.users` — 0004's position stands.
- Students never see each other's emails or enterprise contact details; a
  member sees their own entitlement, the enterprise name and the board toggle.
- The invite email is the app's own (lib/chapter/emails.ts) — plain HTML,
  no images, no tracking pixel, nothing that phones home. In fallback mode
  it is Supabase's standard invite mail instead; customising that copy
  (Auth → Email Templates → "Invite user") is optional and safe.
