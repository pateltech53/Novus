import "server-only";

import type Stripe from "stripe";

import { priceIdFor, type Sku } from "./catalogue";
import { stripe } from "./client";

/**
 * Turn whatever is in the env var into a price id the app is willing to sell.
 *
 * ── Why both `price_…` and `prod_…` are accepted ───────────────────────────
 *
 * A product is the thing; a price is what it costs. Checkout needs the price.
 * But the dashboard shows the product id most prominently, it is the id you
 * have in hand right after creating something, and every SKU Novus sells has
 * exactly one price — so demanding the price id was making people hunt for a
 * value that carries no extra information in our case. Both work now, and a
 * product id is resolved to its price here.
 *
 * That is only safe because of the second half of this file. Resolution alone
 * would be a footgun: "whichever price this product happens to have" is not
 * something to charge a card on. Every resolved price is then checked against
 * lib/monetization.ts on amount, currency, recurrence and interval, and a
 * mismatch refuses the sale. So the worst a wrong id can do is fail loudly
 * before anyone is charged.
 */

export type Resolved =
  | { ok: true; priceId: string }
  | { ok: false; reason: string };

/**
 * Product id → price id, for the life of the process.
 *
 * Only the RESOLUTION is cached, never the amount. A price's amount is
 * re-fetched and re-checked on every checkout, so changing a price in the
 * dashboard cannot be papered over by a warm cache — the check still runs
 * against live data. What is cached is the far more stable "which price does
 * this product point at", which saves one API call on a path a player is
 * waiting on.
 */
const resolvedProducts = new Map<string, string>();

export async function resolvePrice(sku: Sku): Promise<Resolved> {
  const configured = priceIdFor(sku).trim();
  // A product→price mapping is cached for the life of the process. The normal
  // way to change a product's price is to archive the old one and set a new
  // default — after which a warm cache keeps handing back the archived id and
  // verify() fails on every checkout until a redeploy, even though the dashboard
  // is correct. So a failure on a CACHED resolution evicts the entry and
  // resolves once more against the product's live default before giving up. A
  // cold-cache failure is a real one and is returned as-is (no wasted retry).
  const wasCached = configured.startsWith("prod_") && resolvedProducts.has(configured);

  const first = await resolveOnce(sku, configured);
  if (first.ok || !wasCached) return first;

  resolvedProducts.delete(configured);
  return resolveOnce(sku, configured);
}

async function resolveOnce(sku: Sku, configured: string): Promise<Resolved> {
  if (!configured) return { ok: false, reason: `${sku.envVar} is not set` };

  const priceId = configured.startsWith("prod_")
    ? await priceForProduct(sku, configured)
    : configured;

  if (typeof priceId !== "string") return priceId; // a failure from the lookup

  if (!priceId.startsWith("price_")) {
    return {
      ok: false,
      reason:
        `${sku.envVar}=${configured} is not a Stripe id — expected a price ` +
        `(price_…) or a product (prod_…)`,
    };
  }

  return verify(sku, priceId, configured);
}

/**
 * The one price behind a product.
 *
 * `default_price` first, because that is the field Stripe sets when a product
 * is created with a price in the dashboard — the ordinary case. Falling back to
 * listing exists for products created by API without one.
 *
 * Two or more active prices is a refusal rather than a guess. A product with a
 * monthly and a yearly price is exactly the shape where guessing charges
 * someone the wrong cadence, and the fix — name the price id — takes ten
 * seconds.
 */
async function priceForProduct(sku: Sku, productId: string): Promise<string | Resolved> {
  const cached = resolvedProducts.get(productId);
  if (cached) return cached;

  let product: Stripe.Product;
  try {
    product = await stripe().products.retrieve(productId);
  } catch (e) {
    return {
      ok: false,
      reason: `${sku.envVar}=${productId} could not be read from Stripe: ${(e as Error).message}`,
    };
  }

  if (!product.active) {
    return { ok: false, reason: `${sku.envVar}=${productId} is archived in Stripe` };
  }

  const fromDefault =
    typeof product.default_price === "string"
      ? product.default_price
      : (product.default_price?.id ?? null);

  if (fromDefault) {
    resolvedProducts.set(productId, fromDefault);
    return fromDefault;
  }

  let prices: Stripe.ApiList<Stripe.Price>;
  try {
    prices = await stripe().prices.list({ product: productId, active: true, limit: 10 });
  } catch (e) {
    return {
      ok: false,
      reason: `${sku.envVar}=${productId}: could not list prices: ${(e as Error).message}`,
    };
  }

  if (prices.data.length === 0) {
    return {
      ok: false,
      reason: `${sku.envVar}=${productId} has no active price — add one in the Stripe dashboard`,
    };
  }
  if (prices.data.length > 1) {
    return {
      ok: false,
      reason:
        `${sku.envVar}=${productId} has ${prices.data.length} active prices, so which one ` +
        `to charge is ambiguous. Set ${sku.envVar} to one of: ` +
        prices.data.map((p) => p.id).join(", "),
    };
  }

  resolvedProducts.set(productId, prices.data[0].id);
  return prices.data[0].id;
}

/**
 * The refusal that keeps the screen and the charge in agreement.
 *
 * The price id is configuration and the amount is code, and nothing else keeps
 * the two honest. Currency and cadence are checked alongside the amount
 * because a monthly price behind STRIPE_PRICE_PRO_YEARLY charges $39.99 every
 * month to someone who was shown a yearly figure — same number, wrong promise,
 * and no amount comparison would catch it.
 *
 * `configured` is echoed in the messages so the operator sees the value they
 * actually typed, not the price id it silently resolved to.
 */
async function verify(sku: Sku, priceId: string, configured: string): Promise<Resolved> {
  const via = configured === priceId ? "" : ` (via ${configured})`;

  let price: Stripe.Price;
  try {
    price = await stripe().prices.retrieve(priceId);
  } catch (e) {
    return {
      ok: false,
      reason: `${sku.envVar}=${priceId}${via} could not be read from Stripe: ${(e as Error).message}`,
    };
  }

  if (!price.active) {
    return { ok: false, reason: `${sku.envVar}=${priceId}${via} is archived in Stripe` };
  }

  if (price.unit_amount !== sku.expectedCents) {
    return {
      ok: false,
      reason:
        `${sku.envVar}=${priceId}${via} costs ${price.unit_amount} cents but the app ` +
        `displays ${sku.expectedCents} — refusing to charge a price the player was not shown`,
    };
  }

  if (price.currency !== "usd") {
    return {
      ok: false,
      reason: `${sku.envVar}=${priceId}${via} is in ${price.currency}; every price in lib/monetization.ts is USD`,
    };
  }

  const wantRecurring = sku.kind === "subscription";
  if (wantRecurring !== !!price.recurring) {
    return {
      ok: false,
      reason: `${sku.envVar}=${priceId}${via} is ${price.recurring ? "recurring" : "one-time"} but ${sku.id} is not`,
    };
  }

  if (price.recurring) {
    const want = sku.id === "pro_monthly" ? "month" : "year";
    if (price.recurring.interval !== want || price.recurring.interval_count !== 1) {
      return {
        ok: false,
        reason:
          `${sku.envVar}=${priceId}${via} bills every ${price.recurring.interval_count} ` +
          `${price.recurring.interval}, expected 1 ${want}`,
      };
    }
  }

  return { ok: true, priceId };
}
