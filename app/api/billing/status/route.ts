import { NextResponse } from "next/server";

import { availableSkus } from "@/lib/stripe/catalogue";
import { billingConfigured, isLiveMode } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/status — can this deploy actually take money?
 *
 * It exists so the pricing screens can tell the truth. The line under CHOOSE
 * PRO currently reads "No card is taken. Pro switches on for this device until
 * accounts launch." — which is honest today and becomes a lie the moment
 * Stripe keys are set. A screen cannot read a server-only env var, so it asks.
 *
 * Nothing secret crosses. `live` is the mode, not the key: it is here because
 * "I checked out and my card was not charged" is nearly always a test-mode
 * deploy, and a build that cannot say which mode it is in makes that a
 * half-hour of guessing.
 */
export function GET() {
  return NextResponse.json({
    configured: billingConfigured(),
    live: billingConfigured() && isLiveMode(),
    // Which SKUs have a price id set. A deploy that has configured the
    // subscription but not the run slot should show one button, not two.
    skus: billingConfigured() ? availableSkus() : [],
  });
}
