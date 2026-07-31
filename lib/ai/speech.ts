import { voiceOf } from "./voices";
import type { SharkId } from "./types";

/**
 * Voice output, per character.
 *
 * The signature is the one the live tier will use, so wiring ElevenLabs later
 * is a config change rather than a refactor:
 *
 *   speak(text, "marcus")   →  tries marcus's cloud voice
 *                           →  falls back to a shaped browser voice
 *                           →  falls back to silence, never to an error
 *
 * `lib/ai/voices.ts` holds the per-shark table. Fill in `elevenVoiceId` there
 * and this file starts using it with no other change. Until then every shark
 * still sounds DIFFERENT from every other shark, because the local synth is
 * shaped per character rather than "male voice / female voice".
 *
 * Audio is always an enhancement. The panel is fully playable and fully legible
 * muted, and every spoken line is also on screen.
 */

export type Speaker = SharkId | "chair" | "narrator";

/** Set once the hosted tier is live. Route handler, never a client-side key. */
const TTS_ENDPOINT = process.env.NEXT_PUBLIC_TTS_ENDPOINT ?? "";

let cachedVoices: SpeechSynthesisVoice[] = [];
let current: HTMLAudioElement | null = null;
/** Flips to true after the first cloud failure so we stop hammering a dead route. */
let cloudDown = false;

function voices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  if (cachedVoices.length === 0) cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The hosted voice. Returns false if it is not configured, not reachable, or
 * out of quota — every one of which is a normal state, not a failure to report.
 */
async function speakCloud(text: string, speaker: Speaker): Promise<boolean> {
  const profile = voiceOf(speaker);
  if (!TTS_ENDPOINT || !profile.elevenVoiceId || cloudDown) return false;
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voiceId: profile.elevenVoiceId, speaker }),
    });
    if (!res.ok) {
      // 429 means the day's cap is spent; that is a budget decision working as
      // designed, so drop to the local voice for the rest of the session.
      if (res.status === 429 || res.status === 402) cloudDown = true;
      return false;
    }
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    current = audio;
    await audio.play();
    await new Promise<void>((r) => {
      audio.onended = () => r();
      audio.onerror = () => r();
    });
    return true;
  } catch {
    cloudDown = true;
    return false;
  }
}

/** The local voice, shaped per character. */
function speakLocal(text: string, speaker: Speaker): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return resolve();
    const profile = voiceOf(speaker);
    const utterance = new SpeechSynthesisUtterance(text);
    const list = voices();
    // Walk the preference list in order so each shark lands on a different
    // device voice where one exists — five sharks that all sound identical is
    // worse than no voice at all.
    const preferred =
      profile.prefer.map((n) => list.find((v) => v.name.toLowerCase().includes(n.toLowerCase()))).find(Boolean) ??
      list.find((v) => /en[-_]/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

/** Speak a line as a specific character. Resolves when the line finishes. */
export async function speak(text: string, speaker: Speaker = "chair"): Promise<void> {
  if (!text) return;
  // Someone who asked for less motion did not ask to be talked at either.
  if (reducedMotion()) return;
  stopSpeaking();
  if (await speakCloud(text, speaker)) return;
  await speakLocal(text, speaker);
}

/** Barge-in: the player starting to talk cuts the shark off immediately. */
export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  if (current) {
    current.pause();
    current = null;
  }
}
