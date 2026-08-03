import "server-only";

/**
 * Sending mail through Resend (resend.com), the app's one email provider.
 *
 * Until chapters, Novus sent no email of its own — the only mail a player
 * ever received was Supabase's password-reset, delivered by Supabase's
 * mailer. Inviting a classroom is different: thirty invites in one paste is
 * exactly the volume Supabase's built-in mailer throttles, and an invite is
 * OUR email — our subject line, our copy — not an auth side effect.
 *
 * One deliberate shape: this is a plain fetch against Resend's HTTP API, not
 * their SDK. The call is a single POST with a bearer key; a dependency would
 * add a lockfile entry and a supply-chain surface to save six lines.
 *
 * SERVER ONLY, like every key in this app. RESEND_API_KEY never reaches a
 * page, and nothing here is imported by anything a Client Component can
 * reach — `import "server-only"` makes that a build error rather than a
 * code-review hope.
 *
 * ── Unconfigured is a supported answer ─────────────────────────────────────
 *
 * With no key set, `resendConfigured()` is false and chapter invites fall
 * back to the Supabase recovery email (the pre-Resend behaviour): small
 * classrooms keep working with zero setup, and nothing half-sends. Both
 * variables are required together — a key with no verified sender would
 * accept the send and bounce it, which reads as "invited" and arrives never.
 */

export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

/**
 * The From header, e.g. `Novus <chapters@novuspitch.com>`. The domain must be
 * verified in the Resend dashboard (Domains → Add) or every send is refused —
 * which surfaces per-row in the console rather than silently.
 */
export const RESEND_FROM = process.env.RESEND_FROM ?? "";

export const resendConfigured = (): boolean => !!RESEND_API_KEY && !!RESEND_FROM;

/**
 * One email. Returns null on success, or a one-line reason on failure —
 * the invite route threads that straight into its per-row results, so a
 * refused send is a visible row ("domain not verified"), never a lost one.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<string | null> {
  if (!resendConfigured()) return "Resend is not configured";

  // Bounded: an email API that hangs must not hold a 200-row invite loop
  // hostage. Ten seconds is generous for a single POST.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
      signal: abort.signal,
    });

    if (res.ok) return null;

    // Resend answers errors as { message } (sometimes { name, message }).
    // The message is written for operators and safe to surface to the admin
    // console; it never contains the key.
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* a non-JSON error body keeps the status code */
    }
    return message;
  } catch (e) {
    return e instanceof Error && e.name === "AbortError"
      ? "Resend did not answer within 10 seconds"
      : (e as Error).message;
  } finally {
    clearTimeout(timer);
  }
}
