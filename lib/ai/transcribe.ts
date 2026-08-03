import { apiUrl } from "@/lib/native/origin";
import { reportFallback, reportLive } from "./report";
import type { PitchTranscript, TranscriptWord } from "./types";

/**
 * SPEECH TO TEXT — turning what the player said into something readable.
 *
 * Three paths, in preference order, because this has to work on a school
 * Chromebook and in Safari and offline:
 *
 *   1. A real STT endpoint (`NEXT_PUBLIC_STT_ENDPOINT`) fed the recorded audio.
 *      Most accurate, and the one that will be there once the API lands.
 *   2. The browser's own `SpeechRecognition`, live, while they talk. Free, no
 *      network round trip, and good enough to score content on. Chrome and Safari
 *      have it behind a prefix; Firefox does not have it at all.
 *   3. Nothing — and the UI offers a text box instead. A player who cannot be
 *      transcribed must never be scored worse than one who can, so typing is a
 *      first-class route rather than an accessibility afterthought.
 *
 * ── Privacy — stated precisely, because the UI repeats it ──────────────────
 *
 * Nothing here writes audio to storage, and `LiveTranscriber` holds only text.
 * But the three paths differ, and the on-screen promise must not blur them:
 *
 *   · VIDEO never leaves the device, full stop. (The delivery coach analyses
 *     frames in memory and keeps only means and variances.)
 *   · AUDIO leaves the device in exactly one case: a server STT endpoint is
 *     configured, and then the recording is sent there for transcription only
 *     and is not stored by this app. With no endpoint, recognition runs
 *     through the browser (which may use its vendor's speech service) or not
 *     at all.
 *
 * Any screen that says "never leaves this device" must be talking about video,
 * or it is overclaiming. Permission is asked at the moment of use, never up
 * front.
 *
 * ── What the transcript is FOR ─────────────────────────────────────────────
 *
 * Content. What you said, so it can be judged on substance and checked against
 * your own books. Word timings are preserved because the coach panel reports
 * delivery figures — but per Brand Law 5 those are reported, never scored. See
 * `pitch-content.ts` for where that line is drawn structurally.
 */

/**
 * Defaults to this app's own `/api/stt`. It used to default to undefined, so a
 * deploy that set DEEPGRAM_API_KEY got nothing: no file read that name, and
 * this constant stayed empty, so `transcribeAudio` returned before it looked.
 * Set NEXT_PUBLIC_STT_ENDPOINT only to send audio somewhere other than here.
 *
 * The privacy note above is unchanged and still exact: audio leaves the device
 * only when there is an endpoint AND that endpoint has a key behind it. With no
 * key the route answers 501, `sttDownUntil` latches, and nothing is sent for
 * the rest of the session.
 */
const STT_ENDPOINT = process.env.NEXT_PUBLIC_STT_ENDPOINT || "/api/stt";

/**
 * Until when the endpoint is considered down, epoch ms. Refusals that cannot
 * heal mid-session — no key (501), a bad one (401), nothing deployed (404) —
 * latch for the session (Infinity), so a broken deploy does not receive a
 * fresh recording on every pitch. A spent budget (429) is different: budgets
 * are windowed and refill, and on a phone one burst must not silence
 * transcription for the rest of the sitting. It backs off instead.
 */
let sttDownUntil = 0;

/** How long a 429 backs off before the next pitch may try the server again. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Whether the endpoint has a key behind it — asked BEFORE any audio is sent,
 * and remembered for the session.
 *
 * Without this, defaulting `STT_ENDPOINT` to our own route would mean an
 * unconfigured deploy received one recording per session: a 501 can only be
 * returned after the request body is already on the wire. The claim this file
 * makes, and the UI repeats, is that audio leaves the device only when a server
 * endpoint is configured — so it is asked first and the recording stays here
 * when the answer is no.
 *
 * Only for our own route. An operator who set NEXT_PUBLIC_STT_ENDPOINT to
 * something else chose that endpoint deliberately and it need not implement a
 * GET, so that path posts directly, exactly as it always did.
 */
let sttReady: Promise<boolean> | null = null;

function sttConfigured(url: string): Promise<boolean> {
  if (!STT_ENDPOINT.startsWith("/")) return Promise.resolve(true);
  sttReady ??= fetch(url, { method: "GET" })
    .then((res) => {
      // Only a definitive answer is worth remembering. A non-2xx here is the
      // origin having a moment, not the deploy's configuration.
      if (!res.ok) {
        sttReady = null;
        return false;
      }
      return res
        .json()
        .then((body: { configured?: boolean }) => body.configured === true);
    })
    // A probe that fails is not permission to upload anyway — but it is also
    // not the deploy's answer, so it is forgotten rather than cached. One
    // dropped request on a phone network used to read "no key" and silence
    // server transcription for the rest of the session.
    .catch(() => {
      sttReady = null;
      return false;
    });
  return sttReady;
}

// The DOM lib does not ship types for this yet; it is still prefixed in Safari.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export const liveTranscriptionAvailable = () => recognitionCtor() !== null;

/**
 * Live, interim-updating transcription for the duration of a pitch.
 *
 * Deliberately forgiving: a recognition error mid-sentence does not throw away
 * what was already captured, and `stop()` always returns whatever it has. Losing
 * a pitch to a network blip would cost the player one of three daily cold calls,
 * which is unacceptable for a transport failure.
 */
