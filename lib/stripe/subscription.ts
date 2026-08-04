import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOGUE, priceIdFor, type SkuId } from "./catalogue";
import { stripe } from "./client";
import { billingConfigured } from "./config";

/**
 * One subscription, turned into one answer: is this player Pro right now.
 *
 * This is the only place that maps Stripe's status vocabulary onto access, and
 * both webhook paths (`checkout.session.completed` and the three
 * `customer.subscription.*` events) go through it. Two paths that each decided
 * for themselves would eventually disagree, and the shape of that bug is a
 * player who paid and is not Pro — the single worst outcome billing has.
 */

/**
 * Statuses that mean the player keeps what they bought.
 *
 * `past_due` is in the list on purpose. It means Stripe is retrying a card
 * that has not settled — a bank fraud hold, an expired card, a full account —
 * and it retries for a couple of weeks before giving up. Revoking Pro on the
 * first failed charge takes The Room away from a player whose card will work
 * on Thursday. When Stripe actually gives up the status becomes `unpaid` or
 * `canceled`, and those are not in this list.
 *
 * `incomplete` is not here either: that is a subscription whose FIRST payment
 * never succeeded, which is a checkout that failed rather than a lapse.
 */
const ENTITLING: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

export const grantsAccess = (status: string): boolean => ENTITLING.has(status);

/**
 * Which plan this subscription is, by matching its price id back to the
 * catalogue. Returns null for a price we do not recognise — someone selling a
 * one-off deal from the Stripe dashboard, or an env var pointed at the wrong
 * price. Null means "do not claim to know the plan", never "no access": access
 * is decided by status above, so an unrecognised price still grants Pro rather
 * than silently withholding something the player paid for.
 */
export function planFromSubscription(sub: Stripe.Subscription): SkuId | null {
  const priceIds = new Set(
    sub.items.data.map((item) => item.price?.id).filter((id): id is string => !!id),
  );
  for (const id of ["pro_monthly", "pro_yearly"] as const) {
    const configured = priceIdFor(CATALOGUE[id]);
    if (configured && priceIds.has(configured)) return id;
  }
  return null;
}

/**
 * When access lapses if nothing renews.
 *
 * Stripe moved `current_period_end` off the subscription and onto its items,
 * so this reads the items and takes the latest — a subscription with one item
 * is the only shape we sell, but taking the maximum means a future bundle
 * cannot accidentally expire a player early. Returns null rather than a guess
 * when there are no items, because a wrong date on a "Pro until…" line is
 * worse than no date.
 */
export function periodEnd(sub: Stripe.Subscription): string | null {
  const ends = sub.items.data
    .map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000).toISOString();
}

/**
 * Writes a subscription's current state to both tables it touches.
 *
 * Order matters: `entitlements` first, then `billing_customers`. Entitlements
 * are what the game reads, and if the second write fails the player is Pro
 * with a stale billing record — recoverable, invisible, and fixed by the next
 * event. The other order leaves a player who paid without access until someone
 * notices.
 *
 * `db` is the service-role client. Every statement here names the profile
 * explicitly; there is no RLS underneath to catch a missing filter.
 */
export async function syncSubscription(
  db: SupabaseClient,
  profileId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const plan = planFromSubscription(sub);
  const active = grantsAccess(sub.status);

  const { error: entError } = await db.rpc("apply_subscription", {
    p_profile: profileId,
    p_active: active,
    p_plan: plan,
  });
  if (entError) {
    // Thrown, not logged. The webhook route turns a throw into a 500, which is
    // what makes Stripe retry — and a retry is exactly what a failed grant
    // needs. Swallowing this would acknowledge the event and lose the purchase.
    throw new Error(`apply_subscription failed: ${entError.message}`);
  }

  const { error: custError } = await db
    .from("billing_customers")
    .update({
      subscription_id: sub.id,
      subscription_status: sub.status,
      plan,
      current_period_end: periodEnd(sub),
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
    })
    .eq("profile_id", profileId);
  if (custError) {
    throw new Error(`billing_customers update failed: ${custError.message}`);
  }
}

/**
 * Cancel a profile's personal Pro subscription before the account is deleted.
 *
 * Shared by both delete paths so neither can forget it: deleting the account
 * while Stripe keeps billing the card is the worst outcome of "delete me", and
 * the personal-Pro subscription is not covered by the chapter wind-down (that
 * one reads `chapters`; this one reads `billing_customers`).
 *
 * `unpaid` and `paused` count as billable alongside the obvious three: Stripe
 * can resume a paused subscription and an unpaid one still has an open invoice a
 * recovered card settles. An already-cancelled subscription (or one flagged
 * cancel_at_period_end) is finished and needs nothing. Returns `ok:false` only
 * when a genuinely billable subscription existed and Stripe refused to cancel it
 * — the caller decides whether that refuses the deletion or merely warns.
 */
const BILLABLE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];

export async function cancelActivePersonalPro(
  db: SupabaseClient,
  profileId: string,
): Promise<{ ok: boolean; subscriptionId: string | null }> {
  const { data: billing } = await db
    .from("billing_customers")
    .select("subscription_id, subscription_status, cancel_at_period_end")
    .eq("profile_id", profileId)
    .maybeSingle();

  const status = billing?.subscription_status as string | undefined;
  const stillBillable =
    !!status && BILLABLE_STATUSES.includes(status) && billing?.cancel_at_period_end !== true;
  if (!stillBillable) return { ok: true, subscriptionId: null };

  const subscriptionId = (billing?.subscription_id as string | undefined) ?? null;
  // A billable status with no subscription id is a broken record, not a live
  // subscription — nothing to cancel and nothing that can bill.
  if (!subscriptionId || !billingConfigured()) return { ok: true, subscriptionId: null };

  try {
    await stripe().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
    return { ok: true, subscriptionId };
  } catch {
    return { ok: false, subscriptionId };
  }
}

/**
 * The profile behind a Stripe customer id.
 *
 * The row is created by the checkout route before Stripe ever sees the
 * customer, so by the time any webhook arrives this lookup succeeds. Returning
 * null for an unknown customer is correct rather than exceptional: a Stripe
 * account shared with another product, or a test-mode event replayed against a
 * live database, both land here and both should be acknowledged and ignored
 * rather than retried forever.
 */
export async function profileForCustomer(
  db: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data } = await db
    .from("billing_customers")
    .select("profile_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}

/** Stripe hands back `string | Customer | DeletedCustomer | null` nearly
 *  everywhere a customer is referenced. This is that, flattened to an id. */
export const customerId = (
  c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null => (typeof c === "string" ? c : (c?.id ?? null));
