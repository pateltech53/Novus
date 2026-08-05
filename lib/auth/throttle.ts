import "server-only";

import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting for the auth routes.
 *
 * Supabase limits auth by IP, and Novus deliberately gives it only one to look
 * at: the browser never talks to Supabase, so every player in the world
 * reaches it from our server. That protection is therefore worth nothing here,
 * and without a replacement a script can mint accounts as fast as it can post.
 * This is the replacement. See supabase/migrations/0005_auth_throttle.sql for
 * why the counter lives in Postgres rather than in memory.
 *
 * ── No IP is stored ────────────────────────────────────────────────────────
 *
 * 0001's header forbids putting an IP address in this schema (§9.6), and rate
 * limiting is exactly the feature that wants to. So what goes to the database
 * is an HMAC of the address under a server-only secret, truncated — opaque,
 * unreversible without the secret, lossy even with it, and deleted when its
 * window closes.
 */

/** How many, per window, per bucket. Windows are 15 minutes unless stated. */
export const LIMITS = {
  /**
   * The one that answers "protect against bulk registration". Five accounts
   * per address per fifteen minutes is far above what a real person does — a
   * family sharing a router, a teacher setting up alongside a class — and far
   * below what makes bulk creation worth automating.
   */
  signupPerIp: 5,
  /** A whole classroom behind one NAT is the case this must not break. */
  signinPerIp: 30,
  /** Per account, so one victim's password cannot be ground down from many
   *  addresses at once — the limit credential stuffing actually meets. */
  signinPerEmail: 10,
  /** Reset emails are mail we send on a stranger's say-so. Kept tight. */
  resetPerIp: 5,
  resetPerEmail: 3,
  /**
   * Leaving for Google or Apple. Sized like sign-IN rather than sign-UP, and
   * the difference is deliberate.
   *
   * `signupPerIp` is five, on the reasoning that bulk account creation is worth
   * automating when all it costs is a typed address. It is not worth automating
   * here: every account this door opens needs a real Google or Apple account
   * behind it, which is a far higher bar than anything our own form asks for.
   * Meanwhile the ways to spend an attempt without getting an account are
   * ordinary — press the button, see the account chooser, change your mind —
   * and at five a classroom behind one NAT would lock itself out before the
   * back row had tried once.
   *
   * Thirty bounds the abuse that remains (a script hammering the route to make
   * us mint authorisation URLs) without standing in front of a real player.
   */
  oauthPerIp: 30,
} as const;

/**
 * The caller's address, as an opaque key.
 *
 * `x-forwarded-for` is a client-settable header, and trusting it blindly would
 * let an attacker rotate it per request and defeat the whole thing. Behind a
 * proxy that rewrites it — Vercel, Cloudflare, most hosts — the LAST entry is
 * the one the proxy observed and the earlier ones are whatever the client
 * claimed, so the last is what gets hashed.
 *
 * Returns null when there is no usable address at all. Callers treat that as
 * "cannot throttle by address" rather than inventing a shared bucket, because
 * one bucket for every unidentifiable caller is a bucket an attacker fills to
 * lock everyone else out.
 */
export function callerKey(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const chain = forwarded?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const address = chain.length > 0 ? chain[chain.length - 1] : req.headers.get("x-real-ip");

  if (!address) return null;
  return hash(address);
}

/**
 * HMAC, truncated to 128 bits.
 *
 * Keyed with the service role key because it is already a server-only secret
 * this deploy must have, and adding a second required variable to a setup that
 * already juggles several is friction with no security gain — an attacker who
 * has one has the database anyway. The truncation is deliberate: it keeps the
 * key small and makes the mapping lossy on top of being secret.
 */
function hash(value: string): string {
  return createHmac("sha256", SUPABASE_SERVICE_ROLE_KEY)
    .update(`novus:auth:${value}`)
    .digest("hex")
    .slice(0, 32);
}

/** Emails are their own bucket key — normalised, then hashed like an address
 *  so the table cannot become a list of who has an account here. */
export const emailKey = (email: string): string => hash(email.trim().toLowerCase());

export interface Throttled {
  allowed: boolean;
  /** The bucket that ran out, for the message. Null when allowed. */
  hit: string | null;
}

const ALLOWED: Throttled = { allowed: true, hit: null };

/**
 * Spends one attempt against each bucket and reports whether to proceed.
 *
 * Every bucket is charged even after one fails, so a caller cannot probe which
 * limit they are near by watching what stops counting.
 *
 * ── Fails OPEN when unconfigured ───────────────────────────────────────────
 *
 * With no service role key there is no admin client and no HMAC secret, so
 * nothing can be counted. That is the local-development case and a deploy that
 * has not finished setup; blocking sign-up there would mean the app could not
 * be tried at all. docs/ACCOUNTS-SETUP.md says plainly that such a deploy has
 * no rate limiting, because a protection you have to be told about is worth
 * more than one you assume.
 */
export async function throttle(
  buckets: { bucket: string; key: string | null; limit: number; windowMinutes?: number }[],
): Promise<Throttled> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return ALLOWED;

  const live = buckets.filter((b) => b.key !== null);
  if (live.length === 0) return ALLOWED;

  const db = adminClient();

  const verdicts = await Promise.all(
    live.map(async (b) => {
      const { data, error } = await db.rpc("claim_auth_attempt", {
        p_bucket: b.bucket,
        p_key: b.key,
        p_limit: b.limit,
        p_window: `${b.windowMinutes ?? 15} minutes`,
      });
      // A throttle that errors must not become a lock on the front door. The
      // failure is logged by Supabase; the player gets in.
      if (error) return { bucket: b.bucket, ok: true };
      return { bucket: b.bucket, ok: data !== false };
    }),
  );

  const blocked = verdicts.find((v) => !v.ok);
  return blocked ? { allowed: false, hit: blocked.bucket } : ALLOWED;
}

/**
 * One sentence, no apology, says what to do — design.md §8.
 *
 * Deliberately does not say which bucket ran out. "Too many accounts from your
 * network" tells a script exactly which dimension to vary next.
 */
export const THROTTLED_MESSAGE =
  "Too many attempts just now. Wait a few minutes and try again.";
