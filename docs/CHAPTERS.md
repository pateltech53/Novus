# Chapters — seats for classrooms and clubs

A chapter is 35 or 100 seats bought by one adult as a yearly subscription.
Every seat is Pro for the licence year. This document is the operator's view:
what to run, what to configure, and how the flow behaves end to end.

The licences: **$299 / year for 35 seats** and **$599 / year for 100 seats**
(`chapter_35`, `chapter_100` in `lib/monetization.ts`). The live Stripe
product ids ship as in-code defaults — see `docs/STRIPE-SETUP.md` §2.

---

## 1. What to run, in order

Chapters need two migrations on top of whatever the project already has:

```
supabase/migrations/0007_chapters.sql    # chapters, chapter_seats, grants
supabase/migrations/0008_board_rank.sql  # my rank + the chapter board (needs 0007)
```

Paste each into the Supabase SQL editor (Database → SQL Editor), 0007 first.
A fresh project needs the whole set in order: 0001 → 0008.

`supabase/tests/chapters_test.sql` checks the schema against a local Postgres
the same way `billing_test.sql` does.

## 2. The two Supabase settings this feature leans on

1. **Redirect URL.** Authentication → URL Configuration must include
   `https://<your-domain>/reset` — the same entry password reset already
   requires (`docs/ACCOUNTS-SETUP.md` §4). Invites reuse that exact email.
2. **Real SMTP.** Supabase's built-in mailer sends a handful of emails an
   hour, which is fine for one forgotten password and useless for inviting a
   classroom. Before inviting at volume, configure custom SMTP (Project
   Settings → Auth → SMTP) or invites will land as per-row failures the
   console reports and RESEND can retry later.

## 3. How a chapter comes to exist

1. A signed-in buyer presses START 35/100 SEATS in the pricing section.
   Checkout refuses anonymous identities, exactly as it does for Pro.
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
  addresses get an account (random password, never shown) and the app's
  existing password-reset email, which for a new account is simply "set your
  password"; the link lands on `/reset` and the player ends up signed in
  with the seat lit. Addresses that already have a Novus account are granted
  the seat with **no email** — their password is their business. Re-pasting
  an address resends its email; so does the RESEND button on the roster.
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
- The invite email is Supabase's standard recovery mail. Customising its
  copy (Auth → Email Templates) is optional and safe — the app only cares
  where the link points.
