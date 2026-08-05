import "server-only";

import { NO_ENTITLEMENTS, type Entitlements } from "@/lib/monetization";

/**
 * The one translation from what the database stores to what the client is
 * told it owns. Both readers of `public.entitlements` — /api/sync and
 * /api/billing/entitlements — route through here, so a gift or an admin view
 * cannot be honoured on one path and forgotten on the other.
 *
 * Two rules live here and nowhere else on the read side:
 *
 * · **Comped Pro folds into `pro`.** The client's Entitlements shape has one
 *   `pro` flag and every gate reads it; whether the server's reason is a
 *   Stripe subscription or `comp_pro` (0009) is billing's business, not the
 *   closet's. Expiry is evaluated here, at read time — the same instant the
 *   database functions evaluate it — so a lapsed gift simply stops arriving,
 *   with no sweeper and no window where client and ledger disagree.
 *
 * · **An admin's account is derived, never stored.** `profiles.role` and
 *   `admin_view` decide what the account plays at; entitlements rows are not
 *   written for it (see 0009's header). 'free' and 'pro' exist so paywalls
 *   can be tested from a real session and behave exactly like the tier they
 *   imitate — which is why 'free' returns NO_ENTITLEMENTS rather than the
 *   admin's own gifts and packs.
 */

export type AdminView = "free" | "pro" | "all";

/** The columns the two routes select, in the table's own names. */
export interface EntitlementRow {
  pro: boolean | null;
  extra_run_slots: number | null;
  extra_year_closes: number | null;
  industry_packs: string[] | null;
  cosmetic_bundles: string[] | null;
  chapter: string | null;
  intent: string | null;
  comp_pro: boolean | null;
  comp_until: string | null;
}

/** The role columns the same routes read off the caller's profile. */
export interface ProfileRoleRow {
  role: string | null;
  admin_view: string | null;
}

const compActive = (row: EntitlementRow): boolean =>
  !!row.comp_pro && (!row.comp_until || new Date(row.comp_until) > new Date());

const fromRow = (row: EntitlementRow): Entitlements => ({
  pro: !!row.pro || compActive(row),
  extraRunSlots: row.extra_run_slots ?? 0,
  extraYearCloses: row.extra_year_closes ?? 0,
  industryPacks: (row.industry_packs ?? []) as Entitlements["industryPacks"],
  cosmeticBundles: row.cosmetic_bundles ?? [],
  chapter: (row.chapter ?? null) as Entitlements["chapter"],
  intent: (row.intent ?? null) as Entitlements["intent"],
  admin: false,
});

/**
 * Null in, null out for players: a missing entitlements row means "no
 * purchase on record", and that absence is load-bearing — it is what lets a
 * device-local pre-billing grant survive a sync. An admin is the exception,
 * because their access exists whether or not they ever bought anything.
 */
export function wireEntitlements(
  row: EntitlementRow | null,
  profile: ProfileRoleRow | null,
): Entitlements | null {
  const base = row ? fromRow(row) : null;

  if (profile?.role !== "admin") return base;

  const view: AdminView =
    profile.admin_view === "free" || profile.admin_view === "pro"
      ? profile.admin_view
      : "all";

  switch (view) {
    case "free":
      // The free tier, faithfully — not even the admin's own purchases, so
      // the locked states under test are the ones a new player actually sees.
      return { ...NO_ENTITLEMENTS, intent: base?.intent ?? null };
    case "pro":
      return { ...(base ?? NO_ENTITLEMENTS), pro: true, admin: false };
    default:
      return { ...(base ?? NO_ENTITLEMENTS), pro: true, admin: true };
  }
}
