/**
 * Account changes must erase pending invitation credentials synchronously.
 * Keep that small boundary separate from the invitation page's storage and
 * validation helpers so ordinary pages do not download the whole handover.
 * Both modules share the timer: clearing on sign-out also cancels expiry.
 */
export const INVITE_SETUP_KEY = "novus:invite:setup:v1";
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export function expireInviteSetupAt(deadline: number): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  if (typeof window !== "undefined") {
    expiryTimer = setTimeout(forgetInviteSetup, Math.max(0, deadline - Date.now()));
  }
}

export function forgetInviteSetup(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  try {
    sessionStorage.removeItem(INVITE_SETUP_KEY);
  } catch {
    /* No storage, nothing durable to remove. */
  }
}
