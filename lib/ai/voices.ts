import type { SharkId } from "./types";

/**
 * One voice per shark, plus the Chair.
 *
 * Written so that swapping `speechSynthesis` for ElevenLabs is a config change,
 * not a refactor: every shark already has a stable `voiceId` slot, and the
 * browser-voice fields below are only the FALLBACK the app uses until that id
 * resolves to a real cloud voice.
 *
 * Fill `elevenVoiceId` when the account exists. Nothing else has to change —
 * `lib/ai/speech.ts` reads this table, tries the cloud voice, and falls back to
 * the local synth on any failure or quota exhaustion. A missing id is not an
 * error; it just means "still on the local voice".
 */

export interface VoiceProfile {
  /** ElevenLabs voice id. Empty until the account is provisioned. */
  elevenVoiceId: string;
  /** Local speechSynthesis fallback shaping. */
  rate: number;
  pitch: number;
  /** Preferred local voice names, in order; first match on the device wins. */
  prefer: string[];
  /** How they sound, in words — the brief a voice actor would get. */
  direction: string;
}

export const VOICES: Record<SharkId | "chair", VoiceProfile> = {
  marcus: {
    elevenVoiceId: "",
    rate: 0.94,
    pitch: 0.82,
    prefer: ["Daniel", "Google UK English Male", "Microsoft Guy"],
    direction: "Low, unhurried, never raises it. The pause before the number is the threat.",
  },
  serena: {
    elevenVoiceId: "",
    rate: 1.08,
    pitch: 1.15,
    prefer: ["Samantha", "Google US English", "Microsoft Aria"],
    direction: "Fast, bright, leans forward. Interrupts because she is already three steps ahead.",
  },
  dev: {
    elevenVoiceId: "",
    rate: 1.0,
    pitch: 0.95,
    prefer: ["Rishi", "Google UK English Male", "Microsoft Ryan"],
    direction: "Even and practical. Asks the question a person who has built it would ask.",
  },
  lily: {
    elevenVoiceId: "",
    rate: 0.98,
    pitch: 1.1,
    prefer: ["Karen", "Google US English", "Microsoft Michelle"],
    direction: "Warm, but the warmth is not agreement. Notices who you thanked.",
  },
  viktor: {
    elevenVoiceId: "",
    rate: 0.88,
    pitch: 0.75,
    prefer: ["Alex", "Google UK English Male", "Microsoft Davis"],
    direction: "Quiet, flat, unhurried. Describes how this dies the way a doctor reads a chart.",
  },
  chair: {
    elevenVoiceId: "",
    rate: 1.0,
    pitch: 1.0,
    prefer: ["Daniel", "Google US English"],
    direction: "Neutral host. Frames the round, keeps time, never takes a side.",
  },
};

export const voiceOf = (id: string): VoiceProfile => VOICES[id as SharkId] ?? VOICES.chair;
