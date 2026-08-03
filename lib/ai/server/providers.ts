import "server-only";

/**
 * The server half of the AI tier — where the three API keys live and where they
 * stay.
 *
 * ── The bug this file exists to fix ────────────────────────────────────────
 *
 * `lib/ai/speech.ts`, `lib/ai/transcribe.ts` and `lib/ai/callers.ts` were
 * written against ENDPOINTS, not providers: each reads a `NEXT_PUBLIC_*_ENDPOINT`
 * URL and POSTs to it. That is the right shape — a key must never reach a
 * browser — but nothing was ever built on the other end of those URLs. Setting
 * ELEVENLABS_API_KEY, DEEPGRAM_API_KEY and OPENROUTER_API_KEY therefore did
 * nothing at all: no file in the repo read those names, so the three features
 * silently stayed on their local fallbacks (browser speech synthesis, browser
 * recognition, the offline resolver) and reported no error, because for those
 * three "unconfigured" is a normal state rather than a failure.
 *
 * `app/api/tts`, `app/api/stt` and `app/api/pitch` are the missing other end.
 * This module is what they share.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 *
 * · No `NEXT_PUBLIC_` prefix on anything here, ever. These are secrets.
 * · `server-only` above turns importing this from a Client Component into a
 *   build error rather than a leak found later by grepping a bundle.
 * · An unconfigured provider answers 501, never 500. The clients treat 501 as
 *   "stay local for the rest of this session" and stop asking, so a deploy with
 *   no keys costs one request per feature per session and nothing else.
 */

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
export const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? "";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

/**
 * Model ids, overridable without a code change because provider catalogues move
 * faster than releases do.
 *
 * The defaults are picked for cost first: this is a game for minors that has to
 * survive a classroom, and a per-pitch bill that scales with enthusiasm is a
 * design flaw. `eleven_turbo_v2_5` and `nova-3` are the cheap tiers of their
 * respective products; `anthropic/claude-haiku-4.5` is chosen over a frontier
 * model because judging a two-minute pitch against a fixed rubric is not a
 * frontier task, and the local resolver is a defensible answer when it fails.
 */
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
export const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5";

/**
 * How many calls, per address, per fifteen minutes — and a hard daily ceiling
 * across everyone.
 *
 * These endpoints spend real money on someone else's bill and are reachable by
 * anyone who can find them, so an unlimited one is a funding request with no
 * upper bound. The per-address numbers are sized for the case that must not
 * break — a class of thirty behind one school NAT — and the daily cap is the
 * backstop for the case where that assumption is wrong.
 *
 * Every limit degrades to the local fallback rather than to an error, so being
 * throttled costs quality and never a turn. That is what makes capping this
 * aggressively safe.
 */
export const AI_LIMITS = {
  /** A panel is ~20 spoken lines, so this is roughly 15 players an hour. */
  ttsPerIp: numberFromEnv("NOVUS_AI_TTS_PER_IP", 300),
  sttPerIp: numberFromEnv("NOVUS_AI_STT_PER_IP", 60),
  /** The game itself allows three cold calls a real day, per player. */
  pitchPerIp: numberFromEnv("NOVUS_AI_PITCH_PER_IP", 60),
  /** Everyone, everywhere, per 24h. The wallet's limit rather than a player's. */
  ttsPerDay: numberFromEnv("NOVUS_AI_TTS_PER_DAY", 20_000),
  sttPerDay: numberFromEnv("NOVUS_AI_STT_PER_DAY", 4_000),
  pitchPerDay: numberFromEnv("NOVUS_AI_PITCH_PER_DAY", 4_000),
} as const;

function numberFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** One minute. Long enough for a slow transcription, short enough that a hung
 *  provider does not hold a serverless invocation open until it is billed. */
export const PROVIDER_TIMEOUT_MS = 60_000;

/**
 * The body every route returns when its key is absent.
 *
 * 501 and not 500: nothing is broken, the feature is simply not switched on,
 * and the difference matters because the clients cache the answer.
 */
export const NOT_CONFIGURED = { configured: false as const };

export function timeoutSignal(ms: number = PROVIDER_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
