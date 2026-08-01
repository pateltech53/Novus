import { createAccount, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import { RESTORED_FLAG } from "@/lib/cloud/keys";

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
}

async function post(path: string, payload: unknown): Promise<{ res: Response; body: AuthBody } | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
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
): Promise<AuthOutcome> {
  const out = await post("/api/auth/signup", { email, password, displayName });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");

  const { res, body } = out;

  // No Supabase project on this deploy. Not an error — the app is built to run
  // this way, so fall back to the device-local account and carry on.
  if (body.configured === false) {
    createAccount(displayName, email);
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
  if (!res.ok || !body.signedIn) {
    return fail("error", body.error ?? "Could not create the account. Try again.");
  }

  createAccount(displayName, body.email ?? email);
  forgetIdentity();
  return { ok: true, email: body.email ?? email };
}

/** Sign an existing account back in. */
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
 * The server half is attempted first but never gates the local half, for the
 * same reason the route clears the cookie unconditionally: a machine must not
 * stay signed in because Supabase was briefly unreachable.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/signout", { method: "POST" });
  } catch {
    /* the local half still happens */
  }

  forgetLocalAccount();
  forgetIdentity();

  if (typeof window === "undefined") return;
  for (const key of DEVICE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // One blocked key must not stop the rest from being cleared.
    }
  }
  try {
    // Otherwise the next player's boot sees the flag, skips the cloud restore,
    // and starts on an empty device that never asks the server for their save.
    window.sessionStorage.removeItem(RESTORED_FLAG);
  } catch {
    /* private mode; the restore will simply run as normal */
  }
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
    identityCache = fetch("/api/auth/me")
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
