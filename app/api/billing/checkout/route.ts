import { NextResponse, type NextRequest } from "next/server";

import {
  CHAPTER_CUSTOM_MAX_SEATS,
  CHAPTER_CUSTOM_MIN_SEATS,
  customChapterPriceCents,
  isCustomSeatCount,
} from "@/lib/monetization";
import { adminClient } from "@/lib/supabase/admin";
import { attachSession, sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";
import { CATALOGUE, isChapterSku, isSellableIndustry, isSkuId, priceIdFor, type Sku } from "@/lib/stripe/catalogue";
import { stripe } from "@/lib/stripe/client";
import { resolvePrice } from "@/lib/stripe/prices";
import { SITE_URL, billingConfigured } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout — open a Stripe Checkout session.
 *
 * Body: `{ sku: SkuId, industry?: Industry }`. Answers `{ url }`, and the
 * client sets `location.href` to it. The browser never loads stripe.js: the
 * whole payment happens on Stripe's own origin, so no third-party script and
 * no third-party identifier ever runs on a page shown to a minor
 * (docs/LEADERBOARD.md §1.4, §9.6).
 *
 * ── What this route refuses to do ──────────────────────────────────────────
 *
 * · **Sell at a price the app does not display.** The price is configuration
 *   and the amount is in lib/monetization.ts, and nothing keeps the two
 *   honest. So before opening checkout it fetches the price and compares
 *   amount, currency and cadence — see lib/stripe/prices.ts. A mismatch is a
 *   500 with both numbers in it, because the alternative is charging a player
 *   something other than the number on the screen they tapped. That check is
 *   also what makes it safe for the env vars to accept a product id (prod_…)
 *   as well as a price id: a wrong id fails loudly instead of charging.
 * · **Sell something the player already owns.** Buying TECH twice is a charge
 *   for nothing; the array in `entitlements` would swallow the duplicate.
 * · **Take a price id from the client.** The body names a SKU from a closed
 *   set. A route that accepted a price id would let anyone check out against
 *   the $0 price they made in their own test account and get a real grant.
 *   The custom chapter takes one number from the client — the SEAT COUNT —
 *   and never the price: the amount is computed here from that count, by the
 *   same function the pricing screen displays with.
 *
 * ── What it does NOT decide ────────────────────────────────────────────────
 *
 * Whether the person tapping is old enough to be entering card details. That
 * is a product gate belonging to the screen that calls this, and it is a real
 * one: Novus is handed to minors, and Stripe's terms are written for an adult
 * account holder. This route will happily open checkout for anyone who reaches
 * it — see docs/STRIPE-SETUP.md §Who may see a checkout button.
 */

interface Body {
  sku?: unknown;
  industry?: unknown;
  /** `chapter_custom` only: how many seats the buyer chose. */
  seats?: unknown;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * A refusal that does NOT sign the player out.
 *
 * sessionFromRequest rotates the refresh token, so by the time any of the
 * checks below can fail, the token in the browser's cookie is already spent.
 * Returning a bare error would leave it there — and "you already own TECH"
 * would quietly cost the player their session and their cloud sync.
 */
const refuse = (session: Session | null, error: string, status = 400) =>
  withSession(NextResponse.json({ error }, { status }), session);

export async function POST(req: NextRequest) {
  if (!billingConfigured()) {
    // The same shape lib/cloud/sync.ts already expects from an unconfigured
    // project: a normal answer, not an error. The caller falls back to the
    // device-local grant and the player keeps playing.
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("bad json");
  }

  // The buyer-sized licence is not a CATALOGUE entry: it has no configured
  // Stripe price to resolve — the amount is computed from the seat count by
  // the very function the pricing screen called (customChapterPriceCents),
  // and handed to Stripe as price_data. The screen's number and the charged
  // number cannot disagree, which is the invariant resolvePrice defends for
  // every fixed SKU; here it holds by construction. The seat count itself is
  // the one thing taken from the client, and it is bounded and priced
  // server-side — never the price.
  const customSeats = body.sku === "chapter_custom" ? body.seats : null;
  if (customSeats !== null && !isCustomSeatCount(customSeats)) {
    return bad(
      `a custom chapter is ${CHAPTER_CUSTOM_MIN_SEATS} to ${CHAPTER_CUSTOM_MAX_SEATS} seats — whole numbers only`,
    );
  }
  const custom = isCustomSeatCount(customSeats) ? customSeats : null;

  if (custom === null && !isSkuId(body.sku)) return bad("unknown sku");
  const sku = custom === null ? CATALOGUE[body.sku as Sku["id"]] : null;

  if (sku && !priceIdFor(sku)) return bad(`${sku.envVar} is not set`, 501);

  // An industry pack without an industry is a $2.99 charge for nothing, and a
  // free industry is a charge for something already owned. Both are checked
  // before a customer is created, so a bad request leaves no debris in Stripe.
  let industry: string | null = null;
  if (sku?.needsIndustry) {
    if (!isSellableIndustry(body.industry)) return bad("unknown or free industry");
    industry = body.industry;
  }

  // Not sessionOrCreate: a purchase must never be the thing that mints an
  // identity. See the anonymous check immediately below.
  const session = await sessionFromRequest(req);
  if (!session) return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });

  /*
   * Nothing is sold to an anonymous identity.
   *
   * An anonymous user exists only as long as its cookie. Clear the browser,
   * switch device, or hand the school iPad to the next student, and it is gone
   * — along with every entitlement attached to it, with no email, no password
   * and no way on earth for the player to prove they paid. Taking money for
   * that is indefensible, so the sale is refused and the client is told to
   * send them through sign-up first.
   *
   * This is also what makes it safe for sign-up to mint a NEW user id instead
   * of converting the anonymous one (app/api/auth/signup/route.ts): if nothing
   * can be bought before the account exists, nothing can be stranded when it
   * is created.
   */
  if (session.anonymous) {
    return withSession(
      NextResponse.json(
        {
          configured: true,
          signedIn: true,
          needsAccount: true,
          error:
            "Create an account before buying — otherwise the purchase has nothing to attach to.",
        },
        { status: 403 },
      ),
      session,
    );
  }

  // Same upsert /api/session does. A purchase can be someone's first ever
  // request — the profile row is the foreign key every table below hangs off,
  // including billing_customers, so it has to exist before Stripe is called.
  const { error: profileError } = await session.supabase
    .from("profiles")
    .upsert({ id: session.userId, display_name: "Founder" }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) return refuse(session, `profile: ${profileError.message}`, 500);

  const db = adminClient();

  const chapterPurchase = custom !== null || (sku !== null && isChapterSku(sku.id));

  const owned = await alreadyOwns(db, session.userId, chapterPurchase, sku, industry);
  if (owned) return refuse(session, owned, 409);

  // Accepts either a price id or a product id, and refuses outright if the
  // amount, currency or cadence disagrees with the pricing screens. The
  // custom licence has nothing to resolve — its price is minted below.
  let priceId = "";
  if (sku) {
    const resolved = await resolvePrice(sku);
    if (!resolved.ok) return refuse(session, resolved.reason, 500);
    priceId = resolved.priceId;
  }

  let customer: string;
  try {
    customer = await customerFor(db, session);
  } catch (e) {
    return refuse(session, `customer: ${(e as Error).message}`, 500);
  }

  const skuId = custom !== null ? "chapter_custom" : sku!.id;
  // Travels on the session AND the subscription, so every later
  // customer.subscription.* event knows the licence size with no lookup.
  const seatsMetadata: Record<string, string> =
    custom !== null ? { seats: String(custom) } : {};

  try {
    const checkout = await stripe().checkout.sessions.create(
      {
        mode: custom !== null ? "subscription" : sku!.kind,
        customer,
        line_items: [
          custom !== null
            ? {
                // One line at the quoted total (not per-seat × quantity), so
                // the charge equals the rounded number the screen printed to
                // the cent. product_data mints a product per checkout; the
                // seat count in its name is what makes the invoice and the
                // dashboard row legible, and custom licences are rare enough
                // that the product list stays readable.
                price_data: {
                  currency: "usd",
                  unit_amount: customChapterPriceCents(custom),
                  recurring: { interval: "year" },
                  product_data: {
                    name: `Novus Chapter — ${custom} seats`,
                    metadata: { novus_sku: "chapter_custom" },
                  },
                },
                quantity: 1,
              }
            : { price: priceId, quantity: 1 },
        ],

        // Both are read by the webhook. `client_reference_id` is the one Stripe
        // shows in the dashboard, which is what makes a support ticket
        // answerable; `metadata` is what the code actually branches on.
        client_reference_id: session.userId,
        metadata: {
          profile_id: session.userId,
          sku: skuId,
          ...(industry ? { industry } : {}),
          ...seatsMetadata,
        },

        // Copied onto the subscription itself, so the three
        // customer.subscription.* events can identify the player — and tell a
        // chapter licence from Pro — without needing the checkout session
        // that started it all.
        ...(custom !== null || sku!.kind === "subscription"
          ? {
              subscription_data: {
                metadata: { profile_id: session.userId, sku: skuId, ...seatsMetadata },
              },
            }
          : {}),

        // A licence buyer lands on the seat console their purchase just
        // opened; everyone else returns to the game.
        success_url: chapterPurchase
          ? `${SITE_URL}/chapter?purchase=ok`
          : `${SITE_URL}/found?purchase=ok`,
        cancel_url: chapterPurchase
          ? `${SITE_URL}/chapter?purchase=cancelled`
          : `${SITE_URL}/found?purchase=cancelled`,

        // A checkout left open on a school iPad should not still be a live
        // payment link an hour later. Stripe's floor is 30 minutes and it
        // rejects anything under, so this sits just above it rather than
        // exactly on it — the request takes time to arrive.
        expires_at: Math.floor(Date.now() / 1000) + 32 * 60,
      },
      // Not idempotent across taps on purpose — a player who abandons checkout
      // and comes back needs a fresh session, not the expired one.
    );

    if (!checkout.url) return refuse(session, "stripe returned no checkout url", 500);
    return attachSession(NextResponse.json({ configured: true, url: checkout.url }), session);
  } catch (e) {
    return refuse(session, `stripe: ${(e as Error).message}`, 502);
  }
}

