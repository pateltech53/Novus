import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_WEBHOOK_SECRET, billingConfigured } from "@/lib/stripe/config";
import { skuFromMetadata } from "@/lib/stripe/catalogue";
import { chapterFromSubscription, syncChapter } from "@/lib/stripe/chapter";
import { customerId, profileForCustomer, syncSubscription } from "@/lib/stripe/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — the only thing that grants a paid entitlement.
 *
 * Nothing on the success page grants anything. A player redirected to
 * `/found?purchase=ok` has only proved they reached a URL, and that URL can be
 * typed. Money is confirmed here, by Stripe, over a signed request, or it is
 * not confirmed at all.
 *
 * ── The signature ──────────────────────────────────────────────────────────
 *
 * This route is public — it has to be, Stripe calls it — and it writes to the
 * one table the whole RLS design exists to keep the browser out of. The
 * signature check is what stands between those two facts. `req.text()` gets
 * the body EXACTLY as sent; parsing it first and re-serialising would change a
 * byte somewhere and fail every verification, which is the classic way this
 * route gets "fixed" into being unverified.
 *
 * ── Delivered at least once ────────────────────────────────────────────────
 *
 * Stripe retries any non-2xx for three days, so every handler below is written
 * to survive being run twice. `grant_extra_island` is the one that cannot be
 * idempotent — two slots bought is two slots — and the `billing_events` row is
 * what protects it, claimed before the work and released if the work fails.
 */

