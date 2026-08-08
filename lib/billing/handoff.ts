import { createHmac, timingSafeEqual } from "node:crypto";

import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";

/**
 * WHICH ACCOUNT IS BUYING — the app's answer, carried into the browser.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 *
 * A store build cannot sell (lib/commerce.ts), so GET PRO opens the pricing
 * page in the player's own browser. `Browser.open` is a real Safari view with
 * Safari's cookie jar, which is exactly what keeps that link legal and exactly
 * what makes it a different session: the app's account and the browser's are
 * two unrelated facts that happen to be on one phone.
 *
 * Nothing checked that they agreed. A player signed into the app as one
 * account and into the web as an old one — a sibling's, a school one, the
 * address they used before they changed it — paid, and Pro landed on the
 * account that was never going to open the app. From inside the app that is
 * indistinguishable from a purchase that silently did not work, and Restore
 * cannot fix it, because Restore correctly reports what THIS account owns.
 *
 * So the app states who it is on the way out, and that statement is checked
 * before any money moves.
 *
 * ── Why this is an assertion and never a credential ─────────────────────────
 *
 * The token says "the app on this device is signed in as <user>". It is signed
 * so the claim cannot be forged, and it is deliberately worth NOTHING on its
 * own: holding one does not sign anybody in, does not authorise a purchase and
 * cannot be replayed into a session. The only thing it can do is make a
 * checkout REFUSE — the safe direction for a token to fail in. Handing the
 * browser a real session instead would mean minting a credential that travels
 * through a URL, an address bar and a browser history, which is a much larger
 * thing to get wrong for a much smaller gain.
 *
 * Thirty minutes, matching lib/cloud/pending-pro.ts: long enough to open a
 * browser, find the account you meant, sign in and pay; short enough that a
 * link left in a history is stale before anyone reads it.
 */

const TTL_MS = 30 * 60 * 1000;

/**
 * The same secret lib/auth/throttle.ts hashes its buckets with.
 *
 * A dedicated variable would be one more thing to set correctly in four
 * environments and one more thing to be silently unset in production, where
 * unset means "every signature verifies against the empty key". Billing
 * already refuses to run without this one — see `billingConfigured()` — so
 * reusing it means the secret is exactly as present as the feature is.
 */
const secret = (): string => SUPABASE_SERVICE_ROLE_KEY;

const b64url = (raw: string): string =>
  Buffer.from(raw, "utf8").toString("base64url");

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/** Constant-time, and false rather than a throw on a length mismatch. */
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** A signed "the app is this account", good for half an hour. */
export function mintHandoff(userId: string): string | null {
  if (!secret() || !userId) return null;
  const payload = b64url(JSON.stringify({ u: userId, x: Date.now() + TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

/**
 * The account a handoff names, or null.
 *
 * Null for every kind of wrong — not ours, tampered with, expired, malformed.
 * Callers treat all of them the same way and must treat them as "no claim was
 * made" rather than as "the claim failed": an expired token is a player who
 * took forty minutes to sign in, and refusing their purchase over it would be
 * this feature causing the failure it exists to prevent.
 */
export function readHandoff(token: unknown): string | null {
  if (typeof token !== "string" || !secret()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!sameSignature(sign(payload), signature)) return null;

  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      x?: unknown;
    };
    if (typeof claim.u !== "string" || !claim.u) return null;
    if (typeof claim.x !== "number" || Date.now() > claim.x) return null;
    return claim.u;
  } catch {
    return null;
  }
}

/**
 * An email you can recognise but not read: `fou•••@gmail.com`.
 *
 * The signed-out browser has to be told WHICH account to sign in as, and the
 * only useful handle for that is the address. Printing it in full would make
 * this endpoint an email oracle for anyone holding a link out of somebody's
 * browser history — and the accounts here belong to children, which is the
 * reason lib/supabase/route.ts already refuses to say whether an address has an
 * account at all. Three characters and the domain is enough to recognise your
 * own address and not enough to learn one you did not have.
 *
 * The full address is never needed on the other branch: a browser signed in as
 * the matching account already knows what it is called.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, Math.min(3, local.length))}•••${domain}`;
}