/** A refusal string when the player already has the thing, else null.
 *  `sku` is null exactly when the purchase is the custom chapter, which the
 *  `chapterPurchase` branch answers before it is needed. */
async function alreadyOwns(
  db: ReturnType<typeof adminClient>,
  profileId: string,
  chapterPurchase: boolean,
  sku: Sku | null,
  industry: string | null,
): Promise<string | null> {
  // A chapter licence is owned as a chapter, not as an entitlement — and
  // holding personal Pro is no reason to refuse a teacher a classroom. One
  // live licence per owner: sizes are changed in the billing portal, where
  // the subscription already lives, not by stacking a second subscription.
  if (chapterPurchase) {
    const { data } = await db
      .from("chapters")
      .select("id")
      .eq("owner_profile_id", profileId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    return data
      ? "this account already runs a chapter — change its size from the billing portal"
      : null;
  }
  if (!sku) return null;

  const { data } = await db
    .from("entitlements")
    .select("pro, industry_packs")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!data) return null;

  if (sku.kind === "subscription" && data.pro) {
    // Changing monthly ↔ yearly is a real thing a player wants to do; it is
    // just not a second checkout. The portal handles it, and the client is
    // told which door to use rather than being left at a dead end.
    return "already subscribed — use the billing portal to change plan";
  }

  if (industry && (data.industry_packs as string[] | null)?.includes(industry)) {
    return `${industry} is already unlocked`;
  }

  return null;
}

/**
 * The player's Stripe customer, created on first purchase and reused after.
 *
 * Reused rather than recreated so a returning player's payment methods and
 * receipts stay in one place, and so the portal has something to open. The
 * only thing Stripe is told about them is the profile UUID — no display name,
 * no board handle, and nothing derived from RunState.playerAge.
 */
async function customerFor(
  db: ReturnType<typeof adminClient>,
  session: Session,
): Promise<string> {
  const { data, error } = await db
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("profile_id", session.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;

  const created = await stripe().customers.create({
    metadata: { profile_id: session.userId },
  });

  // Written before checkout opens, so the webhook can resolve the customer
  // back to a profile no matter how fast Stripe calls us back. Losing this
  // race would mean a paid event we cannot attribute to anyone.
  const { error: insertError } = await db
    .from("billing_customers")
    .insert({ profile_id: session.userId, stripe_customer_id: created.id });
  if (insertError) throw new Error(insertError.message);

  return created.id;
}
