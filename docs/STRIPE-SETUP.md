# Stripe setup

Everything needed to turn billing on, in the order you should do it. Budget
about thirty minutes the first time.

Nothing here is required to run Novus. With no Stripe keys set the game behaves
exactly as it did before billing existed: CHOOSE PRO grants Pro on that device,
takes no card, and says so. That is a supported way to run this app — for a
classroom pilot it may be the right one.

---

## 0. The shape of it, in one paragraph

The browser never talks to Stripe's API and never loads `stripe.js`. It asks
our own route handler to open a checkout, gets back a URL, and the player is
redirected to a page hosted on `checkout.stripe.com`. They pay there and come
back. Meanwhile Stripe calls `/api/billing/webhook` server-to-server, and
**that call — signed, verified — is the only thing in the entire codebase that
grants a paid entitlement.** The success page grants nothing, because a URL can
be typed.

This matters beyond tidiness. Novus is handed to minors, and
`docs/LEADERBOARD.md` §1.4 and §9.6 rule out third-party scripts and
third-party identifiers on our pages. A redirect keeps that promise: no Stripe
code ever executes on our origin.

---

## 1. Which key?

**The secret key, `sk_…`. Not the publishable key.**

The publishable key (`pk_…`) exists to be embedded in a browser so `stripe.js`
can build a card form on your own page. We do not do that — the card form is on
Stripe's page — so there is nothing for a publishable key to do. Do not add
one, and in particular do not add a `NEXT_PUBLIC_STRIPE_…` variable: Next.js
inlines every `NEXT_PUBLIC_` value into the JavaScript bundle it ships to
browsers, and that is where secrets go to die.

Dashboard → **Developers → API keys → Secret key**.

Use `sk_test_…` until the whole flow works end to end. Test and live mode have
entirely separate products, prices, customers and webhook secrets — a
`price_…` created in test mode does not exist in live mode, so you will do
section 2 twice.

---

## 2. What to create in Stripe

Six products. Dashboard → **Product catalogue → Add product**.

| Product name | Price | Billing | Env var for its price id |
|---|---|---|---|
| Novus Pro — Monthly | $6.99 | Recurring, monthly | `STRIPE_PRICE_PRO_MONTHLY` |
| Novus Pro — Yearly | $39.99 | Recurring, yearly | `STRIPE_PRICE_PRO_YEARLY` |
| Industry Pack | $2.99 | One-off | `STRIPE_PRICE_INDUSTRY_PACK` |
| Extra Island | $1.99 | One-off | `STRIPE_PRICE_EXTRA_ISLAND` |
| Novus Chapter — 35 seats | $799 | Recurring, yearly | `STRIPE_PRICE_CHAPTER_35` |
| Novus Chapter — 100 seats | $1,599 | Recurring, yearly | `STRIPE_PRICE_CHAPTER_100` |

The two chapter licences already exist in the live account — `lib/stripe/
catalogue.ts` carries their product ids as defaults, so their env vars only
need setting to point somewhere else (a test-mode copy, a new account). In
test mode, create the two products and set the vars, exactly like the rest.

The **custom-size chapter** (`chapter_custom`, 10–500 seats) needs nothing
here: it has no pre-made product or price. Checkout computes the amount from
the typed seat count (`customChapterPriceCents` in `lib/monetization.ts`) and
sends it as `price_data`, minting a one-off yearly price — named "Novus
Chapter — N seats" — per purchase. It does need migration 0011 applied
(`docs/CHAPTERS.md` §1) or the webhook cannot record the licence.

All four in **USD** — every price in `lib/monetization.ts` is USD, and checkout
refuses a price in another currency rather than showing a player a converted
number the pricing screen never claimed.

### Products vs prices — either id works

A product (`prod_…`) is the thing being sold. A price (`price_…`) is what it
costs, and one product can carry several — that is how Stripe models "same
product, monthly or yearly".

Checkout needs the price, but **the env vars accept either**. Give a product id
and it is resolved to that product's price: `default_price` if set, otherwise
its single active price. So you can paste the id the dashboard shows you right
after creating a product, without hunting for a second one.

The exception is a product with two or more active prices. That is ambiguous —
it is exactly the shape where guessing charges someone the wrong cadence — so
the app refuses and lists the candidates. Name the `price_…` id in that case.

Every SKU Novus sells has one price, so in practice product ids are fine.

### One Industry Pack product for twelve industries

There is one $2.99 pack SKU, not one per industry. Which industry was bought
travels in the checkout session's metadata and the webhook reads it there.
Twelve near-identical products would be twelve places for the price to drift.

### What is deliberately not sold

