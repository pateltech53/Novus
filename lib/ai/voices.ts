import type { SharkId } from "./types";

/**
 * One voice per shark, plus the Chair and the narrator.
 *
 * ── The bug this table now fixes ───────────────────────────────────────────
 *
 * Every `elevenVoiceId` here used to be `""`. `lib/ai/speech.ts` only sends a
 * `voiceId` when this table names one, so the empty strings meant the client
 * never named a voice at all — and `app/api/tts/route.ts` had to work out who
 * was speaking on its own, per request, per serverless instance:
 *
 *   1. read the account's voice list and assign by seat index, or
 *   2. if that read failed, rotate through the premade library instead.
 *
 * Both steps are cached PER PROCESS. So a deploy where the voice-list read is
 * intermittent — a key without `voices_read`, a rate limit, a cold instance
 * that has not fetched yet — hands the same shark a different voice depending
 * on which lambda answers. That is precisely the reported symptom: the Chair
 * sounds right every time because the Chair speaks from one screen, and the
 * sharks change voices mid-conversation because their lines fan out.
 *
 * Naming the ids here removes the guess. The client sends an explicit voice,
 * the route uses it, and Marcus is Marcus on every instance forever.
 *
 * ── Why hardcoding these ids is right HERE and wrong as a fallback ─────────
 *
 * `app/api/tts/route.ts` argues at length that hardcoded library ids are a bad
 * PRIMARY source, because they are not guaranteed to exist on a given account.
 * That argument stands, and this does not contradict it: these are DEFAULTS,
 * not a guarantee. The route still tries the account list and its own rotation
 * when one of these 404s, and `ELEVENLABS_VOICE_MARCUS` and friends still
 * outrank everything — casting is a creative decision and belongs to whoever
 * runs the deploy.
 *
 * What changed is the failure mode. Before: no id, so the voice was decided
 * per-process and drifted. Now: a stable id that is wrong only if the account
 * genuinely lacks the voice, and that case is detected and recovered.
 *
 * ── Casting ────────────────────────────────────────────────────────────────
 *
 * The ids below are the premade voices every ElevenLabs account is created
 * with, matched to the `direction` line each character already had. All seven
 * are distinct, which is the other half of the point: five sharks who share one
 * voice is barely better than no voice at all.
 */

export interface VoiceProfile {
  /**
   * ElevenLabs voice id. A default, overridable per deploy with
   * `ELEVENLABS_VOICE_<CHARACTER>` — see `app/api/tts/route.ts`.
   */
  elevenVoiceId: string;
  /** Local speechSynthesis fallback shaping. */
  rate: number;
  pitch: number;
  /** Preferred local voice names, in order; first match on the device wins. */
  prefer: string[];
  /** How they sound, in words — the brief a voice actor would get. */
  direction: string;
}

export type VoiceKey = SharkId | "chair" | "narrator";

export const VOICES: Record<VoiceKey, VoiceProfile> = {
  marcus: {
    elevenVoiceId: "xzZRXG86mSM3naOyL9fa",
    rate: 0.94,
    pitch: 0.82,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Guy"],
    direction: "Low, unhurried, never raises it. The pause before the number is the threat.",
  },
  serena: {
    elevenVoiceId: "2qfp6zPuviqeCOZIE9RZ",
    rate: 1.08,
    pitch: 1.15,
    prefer: ["Samantha", "Google US English", "Microsoft Aria"],
    direction: "Fast, bright, leans forward. Interrupts because she is already three steps ahead.",
  },
  dev: {
    elevenVoiceId: "Dey7SsJGQxe5rLi7TlDb",
    rate: 1.0,
    pitch: 0.95,
    prefer: ["Rishi", "Google UK English Male", "Microsoft Ryan"],
    direction: "Even and practical. Asks the question a person who has built it would ask.",
  },
  lily: {
    elevenVoiceId: "IMk6UKhh3TUTWOy0lm5b",
    rate: 0.98,
    pitch: 1.1,
    prefer: ["Karen", "Google US English", "Microsoft Michelle"],
    direction: "Warm, but the warmth is not agreement. Notices who you thanked.",
  },
  viktor: {
    elevenVoiceId: "LAGBxLXnb0Y6n64yiOWj",
    rate: 0.88,
    pitch: 0.75,
    prefer: ["Alex", "Google UK English Male", "Microsoft Davis"],
    direction: "Quiet, flat, unhurried. Describes how this dies the way a doctor reads a chart.",
  },
  chair: {
    elevenVoiceId: "VgQ3etxCiFKtKJpfkhX9",
    rate: 1.0,
    pitch: 1.0,
    prefer: ["Daniel", "Google US English"],
    direction: "Neutral host. Frames the round, keeps time, never takes a side.",
  },
  narrator: {
    /*
     * The narrator had no entry at all, so `voiceOf("narrator")` fell through
     * to the Chair — which is why the framing line before a pitch and the
     * Chair's line inside the room were the same voice saying different jobs.
     * Sam: raspier, drier, unmistakably not the Chair.
     */
    elevenVoiceId: "yoZ06aMxZJJ28mfd3POQ",
    rate: 0.97,
    pitch: 0.9,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Guy"],
    direction: "Dry, close-mic'd. Sets the scene and gets out of the way.",
  },
};

export const voiceOf = (id: string): VoiceProfile => VOICES[id as VoiceKey] ?? VOICES.chair;
