import { createAccount, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import { PROVIDER_LABEL, type OAuthProvider, type OAuthState } from "@/lib/auth/providers";
import { RESTORED_FLAG } from "@/lib/cloud/keys";
import { forgetPurchaseAccount } from "@/lib/commerce";
import { dropPendingRun } from "@/lib/engine/save";
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
  /** The player closed the provider's sheet. Not a failure; say nothing. */
  | "cancelled"
  | "error";

/** The refusal branch on its own, so `fail()` is assignable to every outcome
 *  shape in this file rather than only to AuthOutcome. */
interface Refusal {
  ok: false;
  reason: AuthFailReason;
  message: string;
}

const fail = (reason: AuthFailReason, message: string): Refusal => ({
  ok: false,
  reason,
  message,
});

interface AuthBody {
  configured?: boolean;
  signedIn?: boolean;
  needsConfirmation?: boolean;
  deleted?: boolean;
  email?: string | null;
  displayName?: string | null;
  error?: string;
  reason?: string;
  captcha?: string;
  /** Provider sign-in only: which of the two doors this turned out to be. */
  state?: string;
  /** Provider sign-in only: the name Google or Apple offered, if any. */
  suggestedName?: string | null;
}

/**
 * `timeoutMs` is opt-in rather than the rule.
 *
 * A request that never settles is indistinguishable from a dead button, and
 * the reset link is the one control with nothing else on screen to show it is
 * working — so that call gives up and says so. The rest are left alone: sign-up
 * behind a slow human check is a request worth waiting for, and a deadline
 * there would turn a succeeding signup into "could not reach the server".
 *
 * The guard around `AbortSignal.timeout` is not decoration. It is absent on
 * older WKWebView, and an unguarded call would throw INSIDE the try below,
 * where it would be caught and reported as an unreachable server — on every
 * auth call in the app, not just this one.
 */
async function post(
  path: string,
  payload: unknown,
  timeoutMs?: number,
): Promise<{ res: Response; body: AuthBody } | null> {
  const signal =
    timeoutMs && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  try {
    // apiUrl + credentials: the shipped app is a static bundle with no server
    // behind it, so these have to go to the real origin and carry the session
    // cookie explicitly across it (lib/native/origin.ts).
    const res = await fetch(apiUrl(path), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
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

  // Same re-arm sign-up does, and for the same reason: boot switched the sync
  // layer off because this device had no account, and every call since has
  // returned early behind that flag. A caller that pulls the account's saves
  // before reloading — the in-app sign-in does — would otherwise be answered
  // by a decision made one second before this account existed here.
  try {
    const { resume } = await import("@/lib/cloud/sync");
    resume();
  } catch {
    /* the reload re-initialises the module anyway */
  }

  return { ok: true, email: body.email ?? email, displayName: body.displayName };
}

// ── Google and Apple ────────────────────────────────────────────────────────

export type ProviderOutcome =
  | {
      ok: true;
      /** "new" on the sign-in that created the account, "known" after that. */
      state: OAuthState;
      email: string | null;
      displayName: string | null;
      /** The provider's own name for this person, to prefill the name field. */
      suggestedName: string | null;
    }
  | { ok: false; reason: AuthFailReason; message: string };

/**
 * Where the browser goes to leave for Google or Apple.
 *
 * A full navigation, not a fetch — the player is going to another site and
 * coming back, and a redirect chain is not something XHR can follow into a
 * consent screen. The route on the other end mints the PKCE verifier and parks
 * it in a cookie; see app/api/auth/oauth/start/route.ts for why none of that
 * can happen in the page.
 */
export const providerStartUrl = (provider: OAuthProvider): string =>
  apiUrl(`/api/auth/oauth/start?provider=${provider}`);

/**
 * What this device owes the player once a provider has signed them in.
 *
 * The whole of the sign-up/sign-in split lives here, and it is the same split
 * signUp() and signIn() above document at length — only the trigger differs.
 * With email the player chose a door; with a provider there is one button, so
 * the server reports which door it turned out to be (lib/auth/oauth-profile.ts)
 * and this acts on the answer:
 *
 * · **new** — the account was created a moment ago, so this device's companies
 *   are the player's own and they came here to keep them. Kept, and pushed up
 *   immediately, exactly as sign-up does and for the same reason: the debounced
 *   write never fires for somebody who signs up and closes the tab.
 * · **known** — a returning player, so everything in localStorage belongs to
 *   whoever used this browser before them. Emptied, and the account's own copy
 *   is pulled on the reload the caller does next.
 *
 * Getting this backwards is not a cosmetic bug in either direction: one way a
 * stranger's save is pushed over a returning player's cloud copy, the other a
 * player watches the company they just made disappear.
 */
async function adoptProviderSession(
  state: OAuthState,
  email: string | null,
  displayName: string | null,
): Promise<void> {
  // Emptied BEFORE the account cache is written, so a failure between the two
  // leaves nothing pointing at someone else's saves. Same order as signIn().
  if (state === "known") wipeDevice();

  createAccount(displayName ?? "Founder", email ?? undefined);
  forgetIdentity();

  try {
    const { resume, pushLocalNow } = await import("@/lib/cloud/sync");
    // Boot switched sync off because this device had no account. It has one
    // now, so re-arm before anything tries to use it.
    resume();
    if (state === "new") await pushLocalNow();
  } catch {
    /* the device still has it; the next commit carries it up */
  }
}

/**
 * Finish a provider sign-in that came back through the browser.
 *
 * Called by /auth/callback, which is the first page of ours the player sees
 * after the round trip. The session cookie is already set by then — the
 * callback route did the exchange — so this reads who that turned out to be and
 * settles the device.
 *
 * `state` comes off the URL, and it is worth being clear about what happens if
 * somebody edits it. Forcing "known" wipes the localStorage of the browser
 * you are sitting at, which is a thing you can already do by signing out.
 * Forcing "new" pushes this device's save into the account you just signed in
 * to — your own account. Neither reaches anybody else's data, which is why the
 * value is allowed to travel in the open.
 */
export async function completeProviderSignIn(state: OAuthState): Promise<ProviderOutcome> {
  forgetIdentity();
  const who = await identity();

  if (!who.configured) {
    return fail("not-configured", "Accounts are not switched on for this build.");
  }
  if (!who.signedIn) {
    return fail("invalid", "That sign-in did not complete. Try again.");
  }

  await adoptProviderSession(state, who.email, who.displayName);

  return {
    ok: true,
    state,
    email: who.email,
    displayName: who.displayName,
    // The prefill for a brand-new account is whatever the callback route
    // already wrote to the profile — "Founder" when the provider offered
    // nothing, which the name screen shows as an empty field.
    suggestedName: who.displayName,
  };
}

/**
 * The whole flow, in the shipped app, without leaving it.
 *
 * The system sheet returns a signed token in the app's own process; that goes
 * to our own route, which verifies it through Supabase and sets the cookie on
 * this connection. See lib/cloud/native-oauth.ts for why the redirect flow
 * cannot be used here — the short version is that `Browser.open` has Safari's
 * cookie jar and not the webview's.
 */
export async function nativeProviderSignIn(provider: OAuthProvider): Promise<ProviderOutcome> {
  const label = PROVIDER_LABEL[provider];

  let token: { idToken: string; name: string | null } | null;
  try {
    const { nativeIdToken } = await import("@/lib/cloud/native-oauth");
    token = await nativeIdToken(provider);
  } catch {
    return fail("error", `Could not open the ${label} sign-in. Try again.`);
  }

  // Dismissed the sheet. Not an error, and must not be shown as one.
  if (!token) return fail("cancelled", "");

  const out = await post("/api/auth/oauth/native", {
    provider,
    idToken: token.idToken,
    ...(token.name ? { name: token.name } : {}),
  });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");

  const { res, body } = out;
  if (body.configured === false) {
    return fail("not-configured", "Accounts are not switched on for this build.");
  }
  if (!res.ok || !body.signedIn) {
    return fail("invalid", body.error ?? `That ${label} sign-in could not be completed.`);
  }

  const state: OAuthState = body.state === "new" ? "new" : "known";
  await adoptProviderSession(state, body.email ?? null, body.displayName ?? null);

  return {
    ok: true,
    state,
    email: body.email ?? null,
    displayName: body.displayName ?? null,
    suggestedName: body.suggestedName ?? null,
  };
}

/**
 * Name an account the player has just been handed.
 *
 * Only ever called on the `new` path, where the row exists but is called
 * whatever the provider said — or "Founder", which is nobody's name. The
 * server-side half also records the privacy consent this screen collected;
 * see app/api/auth/name/route.ts for why that checkbox cannot sit where the
 * email form's does.
 *
 * The local account cache is rewritten with the chosen name, which is what the
 * front door reads at first paint — otherwise CONTINUE AS FOUNDER greets
 * somebody who has just told us they are called something else.
 */
export async function setDisplayName(
  displayName: string,
  acceptedPrivacy: boolean,
): Promise<AuthOutcome> {
  const out = await post("/api/auth/name", { displayName, acceptedPrivacy });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");

  const { res, body } = out;
  if (body.configured === false) {
    return fail("not-configured", "Accounts are not switched on for this build.");
  }
  if (!res.ok) return fail("error", body.error ?? "Could not save that name. Try again.");

  const named = body.displayName ?? displayName;
  createAccount(named, body.email ?? undefined, acceptedPrivacy);
  forgetIdentity();

  return { ok: true, email: body.email ?? null, displayName: named };
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
  // Islands. `novus:run:v1:0` … and the pre-islands `novus:run:v1` beside
  // them, which a device that has not booted since 0013 still carries. These
  // are PREFIXES, matched below — an exact list cannot enumerate ten slots
  // without going stale the first time ISLAND_CAP moves, and a key that
  // escapes this wipe is the previous student's company left on a shared iPad.
  "novus:run:v1",
  // The cards left face-up on that run. loadTable() would refuse them for a
  // different company anyway, but "the last student's decision is still on the
  // table" is the same problem this list exists to prevent.
  "novus:table:v1",
  // Which island was open, and the picker's cache of what is on the others.
  "novus:island:v1",
  "novus:islands:v1",
  // The leaderboard tape, per island. Never on this list before islands, which
  // means a shared device has always kept the previous player's tape — a
  // record of every tap they took, left for the next person to sign in.
  "novus:tape:v1",
  "novus:legacy:v1",
  "novus:profile:v1",
  "novus:entitlements:v1",
  "novus:runledger:v1",
  "novus:yearcloses:v1",
  "novus:wardrobe:v1",
  "novus:theme:v1",
  "novus:sound:v1",
];

/** Does this key belong to one of the entries above, exactly or per island? */
const isDeviceKey = (key: string): boolean =>
  DEVICE_KEYS.some((k) => key === k || key.startsWith(`${k}:`));

/**
 * Empties this device of the previous player, leaving the account cache alone.
 *
 * Used by both sign-out and sign-in: in each case the person about to use this
 * browser is not the person whose data is in it.
 */
function wipeDevice(): void {
  if (typeof window === "undefined") return;
  /*
   * Drop any write save.ts is holding, BEFORE removing the keys.
   *
   * `saveRun` coalesces its localStorage write over a short window (see its
   * note). A held write is normally flushed on every path that could lose it —
   * but this path must not flush it, it must throw it away: a save from the
   * outgoing player landing after the loop below would restore that player's
   * company onto a device that has just been handed to someone else. Exactly
   * the resurrection `clearRun` guards against, with a worse blast radius,
   * because this function also runs on sign-IN.
   *
   * A STATIC import, and it has to be: a dynamic one resolves a microtask
   * later, which is after the synchronous loop below has already run — the
   * drop would land on the far side of the very wipe it exists to protect.
   * There is no cycle to avoid here; the chain is auth → save → sync → billing
   * and nothing on it reaches back to this file.
   */
  dropPendingRun();
  /*
   * The cached "the app is signed in as…" claim belongs to the outgoing player.
   * Left in place it would name the wrong account on the very next purchase
   * link — quietly, and for ten minutes, which is long enough to be pressed.
   */
  forgetPurchaseAccount();
  /*
   * Collected first, then removed. Iterating localStorage while deleting from
   * it re-indexes the collection underneath the loop and silently skips keys —
   * and a skipped key here is a company handed to the next person to use this
   * browser.
   */
  const doomed: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && isDeviceKey(key)) doomed.push(key);
    }
  } catch {
    /* fall through — the exact-name pass below still runs */
  }
  for (const key of [...new Set([...doomed, ...DEVICE_KEYS])]) {
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
 * The account behind this device stopped existing while it was in use.
 *
 * The server-side half already happened — an admin deleted the account, or the
 * session was revoked — so unlike signOut() there is no flush-first bargain to
 * strike: there is no account left to receive a flush, and everything in
 * localStorage belongs to a player the server no longer knows. Forget who was
 * here and empty the device, exactly as sign-out would have.
 */
export function sessionLost(): void {
  forgetLocalAccount();
  forgetIdentity();
  wipeDevice();
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
  // Only `deleted: true` is a real deletion. The route answers 200 for other
  // states — no session, an unconfigured deploy — and treating any 2xx as
  // success would wipe the device and tell the player their account is gone
  // while it (and any subscription behind it) still exists. That is the one
  // thing "delete my account" must never get wrong.
  if (!res.ok || body.deleted !== true) {
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

export interface ResetRequest {
  /** False means no email is coming, and `message` says why. */
  ok: boolean;
  message: string;
}

/**
 * Ask for a password reset email.
 *
 * The answer never says whether the address has an account — see
 * app/api/auth/reset/route.ts for why that matters more here than usual.
 *
 * ── Why this reports failure separately ────────────────────────────────────
 *
 * It used to return one string and let the caller render it as good news.
 * Every outcome that is NOT "the mail is on its way" therefore arrived wearing
 * the same clothes as the one that is: an unreachable server, a deploy with no
 * Supabase behind it at all, a 500. The one case worth telling a locked-out
 * player apart from the others — nothing is coming, stop waiting for it — was
 * the one case they could not see. `ok` is that distinction, and it is what
 * lets the two callers put a refusal in the alert colour.
 *
 * The `configured === false` check closes the last inconsistency in this file:
 * signIn (not-configured) and signUp (falls back to a local account) both read
 * that flag, and this was the only wrapper that ignored it — so a deploy that
 * has never sent an email in its life still promised one.
 *
 * The success sentence stays identical whether or not the address has an
 * account. That is the whole design of the route and nothing here weakens it.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequest> {
  // Ten seconds, because this is the one auth call with nothing else on screen
  // to prove it is still running. Silence past that is a failure worth saying.
  const out = await post("/api/auth/reset", { email }, 10_000);
  if (!out) {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }

  const { res, body } = out;

  if (body.configured === false) {
    return { ok: false, message: "Accounts are not switched on for this build." };
  }

  // The route's own words when it has any — a malformed address is the one
  // thing it is willing to say out loud, because that is the player's typo
  // rather than a fact about who has an account here.
  if (body.error) return { ok: false, message: body.error };

  if (!res.ok) {
    return { ok: false, message: "Could not send the reset email just now. Try again in a minute." };
  }

  return {
    ok: true,
    message:
      "If that email has an account, a reset link is on its way. It can take a few minutes — check your spam folder before asking for another.",
  };
}

/**
 * Finish a reset — or set up an invited seat — using the tokens the page read
 * out of its own URL. Two pages call this: /reset, where someone is repairing
 * an account they already own, and /join/setup, where a chapter invitee is
 * choosing the first password the account has ever had. Same endpoint, because
 * it is the same operation; `displayName` is the one thing only the second one
 * sends, and only when nothing has asked for a name yet.
 *
 * ── Why this WIPES the device, exactly like signIn ─────────────────────────
 *
 * Finishing a reset leaves the player signed in — it is a sign-in by another
 * door. On the shared classroom machines this app is built for, the
 * localStorage sitting here belongs to whoever played last, and leaving it in
 * place breaks the same way signIn documents: the previous occupant's run is
 * adopted, the front door routes into their company, and the first debounced
 * write pushes their save up into the resetting player's account — overwriting
 * the cloud save the reset was performed to get back to. So the device is
 * emptied and the account's own copy is pulled on the full reload the /reset
 * page does next (restoreOnBoot adopts the cloud save onto an empty device).
 */
export async function confirmPasswordReset(
  accessToken: string,
  refreshToken: string,
  password: string,
  displayName?: string,
): Promise<AuthOutcome> {
  const out = await post("/api/auth/reset/confirm", {
    accessToken,
    refreshToken,
    password,
    ...(displayName ? { displayName } : {}),
  });
  if (!out) return fail("offline", "Could not reach the server. Check your connection.");
  const { res, body } = out;
  if (!res.ok) return fail("error", body.error ?? "Could not set that password.");

  // Empty the device before the caller writes the new account cache, so a
  // stranger's saves cannot be routed into the account that just signed in.
  wipeDevice();
  forgetIdentity();

  // Re-arm the sync layer, the same way signIn does: boot may have switched it
  // off because this device had no account, and the full reload the page does
  // next needs it live to pull the account's own saves.
  try {
    const { resume } = await import("@/lib/cloud/sync");
    resume();
  } catch {
    /* the reload re-initialises the module anyway */
  }

  return { ok: true, email: body.email ?? null, displayName: body.displayName ?? null };
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
