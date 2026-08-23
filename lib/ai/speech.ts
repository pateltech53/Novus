import { apiUrl } from "@/lib/native/origin";
import { reportFallback, reportLive } from "./report";
import { voiceOf, type VoiceKey } from "./voices";

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

/**
 * Anyone this app can put a voice to.
 *
 * Was `SharkId | "chair" | "narrator"`, written out — which made it the third
 * independent list of who may speak, beside the VOICES table and the TTS
 * route's own literal. It is `VoiceKey` now, so casting a new character means
 * adding a profile to lib/ai/voices.ts and nothing else.
 */
export type Speaker = VoiceKey;

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
/** Flips to true after a SETTLED failure — no key, wrong key, spent budget.
 *  A transient one uses `cloudRetryAt` instead; see speakCloud. */
let cloudDown = false;
/** When a transient failure may be retried. One blip must not cost a session. */
let cloudRetryAt = 0;
const RETRY_AFTER_MS = 20_000;

/**
 * ONE audio element, primed by a real tap, reused for every line.
 *
 * ── The iOS Safari bug this exists for ──────────────────────────────────────
 *
 * Every line was `new Audio(objectUrl)` then `.play()`. On a desktop browser
 * that is fine. On iOS Safari it is refused: audio may only start from a user
 * gesture, and by the time a line is ready we are several awaits past the tap
 * that asked for it — the round trip to ElevenLabs is by itself long enough to
 * lose the gesture. `play()` rejects with NotAllowedError, speakCloud reports
 * failure, and the browser's synthesiser answers instead.
 *
 * The symptom on an iPhone was: keys configured, credits being spent, and the
 * robot voice still talking. The cloud voice was working perfectly and being
 * thrown away at the last step.
 *
 * The fix is the standard one. An element played once inside a gesture stays
 * playable programmatically for the life of the page, so `unlockSpeech()` plays
 * a few milliseconds of silence on the first tap and every line after that
 * swaps this element's `src`. Desktop browsers do not need it and are unharmed.
 */
let player: HTMLAudioElement | null = null;
/** True only once silence has ACTUALLY played. A rejected attempt is retried on
 *  the next gesture rather than assumed to have worked. */
let unlocked = false;
/**
 * The one element used when no gesture ever unlocked one (the desktop case).
 * A MODULE element, not `new Audio()` per line: with a fresh element per line,
 * `current` only tracked the newest, stopSpeaking() could not reach an older
 * one still playing, and two overlapping copies of near-identical speech is
 * the comb-filtered mess players heard as crackle.
 */
let fallbackPlayer: HTMLAudioElement | null = null;
/**
 * Settles the in-flight line's completion promise. stopSpeaking() calls it so
 * an interrupted line's `finally` actually runs — before this, a barge-in left
 * the old promise pending forever, its object URL unrevoked (real memory on a
 * phone also running a camera) and `setSpeaking` stuck.
 */
let settleCurrent: (() => void) | null = null;

/** 32 samples of 8 kHz silence. Inline so the unlock never waits on a fetch. */
const SILENCE =
  "data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

/**
 * Call from a real user gesture. Cheap, silent, and a no-op once it has worked.
 * Wired to pointerdown, touchend and click in components/ui/Sound.tsx, because
 * WebKit is particular about which of those counts.
 */