export class LiveTranscriber {
  private rec: SpeechRecognitionLike | null = null;
  private finalText = "";
  private interim = "";
  private startedAt = 0;
  private onUpdate?: (text: string, interim: string) => void;

  constructor(onUpdate?: (text: string, interim: string) => void) {
    this.onUpdate = onUpdate;
  }

  start(lang = "en-US"): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    try {
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (e: unknown) => {
        const ev = e as { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const res = ev.results[i];
          const chunk = res[0]?.transcript ?? "";
          if (res.isFinal) this.finalText += (this.finalText ? " " : "") + chunk.trim();
          else interim += chunk;
        }
        this.interim = interim.trim();
        this.onUpdate?.(this.finalText, this.interim);
      };

      // "no-speech" and "aborted" are normal endings, not failures. Keeping the
      // captured text is the whole point of not treating them as errors.
      rec.onerror = () => {};
      // Chrome stops on its own after a pause even with continuous:true.
      rec.onend = () => {
        if (this.rec) {
          try {
            rec.start();
          } catch {
            /* already restarting, or the pitch is over */
          }
        }
      };

      rec.start();
      this.rec = rec;
      this.startedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /** Everything captured so far, interim included. */
  text(): string {
    return [this.finalText, this.interim].filter(Boolean).join(" ").trim();
  }

  stop(): { text: string; seconds: number } {
    const rec = this.rec;
    this.rec = null; // stops onend from restarting it
    try {
      rec?.stop();
    } catch {
      /* nothing to stop */
    }
    return {
      text: this.text(),
      seconds: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
    };
  }
}

/**
 * Server transcription of a finished recording.
 *
 * Returns null rather than throwing when there is no endpoint or the call fails,
 * so callers can fall back to whatever the live transcriber captured.
 */
export async function transcribeAudio(
  audio: Blob | null,
  durationSeconds: number,
): Promise<PitchTranscript | null> {
  if (!STT_ENDPOINT || !audio || Date.now() < sttDownUntil) return null;
  try {
    const url = STT_ENDPOINT.startsWith("/") ? apiUrl(STT_ENDPOINT) : STT_ENDPOINT;
    // Asked before the recording is packed, let alone sent.
    if (!(await sttConfigured(url))) {
      // The probe answered "no key". Reported as 501 because that is what the
      // route would have said had we posted the audio — which is the whole
      // point of the probe: we did not.
      reportFallback("transcription", 501);
      return null;
    }

    const body = new FormData();
    body.append("audio", audio, "pitch.webm");
    body.append("durationSeconds", String(durationSeconds));
    const res = await fetch(url, { method: "POST", body });
    if (!res.ok) {
      // No key (501), a bad one (401), nothing deployed (404) — none of those
      // change before the session ends. A spent budget (429) refills, so it
      // backs off rather than latching.
      if ([501, 401, 404].includes(res.status)) sttDownUntil = Infinity;
      else if (res.status === 429) sttDownUntil = Date.now() + RETRY_AFTER_MS;
      reportFallback("transcription", res.status);
      return null;
    }
    reportLive("transcription");
    const raw = (await res.json()) as { text?: string; words?: TranscriptWord[] };
    if (!raw.text) return null;
    return {
      text: raw.text,
      durationSeconds,
      words: raw.words ?? synthWords(raw.text, durationSeconds),
    };
  } catch {
    reportFallback("transcription", 0);
    return null;
  }
}

/**
 * Word timings for a transcript that arrived without them.
 *
 * Evenly spaced, and that is a real limitation rather than a hidden one: these
 * timings are only ever used for the coach's words-per-minute figure, which is
 * reported and not scored. Nothing that affects the score reads them, so an
 * approximation here cannot move a grade.
 */
export function synthWords(text: string, durationSeconds: number): TranscriptWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const per = (durationSeconds || parts.length / 2.5) / parts.length;
  // Kept identical to the list in app/api/stt/route.ts — a word must be a
  // filler by the same rule whichever path produced it. The sound-shaped
  // entries (ah/aah, hmm, mhmm, uh-huh…) match with punctuation stripped.
  const FILLER =
    /^(um+|uh+|er+|erm+|a+h+|hm+|m+hm+|mm+|uh+huh|uhuh|nuhuh|like|basically|literally|actually|honestly)$/i;
  return parts.map((w, i) => ({
    w,
    start: Number((i * per).toFixed(2)),
    end: Number(((i + 1) * per).toFixed(2)),
    filler: FILLER.test(w.replace(/[^a-z]/gi, "")),
  }));
}

/**
 * The single entry point a pitch screen should call.
 *
 * Prefers the server transcript, falls back to whatever was captured live, and
 * finally to typed text. Returns null only when the player said and typed
 * nothing at all.
 */
export async function resolveTranscript(opts: {
  audio: Blob | null;
  liveText: string;
  typedText?: string;
  durationSeconds: number;
}): Promise<PitchTranscript | null> {
  const server = await transcribeAudio(opts.audio, opts.durationSeconds);
  if (server && server.text.trim()) return server;

  const text = (opts.liveText || opts.typedText || "").trim();
  if (!text) return null;
  return {
    text,
    durationSeconds: opts.durationSeconds,
    words: synthWords(text, opts.durationSeconds),
  };
}
