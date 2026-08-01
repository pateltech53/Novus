import { createAccount, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import { RESTORED_FLAG } from "@/lib/cloud/keys";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";

/**
 * The browser's half of accounts.
 *
 * Mirrors lib/cloud/billing.ts: the browser talks to our own routes, never to
 * Supabase. No Supabase client is loaded in the page, so no auth endpoint is
 * contacted from a screen a minor is looking at, and the session token stays
 * in an httpOnly cookie where no script can read it.
 *
 * ── Local account vs real account ──────────────────────────────────────────
 *
 * lib/account.ts stays. It is the device-local mirror the front door reads
 * synchronously at mount — the same reason lib/engine/save.ts cannot be async.
 * It now carries the email alongside the display name so `CONTINUE AS <NAME>`
 * can render before any request finishes. The server is the authority; this is
 * the cache, and the cache is written only after the server agrees.
 */

export type AuthOutcome =
  | { ok: true; email: string | null; displayName?: string | null }
  | { ok: false; reason: AuthFailReason; message: string };

export type AuthFailReason =
  | "not-configured"
  | "taken"
  | "invalid"
  | "needs-confirmation"
  | "captcha"
  | "offline"
  | "error";

const fail = (reason: AuthFailReason, message: string): AuthOutcome => ({
  ok: false,
  reason,
  message,
});

interface AuthBody {
  configured?: boolean;
  signedIn?: boolean;
  needsConfirmation?: boolean;
  email?: string | null;
  displayName?: string | null;
  error?: string;
  reason?: string;
  captcha?: string;
}

async function post(path: string, payload: unknown): Promise<{ res: Response; body: AuthBody } | null> {
  try {
    // apiUrl + credentials: the shipped app is a static bundle with no server
    // behind it, so these have to go to the real origin and carry the session
    // cookie explicitly across it (lib/native/origin.ts).
    const res = await fetch(apiUrl(path), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, body: (await res.json()) as AuthBody };
  } catch {
    return null;
  }
}

/**
 * Create a real account.
 *
 * On success the display name is written to the device-local account too, so
 * the front door can greet the player without waiting on a request next time.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
  captchaToken?: string | null,
): Promise<AuthOutcome> {
  const out = await post("/api/auth/signup", {
    email,
    password,
    displayName,
    ...(captchaToken ? { captchaToken } : {}),
  });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");

  const { res, body } = out;

  // No Supabase project on this deploy. Not an error — the app is built to run
  // this way, so fall back to the device-local account and carry on.
  if (body.configured === false) {
    createAccount(displayName, email, true);
    forgetIdentity();
    return { ok: true, email };
  }

  if (body.needsConfirmation) {
    return fail(
      "needs-confirmation",
      "Account created. Check your email for a confirmation link, then sign in.",
    );
  }

  if (res.status === 409) return fail("taken", body.error ?? "That email already has an account.");
  // The token was missing, stale or refused. The form resets the widget so the
  // player gets a fresh one rather than retrying a token Cloudflare has spent.
  if (body.captcha) return fail("captcha", body.error ?? "Complete the human check and try again.");
  if (!res.ok || !body.signedIn) {
    return fail("error", body.error ?? "Could not create the account. Try again.");
  }

  createAccount(displayName, body.email ?? email, true);
  forgetIdentity();

  // Carry this device's progress INTO the new account.
  //
  // Sign-up mints a new auth user rather than converting the anonymous one, so
  // everything played before this moment is attached to an identity nobody can
  // sign back into. The local copy is the only reachable one, and this is the
  // moment to push it — the debounced path would only fire on the next
  // commit(), which never comes for someone who signs up and closes the tab.
  //
  // Failure here is survivable: the save is still on the device and the next
  // game action pushes it. So it does not fail the sign-up.
  try {
    const { resume, pushLocalNow } = await import("@/lib/cloud/sync");
    // Boot switched sync off because this device had no account. It has one
    // now — one created a moment ago — so turn it back on before pushing.
    resume();
    await pushLocalNow();
  } catch {
    /* the device still has it; the next commit will carry it up */
  }

  return { ok: true, email: body.email ?? email };
}

