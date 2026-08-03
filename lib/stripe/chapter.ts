import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAPTER_LICENCES, type ChapterLicence } from "@/lib/monetization";
import { CATALOGUE, isChapterSku, isSkuId } from "./catalogue";
import { resolvePrice } from "./prices";
import { grantsAccess, periodEnd } from "./subscription";

/**
 * One chapter subscription, turned into one answer: which classroom has how
 * many seats, and whether they are lit right now.
 *
 * The deliberate mirror of lib/stripe/subscription.ts, and deliberately NOT
 * the same code path. A Pro subscription is about one player's entitlements;
 * a chapter subscription is about a licence row that up to a hundred players'
 * entitlements hang off. Routing both through syncSubscription would set
 * `pro` on the buyer — a teacher who never plays — and grant nothing to the
 * classroom, which is the exact failure 0003 refused to ship.
 *
 * What a chapter subscription does NOT touch: `billing_customers`'s
 * subscription columns. That table holds one subscription per profile and it
 * is the personal Pro slot; an owner may hold Pro for themselves AND a licence
 * for their class, and the licence's state lives on `chapters` alone. The
 * customer id is shared — same buyer, same card, one portal.
 */

/**
 * Which licence a subscription is, or null when it is not a chapter at all.
 *
 * Metadata first: checkout writes `sku` onto the subscription itself, so every
 * later `customer.subscription.*` event carries the answer with no lookup.
 * The price match is the fallback for subscriptions the dashboard created —
 * and it resolves each configured id through the same cache checkout uses,
 * because the env vars may hold product ids while the subscription's items
 * only ever name prices.
 */
export async function chapterFromSubscription(
  sub: Stripe.Subscription,
): Promise<ChapterLicence["id"] | null> {
  const fromMetadata = sub.metadata?.sku;
  if (isSkuId(fromMetadata) && isChapterSku(fromMetadata)) return fromMetadata;

  const priceIds = new Set(
    sub.items.data.map((item) => item.price?.id).filter((id): id is string => !!id),
  );
  for (const licence of CHAPTER_LICENCES) {
    const resolved = await resolvePrice(CATALOGUE[licence.id]);
    if (resolved.ok && priceIds.has(resolved.priceId)) return licence.id;
  }
  return null;
}

/**
 * Writes a chapter subscription's state to the chapter and to every seat.
 *
 * Order matters, same argument as syncSubscription: the chapter row first
 * because `set_chapter_access` reads the licence off it, then the roster's
 * entitlements in one statement. Both are idempotent, so a Stripe retry
 * re-running this is harmless.
 *
 * A lapse does not touch the roster rows themselves — the teacher's list
 * survives a failed card, and renewal lights every seat back up without
 * re-inviting anyone.
 */
export async function syncChapter(
  db: SupabaseClient,
  ownerProfileId: string,
  sub: Stripe.Subscription,
  licenceId: ChapterLicence["id"],
): Promise<void> {
  const licence = CHAPTER_LICENCES.find((l) => l.id === licenceId);
  if (!licence) throw new Error(`unknown chapter licence ${licenceId}`);

  const active = grantsAccess(sub.status);

  const { data: chapter, error: upsertError } = await db
    .from("chapters")
    .upsert(
      {
        owner_profile_id: ownerProfileId,
        licence: licence.id,
        seats: licence.seats,
        stripe_subscription_id: sub.id,
        status: active ? "active" : "lapsed",
        current_period_end: periodEnd(sub),
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("id")
    .single();
  if (upsertError || !chapter) {
    // Thrown so the webhook 500s and Stripe retries — a licence that was paid
    // for and never recorded is the purchase-lost failure mode.
    throw new Error(`chapters upsert failed: ${upsertError?.message ?? "no row"}`);
  }

  const { error: accessError } = await db.rpc("set_chapter_access", {
    p_chapter: chapter.id,
    p_active: active,
  });
  if (accessError) {
    throw new Error(`set_chapter_access failed: ${accessError.message}`);
  }
}
