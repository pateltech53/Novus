import { NextResponse, type NextRequest } from "next/server";

import {
  AI_LIMITS,
  DEEPGRAM_API_KEY,
  DEEPGRAM_MODEL,
  NOT_CONFIGURED,
  timeoutSignal,
} from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import type { TranscriptWord } from "@/lib/ai/types";

/**
 * POST /api/stt — what the player actually said. Deepgram behind a route handler.
 *
 * The other end of the URL `lib/ai/transcribe.ts` has always posted to. Shapes
 * are its, unchanged:
 *
 *   in   multipart/form-data · audio (webm) + durationSeconds
 *   out  { text, words: [{ w, start, end, filler }] }
 *
 * ── The privacy claim this route has to keep ───────────────────────────────
 *
 * `transcribe.ts` states precisely what leaves the device, and the UI repeats
 * it: video never does, and audio does in exactly one case — this endpoint
 * being configured — "for transcription only, and is not stored by this app."
 *
 * So: the bytes are read from the request, forwarded, and dropped. Nothing is
 * written to disk, to Supabase, or to a log. The transcript is returned and not
 * kept either. The one thing this file cannot promise on the operator's behalf
 * is what Deepgram does with it — that is the account's own data-retention
 * setting, and docs/AI-SETUP.md says to turn it off before pointing this at
 * children rather than pretending the question does not exist.
 *
 * Failure returns null-ish (a non-2xx) and the player keeps whatever the live
 * browser transcriber caught, or types. Losing a pitch to a transport error
 * would cost one of three daily cold calls, which is not an acceptable price
 * for a better transcript.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stt — "is there a key behind you?", asked before any audio is sent.
 *
 * This exists for one reason. The client now defaults to calling this route, so
 * without a way to ask first, a deploy with no Deepgram key would receive one
 * recording per session before it could answer 501 — the body is already on the
 * wire by the time a handler runs. For a route that carries a child's voice,
 * "we uploaded it and then declined to use it" is not good enough, and it would
 * quietly break the promise transcribe.ts makes and the UI repeats: audio leaves
 * the device only when a server endpoint is configured.
 *
 * So the client asks, caches the answer for the session, and sends nothing at
 * all when the answer is no. One tiny GET, once, in exchange for the claim
 * staying exactly true.
 */
export function GET() {
  return NextResponse.json(
    { configured: Boolean(DEEPGRAM_API_KEY) },
    // The answer changes only on redeploy, and a stale "yes" costs one wasted
    // upload while a stale "no" costs a session of transcription. Not cached.
    { headers: { "cache-control": "no-store" } },
  );
}

/** Two minutes of Opus is well under a megabyte; ten is the abuse ceiling, not
 *  the expected size. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Same list `synthWords` uses in transcribe.ts, so a word is a filler by the
 *  same rule whether the timings came from Deepgram or were synthesised. The
 *  figure it feeds is reported to the player and never scored (Brand Law 5).
 *  The sound-shaped entries cover everything Deepgram's filler_words feature
 *  can emit — um, uh, ah/aah, hmm, mhmm, mm-mm, uh-uh, uh-huh, nuh-uh — as the
 *  regex runs on the word stripped of punctuation ("uh-huh" arrives as
 *  "uhhuh"). Missing "aah" here meant a hesitation Deepgram faithfully kept
 *  was displayed as an ordinary word and never counted. */
const FILLER =
  /^(um+|uh+|er+|erm+|a+h+|hm+|m+hm+|mm+|uh+huh|uhuh|nuhuh|like|basically|literally|actually|honestly)$/i;

export async function POST(req: NextRequest) {
  if (!DEEPGRAM_API_KEY) {
    return NextResponse.json(NOT_CONFIGURED, { status: 501 });
  }

  // Reject an over-large upload from its declared size BEFORE reading the body.
  // req.formData() buffers the whole request into memory first, so the size
  // check below (which bounds what is forwarded to Deepgram) does nothing to
  // bound what this server itself swallows — on a self-hosted Node deploy with
  // no platform body cap, a few concurrent multi-hundred-MB posts would exhaust
  // memory before any limit ran. Content-Length is advisory but it stops the
  // honest-header case cheaply; the parse below is still the real gate.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large." }, { status: 413 });
  }

  const limited = await claimAiCall(req, "stt", {
    perIp: AI_LIMITS.sttPerIp,
    perDay: AI_LIMITS.sttPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Transcription budget spent." }, { status: 429 });
  }

  const durationSeconds = Number(form.get("durationSeconds")) || 0;

  const query = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    smart_format: "true",
    punctuate: "true",
    // Kept rather than stripped: the coach reports a filler count, and a
    // transcript that has quietly deleted the "um"s cannot produce one.
    filler_words: "true",
  });

  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "content-type": audio.type || "audio/webm",
      },
      body: await audio.arrayBuffer(),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      const status = res.status === 401 || res.status === 429 ? res.status : 502;
      return NextResponse.json({ error: "Transcription unavailable." }, { status });
    }

    const raw = (await res.json()) as DeepgramResponse;
    const best = raw.results?.channels?.[0]?.alternatives?.[0];
    const text = best?.transcript?.trim() ?? "";

    // Silence is a successful transcription of nothing, not an error — and the
    // client reads an empty `text` as "fall back to what I captured live".
    if (!text) return NextResponse.json({ text: "", words: [], durationSeconds });

    return NextResponse.json({
      text,
      durationSeconds,
      words: mapWords(best?.words ?? []),
    });
  } catch {
    return NextResponse.json({ error: "Transcription unavailable." }, { status: 502 });
  }
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
}

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: { transcript?: string; words?: DeepgramWord[] }[];
    }[];
  };
}

/**
 * Deepgram's word list to ours.
 *
 * `punctuated_word` is what gets displayed, but the filler test runs on the
 * bare `word` — "Um," with smart formatting applied still has to count as a
 * filler, and it would not if the comma reached the regex.
 */
function mapWords(words: DeepgramWord[]): TranscriptWord[] {
  return words
    .filter((w) => typeof w.word === "string" || typeof w.punctuated_word === "string")
    .map((w) => ({
      w: w.punctuated_word ?? w.word ?? "",
      start: Number((w.start ?? 0).toFixed(2)),
      end: Number((w.end ?? 0).toFixed(2)),
      filler: FILLER.test((w.word ?? "").replace(/[^a-z]/gi, "")),
    }));
}