/**
 * Sign an existing account back in.
 *
 * ── Why this WIPES the device first ────────────────────────────────────────
 *
 * Signing in is a claim to a different identity, and the data sitting in
 * localStorage belongs to whoever was here before — which on the machines this
 * app is actually used on is very often another student.
 *
 * Leaving it in place breaks in both directions at once. The previous
 * occupant's companies appear under the new player's name, `destination()`
 * reads their `onboarded` flag and routes past onboarding into their founder
 * profile, and the first debounced write pushes their run up into the signing-
 * in player's account — overwriting the cloud save that player came back FOR.
 * The Pro entitlement cached in localStorage leaks across accounts the same
 * way.
 *
 * So the device is emptied and the account's own copy is pulled on the reload
 * that follows (restoreOnBoot finds an empty device and adopts the cloud save,
 * which is exactly the case it was written for). The caller must reload — see
 * AccountGate.
 */
export async function signIn(email: string, password: string): Promise<AuthOutcome> {
  const out = await post("/api/auth/signin", { email, password });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");

  const { res, body } = out;
  if (body.configured === false) {
    return fail("not-configured", "Accounts are not switched on for this build.");
  }
  if (!res.ok || !body.signedIn) {
    return fail("invalid", body.error ?? "That email and password do not match an account.");
  }

  // Empty the device BEFORE writing the new account, so a failure between the
  // two leaves no account cache pointing at someone else's saves.
  wipeDevice();

  // The server's display name wins — it is the one that followed the account,
  // and this device may never have seen it before.
  createAccount(body.displayName ?? "Founder", body.email ?? email);
  forgetIdentity();
  return { ok: true, email: body.email ?? email, displayName: body.displayName };
}

/**
 * Every localStorage key the game owns, in one list.
 *
 * Gathered here rather than exported from each module because the modules are
 * the wrong owners of "wipe everything" — save.ts has clearRun() for burying a
 * company, which is a game action, not a sign-out.
 *
 * Wardrobe, theme and sound are included: they are device taste, but on a
 * shared machine "the last student's skin is still equipped" is the same
 * problem in a smaller coat.
 */
const DEVICE_KEYS = [
  "novus:run:v1",
  "novus:legacy:v1",
  "novus:profile:v1",
  "novus:entitlements:v1",
  "novus:runledger:v1",
  "novus:wardrobe:v1",
  "novus:theme:v1",
  "novus:sound:v1",
];

/**
 * Empties this device of the previous player, leaving the account cache alone.
 *
 * Used by both sign-out and sign-in: in each case the person about to use this
 * browser is not the person whose data is in it.
 */
function wipeDevice(): void {
  if (typeof window === "undefined") return;
  for (const key of DEVICE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // One blocked key must not stop the rest from being cleared.
    }
  }
  try {
    // Otherwise the next boot sees the flag, skips the cloud restore, and sits
    // on an empty device that never asks the server for the account's save.
    window.sessionStorage.removeItem(RESTORED_FLAG);
  } catch {
    /* private mode; the restore will simply run as normal */
  }
}

/**
 * Sign out here, and leave nothing behind.
 *
 * ── Why this wipes the device now, when it never used to ───────────────────
 *
 * Signing out used to forget the display name and leave the companies, legacy
 * and entitlements sitting in localStorage. It had to: that WAS the save.
 * Clearing it would have destroyed the only copy of a player's work.
 *
 * With real accounts the only copy is on the server, so the calculation
 * inverts — and the deployment this app is built for makes it urgent. Novus is
 * sold to schools and handed round a classroom. A student who signs out on a
 * shared iPad and leaves their companies, their run history and their Pro
 * entitlement for the next child is the failure mode that matters here, and
 * it is not fixed by clearing a display name.
 *
 * ── The two things that must be true before wiping ─────────────────────────
 *
 * The whole justification is "the server has a copy", so it only wipes when
 * that is actually true:
 *
 *   1. **The pending write must land first.** flush() is debounced by 1.5s, so
 *      the last decision a player made is very often still sitting in memory
 *      when they hit sign out. Wiping first would delete the only copy of it.
 *   2. **There must be a server at all.** On a deploy with no Supabase
 *      configured, or one where sync never came up, localStorage is not a
 *      cache — it is the save. Wiping there is data loss with no upside, so it
 *      does not happen, and the session cookie is cleared alone.
 */
