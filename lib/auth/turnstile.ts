import "server-only";

/**
 * Cloudflare Turnstile — the human check on sign-up.
 *
 * ── Why this and not Supabase's own Attack Protection ──────────────────────
 *
 * Supabase can verify a captcha for you, but enabling it turns the requirement
 * on for EVERY auth endpoint at once: sign-in and password reset would each
 * need a widget too, or they simply stop working. Sign-up is the door that
 * needed guarding — creating accounts in bulk is the abuse — so the check is
 * verified here instead, and the dashboard toggle stays off.
 *
 * ── Why Turnstile and not reCAPTCHA ────────────────────────────────────────
 *
 * It is the only one of these worth putting in front of children. No cookies,
 * no cross-site profile, nothing sold on, and most visitors never see a puzzle
 * — it watches how the browser behaves rather than making a person label
 * traffic lights. reCAPTCHA is an advertising company's tracker wearing a
 * security badge, and this app does not carry those.
 *
 * It is still a third-party script, and this app has a rule against those
 * (docs/LEADERBOARD.md §1.4, §9.6). That rule is bent here, deliberately and
 * narrowly: components/landing/Turnstile.tsx loads the script ONLY when the
 * sign-up form is opened, so a player who never makes an account never
 * contacts Cloudflare at all.
 *
 * ── Unconfigured means off ─────────────────────────────────────────────────
 *
 * No secret, no check. That keeps local development and any deploy that has
 * not set it up working exactly as before — and it is why the site key is what
 * the FORM keys off: if the widget is not shown, no token is required.
 */

const SECRET = process.env.TURNSTILE_SECRET_KEY ?? "";

export const turnstileConfigured = (): boolean => SECRET.length > 0;

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "rejected" | "unreachable" };

/**
 * Checks a token with Cloudflare.
 *
 * Tokens are single-use and short-lived, so this cannot be replayed: a second
 * sign-up with the same token is rejected by Cloudflare, not by us.
 *
 * `remoteIp` is passed when we have it because it tightens the check, and it
 * is NOT stored anywhere — it goes to Cloudflare with the token and is gone.
 * That is a different thing from the throttle, which never sees an address at
 * all (lib/auth/throttle.ts hashes it first).
 */
export async function verifyTurnstile(
  token: unknown,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  if (!turnstileConfigured()) return { ok: true };

  if (typeof token !== "string" || !token.trim()) {
    return { ok: false, reason: "missing" };
  }

  const form = new URLSearchParams({ secret: SECRET, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      // Cloudflare is fast, and a sign-up button that hangs for thirty seconds
      // because a third party is having a bad day is its own kind of outage.
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { success?: boolean };
    return body.success ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    /*
     * Cloudflare unreachable.
     *
     * This FAILS CLOSED — the sign-up is refused rather than waved through.
     * The opposite would mean anyone who wanted unlimited accounts only had to
     * make our server unable to reach challenges.cloudflare.com, which turns a
     * dependency into the bypass. The rate limiter still stands either way, so
     * the blast radius of a Cloudflare outage is "sign-ups pause", not "the
     * game is down": everything else, including playing and signing in, is
     * untouched.
     */
    return { ok: false, reason: "unreachable" };
  }
}

/** The address to hand Cloudflare, from the proxy's own header. Same reasoning
 *  as lib/auth/throttle.ts: the last entry is the one the proxy observed. */
export function remoteIpFrom(headers: Headers): string | null {
  const chain = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return chain.length > 0 ? chain[chain.length - 1] : headers.get("x-real-ip");
}
