/**
 * THE AGE GATE — one rule, in one place.
 *
 * ── What this is, and what it honestly is not ──────────────────────────────
 *
 * Novus is a product for minors. COPPA (US) and the UK/EU equivalents draw
 * their line at 13: below it, an online service may not collect a child's
 * personal information without verifiable parental consent, and this app has
 * no mechanism for obtaining that. So the honest position is not to sign them
 * up at all.
 *
 * This is an age SCREEN, not age VERIFICATION. A determined thirteen-year-old
 * types 14 and nothing here can tell. That is true of every non-invasive gate
 * on the internet, and the alternative — asking a child for ID, or for a
 * parent's card — collects far more data about a minor than the gate saves.
 * What a screen does do is stop the accidental case, which is the common one,
 * and record that the question was asked and answered.
 *
 * ── Why it asks for an age and not a birthday ──────────────────────────────
 *
 * A full date of birth is strictly more personal data about a child than "how
 * old are you", and it buys nothing here: the only question is which side of
 * 13 they are on. `Profile.playerAge` is already the most carefully handled
 * field in the codebase — `lib/engine/save.ts` and `app/api/sync/route.ts`
 * both strip it so it never reaches the server, and there are comments in both
 * saying it must never be added. Asking for a birthday would mean either
 * storing more, or storing the same and having asked for more. Neither is an
 * improvement on a product whose users are children.
 *
 * ── Why the answer is remembered ───────────────────────────────────────────
 *
 * A gate that can be beaten by pressing back is not a gate, it is a speed
 * bump with a message. The refusal is recorded on the device so reloading,
 * navigating back, or re-running onboarding lands on the same answer.
 *
 * The cost of that is real and worth stating: a fourteen-year-old who typos
 * `1` is locked out until the site's data is cleared. That is the trade this
 * makes deliberately — an under-13 who can retry until the number is accepted
 * is not gated at all, and the recovery path (clear site data, or use the
 * device's "forget this site") exists and is stated in the refusal copy.
 */

/** The line. One constant, read by the onboarding screen and the account
 *  gate — its two importers. No route reads it: the server deliberately never
 *  receives an age (docs/LEADERBOARD.md §9.4), so there is nothing server-side
 *  to enforce it against. */
export const MIN_AGE = 13;

/** True when this age may proceed. Anything unparseable is not old enough. */
export function isOldEnough(age: number | string | null | undefined): boolean {
  const n = typeof age === "string" ? Number.parseInt(age, 10) : age;
  return typeof n === "number" && Number.isFinite(n) && n >= MIN_AGE;
}

/**
 * An age a person could plausibly have typed about themselves.
 *
 * Above this the field is almost certainly a mistake or a joke, and treating
 * "99" as a valid answer would let the gate be cleared by mashing a key. It is
 * not a claim about how old a player may be — it is a claim about what a
 * numeric field with two characters can mean.
 */
export const MAX_AGE = 99;

export function isPlausibleAge(age: number | string | null | undefined): boolean {
  const n = typeof age === "string" ? Number.parseInt(age, 10) : age;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= MAX_AGE;
}

const KEY = "novus:agegate:v1";

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

/**
 * Remember that this device answered under 13.
 *
 * The age itself is NOT written — only the fact of the refusal. Storing "11"
 * would be keeping a data point about a child we have just decided not to
 * serve, which is the opposite of what the gate is for.
 */
export function recordTooYoung(): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // A blocked or full store must not take the screen down. The in-memory
    // state for this session still refuses; only the persistence is lost.
  }
}

export function isAgeBlocked(): boolean {
  if (!canStore()) return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Clear the block.
 *
 * Exists for the operator tools and for tests, NOT for a button on the refusal
 * screen — a "let me back in" control on the gate is the gate removing itself.
 */
export function clearAgeBlock(): void {
  if (!canStore()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** What every surface says. One string, so the wording cannot drift. */
export const TOO_YOUNG_TITLE = "Come back when you're 13.";

export const TOO_YOUNG_BODY =
  "Novus keeps an account for you, and the law says we can't do that for anyone under 13 without a parent's permission — which we have no way to check. So we'd rather not sign you up at all than do it badly. Nothing is wrong with you or your device; you're just early.";