- **Cosmetic bundles.** `lib/monetization.ts` prices them as a $1.99–$4.99
  shelf, and no bundle ids or per-bundle prices exist anywhere in the app. A
  single price id would have to invent them.

They still appear on the pricing screens as things Novus sells, which is
accurate — they are just not checkout buttons yet.

Chapter licences used to be on this list because there was no seat table to
deliver them with. There is now — `supabase/migrations/0007_chapters.sql` and
the `/chapter` console — so both licences are ordinary subscription SKUs. The
webhook creates the chapter; the buyer hands out seats by email or by pasted
list; every seat is Pro for the year. The whole flow is documented in
`docs/CHAPTERS.md`, including the two Supabase settings it leans on (the
`/reset` redirect URL and real SMTP for invite volume).

### The guard you get for free

Before opening any checkout the app fetches the price from Stripe and compares
it to `lib/monetization.ts`: amount, currency, one-off vs recurring, and the
billing interval. A mismatch is a refusal, not a warning. So pasting the
monthly id into `STRIPE_PRICE_PRO_YEARLY` fails loudly instead of charging
$39.99 every month to someone who was shown a yearly figure.

This is also what makes accepting product ids safe. Resolution on its own would
be a footgun — "whichever price this product happens to have" is not something
to charge a card on — but every resolved price still has to survive the check
above. See `lib/stripe/prices.ts`.

---

## 3. The database

Apply the billing migration to your Supabase project:

```
supabase/migrations/0003_billing.sql
```

It adds `billing_customers` (profile ↔ Stripe customer), `billing_events`
(webhook deduplication), and three grant functions that only the service role
may execute. It writes to `public.entitlements`, which 0001 already created and
left read-only to players.

To check it before trusting it, against a plain local Postgres:

```sh
createdb novus
psql -d novus -f supabase/tests/_supabase_shim.sql \
              -f supabase/migrations/0001_novus_core.sql \
              -f supabase/migrations/0002_leaderboard.sql \
              -f supabase/migrations/0003_billing.sql \
              -f supabase/tests/billing_test.sql
```

Sections 1, 2, 3, 6, 9 and 10 are supposed to print errors — those are the
assertions. Section 1 in particular proves a signed-in player cannot call the
grant functions over PostgREST, which if it ever regressed would make Pro free
to anyone who can open devtools.

---

## 4. The webhook

Dashboard → **Developers → Webhooks → Add endpoint**.

- URL: `https://your-domain.com/api/billing/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`

Copy the **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`. It is
shown when you create the endpoint. It is not an API key and it is not
interchangeable with one; without it the endpoint that grants Pro would accept
a POST from anybody.

Locally, `stripe listen` prints its **own** signing secret, different from the
dashboard's. Use that one while developing:

```sh
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
```

---

## 5. The customer portal

Dashboard → **Settings → Billing → Customer portal** → save once.

Cancelling, switching monthly ↔ yearly, updating a card and downloading
receipts all happen there, via `/api/billing/portal`. Stripe will not create a
portal session until that configuration has been saved at least once, and the
error it returns is opaque — the portal route rewrites it to say so.

---

## 6. Environment

```sh
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# price_… or prod_… — both accepted, see §2
STRIPE_PRICE_PRO_MONTHLY=prod_...
STRIPE_PRICE_PRO_YEARLY=prod_...
STRIPE_PRICE_INDUSTRY_PACK=prod_...
STRIPE_PRICE_EXTRA_ISLAND=prod_...

