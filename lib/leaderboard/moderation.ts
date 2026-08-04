/**
 * Company-name moderation — the gate between free text a child typed and a
 * world-readable board.
 *
 * `RunState.companyName` is the one field on the board that is not drawn from a
 * word list. Across enough players it will contain real names, school names,
 * phone numbers, home addresses and slurs. A board that publishes it the
 * instant it is submitted is a liability you will find out about from a parent
 * (docs/LEADERBOARD.md §9.3).
 *
 * ── What this file is, and is not ───────────────────────────────────────────
 *
 * It is the CHEAP pass: it catches contact details, obvious profanity, and text
 * that cannot render. It is not a judgement about whether a name is safe. That
 * is what `listed = false` and the human queue are for — the read policy in
 * 0002 makes an unlisted entry invisible to everyone including its own author,
 * so nothing here has to be right for the board to be safe. It only has to be
 * right for the queue to be short.
 *
 * Getting that order backwards is the mistake this comment exists to prevent.
 * A blocklist is a filter in front of a human, never a substitute for one.
 */

export type ModerationVerdict = "clean" | "review" | "reject";

export interface ModerationResult {
  verdict: ModerationVerdict;
  /** Machine-readable reasons. Logged, never shown to the player verbatim. */
  reasons: string[];
  /** What to tell the player. Written for a fifteen-year-old, not a lawyer. */
  message: string | null;
}

/** Mirrors `length(btrim(display_name)) between 1 and 24` in 0001. */
export const MAX_COMPANY_NAME = 40;
export const MIN_COMPANY_NAME = 2;

/**
 * The renderable set.
 *
 * Letters, digits, spaces, and the punctuation a company name actually uses.
 * Everything else is refused rather than stripped — silently mangling somebody's
 * name is worse than telling them it will not fit.
 *
 * Deliberately ASCII-plus-Latin-1: this app ships in English, and a board that
 * renders a name it cannot lay out is a board with a broken row on it. When
 * this app ships in another script, this is the line to change, and it should
 * be changed by widening the class rather than by removing the check.
 */
const RENDERABLE = /^[A-Za-z0-9À-ÿ '&.,!?()+\-/]+$/;

/** Zero-width and bidi characters. Invisible in a review, loud on a board. */
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿]/;

/**
 * Contact details, in the shapes a child actually types them.
 *
 * Each of these is a reject rather than a review: there is no company name that
 * needs to contain a phone number, and putting one in front of a human just
 * costs the human a click.
 */
const CONTACT_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { id: "url", re: /\b(?:https?:\/\/|www\.)\S+/i },
  { id: "domain", re: /\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|edu|gov|app|xyz)\b/i },
  { id: "social", re: /(?:^|\s)@[a-z0-9_]{3,}/i },
  // Seven or more digits in a row, or a grouped phone number with separators.
  { id: "phone", re: /\d[\d\s().-]{6,}\d/ },
  { id: "digit-run", re: /\d{7,}/ },
];

/**
 * Profanity and slurs, as substrings on a normalised string.
 *
 * This list is a FLOOR, not a ceiling, and it is written to be read: an
 * unreadable regex is one nobody maintains. It is matched against text with
 * leetspeak folded and separators removed, so `f.u.c.k` and `fu(k` land on the
 * same entry as the plain spelling.
 *
 * Slurs are rejected outright; general profanity goes to review, because
 * "Damn Good Coffee" is a real company name and a nine-year-old naming a
 * company after a rude word is a conversation, not a ban.
 */
const SLURS = [
  "nigg", "fagg", "kike", "spic", "chink", "tranny", "retard", "raped", "rapist",
];

const PROFANITY = [
  "fuck", "shit", "cunt", "bitch", "bastard", "dick", "cock", "penis", "vagina",
  "boobs", "tits", "arse", "asshole", "whore", "slut", "wank", "bollock",
  "nazi", "hitler", "kkk", "isis", "cocaine", "heroin", "meth",
];

/**
 * Folds the tricks people use to slip a word past a substring match.
 *
 * Not a security boundary — a determined adult defeats this in a minute. It
 * exists so the human queue is not full of `f_u_c_k Industries`, which is the
 * actual failure mode of a naive blocklist on a product for children.
 */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    // A character class, not the literal sequence "5$": both '5' and '$' are
    // common substitutions for 's' (a55hole, cla$$). The old /5\$/ matched
    // neither on its own, so those obfuscations slipped straight through.
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

/**
 * Does this name look like a person's full name?
 *
 * Two capitalised words and nothing else — `Sarah Mitchell` — is the shape a
 * child types when they name the company after themselves or a classmate. It is
 * NOT a reject: `Marco Holdings` is two capitalised words and so is half the
 * FTSE. It is the single most useful thing to put in front of a human, which is
 * exactly what `review` means.
 */
function looksLikePersonalName(name: string): boolean {
  return /^[A-Z][a-z]{1,14} [A-Z][a-z]{1,14}$/.test(name.trim());
}

export function moderateCompanyName(raw: string): ModerationResult {
  const name = (raw ?? "").trim();
  const reasons: string[] = [];

  const reject = (reason: string, message: string): ModerationResult => ({
    verdict: "reject",
    reasons: [reason],
    message,
  });

  if (name.length < MIN_COMPANY_NAME) {
    return reject("too-short", "That name is too short to put on a board.");
  }
  if (name.length > MAX_COMPANY_NAME) {
    return reject(
      "too-long",
      `Board names stop at ${MAX_COMPANY_NAME} characters. Yours is ${name.length}.`,
    );
  }
  if (INVISIBLE.test(name)) {
    return reject("invisible-characters", "That name contains characters we cannot show.");
  }
  if (!RENDERABLE.test(name)) {
    return reject(
      "unrenderable",
      "Board names use letters, numbers and ordinary punctuation.",
    );
  }

  for (const { id, re } of CONTACT_PATTERNS) {
    if (re.test(name)) {
      return reject(
        `contact:${id}`,
        "Company names on the board cannot contain contact details. Nothing that could identify you or anyone else goes on a public page.",
      );
    }
  }

  const folded = normalise(name);
  for (const slur of SLURS) {
    if (folded.includes(slur)) {
      return reject("slur", "That name will not go on a public board. Pick another one.");
    }
  }

  for (const word of PROFANITY) {
    if (folded.includes(word)) reasons.push(`profanity:${word}`);
  }
  if (looksLikePersonalName(name)) reasons.push("looks-personal");
  // ALL CAPS SHOUTING is not a problem; a name that is nothing but punctuation
  // is, because it renders as a row with no name in it.
  if (!/[A-Za-z0-9]/.test(name)) {
    return reject("no-letters", "A company name needs at least one letter or number.");
  }

  if (reasons.length > 0) {
    return {
      verdict: "review",
      reasons,
      message:
        "Your run is in. The name is waiting on a human before it shows publicly — that is how every name gets there.",
    };
  }

  return { verdict: "clean", reasons: [], message: null };
}

/**
 * Whether an entry may be listed without a human looking at it.
 *
 * Two arguments, not one: the verdict AND the deployment's policy. A clean
 * verdict under `review` still waits, because "the regex liked it" is not the
 * same claim as "somebody read it".
 */
export function mayAutoList(
  result: ModerationResult,
  policy: "review" | "clean",
): boolean {
  return policy === "clean" && result.verdict === "clean";
}
