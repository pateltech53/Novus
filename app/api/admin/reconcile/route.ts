import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { stripe } from "@/lib/stripe/client";
import { billingConfigured } from "@/lib/stripe/config";
import { syncSubscription } from "@/lib/stripe/subscription";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reconcile — ask Stripe what is true, and write it down.
 *
 * `entitlements.pro` is written by exactly one thing, the webhook, and a
 * webhook is a request that can fail to arrive: an endpoint added after the
 * first sale, a rotated STRIPE_WEBHOOK_SECRET, a `customer.subscription.*`
 * event never ticked in the dashboard. Every one of those leaves a player who
 * is being charged without the Pro they are paying for, and — until 0016 —
 * left the console showing PRO · PAID · 0 while the account panel showed a
 * live subscription. `admin_billing_mismatches` finds them; this repairs them.
 *
 * ── Why this is not a grant ─────────────────────────────────────────────────
 *
 * Nothing here decides anything. The subscription is read back FROM STRIPE and
 * handed to `syncSubscription` — the same function both webhook paths call, so
 * an account repaired here lands in exactly the state the webhook would have
 * left it in, including the case where the answer is "this lapsed, take Pro
 * away". An operator who wants to GIVE Pro uses the gift chips (§5); this
 * button cannot give anything Stripe is not already charging for, which is
 * what makes it safe to press on any account without thinking about it.
 *
 * Both directions are therefore repaired by one call: `stripe-not-granted`
 * grants, `granted-not-billed` revokes, and an account whose records already
 * agree is a no-op that says so.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }
  if (!billingConfigured()) {
    return withSession(bad(503, "billing is not configured on this deploy"), gate.session);
  }

  let body: { profileId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }
  if (!isUuid(body.profileId)) {
    return withSession(bad(400, "profileId is required"), gate.session);
  }
  const profileId = body.profileId;

  const db = adminClient();

  const [billing, account] = await Promise.all([
    db
      .from("billing_customers")
      .select("stripe_customer_id, subscription_id")
      .eq("profile_id", profileId)
      .maybeSingle(),
    db.auth.admin.getUserById(profileId),
  ]);

  if (!billing.data) {
    return withSession(
      bad(404, "this account has never reached checkout — there is no Stripe customer to read"),
      gate.session,
    );
  }

  /*
   * The customer is asked, not the stored subscription id.
   *
   * A record broken badly enough to be worth reconciling is a record whose
   * `subscription_id` may itself be the missing half — a checkout that
   * completed while the webhook was down writes the customer and nothing
   * else. Listing the customer's subscriptions finds the live one whatever
   * this table remembers, and `status: "all"` is deliberate: a subscription
   * that ended is the answer when the entitlement says Pro and Stripe does
   * not, and asking only for active ones would leave that half unrepairable.
   */
  let subscriptions;
  try {
    subscriptions = await stripe().subscriptions.list({
      customer: billing.data.stripe_customer_id as string,
      status: "all",
      limit: 10,
    });
  } catch (e) {
    return withSession(bad(503, `Stripe refused the read: ${(e as Error).message}`), gate.session);
  }

  // Newest first is Stripe's own order; the one that decides access is the
  // most recent, which is the same rule the webhook applies by simply acting
  // on whatever event arrived last.
  const subscription = subscriptions.data[0] ?? null;

  if (!subscription) {
    return withSession(
      NextResponse.json({
        ok: true,
        changed: false,
        message:
          "Stripe has a customer for this account but has never had a subscription on it. Nothing to reconcile — a gift is the way to give Pro here.",
      }),
      gate.session,
    );
  }

  const before = await db
    .from("entitlements")
    .select("pro")
    .eq("profile_id", profileId)
    .maybeSingle();

  try {
    await syncSubscription(db, profileId, subscription);
  } catch (e) {
    return withSession(bad(503, (e as Error).message), gate.session);
  }

  const after = await db
    .from("entitlements")
    .select("pro")
    .eq("profile_id", profileId)
    .maybeSingle();

  const wasPro = before.data?.pro === true;
  const isPro = after.data?.pro === true;

  await audit(gate.session, "billing_reconcile", {
    target: profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: {
      subscriptionId: subscription.id,
      status: subscription.status,
      proBefore: wasPro,
      proAfter: isPro,
    },
  });

  return withSession(
    NextResponse.json({
      ok: true,
      changed: wasPro !== isPro,
      status: subscription.status,
      pro: isPro,
      message:
        wasPro === isPro
          ? `Already correct — Stripe says ${subscription.status} and the entitlement agrees.`
          : isPro
            ? `Repaired: Stripe says ${subscription.status}, and Pro is now granted.`
            : `Repaired: Stripe says ${subscription.status}, and Pro has been taken back.`,
    }),
    gate.session,
  );
}
