import "server-only";

import { MAX_NAME_LENGTH } from "@/lib/account";
import type { Session } from "@/lib/supabase/route";

/**
 * The profile row behind a provider sign-in, and whether we just made it.
 *
 * ── Why "did we make it" is the load-bearing answer ────────────────────────
 *
 * The email flow has two doors and the player picks one, so the app always
 * knows which it is: CREATE ACCOUNT keeps this device's companies and pushes
 * them into the new account, SIGN IN empties the device because the data
 * sitting in it belongs to whoever was here before (lib/cloud/auth.ts explains
 * both at length, and the classroom iPad they are written for).
 *
 * Google and Apple have ONE door. "Continue with Google" is a sign-up the first
 * time and a sign-in every time after, and nothing the player touches
 * distinguishes them. So the distinction has to come from the database, and
 * this is the only moment it is knowable: the profile row either existed a
 * millisecond ago or it did not. Get it wrong in one direction and a returning
 * player's cloud save is overwritten by a stranger's localStorage; wrong in the
 * other and a player who just made an account watches their half-built company
 * get wiped.
 *
 * ── The name ──────────────────────────────────────────────────────────────
 *
 * `display_name` is `not null check (length between 1 and 24)` in 0001, so the
 * row cannot be created without one and "ask the player first" is not
 * available. The provider's suggestion fills it if there is one, "Founder"
 * otherwise — exactly what /api/auth/signup does when onboarding has not
 * collected a name yet. It is a placeholder either way: `created: true` sends
 * the player to a screen that asks what they actually want to be called.
 */
export interface ProfileOutcome {
  created: boolean;
  displayName: string;
  /** A row that could not be written. The caller must not report a sign-in. */
  error: string | null;
}

export async function ensureProfile(
  session: Session,
  suggested: string | null,
): Promise<ProfileOutcome> {
  const { data: existing } = await session.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.userId)
    .maybeSingle();

  if (existing) {
    return { created: false, displayName: existing.display_name as string, error: null };
  }

  const displayName = (suggested ?? "").trim().slice(0, MAX_NAME_LENGTH) || "Founder";

  /*
   * insert, not upsert.
   *
   * Everywhere else in this app the profile write is an upsert with
   * `onConflict: "id"`, because those callers only care that the row ends up
   * there. Here the whole point is to learn whether it was already there — and
   * an upsert would happily overwrite a returning player's chosen name with
   * whatever Google currently calls them, then report success without ever
   * mentioning that it had not created anything.
   *
   * The select above already answered the question, so this is only reached
   * when the row is genuinely absent. A conflict at this point means two
   * requests raced, which is survivable: the row exists either way, so it is
   * reported as found rather than made — the safer of the two, since treating a
   * sign-in as a sign-up is what wipes nobody's device.
   */
  const { error } = await session.supabase
    .from("profiles")
    .insert({ id: session.userId, display_name: displayName });

  if (error) {
    if (error.code === "23505") {
      return { created: false, displayName, error: null };
    }
    return { created: false, displayName, error: error.message };
  }

  return { created: true, displayName, error: null };
}