export async function signOut(): Promise<void> {
  /*
   * Land the last decision before anything is destroyed, and believe only what
   * the server confirmed.
   *
   * This used to read `syncState()` after the flush and treat anything that
   * was not "off" or "error" as a yes. Three states passed that test without
   * anything having been saved: "idle" on a tab that never synced, and
   * "synced" after a request the server answered 200 to while telling us in
   * the body that it had written nothing, or that nobody was signed in. Each
   * one ended here, in wipeDevice(), deleting the only remaining copy of a
   * player's companies.
   *
   * flush() now returns the verdict rather than leaving it to be inferred from
   * a status enum that was never designed to carry it.
   */
  let syncedOk = false;
  try {
    const { flush } = await import("@/lib/cloud/sync");
    syncedOk = await flush();
  } catch {
    syncedOk = false;
  }

  try {
    await fetch(apiUrl("/api/auth/signout"), {
      method: "POST",
      credentials: API_CREDENTIALS,
    });
  } catch {
    /* the cookie is still cleared below by the local half */
  }

  forgetLocalAccount();
  forgetIdentity();

  if (syncedOk) wipeDevice();
}

/**
 * Delete this account and everything attached to it.
 *
 * The privacy policy promises "the deletion is real, not a flag", so this is
 * wired to a button rather than left as a route only support could reach —
 * a promise whose only implementation is an email address is a slower promise.
 *
 * The device is wiped on success whatever the server said about the rest,
 * because after this there is no account to sync back from: leaving the
 * companies in localStorage would mean "delete everything" left everything
 * visible on the machine the player was sitting at.
 */
export async function deleteAccount(): Promise<{ ok: boolean; message?: string }> {
  const out = await post("/api/auth/delete", {});
  if (!out) return { ok: false, message: "Could not reach the server. Check your connection." };

  const { res, body } = out;
  if (!res.ok) {
    return {
      ok: false,
      message: body.error ?? "Could not delete the account. Try again.",
    };
  }

  forgetLocalAccount();
  forgetIdentity();
  wipeDevice();
  return { ok: true };
}

/** Ask for a password reset email. The answer never says whether the address
 *  has an account — see app/api/auth/reset/route.ts. */
export async function requestPasswordReset(email: string): Promise<string> {
  const out = await post("/api/auth/reset", { email });
  if (!out) return "Could not reach the server. Check your connection.";
  return (
    out.body.error ??
    "If that email has an account, a reset link is on its way."
  );
}

/** Finish a reset, using the tokens the /reset page read out of its own URL. */
export async function confirmPasswordReset(
  accessToken: string,
  refreshToken: string,
  password: string,
): Promise<AuthOutcome> {
  const out = await post("/api/auth/reset/confirm", { accessToken, refreshToken, password });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");
  const { res, body } = out;
  if (!res.ok) return fail("error", body.error ?? "Could not set that password.");
  forgetIdentity();
  return { ok: true, email: body.email ?? null };
}

// ── Who is signed in ────────────────────────────────────────────────────────

export interface Identity {
  configured: boolean;
  signedIn: boolean;
  /** Signed in, but with nothing to sign back INTO. Checkout refuses these. */
  anonymous: boolean;
  email: string | null;
  displayName: string | null;
}

const NOBODY: Identity = {
  configured: false,
  signedIn: false,
  anonymous: false,
  email: null,
  displayName: null,
};

/**
 * Cached for the tab. Several surfaces ask (the front door, the plans sheet,
 * settings) and the answer cannot change without one of the calls above, each
 * of which clears it.
 */
let identityCache: Promise<Identity> | null = null;

export function identity(): Promise<Identity> {
  if (!identityCache) {
    identityCache = fetch(apiUrl("/api/auth/me"), { credentials: API_CREDENTIALS })
      .then((res) => (res.ok ? (res.json() as Promise<Identity>) : null))
      .then((body) => ({ ...NOBODY, ...(body ?? {}) }))
      .catch(() => NOBODY);
  }
  return identityCache;
}

export function forgetIdentity(): void {
  identityCache = null;
}

/** The device-local answer, readable synchronously during render. */
export const localAccount = loadAccount;
