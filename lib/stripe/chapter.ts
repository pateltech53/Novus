import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAPTER_LICENCES, type ChapterId } from "@/lib/monetization";
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
 * Metadata first: checkout writes `sku` (and, for custom sizes, `seats`) onto
 * the subscription itself, so every later `customer.subscription.*` event
 * carries the answer with no lookup; `checkoutMetadata` lets the checkout
 * handler offer the session's copy of the same fields first. The price match
 * is the fallback for tier subscriptions the dashboard created — and it
 * resolves each configured id through the same cache checkout uses, because
 * the env vars may hold product ids while the subscription's items only ever
 * name prices. A custom subscription can never match a configured price (its
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
    const sku = meta?.sku;
    if (isSkuId(sku) && isChapterSku(sku)) {
      const licence = CHAPTER_LICENCES.find((l) => l.id === sku);
      if (licence) return { licence: licence.id, seats: licence.seats };
    }
    if (sku === "chapter_custom") {
      const seats = Number(meta?.seats);
      // 1–500 is the database's own bound on chapters.seats (0007), wider
      // than the 10–500 the pricing page offers on purpose: syncing what was
      // genuinely sold beats refusing a row the schema would accept.
      if (!Number.isInteger(seats) || seats < 1 || seats > 500) {
        throw new Error(
          `subscription ${sub.id} is chapter_custom with unusable seats metadata ` +
            `(${meta?.seats ?? "unset"}) — cannot record the licence size`,
        );
      }
      return { licence: "chapter_custom", seats };
    }
    return null;
  };

  const fromCheckout = fromMeta(checkoutMetadata);
  if (fromCheckout) return fromCheckout;
  const fromSub = fromMeta(sub.metadata);
  if (fromSub) return fromSub;

  const priceIds = new Set(
    sub.items.data.map((item) => item.price?.id).filter((id): id is string => !!id),
  );
  for (const licence of CHAPTER_LICENCES) {
    const resolved = await resolvePrice(CATALOGUE[licence.id]);
    if (resolved.ok && priceIds.has(resolved.priceId)) {
      return { licence: licence.id, seats: licence.seats };
    }
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
  spec: ChapterSpec,
): Promise<void> {
  const active = grantsAccess(sub.status);

  const { data: chapter, error: upsertError } = await db
    .from("chapters")
    .upsert(
      {
        owner_profile_id: ownerProfileId,
        licence: spec.licence,
        seats: spec.seats,
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
