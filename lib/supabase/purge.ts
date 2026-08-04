import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Explicitly delete every row the schema keys to one account.
 *
 * On a database that matches the migrations this is a series of no-ops: every
 * one of these tables hangs off `public.profiles(id)` with `on delete cascade`,
 * and profiles itself cascades from `auth.users`, so by the time this runs the
 * cascade has already emptied them. It exists because the privacy policy says
 * "the deletion is real, not a flag" — and that promise must not depend on a
 * production schema being exactly what the migrations say. A table created by
 * hand without its cascade, or a migration that never ran, silently turns
 * "delete my account" into "delete my login and keep my data". This sweep makes
 * the deletion true by construction: each table is cleared by name, children
 * before parents so it also works where no cascade exists at all.
 *
 * Runs AFTER `auth.admin.deleteUser` succeeds, on the service role. Returns
 * the tables that refused, so callers can surface "deleted, but check X" to an
 * operator instead of pretending.
 *
 * Deliberately not on this list:
 *   · admin_audit — the log of support actions, including the deletion itself.
 *     Its `target` column is a bare uuid with no name attached once the
 *     account is gone; the deletion audit row names the email on purpose, so
 *     "who deleted whom" survives the account it is about.
 *   · auth_throttle — keyed by HMAC of address/email, truncated; not
 *     recoverable personal data, and windowed rows age out on their own.
 *   · billing_events — Stripe event ids, data about payments not people.
 */
export async function purgeAccountRows(
  db: SupabaseClient,
  profileId: string,
): Promise<string[]> {
  const leftovers: string[] = [];

  // Seats in chapters this account OWNS belong to other players and reference
  // the chapter row — they must go before the chapters can. (The members were
  // already lapsed by windDownOwnedChapters before the delete.)
  const owned = await db.from("chapters").select("id").eq("owner_profile_id", profileId);
  const ownedIds = (owned.data ?? []).map((c) => c.id as string);
  if (ownedIds.length > 0) {
    const { error } = await db.from("chapter_seats").delete().in("chapter_id", ownedIds);
    if (error) leftovers.push(`chapter_seats(owned): ${error.message}`);
  }

  const targets: { table: string; column: string }[] = [
    { table: "chapter_seats", column: "profile_id" },
    { table: "chapters", column: "owner_profile_id" },
    { table: "leaderboard_entries", column: "profile_id" },
    { table: "runs", column: "profile_id" },
    { table: "submission_quota", column: "profile_id" },
    { table: "run_ledger", column: "profile_id" },
    { table: "billing_customers", column: "profile_id" },
    { table: "entitlements", column: "profile_id" },
    { table: "legacy", column: "profile_id" },
    { table: "saves", column: "profile_id" },
    { table: "preferences", column: "profile_id" },
    { table: "profiles", column: "id" },
  ];

  for (const t of targets) {
    const { error } = await db.from(t.table).delete().eq(t.column, profileId);
    if (error) leftovers.push(`${t.table}: ${error.message}`);
  }

  return leftovers;
}
