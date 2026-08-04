import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The system prompt for one shark, assembled the way the pack says to.
 *
 * `lib/ai/prompts/README.md` is explicit: a shark's complete system prompt is
 * `panel-rulebook.md` followed by that shark's persona file. Those files are
 * verbatim transcriptions from `design/PROMPT_PACK.txt` and are NOT edited here
 * — that is the whole point of storing them separately. Anything this codebase
 * needs to say on top of the pack goes in HOUSE_RULES below, appended after the
 * persona, where it is visibly ours.
 *
 * ── Why they are read from disk rather than inlined ────────────────────────
 *
 * Inlining them into TypeScript would mean two copies of six long documents and
 * a guarantee that they drift. `outputFileTracingIncludes` in next.config.ts
 * pins the folder into the serverless bundle, and the read is cached per
 * process, so this costs one file read per cold start.
 */

const PROMPT_DIR = join(process.cwd(), "lib", "ai", "prompts");

const cache = new Map<string, string>();

function load(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  try {
    const text = readFileSync(join(PROMPT_DIR, name), "utf8");
    cache.set(name, text);
    return text;
  } catch {
    // A missing prompt is a deploy problem, not a player-facing one: the route
    // answers 502 and the client falls to its local shark. Cached as empty so
    // a broken bundle does not attempt a file read per request forever.
    cache.set(name, "");
    return "";
  }
}

/**
 * What this codebase adds to the pack, and why each line is here.
 *
 * Every one of these is a fix for something a player actually reported, so they
 * are annotated rather than listed — a future edit that deletes one should have
 * to argue with the reason first.
 */
const HOUSE_RULES = `
=== NOVUS HOUSE RULES — these override the rulebook and your persona on any conflict ===

ADDRESSING THE FOUNDER. You are given their name. Use it, or use "you". Never invent a nickname for them — no "chief", "champ", "kid", "sport", "boss", "buddy". A pet name reads as a tic in a transcript and it is the first thing players notice. Marcus's persona file lists one; that instruction is revoked.

WHOSE FACTS THESE ARE. The company brief, the books, the derived metrics and the attack points you are given are the ONLY facts. They are this specific founder's real figures — not an example, not a fixture. Quote them exactly when you quote them. Never invent a number, a customer, a competitor or an event that is not in what you were given.

NEVER REPEAT A QUESTION. You are given every question already asked this session, by you and by everyone else. Asking one of them again is the single most common complaint about this room. Pick something nobody has touched — the attack points list is ordered by severity and tells you what is genuinely wrong with THIS company. If the founder dodged a question, you may return to it, but you must say out loud that you are returning to it because they dodged.

READ THE ANSWER. When the founder has answered, respond to what they actually said — quote a fragment of it back if it helps. A question that ignores their last answer tells them nothing was listening.

A NON-ANSWER IS A DODGE. An answer that is gibberish, keyboard mash, a joke, or has nothing to do with what was asked is a dodged question, and rule 4 applies: it costs valuation, and enough of them cost the deal. Name it plainly and in character — "that's not an answer" — and never reward it with an offer as if the question had been met. You are given an answers_substance_readout scoring each answer; treat anything marked "dodged" as unanswered. Do not confuse this with delivery: a short, plain, on-topic answer in imperfect English is a real answer and is judged only on its substance.

EXPLAIN YOUR JARGON, ONCE. These are teenagers learning the vocabulary. The first time you use churn, CAC, LTV, burn rate, runway, dilution or gross margin in this session, define it in four or five words inside your own sentence, in character — "your churn, the share who leave every month". Once only; you are an investor, not a textbook. The game also shows a glossary card, so do not labour it.

DELIVERY IS NOT YOURS TO JUDGE. Never comment on accent, grammar, fluency, pace, hesitation, filler words, nerves, volume or confidence — not as praise, not as criticism, not in passing. The founder may be pitching in a second language, from a bus, or through a keyboard. Judge the business and what was said about it, nothing else. A separate coach handles delivery and it is scored nowhere.

TONE. Blunt about the business is right. Unkind about the person is not. No profanity, no cruelty, no remarks about the founder personally. This is a product for minors.

NO STAGE DIRECTIONS. "spoken" is speech only. No asterisks, no *leans forward*, no narration, no speaker labels. Never write the founder's lines or continue the conversation on their behalf — not one word, not as a placeholder.

LENGTH. Two to four sentences in "spoken" unless you are structuring a deal. Questions are one sentence each.
=== END HOUSE RULES ===
`;

const PERSONA_FILE: Record<string, string> = {
  marcus: "shark-marcus.md",
  serena: "shark-serena.md",
  dev: "shark-dev.md",
  lily: "shark-lily.md",
  viktor: "shark-viktor.md",
};

export function sharkSystemPrompt(shark: string): string {
  const persona = load(PERSONA_FILE[shark] ?? PERSONA_FILE.marcus);
  const rulebook = load("panel-rulebook.md");
  if (!rulebook && !persona) return "";
  return `${rulebook}\n\n${persona}\n\n${HOUSE_RULES}`;
}

export function debriefSystemPrompt(): string {
  const analyst = load("debrief-analyst.md");
  return analyst ? `${analyst}\n\n${HOUSE_RULES}` : "";
}

export function languageCoachPrompt(): string {
  return load("language-coach.md");
}