export async function POST(req: NextRequest) {
  if (!billingConfigured()) {
    // 503 rather than 200: an unconfigured deploy receiving live events should
    // make Stripe retry (and light up the dashboard) rather than quietly
    // acknowledge purchases it is dropping on the floor.
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "no signature" }, { status: 400 });

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    // 400, never a retry. A bad signature is either the wrong
    // STRIPE_WEBHOOK_SECRET or someone poking the endpoint, and neither gets
    // better by being sent again.
    return NextResponse.json({ error: `signature: ${(e as Error).message}` }, { status: 400 });
  }

  const db = adminClient();

  // ── Claim ────────────────────────────────────────────────────────────────
  // The insert IS the lock. Two concurrent deliveries of the same event race
  // here and exactly one wins; the loser sees a unique violation and stops.
  const { error: claimError } = await db
    .from("billing_events")
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    // 23505 = unique_violation: handled already, on a previous delivery or by
    // the other half of a race. Acknowledge so Stripe stops resending.
    if (claimError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  try {
    await handle(db, event);
  } catch (e) {
    // ── Release ────────────────────────────────────────────────────────────
    // Without this the claim above would outlive the failure: Stripe retries,
    // the insert collides, the retry is dismissed as a duplicate, and a
    // purchase is lost permanently by the mechanism meant to protect it.
    await db.from("billing_events").delete().eq("id", event.id);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handle(db: SupabaseClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(db, event.data.object);

    // Renewals, cancellations, plan changes, dunning, and the moment a
    // cancelled subscription actually lapses. All four are the same question —
    // what is this subscription now — so all four take the same path.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return onSubscriptionChanged(db, event.data.object);

    default:
      // Everything else is acknowledged and ignored. The endpoint should be
      // configured to send only the events above; this is the backstop for a
      // dashboard where someone ticked "send all".
      return;
  }
}

/**
 * A completed checkout.
 *
 * Subscriptions are re-read from Stripe rather than trusted from the session
 * object: the session says a subscription was created, but its status is the
 * subscription's to report, and `customer.subscription.created` may already
 * have moved it. Fetching gives one answer instead of two orderings.
 */
async function onCheckoutCompleted(
  db: SupabaseClient,
  cs: Stripe.Checkout.Session,
): Promise<void> {
  // `unpaid` happens with delayed payment methods. Nothing is granted until
  // the money is actually there — the async_payment_succeeded path would be
  // the place to handle those, and we do not enable any such method.
  if (cs.payment_status === "unpaid") return;

  const profileId = await resolveProfile(db, cs.metadata?.profile_id, cs.client_reference_id, cs.customer);
  if (!profileId) {
    // Unattributable. Thrown so it retries and then lands in Stripe's failed-
    // webhook list, where a human can see it — a payment we cannot connect to
    // a player is exactly the thing that must not be silently swallowed.
    throw new Error(`checkout ${cs.id}: no profile in metadata and customer unknown`);
  }

  if (cs.mode === "subscription") {
    const subId = typeof cs.subscription === "string" ? cs.subscription : cs.subscription?.id;
    if (!subId) throw new Error(`checkout ${cs.id}: subscription mode with no subscription`);
    const sub = await stripe().subscriptions.retrieve(subId);

    // A chapter licence is a subscription too, but it buys a classroom, not
    // the buyer: it must never set `pro` on the teacher's own entitlements.
    // The session metadata answers first; the subscription's own metadata and
    // price are the fallback, same as onSubscriptionChanged.
    const chapter = await chapterFromSubscription(sub, cs.metadata);
    if (chapter) {
      await syncChapter(db, profileId, sub, chapter);
      return;
    }

    await syncSubscription(db, profileId, sub);
    return;
  }

  // ── One-time purchases ───────────────────────────────────────────────────
  // Follows a rename: a session opened before 0013 carries `extra_run_slot`
  // and must still deliver. See RETIRED_SKUS in lib/stripe/catalogue.ts.
  const sku = skuFromMetadata(cs.metadata?.sku);
  if (sku === null) {
    throw new Error(`checkout ${cs.id}: unknown sku ${String(cs.metadata?.sku)}`);
  }

  if (sku === "industry_pack") {
    const industry = cs.metadata?.industry;
    if (!industry) throw new Error(`checkout ${cs.id}: industry_pack with no industry`);
    // The entitlements check constraint rejects a code that is not a real
    // industry, so a typo fails loudly here instead of unlocking nothing.
    const { error } = await db.rpc("grant_industry_pack", {
      p_profile: profileId,
      p_industry: industry,
    });
    if (error) throw new Error(`grant_industry_pack: ${error.message}`);
    return;
  }

  if (sku === "extra_island") {
    const { error } = await db.rpc("grant_extra_island", { p_profile: profileId });
    if (error) throw new Error(`grant_extra_island: ${error.message}`);
    return;
  }

  // A subscription SKU arriving in payment mode means the price ids are
  // crossed in the environment. Loud, because it has already taken money.
  throw new Error(`checkout ${cs.id}: ${sku} is not a one-time purchase`);
}

async function onSubscriptionChanged(
  db: SupabaseClient,
  event: Stripe.Subscription,
): Promise<void> {
  /*
   * Re-read the subscription from Stripe rather than trusting the event body.
   *
   * `event.data.object` is the subscription as it was when the event was
   * GENERATED, and Stripe does not guarantee delivery order. A stale
   * `customer.subscription.updated` (status active) delivered after
   * `customer.subscription.deleted` would otherwise re-grant `pro` on a
   * cancelled subscription with nothing left to revoke it — free perpetual Pro
   * — and a `created` (incomplete) delivered last would strip Pro off a player
   * who just paid. Fetching by id collapses the orderings into one current
   * answer, exactly as onCheckoutCompleted already does for the same reason.
   */
  const sub = await stripe().subscriptions.retrieve(event.id);

  const profileId = await resolveProfile(db, sub.metadata?.profile_id, null, sub.customer);
  if (!profileId) {
    // Not thrown. Unlike a checkout, this is the shape of a subscription that
    // belongs to another product on a shared Stripe account, or a test event
    // replayed at a live database — retrying forever would not help.
    return;
  }

  // Renewals, lapses and portal plan-changes for a classroom licence land
  // here exactly like Pro's do, and take the chapter path for the same reason
  // the checkout does: the licence's state belongs to the chapter row and its
  // roster, never to the buyer's own `pro`.
  const chapter = await chapterFromSubscription(sub);
  if (chapter) {
    await syncChapter(db, profileId, sub, chapter);
    return;
  }

  await syncSubscription(db, profileId, sub);
}

/**
 * The profile behind an event, by the three routes it can be known.
 *
 * Metadata first because it is what we set ourselves at checkout; the customer
 * lookup is the fallback for subscription events created from the Stripe
 * dashboard, where nobody typed our metadata in. The `client_reference_id` sits
 * between them as the copy a support agent can actually see.
 */
async function resolveProfile(
  db: SupabaseClient,
  fromMetadata: string | undefined,
  fromReference: string | null,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): Promise<string | null> {
  if (fromMetadata) return fromMetadata;
  if (fromReference) return fromReference;
  const id = customerId(customer);
  return id ? profileForCustomer(db, id) : null;
}