# Optional — the live product ids are the in-code defaults (see §2). Set only
# to override, e.g. with test-mode copies.
# STRIPE_PRICE_CHAPTER_35=prod_...
# STRIPE_PRICE_CHAPTER_100=prod_...
```

`scripts/stripe-prices.mjs` prints that block filled in from your account, and
checks every amount against the pricing screens before you paste it:

```sh
STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-prices.mjs
```

Billing is all-or-nothing: unless the first four are all present,
`billingConfigured()` is false and the app keeps its pre-billing behaviour.
Half-configured billing would take money and grant nothing, so it is not a
state the app will enter. Individual price ids may be missing — that disables
one SKU's button, not the whole shop.

`GET /api/billing/status` reports what a deploy thinks it has, including
whether it is in live or test mode. "I checked out and my card was not charged"
is almost always test mode.

### When checkout fails and the config looks fine

`status` on its own only says which variables are **set**. Checkout fails for a
second class of reason that a set variable hides: a price id pointing at the
wrong amount or the wrong cadence, a product carrying two active prices, or a
billing table that exists in `supabase/migrations/0003_billing.sql` and was
never applied to the project this deploy actually talks to. Each of those is one
500 from `/api/billing/checkout`, and all the player sees is "Checkout could not
be opened."

`?deep=1` runs those checks directly — the same `resolvePrice()` the checkout
route runs, plus a service-role read of `entitlements` and `billing_customers`:

```sh
curl -s https://YOUR-SITE/api/billing/status?deep=1 | jq
```

```json
{
  "configured": true,
  "prices": [{ "sku": "pro_yearly", "envVar": "STRIPE_PRICE_PRO_YEARLY", "ok": true }],
  "tables": [{ "table": "billing_customers", "ok": true }],
  "hint": "Billing is fully configured, every price verifies against Stripe, …"
}
```

Anything with `"ok": false` carries the reason. Stripe ids are stripped from
those reasons — the failure mode is what you need and the identifier adds
nothing. It is opt-in because it costs a Stripe round trip per SKU and every
pricing surface in the app calls this route on mount.

If `deep` comes back clean and a player still cannot check out, the cause is the
caller rather than the config: no account (`signedIn: false`), an anonymous
session (`needsAccount`), or a subscription they already have (409). The pricing
screens name all three now.

Verify with test card `4242 4242 4242 4242`, any future expiry, any CVC.

---

## 7. Who may see a checkout button

**This is a product decision the code does not make for you, and it is the one
thing on this page worth arguing about before launch.**

Stripe's terms are written for an adult account holder. Novus is handed to
minors, and the app already knows something about that — `RunState.playerAge`
exists for local age-gating and, per `docs/LEADERBOARD.md` §9.4, never leaves
the device. Nothing currently stops a twelve-year-old from reaching the pricing
sheet and being shown a card form on Stripe's page.

The routes will open checkout for anyone who reaches them. Deciding who reaches
them belongs to the screens, and the realistic options are:

1. **Gate on the local age answer.** Under a threshold, CHOOSE PRO becomes
   something like "ask a parent" rather than a checkout. Cheap, keeps
   `playerAge` on the device, and is the option that matches how the rest of
   this codebase treats minors.
2. **Sell to schools and parents only.** Chapter licences and a separate adult
   purchase flow; no in-game checkout at all. This is the model the pricing
   copy already leans towards ("the thing a teacher has to be able to read
   before spending $799") — and it is the reason chapter seats, not the monthly
   subscription, are arguably the feature to build next.
3. **Ship as-is.** Defensible only with a deliberate read of Stripe's terms and
   the relevant consumer-protection rules for your markets. It is not the
   default this file recommends.

What the code guarantees regardless: the only Novus identifier that reaches
Stripe is the anonymous profile UUID, in checkout metadata. No display name, no
board handle, no founder name, and never `playerAge`.

---

## 8. Things worth knowing before you launch

**Identity is an anonymous cookie.** A player who clears their browser, or
switches to a different device without ever syncing, becomes a new anonymous
user — and Pro is attached to the old one. There is no email, no password and
no "restore purchases" flow, because there is no account system to hang one on.
`billing_customers` stores the Stripe customer id so such a flow is buildable
later, but today this is a real way for a paying player to lose access, and it
is the strongest argument for real accounts before real money.

**`past_due` keeps Pro.** A failed charge means Stripe is retrying a card that
has not settled — a bank hold, an expired card — and it retries for a couple of
weeks. Revoking The Room on the first failure punishes a player whose card will
work on Thursday. Access ends when Stripe gives up and the status becomes
`unpaid` or `canceled`. See `ENTITLING` in `lib/stripe/subscription.ts`.

**One-time purchases survive cancellation.** Industry packs and islands are
bought, not rented; ending a subscription clears `pro` and leaves them. Test 8
in `billing_test.sql` asserts this.

**Entitlements refresh on every boot, and the server always wins.** That is the
opposite of the rule for saves, where local wins so a tab cannot swap out the
company you are halfway through. Entitlements are the receipt, and the receipt
lives on the server so that editing localStorage does not buy anything. A
change adopted at boot costs one reload — see `restoreOnBoot` in
`lib/cloud/sync.ts`.

**Webhooks arrive at least once.** Stripe retries any non-2xx for three days.
`billing_events` claims an event id before the work and releases it if the work
throws, so a retry re-does a failed grant but never repeats a successful one.
That release is load-bearing: without it, a transient database error would turn
into a permanently lost purchase.

**Brand Law 4 still governs what may be sold.** Everything purchasable is
content — industries, cosmetics, islands, seats. Score, survival, revives and
leaderboard position are in `NEVER_PURCHASABLE` in `lib/monetization.ts` and no
code path puts a price on them. Adding a Stripe product does not change that
list; if a new SKU needs an entry there, the answer is no.
