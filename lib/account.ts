/**
 * The device-local mirror of the account.
 *
 * This file used to BE the account — a display name in localStorage, with no
 * email and no password, because collecting credentials a device-local build
 * could not protect would have been worse than collecting nothing. Real
 * accounts now exist (lib/cloud/auth.ts, app/api/auth/*), and Supabase holds
 * the email and the password hash. This file kept its job but lost its
 * authority: it is the CACHE the front door reads synchronously at mount.
 *
 * It exists for the same reason lib/engine/save.ts cannot be async — screens
 * read it during render (`loadAccount() && loadProfile()?.onboarded`), and
 * there is no synchronous fetch. The server is the truth; this is what the
 * first paint can afford to know.
 *
 * **No password, ever, in here.** The email is stored because the front door
 * shows it; a password would be a credential sitting in localStorage where any
 * injected script could read it, which is precisely the thing the httpOnly
 * cookie exists to prevent.
 *
 * Shaped like lib/engine/save.ts on purpose: every load is validated rather
 * than trusted, and storage failures degrade to "no account" instead of a
 * crash on the front door.
 */

export interface Account {
  /**
   * When the privacy policy was agreed to, ISO. Creation is gated on the
   * checkbox in AccountGate, so this is always present on new accounts;
   * optional because accounts made before the policy existed have no stamp.
   */
  acceptedPrivacyISO?: string;
  displayName: string;
  createdAtISO: string;
  /**
   * The signed-in address, for display only. Absent on accounts made before
   * real sign-up existed, and on a deploy with no Supabase project — both of
   * which are still valid local accounts.
   */
  email?: string;
}

const KEY = "novus:account:v1";

/** Long enough for any real name, short enough that CONTINUE AS <NAME>
 *  stays a one-line button at 320px. */
export const MAX_NAME_LENGTH = 24;

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

export function loadAccount(): Account | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Account>;
    if (typeof parsed.displayName !== "string" || !parsed.displayName.trim()) {
      return null;
    }
    return {
      displayName: parsed.displayName.trim().slice(0, MAX_NAME_LENGTH),
      createdAtISO:
        typeof parsed.createdAtISO === "string"
          ? parsed.createdAtISO
          : new Date(0).toISOString(),
      ...(typeof parsed.email === "string" && parsed.email ? { email: parsed.email } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Trims, caps, and persists. Returns null for a blank name so the caller can
 * keep its button disabled instead of minting an account called "".
 */
export function createAccount(
  displayName: string,
  email?: string,
  /**
   * True only when the player has just ticked the privacy checkbox — i.e. from
   * sign-up. Sign-in passes false.
   *
   * This is a parameter rather than something inferred because the function is
   * called from both, and guessing gets it wrong in both directions. Stamping
   * on every call would re-date the consent record every time anyone signed in,
   * and a consent record that silently moves is not a record of anything.
   * Carrying over whatever was already on the device would be worse on the
   * machines this app is used on: the stamp sitting there belongs to the
   * previous student, and inheriting it would attribute their consent to the
   * person now signing in.
   *
   * So on sign-in the stamp is simply absent — which the field already allows
   * and already means "no stamp". We genuinely do not know when a player
   * signing in on a fresh device agreed to anything, and saying nothing beats
   * inventing a date.
   */
  consentedNow = false,
): Account | null {
  const name = displayName.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return null;

  const now = new Date().toISOString();
  const normalised = email?.trim().toLowerCase();

  // The same player signing in again on their own device keeps their original
  // timestamps — matched on email so it cannot pick up a different account's.
  const existing = loadAccount();
  const sameAccount = !!normalised && existing?.email === normalised;

  const acceptedPrivacyISO = consentedNow
    ? (sameAccount ? (existing?.acceptedPrivacyISO ?? now) : now)
    : sameAccount
      ? existing?.acceptedPrivacyISO
      : undefined;

  const account: Account = {
    displayName: name,
    createdAtISO: sameAccount ? (existing?.createdAtISO ?? now) : now,
    ...(acceptedPrivacyISO ? { acceptedPrivacyISO } : {}),
    ...(normalised ? { email: normalised } : {}),
  };
  if (canStore()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(account));
    } catch {
      // Storage full or blocked (private mode). The session still proceeds —
      // the account just will not survive a reload, which is the honest limit
      // of a device-local store.
    }
  }
  return account;
}

export function signOut(): void {
  if (!canStore()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — if storage is unreachable, there is nothing stored.
  }
}
