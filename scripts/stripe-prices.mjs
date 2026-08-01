#!/usr/bin/env node
/**
 * Resolve Stripe PRODUCT ids to the PRICE ids the app actually needs, and
 * check every amount against lib/monetization.ts.
 *
 * This exists because `prod_…` and `price_…` are easy to confuse and the
 * dashboard shows the product id most prominently. A product is the thing; a
 * price is what it costs, and one product can carry several. The env vars take
 * the price. Pasting a `prod_` id into them fails at the first checkout, which
 * is a bad place to find out.
 *
 * Read-only: it lists, it never creates or modifies anything in your account.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-prices.mjs
 *
 * Output is a block ready to paste into .env.local, plus a verdict on whether
 * each price agrees with the pricing screens. That second part matters — the
 * app refuses to open a checkout whose Stripe amount disagrees with
 * lib/monetization.ts, so a mismatch here is a button that will not work.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.\n");
  console.error("  STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-prices.mjs");
  process.exit(1);
}

// ── What the app expects, read out of the catalogue ─────────────────────────
// Parsed from lib/monetization.ts rather than written down again, for the same
// reason lib/stripe/catalogue.ts derives its amounts there: a price that can
// be wrong in one place only is a price that gets noticed.

const money = readFileSync(join(root, "lib/monetization.ts"), "utf8");

const cents = (label, re) => {
  const match = money.match(re);
  if (!match) {
    console.error(`Could not read ${label} out of lib/monetization.ts — has it been restructured?`);
    process.exit(1);
  }
  return Number(match[1]);
};

const EXPECTED = [
  {
    env: "STRIPE_PRICE_PRO_MONTHLY",
    what: "Novus Pro — Monthly",
    cents: cents("PRO_MONTHLY", /id:\s*"pro_monthly"[\s\S]*?priceCents:\s*(\d+)/),
    recurring: "month",
  },
  {
    env: "STRIPE_PRICE_PRO_YEARLY",
    what: "Novus Pro — Yearly",
    cents: cents("PRO_YEARLY", /id:\s*"pro_yearly"[\s\S]*?priceCents:\s*(\d+)/),
    recurring: "year",
  },
  {
    env: "STRIPE_PRICE_INDUSTRY_PACK",
    what: "Industry Pack",
    cents: cents("industry_pack", /id:\s*"industry_pack"[\s\S]*?priceCents:\s*(\d+)/),
    recurring: null,
  },
  {
    env: "STRIPE_PRICE_EXTRA_RUN_SLOT",
    what: "Extra Run Slot",
    cents: cents("extra_run_slot", /id:\s*"extra_run_slot"[\s\S]*?priceCents:\s*(\d+)/),
    recurring: null,
  },
];

// ── Ask Stripe ──────────────────────────────────────────────────────────────

const { default: Stripe } = await import("stripe");
const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
console.log(`\nStripe account, ${mode} mode.`);
console.log(
  mode === "TEST"
    ? "Products and prices in test mode do NOT exist in live mode; you will do this twice.\n"
    : "These are real prices that will charge real cards.\n",
);

let prices;
try {
  prices = await stripe.prices.list({ limit: 100, active: true, expand: ["data.product"] });
} catch (e) {
  console.error(`Could not list prices: ${e.message}`);
  process.exit(1);
}

if (prices.data.length === 0) {
  console.error("No active prices in this account. Create the four products first —");
  console.error("docs/STRIPE-SETUP.md §2 has the table.");
  process.exit(1);
}

// ── Report ──────────────────────────────────────────────────────────────────

const fmt = (c) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const describe = (p) => {
  const every = p.recurring
    ? `/${p.recurring.interval_count > 1 ? `${p.recurring.interval_count} ` : ""}${p.recurring.interval}`
    : " one-off";
  return `${fmt(p.unit_amount)}${every} ${p.currency.toUpperCase()}`;
};

console.log("Everything active in the account:\n");
for (const p of prices.data) {
  const name = typeof p.product === "object" ? p.product.name : p.product;
  console.log(`  ${p.id}`);
  console.log(`    ${name} — ${describe(p)}`);
  console.log(`    product: ${typeof p.product === "object" ? p.product.id : p.product}`);
}

console.log("\n── Matched against lib/monetization.ts ─────────────────────────\n");

const env = [];
let problems = 0;

for (const want of EXPECTED) {
  // Matched on the price itself, not on the product name: names are typed by a
  // human and will not survive a rename, whereas the amount and the cadence
  // are the things the app actually checks before it will sell anything.
  const hits = prices.data.filter(
    (p) =>
      p.unit_amount === want.cents &&
      p.currency === "usd" &&
      (want.recurring
        ? p.recurring?.interval === want.recurring && p.recurring?.interval_count === 1
        : !p.recurring),
  );

  if (hits.length === 1) {
    console.log(`  ✓ ${want.env}`);
    console.log(`      ${want.what} — ${describe(hits[0])}`);
    env.push(`${want.env}=${hits[0].id}`);
  } else if (hits.length === 0) {
    problems++;
    console.log(`  ✗ ${want.env}`);
    console.log(`      No active USD price at ${fmt(want.cents)}${want.recurring ? ` per ${want.recurring}` : " one-off"}.`);
    console.log(`      Create "${want.what}" — docs/STRIPE-SETUP.md §2.`);
    env.push(`${want.env}=`);
  } else {
    problems++;
    console.log(`  ? ${want.env}`);
    console.log(`      ${hits.length} prices match ${fmt(want.cents)}. Pick one by hand:`);
    for (const h of hits) console.log(`        ${h.id}`);
    env.push(`${want.env}=   # ambiguous, see above`);
  }
}

console.log("\n── Paste into .env.local ───────────────────────────────────────\n");
console.log(env.join("\n"));

console.log(`
Still needed alongside these (docs/STRIPE-SETUP.md §6):
  STRIPE_SECRET_KEY          — set, that is how this ran
  STRIPE_WEBHOOK_SECRET      — whsec_…, shown when you create the webhook endpoint
  SUPABASE_SERVICE_ROLE_KEY  — Supabase → Settings → API → service_role
  NEXT_PUBLIC_SITE_URL       — absolute, no trailing slash

Billing is all-or-nothing: until those four are set, CHOOSE PRO keeps its
pre-billing behaviour and takes no card.
`);

process.exit(problems > 0 ? 1 : 0);