export function unlockSpeech(): void {
  if (unlocked || typeof document === "undefined") return;
  if (!player) {
    const el = document.createElement("audio");
    // Without this an iPhone takes any playback fullscreen, over the game.
    el.setAttribute("playsinline", "");
    el.preload = "auto";
    el.src = SILENCE;
    player = el;
  }
  const el = player;
  void el.play().then(
    () => {
      unlocked = true;
      el.pause();
      el.currentTime = 0;
    },
    () => {
      /* wrong kind of gesture for this browser; the next one tries again */
    },
  );
}

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
  // A transient failure cools off rather than ending the session's voice.
  if (cloudRetryAt && Date.now() < cloudRetryAt) return false;
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
      // A 502 from a provider blip is a bad moment, not a bad deploy.
      else cloudRetryAt = Date.now() + RETRY_AFTER_MS;
      reportFallback("voice", res.status);
      return false;
    }
    reportLive("voice");
    cloudRetryAt = 0;
    const blob = await res.blob();
    // The unlocked element when there is one — see above; the shared fallback
    // element where no gesture ever reached us, which is the desktop case. One
    // element either way, so a new line always displaces the old one instead
    // of playing over it.
    const audio = unlocked && player ? player : (fallbackPlayer ??= new Audio());
    const url = URL.createObjectURL(blob);
    audio.src = url;
    current = audio;
    try {
      await audio.play();
      await new Promise<void>((r) => {
        settleCurrent = r;
        audio.onended = () => r();
        audio.onerror = () => r();
      });
    } finally {
      settleCurrent = null;
      // One line is ~100 kB; twenty-three leaked across a panel is real memory
      // on a phone that is also running a camera.
      URL.revokeObjectURL(url);
    }
    return true;
  } catch {
    /*
     * A network failure, or audio that would not play. Transient by nature, so
     * this cools off instead of latching: the old `cloudDown = true` here meant
     * one tunnel, one wifi handover or one slow cold start switched the sharks
     * to a synthesiser mid-panel and kept them there for the rest of the
     * session. A blip should cost one line, not twenty-three.
     */
    cloudRetryAt = Date.now() + RETRY_AFTER_MS;
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

/*
 * Whether a line is being spoken right now, and who can hear about it.
 *
 * The UI needs this for one reason: a shark talking over the player is the
 * single most broken-feeling thing in the room, and the fix has two halves —
 * the player must be able to CUT the voice off (a SKIP they can see), and the
 * voice must cut ITSELF off when they start answering. Both need to know
 * whether anything is speaking, and React cannot see a module-level variable.
 */
let speaking = false;
const speakingListeners = new Set<(v: boolean) => void>();

function setSpeaking(next: boolean): void {
  if (speaking === next) return;
  speaking = next;
  for (const listener of speakingListeners) listener(next);
}

export const isSpeaking = (): boolean => speaking;

/** Subscribe to speaking changes. Returns the unsubscribe. */
export function onSpeakingChange(fn: (v: boolean) => void): () => void {
  speakingListeners.add(fn);
  return () => speakingListeners.delete(fn);
}

/** Speak a line as a specific character. Resolves when the line finishes. */
export async function speak(text: string, speaker: Speaker = "chair"): Promise<void> {
  if (!text) return;
  // Someone who asked for less motion did not ask to be talked at either.
  if (reducedMotion()) return;
  stopSpeaking();
  setSpeaking(true);
  try {
    if (await speakCloud(text, speaker)) return;
    await speakLocal(text, speaker);
  } finally {
    setSpeaking(false);
  }
}

/**
 * A relative endpoint has to become absolute in the shipped app, which is a
 * static bundle with no server of its own. Same rule the auth, sync and billing
 * calls already follow — see lib/native/origin.ts.
 */
function endpointUrl(endpoint: string): string {
  return endpoint.startsWith("/") ? apiUrl(endpoint) : endpoint;
}

/**
 * Barge-in: the player starting to talk cuts the shark off immediately.
 *
 * Also what SKIP calls, and what the answer turn calls the moment a microphone
 * opens. A shark still finishing their question while the player is already
 * answering it is both of them talking into the same silence — and on a phone
 * the shark wins, because they are louder than the person holding it.
 */
export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  if (current) {
    current.pause();
    // A paused element still holding its src is a line waiting to resume;
    // clear it so nothing can pick the old audio back up.
    current.removeAttribute("src");
    current = null;
  }
  // Settle the interrupted line's promise so its `finally` runs — the URL is
  // revoked, the speaking flag drops, and the caller's await returns.
  settleCurrent?.();
  settleCurrent = null;
  setSpeaking(false);
}
