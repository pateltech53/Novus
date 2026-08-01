import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { attachSession, sessionFromRequest, withSession } from "@/lib/supabase/route";
import { stripe } from "@/lib/stripe/client";
import { SITE_URL, billingConfigured } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal — open Stripe's customer portal.
 *
 * Cancelling, switching monthly ↔ yearly, updating a card, and downloading
 * receipts all happen there rather than in screens we would have to build and
 * keep correct. It also means the cancel path is one click from Settings and
 * not an email to support, which is the difference between a subscription and
 * a trap.
 *
 * Unlike checkout this uses `sessionFromRequest`, not `sessionOrCreate`: there
 * is nothing to manage for an identity that was minted one millisecond ago,
 * and minting one here would hand a brand-new anonymous player a portal for a
 * customer that does not exist.
 */
export async function POST(req: NextRequest) {
  if (!billingConfigured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }

  const db = adminClient();
  const { data, error } = await db
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("profile_id", session.userId)
    .maybeSingle();

  // withSession, not a bare error: sessionFromRequest rotated the refresh
  // token, so returning without it would sign the player out on the way to
  // reporting a database hiccup.
  if (error) return withSession(NextResponse.json({ error: error.message }, { status: 500 }), session);

  if (!data?.stripe_customer_id) {
    // Never bought anything. A normal answer — Settings uses it to keep the
    // "Manage subscription" row hidden rather than showing a button that opens
    // an error.
    return withSession(
      NextResponse.json({ configured: true, signedIn: true, customer: false }, { status: 200 }),
      session,
    );
  }

  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id as string,
      return_url: `${SITE_URL}/found`,
    });
    return attachSession(
      NextResponse.json({ configured: true, signedIn: true, customer: true, url: portal.url }),
      session,
    );
  } catch (e) {
    // The commonest cause by far is that nobody has saved a portal
    // configuration in the Stripe dashboard yet, so say so rather than
    // reporting a bare 502.
    return withSession(
      NextResponse.json(
        {
          error:
            `stripe: ${(e as Error).message} — if this mentions configuration, ` +
            `save the customer portal settings once in the Stripe dashboard`,
        },
        { status: 502 },
      ),
      session,
    );
  }
}
