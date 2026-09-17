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
 * A clean name now lists automatically after the server verifies the run.
 * Contact details, profanity and names shaped like a person's full name are
 * refused with a rename instruction instead of being left in an approval
 * queue. This filter is finite: reports and operator takedowns remain the
 * recovery path for anything it misses (docs/LEADERBOARD.md §9.3).
 */

export type ModerationVerdict = "clean" | "reject";

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
 * Contact details are refused before replay; they have no place in a public
 * company name, whether the entry is global or filtered to a chapter.
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
 * Both groups require a different company name. The run and account stay
 * intact; refusing a public label is not a ban from the game.
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
 * catches `f_u_c_k Industries` as well as plain spelling. Reports still cover
 * forms this finite list does not recognise.
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
 * child types when they name the company after themselves or a classmate.
 * This deliberately conservative heuristic also catches `Marco Holdings`.
 * The player can choose a brand-style name; neither case waits for approval.
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
      verdict: "reject",
      reasons,
      message:
        reasons.includes("looks-personal")
          ? "That looks like a person's full name. Choose a company or brand name without anyone's real name."
          : "Choose a company name without profanity or explicit language.",
    };
  }

  return { verdict: "clean", reasons: [], message: null };
}

/**
 * Name eligibility only. The caller must also require a verified replay;
 * reporting and explicit takedowns can still keep an eligible name unlisted.
 */
export function mayAutoList(result: ModerationResult): boolean {
  return result.verdict === "clean";
}
