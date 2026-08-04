/**
 * The one fact the claim step hands forward to the welcome step.
 *
 * A chapter invite is two screens with a round trip through Supabase between
 * them: /join takes the email and the name, the claim endpoint mints a
 * one-time link, the browser follows it, and Supabase redirects back to
 * /join/setup with a session in the URL fragment. That redirect carries
 * nothing of ours — so the name the student typed thirty seconds ago would be
 * gone by the time the page that says "Welcome, Sam." needs it.
 *
 * sessionStorage rather than a query parameter on the redirect: Supabase only
 * redirects to URLs on its own allow-list, and hanging a parameter off that
 * URL is one more thing that has to match a setting in a dashboard. This is
 * the same tab, the same origin, seconds apart — and if it is missing (private
 * mode, a link opened in a second browser), the welcome page simply asks for
 * the name itself. Nothing depends on it being there.
 *
 * It is a display name, never a credential: what it decides is which question
 * the next screen asks, and the account it belongs to is already proven by the
 * tokens in the fragment.
 */

const KEY = "novus:invite:name";

/** Called by /join once the claim is accepted and the browser is leaving. */
export function rememberInviteName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(KEY, trimmed);
  } catch {
    /* private mode, or storage disabled — the welcome page asks instead */
  }
}

/** The name typed at /join, if this tab is the one that typed it. */
export function readInviteName(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Dropped once the seat is set up — it has served its one purpose. */
export function forgetInviteName(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
