import { GLOSSARY } from "@/lib/engine/constants";

/**
 * TERM-ON-FIRST-USE, in the room.
 *
 * The Tank is where a fifteen-year-old first hears "what's your CAC payback"
 * said out loud by somebody who expects an answer. The glossary already exists
 * (`GLOSSARY` in lib/engine/constants.ts, rookie gloss and pro definition for
 * every term the game uses); it was simply never wired to the panel, so the
 * sharks used the vocabulary and nothing explained it.
 *
 * This finds the first term in a line that the player has not had explained
 * yet. `TermCoach` renders it, docked, for nine seconds.
 *
 * ── Why first-use and not a glossary screen ────────────────────────────────
 *
 * Because a glossary you have to go and find is a glossary nobody reads, and
 * because the definition is only interesting at the moment the word lands. The
 * sharks also define their own jargon once per session in character — the house
 * rules in lib/ai/server/panel-prompts.ts require it — so this card is the
 * belt to that braces, and it is deliberately dismissable.
 */

/**
 * Longest first, so "gross margin" wins over "margin" and "ltv:cac" over "ltv".
 * Computed once: the glossary is a module constant and never changes.
 */
const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

/**
 * Word-boundary match that survives the punctuation a spoken line carries.
 *
 * A plain `includes` matches "cac" inside "cactus" and "ltv" inside a URL. It
 * also has to cope with terms that contain a colon or a hyphen — "ltv:cac",
 * "break-even" — which `\b` handles badly, hence the explicit escape and the
 * lookarounds on either side.
 */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/**
 * The first term in `text` that is not already in `seen`.
 *
 * Returns null when the line has no jargon in it, which is most lines — the
 * card should be a rare, welcome interruption rather than a permanent fixture
 * at the bottom of the screen.
 */
export function firstUnseenTerm(text: string, seen: readonly string[]): string | null {
  if (!text) return null;
  const already = new Set(seen.map((s) => s.toLowerCase()));
  for (const term of TERMS) {
    if (already.has(term)) continue;
    if (mentions(text, term)) return term;
  }
  return null;
}

/** Every glossary term a piece of text uses, for the debrief's vocabulary list. */
export function termsUsed(text: string): string[] {
  if (!text) return [];
  return TERMS.filter((t) => mentions(text, t));
}
