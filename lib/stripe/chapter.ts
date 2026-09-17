import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAPTER_CUSTOM_MAX_SEATS, CHAPTER_LICENCES, type ChapterId } from "@/lib/monetization";
import { chapterProfileFromMetadata } from "@/lib/chapter/profile";
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

/** A chapter subscription, decoded: which licence, and how many seats it
 *  lights. For the fixed licences the seats ARE the licence; for
 *  `chapter_custom` they are whatever number the buyer checked out with,
 *  carried in the subscription's own metadata. */
export interface ChapterSpec {
  licence: ChapterId;
  seats: number;
}

/**
 * Which chapter a subscription buys, or null when it is not a chapter at all.
 *
 * Current item prices identify fixed tiers before metadata: a portal plan
 * switch updates the price, but leaves the checkout's original SKU untouched.
 * Resolving each configured id through checkout's cache supports both product
 * and price env vars. Metadata is the fallback for manually created prices,
 * and the subscription's current metadata wins over the checkout's snapshot.
 * A custom subscription can never match a configured price (its
 * price is minted per checkout), so for it the metadata is the only truth —
 * and a custom sku whose seats are unreadable is thrown rather than guessed,
 * because writing a chapter row with an invented size is the one thing worse
 * than retrying.
 */
export async function chapterFromSubscription(
  sub: Stripe.Subscription,
  checkoutMetadata?: Stripe.Metadata | null,
): Promise<ChapterSpec | null> {
  const fromMeta = (meta: Stripe.Metadata | null | undefined): ChapterSpec | null => {
    const sku = meta?.sku ?? meta?.novus_sku;
    if (isSkuId(sku) && isChapterSku(sku)) {
      const licence = CHAPTER_LICENCES.find((l) => l.id === sku);
      if (licence) return { licence: licence.id, seats: licence.seats };
    }
    if (sku === "chapter_custom") {
      const seats = Number(meta?.seats);
      // Existing invoices may predate the 10-seat sales floor. The upper
      // bound follows migration 0014, rather than the retired 500-seat cap.
      if (!Number.isInteger(seats) || seats < 1 || seats > CHAPTER_CUSTOM_MAX_SEATS) {
        throw new Error(
          `subscription ${sub.id} is chapter_custom with unusable seats metadata ` +
            `(${meta?.seats ?? "unset"}) — cannot record the licence size`,
        );
      }
      return { licence: "chapter_custom", seats };
    }
    return null;
  };

  const metadataSpec = fromMeta(sub.metadata) ?? fromMeta(checkoutMetadata);
  if (metadataSpec?.licence === "chapter_custom") return metadataSpec;

  const priceIds = new Set(
    sub.items.data.map((item) => item.price?.id).filter((id): id is string => !!id),
  );
  for (const licence of CHAPTER_LICENCES) {
    const resolved = await resolvePrice(CATALOGUE[licence.id]);
    if (resolved.ok && priceIds.has(resolved.priceId)) {
      return { licence: licence.id, seats: licence.seats };
    }
  }
  return metadataSpec;
}

/**
 * Writes a chapter subscription's state to the chapter and to every seat.
 *
 * Migration 0020 performs the row write and entitlement sync under one lock.
 * A deleted enterprise retains a tombstone against its subscription id, so
 * even an already-in-flight webhook cannot reactivate it. Initial metadata
 * fills the organisation profile only on INSERT: renewals must never undo an
 * owner's later edits to their contact details.
 *
 * A lapse does not touch the roster rows themselves — the teacher's list
 * survives a failed card, and renewal lights every seat back up without
 * re-inviting anyone.
 */
export async function syncChapter(
  db: SupabaseClient,
  ownerProfileId: string,
  sub: Stripe.Subscription,
  spec: ChapterSpec,
  checkoutMetadata?: Stripe.Metadata | null,
): Promise<void> {
  const active = grantsAccess(sub.status);
  const profile = chapterProfileFromMetadata(checkoutMetadata) ?? chapterProfileFromMetadata(sub.metadata);
  const { error } = await db.rpc("sync_chapter_subscription", {
    p_owner: ownerProfileId,
    p_subscription: sub.id,
    p_licence: spec.licence,
    p_seats: spec.seats,
    p_active: active,
    p_period_end: periodEnd(sub),
    p_name: profile?.name ?? null,
    p_organization_type: profile?.organizationType ?? null,
    p_contact_name: profile?.contactName ?? null,
    p_contact_email: profile?.contactEmail ?? null,
  });
  if (error) {
    throw new Error(`sync_chapter_subscription failed: ${error.message}`);
  }
}

/**
 * Cancel precisely the subscription proven to belong to the selected owned
 * enterprise. Read Stripe's live state, not our active/lapsed flag: paused
 * and unpaid subscriptions can still resume billing. A retry after a lost
 * response is successful only when Stripe confirms it is already cancelled.
 * Missing configuration is an error, never permission to delete a billable
 * enterprise while leaving its payment obligation running.
 */
export async function cancelChapterSubscription(subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) return;
  const { stripe } = await import("./client");
  const processor = stripe();
  const subscription = await processor.subscriptions.retrieve(subscriptionId);
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return;
  try {
    await processor.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
  } catch (error) {
    const latest = await processor.subscriptions.retrieve(subscriptionId);
    if (latest.status !== "canceled" && latest.status !== "incomplete_expired") throw error;
  }
}

/**
 * Account deletion uses the same cancellation and atomic tombstone operation
 * as enterprise deletion. A lapsed access flag is not proof billing ended.
 * Cancel every subscription before touching rosters; read/cancellation/cleanup
 * failures keep the account available for retry. The tombstone also serializes
 * against in-flight seat grants and subscription webhooks before the cascade.
 */
export async function windDownOwnedChapters(
  db: SupabaseClient,
  ownerProfileId: string,
): Promise<{ ok: boolean; failedCancellations: string[] }> {
  const { data: chapters, error } = await db
    .from("chapters")
    .select("id, stripe_subscription_id")
    .eq("owner_profile_id", ownerProfileId);
  if (error) return { ok: false, failedCancellations: [] };

  const failedCancellations: string[] = [];
  for (const chapter of chapters ?? []) {
    const subId = chapter.stripe_subscription_id as string | null;
    try {
      await cancelChapterSubscription(subId);
    } catch {
      if (subId) failedCancellations.push(subId);
      else return { ok: false, failedCancellations };
    }
  }
  if (failedCancellations.length) return { ok: false, failedCancellations };

  for (const chapter of chapters ?? []) {
    const { data: deleted, error: cleanupError } = await db.rpc("delete_chapter", { p_chapter: chapter.id });
    if (cleanupError || deleted !== true) return { ok: false, failedCancellations };
  }
  return { ok: true, failedCancellations };
}
