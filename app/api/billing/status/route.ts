import { NextResponse } from "next/server";

import { CATALOGUE, availableSkus, priceIdFor, type SkuId } from "@/lib/stripe/catalogue";
import { billingConfigured, isLiveMode, missingBillingConfig } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/status — can this deploy actually take money, and if not, why.
 *
 * It exists so the pricing screens can tell the truth. The line under CHOOSE
 * PRO would otherwise still promise "no card is taken" on a deploy that can
 * charge one, and a screen cannot read a server-only env var, so it asks.
 *
 * ── It also has to be a diagnostic ─────────────────────────────────────────
 *
 * The first version answered `{configured: false}` and stopped, which told an
 * operator that something was missing and nothing about what. Setting this up
 * means juggling four required variables plus four price ids across a
 * dashboard and a deploy, and "false" sent them guessing. So the unset names
 * are listed.
 *
 * Names, never values — and the names are in .env.example in the repository
 * already, so this discloses nothing that reading the repo would not.
 */
export function GET() {
  const missing = missingBillingConfig();
  const configured = billingConfigured();

  // Which SKUs have no price id. Reported even when the four core variables
  // are set, because "checkout says the SKU is not configured" is the other
  // half of this question.
  const missingPrices = (Object.keys(CATALOGUE) as SkuId[]).filter(
    (id) => !priceIdFor(CATALOGUE[id]),
  ).map((id) => CATALOGUE[id].envVar);

  return NextResponse.json({
    configured,
    live: configured && isLiveMode(),
    // Which SKUs are actually purchasable right now.
    skus: configured ? availableSkus() : [],

    // ── Diagnostics ────────────────────────────────────────────────────────
    /** Required variables that are unset. Empty when `configured` is true. */
    missing,
    /** Price ids that are unset. Each one disables exactly one button. */
    missingPrices,
    /**
     * The commonest cause by far, and not something the server can detect:
     * variables added to a hosting dashboard do not reach a build that already
     * happened. Said here because the alternative is half an hour of checking
     * spellings that were right.
     */
    hint:
      missing.length > 0
        ? "Set these, then REDEPLOY — env vars added after a build do not reach it. On Vercel, check you set them for the right environment (Production vs Preview)."
        : missingPrices.length > 0
          ? "Core config is complete. Each price id above disables one purchase button until set."
          : "Billing is fully configured.",
  });
}
