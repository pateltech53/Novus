import { mulberry32 } from "@/lib/engine/rng";

/**
 * The board handle — the only name that ever appears on a public board.
 *
 * `RunState.founderName` is what the player typed when they founded the
 * company. For a nine-year-old that is their first name, and often their full
 * name. Publishing it on a world-readable board, beside a company name that
 * might identify a school, is the exact pattern COPPA exists to prevent
 * (docs/LEADERBOARD.md §9.2).
 *
 * So the board's name is assembled from the two word lists below and four
 * digits, and the player PICKS from a shuffle rather than typing. That is the
 * whole design in one sentence: free text here would be a moderation queue
 * nobody budgeted for, and a word list is not.
 *
 * The shape — `Brave Otter 4417` — is enforced in three places, deliberately:
 * `profiles.board_handle` in 0001, `leaderboard_entries.founder_display_name`
 * in 0002, and `isPoolHandle` below. A constraint holds when a route handler
 * forgets; a route handler explains itself when a constraint fires.
 *
 * The real founder name still shows locally, in the player's own run, on their
 * own device, wherever the app already shows it. That is theirs. The global
 * board is not the place for it.
 */

/**
 * Adjectives. Every one of them is a thing a founder might be called at work,
 * because a handle a player is embarrassed by is a handle they will try to
 * replace with their own name.
 */
const ADJECTIVES = [
  "Brave", "Silent", "Patient", "Restless", "Steady", "Curious", "Stubborn",
  "Careful", "Bright", "Quiet", "Sharp", "Honest", "Rapid", "Modest",
  "Certain", "Frugal", "Candid", "Nimble", "Solid", "Keen", "Humble",
  "Bold", "Clever", "Direct", "Earnest", "Fearless", "Gracious", "Level",
  "Prudent", "Ready", "Shrewd", "Tidy", "Upright", "Vivid", "Willing",
  "Zealous", "Ample", "Blunt", "Crisp", "Dogged",
] as const;

/**
 * Nouns. Animals only, and only ones a child can picture — no place names, no
 * job titles, nothing that could read as a description of a real person.
 */
const NOUNS = [
  "Otter", "Marten", "Falcon", "Heron", "Badger", "Lynx", "Osprey", "Ibis",
  "Marlin", "Puffin", "Raven", "Sable", "Tapir", "Vole", "Wombat", "Yak",
  "Beaver", "Condor", "Dingo", "Egret", "Ferret", "Gannet", "Hare", "Jackal",
  "Kestrel", "Lemur", "Manta", "Narwhal", "Ocelot", "Pelican", "Quail",
  "Racoon", "Shrike", "Tern", "Urchin", "Viper", "Walrus", "Bison", "Civet",
  "Dormouse",
] as const;

/** `Brave Otter 4417` and nothing else. Mirrors both database constraints. */
export const HANDLE_PATTERN = /^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$/;

export interface HandleParts {
  adjective: string;
  noun: string;
  digits: string;
}

export function formatHandle(parts: HandleParts): string {
  return `${parts.adjective} ${parts.noun} ${parts.digits}`;
}

/**
 * Is this a handle that could have come out of the pool?
 *
 * The regex alone is not enough. `Zzzz Qqqq 0000` matches it, and a player who
 * can POST an arbitrary string that matches has free text on a public board
 * again — which is the one thing this file exists to prevent. So membership in
 * both word lists is checked as well, and the server validates against the
 * lists rather than trusting that the client chose from them.
 */
export function isPoolHandle(handle: string): boolean {
  if (!HANDLE_PATTERN.test(handle)) return false;
  const [adjective, noun, digits] = handle.split(" ");
  return (
    (ADJECTIVES as readonly string[]).includes(adjective) &&
    (NOUNS as readonly string[]).includes(noun) &&
    /^[0-9]{4}$/.test(digits)
  );
}

/**
 * A shuffle to pick from.
 *
 * Seeded so the same request produces the same options — a player who reloads
 * mid-choice should not lose the handle they were about to take. `seed` is
 * supplied by the caller (the route derives it from the profile id), which also
 * keeps this function pure and testable.
 *
 * The engine's own `mulberry32` rather than `Math.random`, for the same reason
 * every other draw in this codebase uses it: luck that cannot be retold is luck
 * that cannot be debugged.
 */
export function handleShuffle(seed: number, count = 6): string[] {
  const rng = mulberry32(seed >>> 0);
  const out: string[] = [];
  const seen = new Set<string>();
  // Bounded rather than while(out.length < count): a pathological seed must
  // not spin, and 20× the requested count is far past any real collision rate
  // over 40 × 40 × 9000 possibilities.
  for (let i = 0; i < count * 20 && out.length < count; i++) {
    const handle = formatHandle({
      adjective: ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)],
      noun: NOUNS[Math.floor(rng() * NOUNS.length)],
      // 1000–9999. Four digits always, so the regex never has to think about
      // a leading zero that JSON would have eaten.
      digits: String(1000 + Math.floor(rng() * 9000)),
    });
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

/** For tests and the audit: how large the space actually is. */
export const HANDLE_SPACE = ADJECTIVES.length * NOUNS.length * 9000;
