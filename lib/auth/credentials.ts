/**
 * What counts as a usable email and password, in one place.
 *
 * Shared by the sign-up form and the route that receives it, so the button
 * does not enable for something the server will reject a round trip later.
 * The server checks anyway — a form is a convenience, never a control.
 *
 * ── On the password rules ──────────────────────────────────────────────────
 *
 * A minimum length and nothing else. No "must contain a symbol", no forced
 * mixed case. Composition rules make passwords harder to remember without
 * making them meaningfully harder to guess, and this account will be created
 * by a fourteen-year-old on a phone who has to type it again next term. Length
 * is the property that actually helps, so length is the only thing required.
 *
 * Supabase's own floor is 6. This asks 8, because the account is about to have
 * a payment method attached to it.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Bounded so a pathological paste cannot become a 1MB bcrypt input. */
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately loose. Strict email regexes reject real addresses (plus signs,
 * new TLDs, unicode local parts) and the only thing that truly proves an
 * address works is sending to it. This catches the typo — no @, no dot after
 * it, whitespace — and lets Supabase be the authority on the rest.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CredentialProblem =
  | "email-missing"
  | "email-shape"
  | "email-long"
  | "password-short"
  | "password-long";

export function checkEmail(email: string): CredentialProblem | null {
  const trimmed = email.trim();
  if (!trimmed) return "email-missing";
  if (trimmed.length > MAX_EMAIL_LENGTH) return "email-long";
  if (!EMAIL_SHAPE.test(trimmed)) return "email-shape";
  return null;
}

export function checkPassword(password: string): CredentialProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "password-short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password-long";
  return null;
}

/** Both, for the sign-up path. Sign-in only checks presence — an old account
 *  made under looser rules must still be able to get back in. */
export function checkCredentials(email: string, password: string): CredentialProblem | null {
  return checkEmail(email) ?? checkPassword(password);
}

/**
 * Lowercased and trimmed. Addresses are case-insensitive in practice, and a
 * player who signs up as `Sam@x.com` and back in as `sam@x.com` must land in
 * the same account rather than being told their password is wrong.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** One sentence per problem, written for the player rather than the log. */
export const CREDENTIAL_MESSAGE: Record<CredentialProblem, string> = {
  "email-missing": "Enter an email address.",
  "email-shape": "That does not look like an email address.",
  "email-long": "That email address is too long.",
  "password-short": `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  "password-long": "That password is too long.",
};
