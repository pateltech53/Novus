/**
 * The short handover between an emailed session and a chosen password.
 *
 * /join/setup removes credentials from its URL immediately. Keeping them
 * only in React state made an innocent refresh destroy a valid invitation,
 * though: the email's one-time link had already been used and the address
 * bar now held nothing. Retain the handover in this tab's sessionStorage for
 * at most fifteen minutes, never localStorage, and remove it on completion
 * or expiry. Reloading reads the original deadline; it cannot extend it.
 * Supabase still validates every credential at submission.
 */

import { INVITE_SETUP_KEY as KEY, expireInviteSetupAt as expireAt, forgetInviteSetup } from "@/lib/auth/invite-cleanup";

export { forgetInviteSetup } from "@/lib/auth/invite-cleanup";

const SETUP_TTL_MS = 15 * 60 * 1000;

export interface InviteSetupTokens {
  access: string;
  refresh: string;
}

/** Storage may be disabled. The live page still holds its credentials. */
export function rememberInviteSetup(tokens: InviteSetupTokens): void {
  try {
    const expiresAt = Date.now() + SETUP_TTL_MS;
    sessionStorage.setItem(KEY, JSON.stringify({
      ...tokens,
      expiresAt,
    }));
    expireAt(expiresAt);
  } catch {
    /* The in-memory handover still works; only refresh recovery is absent. */
  }
}

export function readInviteSetup(): InviteSetupTokens | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<InviteSetupTokens> & { expiresAt?: unknown };
    const now = Date.now();
    if (
      typeof value.access !== "string" || !value.access ||
      typeof value.refresh !== "string" || !value.refresh ||
      typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now || value.expiresAt > now + SETUP_TTL_MS
    ) {
      forgetInviteSetup();
      return null;
    }
    expireAt(value.expiresAt);
    return { access: value.access, refresh: value.refresh };
  } catch {
    forgetInviteSetup();
    return null;
  }
}

/** An auth refresh can rotate the pair on a failed setup attempt. Replace
 *  only an existing live handover, without extending its original deadline. */
export function replaceInviteSetup(tokens: InviteSetupTokens): void {
  if (!readInviteSetup()) return;
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { expiresAt: number } | null;
    if (!value) return;
    sessionStorage.setItem(KEY, JSON.stringify({ ...tokens, expiresAt: value.expiresAt }));
  } catch {
    /* The caller's in-memory pair still permits a retry. */
  }
}
