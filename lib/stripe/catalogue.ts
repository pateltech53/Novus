import {
  CHAPTER_LICENCES,
  PRO_MONTHLY,
  PRO_YEARLY,
  PRO_INDUSTRY_CODES,
  ONE_TIME_PURCHASES,
  type ChapterLicence,
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
 * · **Cosmetic bundles.** ONE_TIME_PURCHASES prices them as a $1.99–$4.99
 *   shelf rather than one SKU, and no bundle ids or per-bundle prices exist
 *   anywhere in the app yet. A single price id would have to invent them.
 *
 * They stay out until the thing they sell is real. Brand Law 4 already governs
 * what may be sold at all; this is the narrower rule that we only sell what we
 * can actually deliver.
 *
 * Chapter licences used to be on that list, for the same reason — no seat
 * table to deliver them with. supabase/migrations/0007_chapters.sql is that
 * table, app/chapter is the console that hands the seats out, and the two
 * licences are ordinary subscription SKUs below now. Their `defaultId` is the
 * live Stripe product for each; see the note on that field.
 */

/** One-time or recurring. Decides Checkout's `mode`, and little else. */
export type SkuKind = "subscription" | "payment";

export type SkuId =
  | "pro_monthly"
  | "pro_yearly"
  | "industry_pack"
  | "extra_island"
  | "chapter_35"
  | "chapter_100";

export interface Sku {
  id: SkuId;
  kind: SkuKind;
  /** The env var holding this SKU's Stripe price id. Named in error messages
   *  so a misconfigured deploy says which line of .env.local is missing. */
  envVar: string;
  /**
   * An older name for the same variable, still honoured when `envVar` is
   * unset. Exists for exactly one SKU: `extra_island` was called
   * `extra_run_slot` until 0013, and the whole point of that rename was that
   * the PRICE does not change — same Stripe product, same purchase link, same
   * $1.99. A deploy that has `STRIPE_PRICE_EXTRA_RUN_SLOT` set and has not yet
   * been re-configured must keep selling, or the rename takes the shop down
   * with it.
   */
  legacyEnvVar?: string;
  /**
   * Used when the env var is unset. Only the chapter licences carry one — the
   * ids of the two products actually created in the live Stripe account — so
   * they sell without another deploy-time variable to forget. This is safe
   * where a hardcoded id normally is not because resolvePrice() still fetches
   * the price and refuses on any amount/currency/cadence mismatch, and a
   * test-mode key simply fails to resolve a live product id: the button
   * disables, nothing mischarges. Setting the env var overrides it.
   */
  defaultId?: string;
  /** What lib/monetization.ts says this costs. The screen's number. */
  expectedCents: Cents;
  /** Set when the SKU is meaningless without an argument — which industry. */
  needsIndustry?: true;
  /** Shown on Stripe's hosted page and on the receipt. */
  label: string;
}

const oneTime = (id: "industry_pack" | "extra_island"): Cents => {
  const found = ONE_TIME_PURCHASES.find((p) => p.id === id);
  // ONE_TIME_PURCHASES is a literal in the same repo, so this cannot be missing
  // without someone having deleted the entry the checkout route still offers.
  if (!found) throw new Error(`monetization.ts has no one-time purchase "${id}"`);
  return found.priceCents;
};

const licence = (id: ChapterLicence["id"]): ChapterLicence => {
  const found = CHAPTER_LICENCES.find((l) => l.id === id);
  if (!found) throw new Error(`monetization.ts has no chapter licence "${id}"`);
  return found;
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
  extra_island: {
    id: "extra_island",
    kind: "payment",
    envVar: "STRIPE_PRICE_EXTRA_ISLAND",
    legacyEnvVar: "STRIPE_PRICE_EXTRA_RUN_SLOT",
    expectedCents: oneTime("extra_island"),
    label: "Extra Island",
  },
  chapter_35: {
    id: "chapter_35",
    kind: "subscription",
    envVar: "STRIPE_PRICE_CHAPTER_35",
    defaultId: "prod_V0RQl8TDKC3JKu",
    expectedCents: licence("chapter_35").priceCents,
    label: "Novus Chapter — 35 seats",
  },
  chapter_100: {
    id: "chapter_100",
    kind: "subscription",
    envVar: "STRIPE_PRICE_CHAPTER_100",
    // The $1,599 product, minted for the licence repricing. The original
    // (prod_V0RRsSw8Z2z0hD) still carries $599 in the live account, and
    // resolvePrice() would refuse it forever against the new expectedCents —
    // which is the guard doing its job, so the id moved instead.
    defaultId: "prod_V4J52t9fUOcrVm",
    expectedCents: licence("chapter_100").priceCents,
    label: "Novus Chapter — 100 seats",
  },
};

export const isSkuId = (v: unknown): v is SkuId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CATALOGUE, v);

/**
 * SKU ids that have been renamed, and what they are now.
 *
 * A Checkout Session stamps its sku into metadata when it OPENS and the
 * webhook reads it when it COMPLETES — minutes later, and across a deploy if
 * the timing is unlucky. So a rename cannot simply drop the old string: the
 * one session in flight during the release would arrive as "unknown sku", the
 * webhook would throw, and the retry would throw identically forever on a card
 * that has already been charged.
 *
 * Keep entries here permanently. They cost one map lookup and they are the
 * difference between a rename and a refund.
 */
const RETIRED_SKUS: Readonly<Record<string, SkuId>> = {
  // 0013 — the daily-founding grant became the concurrency it was sold as.
  extra_run_slot: "extra_island",
};

/** Reads a sku from untrusted metadata, following any rename. */
export const skuFromMetadata = (v: unknown): SkuId | null => {
  if (typeof v !== "string") return null;
  const current = RETIRED_SKUS[v];
  if (current) return current;
  return isSkuId(v) ? v : null;
};

/** The two SKUs that buy a classroom rather than a personal plan. */
export const isChapterSku = (id: SkuId): id is ChapterLicence["id"] =>
  id === "chapter_35" || id === "chapter_100";

/**
 * The configured price id for a SKU, or "" when that env var is unset.
 *
 * Read through `process.env[...]` rather than destructured at module scope
 * because a SKU can be unconfigured while the rest of billing works — a shop
 * that sells subscriptions but has not set up the run-slot price yet is a
 * normal intermediate state, and it should disable one button rather than the
 * whole checkout.
 *
 * An empty or whitespace value falls through to `defaultId` where one exists,
 * so `STRIPE_PRICE_CHAPTER_35=` in a dashboard does not silently disable the
 * licence the code ships an id for.
 */
export const priceIdFor = (sku: Sku): string => {
  const configured = process.env[sku.envVar];
  if (configured && configured.trim()) return configured.trim();
  // The renamed SKU's old variable, if this deploy still carries it. Same
  // price, same product — see `legacyEnvVar`.
  const legacy = sku.legacyEnvVar ? process.env[sku.legacyEnvVar] : undefined;
  if (legacy && legacy.trim()) return legacy.trim();
  return sku.defaultId ?? "";
};

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
