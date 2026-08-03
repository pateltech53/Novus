import { apiUrl } from "@/lib/native/origin";
import { reportFallback, reportLive } from "./report";
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

/**
 * Route handler, never a client-side key.
 *
 * Defaults to this app's own `/api/tts` rather than to "". It used to default
 * to nothing, which meant a deploy could set ELEVENLABS_API_KEY and hear no
 * difference whatsoever — the key was read by nobody and this constant was
 * still empty, so `speakCloud` returned false before it ever looked. Pointing
 * at our own route by default is what makes adding the key sufficient. Set
 * NEXT_PUBLIC_TTS_ENDPOINT only to send voice somewhere other than here.
 */
const TTS_ENDPOINT = process.env.NEXT_PUBLIC_TTS_ENDPOINT || "/api/tts";

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
  if (!TTS_ENDPOINT || cloudDown) return false;
  try {
    const res = await fetch(endpointUrl(TTS_ENDPOINT), {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The id is sent when `voices.ts` names one and omitted when it does not.
      // An empty string here used to abort the call entirely, which meant the
      // cloud voice could never be reached without hand-editing that table
      // first; the route resolves an unnamed speaker against the account
      // instead, so casting is an improvement rather than a prerequisite.
      body: JSON.stringify({
        text,
        speaker,
        ...(profile.elevenVoiceId ? { voiceId: profile.elevenVoiceId } : {}),
      }),
    });
    if (!res.ok) {
      // 429 means the day's cap is spent; that is a budget decision working as
      // designed, so drop to the local voice for the rest of the session. 501
      // is the route saying there is no key, and 401/404 mean the key is wrong
      // or nothing is deployed — all three are settled for this session too, and
      // re-asking once per line would be a request per sentence forever.
      if ([429, 402, 501, 401, 404].includes(res.status)) cloudDown = true;
      reportFallback("voice", res.status);
      return false;
    }
    reportLive("voice");
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
    // No response at all, so no status to read. In the shipped app this is
    // normally CORS or a wrong NEXT_PUBLIC_API_ORIGIN, which is exactly the
    // failure a browser tab never reproduces.
    reportFallback("voice", 0);
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

/**
 * A relative endpoint has to become absolute in the shipped app, which is a
 * static bundle with no server of its own. Same rule the auth, sync and billing
 * calls already follow — see lib/native/origin.ts.
 */
function endpointUrl(endpoint: string): string {
  return endpoint.startsWith("/") ? apiUrl(endpoint) : endpoint;
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
