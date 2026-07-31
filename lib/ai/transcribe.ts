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

const STT_ENDPOINT = process.env.NEXT_PUBLIC_STT_ENDPOINT;

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
  if (!STT_ENDPOINT || !audio) return null;
  try {
    const body = new FormData();
    body.append("audio", audio, "pitch.webm");
    body.append("durationSeconds", String(durationSeconds));
    const res = await fetch(STT_ENDPOINT, { method: "POST", body });
    if (!res.ok) return null;
    const raw = (await res.json()) as { text?: string; words?: TranscriptWord[] };
    if (!raw.text) return null;
    return {
      text: raw.text,
      durationSeconds,
      words: raw.words ?? synthWords(raw.text, durationSeconds),
    };
  } catch {
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
  const FILLER = /^(um+|uh+|er+|erm+|like|basically|literally|actually|honestly)$/i;
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
