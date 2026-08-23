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
  /**
   * How fast this character talks, as an ElevenLabs `voice_settings.speed`.
   *
   * 1.0 is the model's own pace, which plays slower than television. The Tank
   * is a room of people interrupting each other, and at 1.0 the gaps read as
   * buffering rather than as menace. Marcus was the worst of it: his direction
   * is "unhurried", so the character the player waits on longest was also the
   * slowest to say anything. ElevenLabs accepts 0.7–1.2, but its CLEAN range
   * tops out around 1.1 — above that the turbo model adds audible artefacts,
   * which players reported as crackle on the dense instruction lines. So these
   * sit at the quick end of natural, capped at 1.1, and keep the characters'
   * pace RELATIVE to each other, which is what makes them sound like
   * different people.
   */
  speed: number;
  /** Local speechSynthesis fallback shaping. */
  rate: number;
  pitch: number;
  /** Preferred local voice names, in order; first match on the device wins. */
  prefer: string[];
  /** How they sound, in words — the brief a voice actor would get. */
  direction: string;
}

/**
 * The Room's cast — the people on the other end of a cold call.
 *
 * ── Why they are not the sharks ────────────────────────────────────────────
 *
 * The obvious shortcut was to point the twenty callers at the seven voices
 * above, and it is the wrong answer for one reason: the Tank is five specific
 * people the player learns to recognise, and a stranger who picks up an
 * unknown number sounding exactly like Marcus is not a stranger. Half the
 * lesson in a cold call is that this person owes you nothing and you have
 * never met them. A familiar voice takes that away before the first sentence.
 *
 * ── Why eight, and why these eight ids ─────────────────────────────────────
 *
 * These are the premade voices every ElevenLabs account is created with — the
 * same list `app/api/tts/route.ts` already falls back to — so they need no
 * setup, no cloning and no per-deploy configuration, and each is overridable
 * with `ELEVENLABS_VOICE_ROOM_*` like every other voice here. Eight rather
 * than twenty because twenty near-identical premades would be twenty voices a
 * player cannot tell apart, and because the directory is authored: each caller
 * is cast by hand in lib/ai/callers.ts rather than hashed onto a voice, for
 * the same reason the sea's swells are hand-placed.
 *
 * Named for the register they carry, never for the character — a caller can be
 * recast without renaming the voice.
 */
export type RoomVoiceKey =
  | "room_even"
  | "room_plain"
  | "room_deep"
  | "room_crisp"
  | "room_calm"
  | "room_bright"
  | "room_warm"
  | "room_soft";

export type VoiceKey = SharkId | "chair" | "narrator" | RoomVoiceKey;

export const VOICES: Record<VoiceKey, VoiceProfile> = {
  marcus: {
    elevenVoiceId: "xzZRXG86mSM3naOyL9fa",
    speed: 1.08,
    rate: 1.1,
    pitch: 0.82,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Guy"],
    direction: "Low, unhurried, never raises it. The pause before the number is the threat.",
  },
  serena: {
    elevenVoiceId: "2qfp6zPuviqeCOZIE9RZ",
    speed: 1.08,
    rate: 1.18,
    pitch: 1.15,
    prefer: ["Samantha", "Google US English", "Microsoft Aria"],
    direction: "Fast, bright, leans forward. Interrupts because she is already three steps ahead.",
  },
  dev: {
    elevenVoiceId: "Dey7SsJGQxe5rLi7TlDb",
    speed: 1.08,
    rate: 1.12,
    pitch: 0.95,
    prefer: ["Rishi", "Google UK English Male", "Microsoft Ryan"],
    direction: "Even and practical. Asks the question a person who has built it would ask.",
  },
  lily: {
    elevenVoiceId: "IMk6UKhh3TUTWOy0lm5b",
    speed: 1.1,
    rate: 1.1,
    pitch: 1.1,
    prefer: ["Karen", "Google US English", "Microsoft Michelle"],
    direction: "Warm, but the warmth is not agreement. Notices who you thanked.",
  },
  viktor: {
    elevenVoiceId: "LAGBxLXnb0Y6n64yiOWj",
    speed: 1.08,
    rate: 1.02,
    pitch: 0.75,
    prefer: ["Alex", "Google UK English Male", "Microsoft Davis"],
    direction: "Quiet, flat, unhurried. Describes how this dies the way a doctor reads a chart.",
  },
  chair: {
    elevenVoiceId: "VgQ3etxCiFKtKJpfkhX9",
    speed: 1.1,
    rate: 1.08,
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
    speed: 1.1,
    rate: 1.08,
    pitch: 0.9,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Guy"],
    direction: "Dry, close-mic'd. Sets the scene and gets out of the way.",
  },

  // ── The Room ─────────────────────────────────────────────────────────────
  // Slower than the Tank on purpose. The sharks talk over each other in a
  // studio; these are people who answered a phone, and the pace is the
  // difference between a panel and a call. Nothing here goes above 1.05.
  room_even: {
    elevenVoiceId: "ErXwobaYiN019PkySvjV",
    speed: 1.02,
    rate: 1.05,
    pitch: 0.98,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Ryan"],
    direction: "Level and unbothered. Has taken this call before and will take the next one.",
  },
  room_plain: {
    elevenVoiceId: "pNInz6obpgDQGcFmaJgB",
    speed: 1.0,
    rate: 1.0,
    pitch: 0.9,
    prefer: ["Alex", "Google UK English Male", "Microsoft Guy"],
    direction: "Plain, unhurried, no performance in it. Says the thing and waits.",
  },
  room_deep: {
    elevenVoiceId: "TxGEqnHWrfWFTfGW9XjX",
    speed: 0.98,
    rate: 0.98,
    pitch: 0.8,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Davis"],
    direction: "Deep and slow. The silence after the question is doing the work.",
  },
  room_crisp: {
    elevenVoiceId: "VR6AewLTigWG4xSOukaG",
    speed: 1.05,
    rate: 1.12,
    pitch: 0.88,
    prefer: ["Alex", "Google US English", "Microsoft Guy"],
    direction: "Clipped. Every sentence is a question with the pleasantries removed.",
  },
  room_calm: {
    elevenVoiceId: "21m00Tcm4TlvDq8ikWAM",
    speed: 1.0,
    rate: 1.02,
    pitch: 1.02,
    prefer: ["Samantha", "Google US English", "Microsoft Aria"],
    direction: "Calm and exact. Reads the number back to you before deciding.",
  },
  room_bright: {
    elevenVoiceId: "AZnzlk1XvdvUeBnXmlld",
    speed: 1.05,
    rate: 1.15,
    pitch: 1.12,
    prefer: ["Samantha", "Google US English", "Microsoft Michelle"],
    direction: "Quick and interested. Already picturing the version of this that works.",
  },
  room_warm: {
    elevenVoiceId: "EXAVITQu4vr4xnSDxMaL",
    speed: 1.02,
    rate: 1.05,
    pitch: 1.08,
    prefer: ["Karen", "Google US English", "Microsoft Michelle"],
    direction: "Warm and unhurried. Friendly is not the same as sold.",
  },
  room_soft: {
    elevenVoiceId: "MF3mGyEYCl7XYWbV9V6O",
    speed: 1.0,
    rate: 1.0,
    pitch: 1.05,
    prefer: ["Karen", "Google US English", "Microsoft Aria"],
    direction: "Soft, careful, slightly wary. Wants to be convinced and expects not to be.",
  },
};

export const voiceOf = (id: string): VoiceProfile => VOICES[id as VoiceKey] ?? VOICES.chair;
