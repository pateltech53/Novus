import {
  PRO_MONTHLY,
  PRO_YEARLY,
  PRO_INDUSTRY_CODES,
  ONE_TIME_PURCHASES,
  type Cents,
} from "@/lib/monetization";
import type { Industry } from "@/lib/engine/types";

/**
 * What Novus sells, joined to what Stripe knows about it.
 *
 * lib/monetization.ts is still the only place a price is written down — this
 * file adds one thing to each entry, the Stripe price id, and takes the amount
 * from there. That direction matters: the pricing screens, the paywall and the
 * checkout session all read the same number, so a price can be wrong in one
 * place only by being wrong everywhere, which is the failure mode you notice.
 *
 * ── Why the amounts are re-checked against Stripe at checkout ──────────────
 *
 * The price id is configuration and the amount is code, and nothing stops
 * someone from pointing STRIPE_PRICE_PRO_YEARLY at a $99 price while the
 * screen still says $39.99. `expectedCents` below is what the checkout route
 * compares Stripe's answer to before it will sell anything — see
 * app/api/billing/checkout/route.ts. A mismatch is a refusal, not a warning,
 * because the alternative is charging a player a price they never saw.
 *
 * ── What is not sold here ──────────────────────────────────────────────────
 *
 * · **Chapter licences.** 35 and 100 seats, bought by a teacher and handed to
 *   students — and there is no enrolment-code table to hand them out with. The
 *   money would arrive and nothing would reach a classroom. They ship with
 *   seat codes; see supabase/migrations/0003_billing.sql.
 * · **Cosmetic bundles.** ONE_TIME_PURCHASES prices them as a $1.99–$4.99
 *   shelf rather than one SKU, and no bundle ids or per-bundle prices exist
 *   anywhere in the app yet. A single price id would have to invent them.
 *
 * Both stay out until the thing they sell is real. Brand Law 4 already governs
 * what may be sold at all; this is the narrower rule that we only sell what we
 * can actually deliver.
 */

/** One-time or recurring. Decides Checkout's `mode`, and little else. */
export type SkuKind = "subscription" | "payment";

export type SkuId = "pro_monthly" | "pro_yearly" | "industry_pack" | "extra_run_slot";

export interface Sku {
  id: SkuId;
  kind: SkuKind;
  /** The env var holding this SKU's Stripe price id. Named in error messages
   *  so a misconfigured deploy says which line of .env.local is missing. */
  envVar: string;
  /** What lib/monetization.ts says this costs. The screen's number. */
  expectedCents: Cents;
  /** Set when the SKU is meaningless without an argument — which industry. */
  needsIndustry?: true;
  /** Shown on Stripe's hosted page and on the receipt. */
  label: string;
}

const oneTime = (id: "industry_pack" | "extra_run_slot"): Cents => {
  const found = ONE_TIME_PURCHASES.find((p) => p.id === id);
  // ONE_TIME_PURCHASES is a literal in the same repo, so this cannot be missing
  // without someone having deleted the entry the checkout route still offers.
  if (!found) throw new Error(`monetization.ts has no one-time purchase "${id}"`);
  return found.priceCents;
};

export const CATALOGUE: Readonly<Record<SkuId, Sku>> = {
  pro_monthly: {
    id: "pro_monthly",
    kind: "subscription",
    envVar: "STRIPE_PRICE_PRO_MONTHLY",
    expectedCents: PRO_MONTHLY.priceCents,
    label: "Novus Pro — Monthly",
  },
  pro_yearly: {
    id: "pro_yearly",
    kind: "subscription",
    envVar: "STRIPE_PRICE_PRO_YEARLY",
    expectedCents: PRO_YEARLY.priceCents,
    label: "Novus Pro — Yearly",
  },
  industry_pack: {
    id: "industry_pack",
    kind: "payment",
    envVar: "STRIPE_PRICE_INDUSTRY_PACK",
    expectedCents: oneTime("industry_pack"),
    needsIndustry: true,
    label: "Industry Pack",
  },
  extra_run_slot: {
    id: "extra_run_slot",
    kind: "payment",
    envVar: "STRIPE_PRICE_EXTRA_RUN_SLOT",
    expectedCents: oneTime("extra_run_slot"),
    label: "Extra Run Slot",
  },
};

export const isSkuId = (v: unknown): v is SkuId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CATALOGUE, v);

/**
 * The configured price id for a SKU, or "" when that env var is unset.
 *
 * Read through `process.env[...]` rather than destructured at module scope
 * because a SKU can be unconfigured while the rest of billing works — a shop
 * that sells subscriptions but has not set up the run-slot price yet is a
 * normal intermediate state, and it should disable one button rather than the
 * whole checkout.
 */
export const priceIdFor = (sku: Sku): string => process.env[sku.envVar] ?? "";

/**
 * Every industry that may be sold as a pack: the eight behind Pro. Selling a
 * free industry would take money for something the player already has, and
 * selling an unrecognised code would fail the entitlements check constraint
 * after the card was charged — so the check happens before checkout opens.
 */
export const isSellableIndustry = (v: unknown): v is Industry =>
  typeof v === "string" && (PRO_INDUSTRY_CODES as readonly string[]).includes(v);

/** The SKUs that are actually purchasable right now, for the UI to render. */
export const availableSkus = (): SkuId[] =>
  (Object.keys(CATALOGUE) as SkuId[]).filter((id) => priceIdFor(CATALOGUE[id]).length > 0);
