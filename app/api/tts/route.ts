import { NextResponse, type NextRequest } from "next/server";

import {
  AI_LIMITS,
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL,
  NOT_CONFIGURED,
  timeoutSignal,
} from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { VOICES } from "@/lib/ai/voices";

/*
 * The provider is allowed a minute (PROVIDER_TIMEOUT_MS); the platform was
 * allowed to decide otherwise, and did.
 *
 * No route under app/api declared `maxDuration`, so every one of them ran at a
 * serverless host's default — commonly 10 s. A route that waits up to 60 s for
 * a model, on a function that is killed at 10, does not time out gracefully:
 * it is terminated, the client sees a network error rather than a JSON body,
 * and the offline fallback fires for a provider that was working. The stated
 * timeouts in lib/ai/server were unreachable.
 *
 * 60 matches PROVIDER_TIMEOUT_MS so the two agree, and the AbortSignal on the
 * provider call stays the thing that actually ends a slow request.
 */
export const maxDuration = 60;


/**
 * POST /api/tts — the shark voices. ElevenLabs behind a route handler.
 *
 * This is the other end of the URL `lib/ai/speech.ts` has always POSTed to.
 * Request and response shapes are dictated by that file and were not changed:
 *
 *   in   { text, voiceId?, speaker }
 *   out  audio/mpeg  ·  the client wraps it in an <Audio> and plays it
 *
 * Any non-2xx sends the player to the browser's own speech synthesis, which is
 * a complete voice rather than a degraded one — every spoken line is also on
 * screen, so the worst case of this route being down is that the panel sounds
 * more ordinary. That is why nothing here retries: a second attempt costs a
 * second of a child's attention to buy a nicer timbre.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two hundred characters over the longest authored line. A cap and not a
 * truncation, because silently speaking half a sentence is worse than falling
 * back to a voice that speaks all of it.
 */
const MAX_CHARS = 800;

/** The order voices are handed out in when the account has not been mapped. */
const SPEAKERS = ["marcus", "serena", "dev", "lily", "viktor", "chair", "narrator"] as const;
type Speaker = (typeof SPEAKERS)[number];

/**
 * Every voice id a legitimate request could carry: the seven cast in
 * lib/ai/voices.ts, plus any the operator pinned through ELEVENLABS_VOICE_*.
 * A client-sent `voiceId` outside this set is ignored — see the POST handler.
 */
const ALLOWED_VOICE_IDS = new Set<string>(
  [
    ...Object.values(VOICES).map((v) => v.elevenVoiceId),
    ...SPEAKERS.map((s) => process.env[`ELEVENLABS_VOICE_${s.toUpperCase()}`]),
  ]
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0),
);

export async function POST(req: NextRequest) {
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json(NOT_CONFIGURED, { status: 501 });
  }

  let body: { text?: unknown; voiceId?: unknown; speaker?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: "Line too long." }, { status: 413 });
  }

  const speaker = SPEAKERS.includes(body.speaker as Speaker)
    ? (body.speaker as Speaker)
    : "chair";

  const limited = await claimAiCall(req, "tts", {
    perIp: AI_LIMITS.ttsPerIp,
    perDay: AI_LIMITS.ttsPerDay,
  });
  if (!limited.allowed) {
    // 429 is the one status `speech.ts` reads as "spent for this session" and
    // stops asking on. The daily cap and the per-caller cap both mean exactly
    // that from the player's side, so both send it.
    return NextResponse.json({ error: "Voice budget spent." }, { status: 429 });
  }

  /*
   * Casting order, and the order matters.
   *
   *   1. `ELEVENLABS_VOICE_<CHARACTER>` — the operator's own casting. It has to
   *      outrank everything, because whoever runs the deploy chose it
   *      deliberately and the client's default is only a default.
   *   2. The id the client sent, which now comes from `lib/ai/voices.ts` and is
   *      stable per character. This is what stopped the sharks swapping voices
   *      between serverless instances — see that file's header.
   *   3. Whatever the account actually has, assigned by seat.
   *   4. The premade library, when the account could not be read at all.
   *
   * Step 1 used to sit BELOW step 2 (`explicit ? … : resolveVoice(speaker)`),
   * which was harmless only while the client never sent an id. Now that it
   * always does, leaving it that way would have silently disabled every
   * ELEVENLABS_VOICE_* variable the moment this shipped.
   */
  const configured = process.env[VOICE_ENV[speaker]]?.trim();
  /*
   * The client's voice id is honoured ONLY if it is one this deploy would ever
   * legitimately use. Without this, `body.voiceId` was passed straight to
   * ElevenLabs, turning the route into an open, unauthenticated TTS relay: any
   * caller could synthesise arbitrary text in any voice on the operator's
   * account — a public-library voice, or a private cloned one if its id leaked
   * — and spend the account's character quota making impersonation audio.
   *
   * The only ids the real client ever sends are the seven cast in
   * lib/ai/voices.ts (and whatever the operator pinned via ELEVENLABS_VOICE_*).
   * Anything else is ignored and falls through to resolveVoice(speaker), exactly
   * as if no id had been sent.
   */
  const sent = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const explicit = sent && ALLOWED_VOICE_IDS.has(sent) ? sent : "";
  const cast = configured
    ? { voiceId: configured, alternates: [] as string[], status: 200 }
    : explicit
      ? // If the pinned default is absent from this account the synthesis call
        // 404s, and the rotation below is the recovery — so the alternates are
        // supplied here rather than leaving a wrong id with nowhere to go.
        { voiceId: explicit, alternates: premadeRotation(speaker), status: 200 }
      : await resolveVoice(speaker);
  if (!cast.voiceId) {
    // Reporting this as 502 would tell the client "transient", and it would
    // re-ask on every line for the rest of the session. Pass the real reason
    // through so it latches instead.
    const status = cast.status === 401 || cast.status === 429 ? cast.status : 502;
    return NextResponse.json({ error: "No voice available." }, { status });
  }

  try {
    // The first id is the intended one. The rest are only ever populated when
    // the account's own list could not be read and we are guessing from the
    // premade set, where a 404 means "not on this account, try the next" rather
    // than a failure. A configured or account-listed id has no alternates, so
    // this loop runs exactly once for a healthy deploy.
    const candidates = [cast.voiceId, ...cast.alternates];
    let last = 502;

    for (const voiceId of candidates) {
      /*
       * The format, and why it changed back up.
       *
       * This used to ask for `mp3_22050_32` with `optimize_streaming_latency=3`
       * to close the gap between a line appearing and the voice arriving. But
       * 32kbps mono is genuinely artefact-heavy — gritty, swirly, "crackly" on
       * sibilants and dense clause runs, which is exactly what the pitch
       * instructions are — and the latency flag bought nothing: this handler
       * buffers the WHOLE stream into an arrayBuffer below before answering,
       * and the client buffers the whole response into a blob before playing.
       * All of the quality was being spent on a first-byte win nobody received.
       * 64kbps at 44.1kHz is still small (~8KB/s), and the crackle is gone.
       *
       * `speed` comes from lib/ai/voices.ts rather than from the request, for
       * the same reason the voice id does: how a character speaks is casting,
       * and casting is decided here, not by whatever can reach the endpoint.
       */
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
          `?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            // Stability high enough that the same shark sounds like themselves
            // line to line, which is the whole reason for a per-character voice.
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed: VOICES[speaker].speed,
            },
          }),
          signal: timeoutSignal(),
        },
      );

      if (!res.ok) {
        // 401 is a wrong key, 429 is a spent quota. Both are permanent for this
        // session from the client's point of view, and both are already handled
        // there — pass the status through rather than flattening it to 502.
        last = res.status === 401 || res.status === 429 ? res.status : 502;
        noteVoiceError(await describeFailure(res));
        // Only a missing voice is worth another attempt; a rejected key would
        // be rejected identically nine more times.
        if (res.status === 404) continue;
        return NextResponse.json({ error: "Voice unavailable." }, { status: last });
      }

      const audio = await res.arrayBuffer();
      return new NextResponse(audio, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(audio.byteLength),
          // Identical lines recur constantly — stock shark lines, Chair framing,
          // the going-out line. Letting the CDN keep them is the single largest
          // saving available here and costs nothing: the same text in the same
          // voice is the same audio.
          "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
        },
      });
    }

    // Every candidate 404'd: the premade guesses are all absent from this
    // account. Nothing is wrong with the key, there is simply nothing to speak
    // with until ELEVENLABS_VOICE_* is set or the list becomes readable.
    return NextResponse.json({ error: "No voice available." }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "Voice unavailable." }, { status: 502 });
  }
}

/**
 * Which ElevenLabs voice speaks for which character.
 *
 * Four sources, in order:
 *
 *   1. `ELEVENLABS_VOICE_MARCUS` and friends — an explicit mapping, and the one
 *      a finished deploy should use, because casting is a creative decision and
 *      `lib/ai/voices.ts` already writes the direction each shark needs.
 *   2. Whatever the account actually has, assigned deterministically so each
 *      character keeps the same voice between requests and no two share one.
 *   3. The premade voices below, when step 2 could not be asked.
 *   4. Nothing, and the caller falls back to the browser voice.
 *
 * Step 2 exists so that adding the key is genuinely all it takes. Asking is
 * cheap — once per process, cached below.
 *
 * ── Why step 3 exists, having argued against it ────────────────────────────
 *
 * The first cut of this file stopped at step 2 and said so in a comment:
 * hardcoding ids from the public library is how this kind of thing breaks six
 * months later, because those ids are not guaranteed to be on a given account.
 * That reasoning is sound for a PRIMARY source and wrong for a last resort,
 * and shipping it cost a working deploy its voice.
 *
 * An ElevenLabs key carries granular permissions, and `voices_read` is a
 * separate one from text-to-speech. A key that can speak perfectly well but
 * may not list the account's voices gets a 401 at step 2 — and because step 2
 * was the only source, the whole feature fell to the browser voice with the
 * player hearing exactly what a missing key sounds like. Free-tier keys
 * flagged for unusual activity land in the same place.
 *
 * So: when the list cannot be READ, we still try to SPEAK. These are the
 * premade voices every account is created with; if one is genuinely absent the
 * synthesis call 404s and the next candidate is tried. The failure mode that
 * argument was protecting against costs one retry. The failure mode it caused
 * cost the entire feature.
 */
const PREMADE_VOICES = [
  "21m00Tcm4TlvDq8ikWAM", // Rachel
  "AZnzlk1XvdvUeBnXmlld", // Domi
  "EXAVITQu4vr4xnSDxMaL", // Bella
  "ErXwobaYiN019PkySvjV", // Antoni
  "MF3mGyEYCl7XYWbV9V6O", // Elli
  "TxGEqnHWrfWFTfGW9XjX", // Josh
  "VR6AewLTigWG4xSOukaG", // Arnold
  "pNInz6obpgDQGcFmaJgB", // Adam
  "yoZ06aMxZJJ28mfd3POQ", // Sam
] as const;

const VOICE_ENV: Record<Speaker, string> = {
  marcus: "ELEVENLABS_VOICE_MARCUS",
  serena: "ELEVENLABS_VOICE_SERENA",
  dev: "ELEVENLABS_VOICE_DEV",
  lily: "ELEVENLABS_VOICE_LILY",
  viktor: "ELEVENLABS_VOICE_VIKTOR",
  chair: "ELEVENLABS_VOICE_CHAIR",
  narrator: "ELEVENLABS_VOICE_NARRATOR",
};

let voicePool: string[] | null = null;
let voicePoolAt = 0;
/** An hour. The account's voice list changes when a person edits it, which is
 *  never during a session, so this is about surviving a cold start not freshness. */
const VOICE_TTL_MS = 60 * 60 * 1000;

/** What ElevenLabs last objected to, verbatim enough to act on. */
interface VoiceError {
  /** The HTTP status the provider returned. */
  http: number;
  /** The provider's own slug, when it sent one: `invalid_api_key`,
   *  `missing_permissions`, `detected_unusual_activity`, `quota_exceeded`. */
  status?: string;
  message?: string;
}

let lastVoiceError: VoiceError | null = null;
let voiceFailAt = 0;
/** A minute. Long enough not to re-ask per spoken line, short enough that a key
 *  fixed in the dashboard starts working without a redeploy. */
const VOICE_FAIL_TTL_MS = 60_000;

/** The voice for this part, plus why there wasn't one when there isn't. */
interface Cast {
  voiceId: string;
  /** Tried in order after voiceId, and only when it is a premade guess. */
  alternates: string[];
  /** The voice-list lookup's HTTP status. 401 means the key itself is wrong. */
  status: number;
}

async function resolveVoice(speaker: Speaker): Promise<Cast> {
  const configured = process.env[VOICE_ENV[speaker]]?.trim();
  if (configured) return { voiceId: configured, alternates: [], status: 200 };

  const seat = SPEAKERS.indexOf(speaker);
  const pool = await voices();
  if (pool.ids.length > 0) {
    // Fixed position per character, so marcus is the same voice every time and a
    // five-voice account still gives five different sharks five different voices.
    return {
      voiceId: pool.ids[seat % pool.ids.length],
      alternates: [],
      status: pool.status,
    };
  }

  // Readable and empty is a real configuration and already reported as one:
  // the key works, the account simply has nothing on it. Guessing premade ids
  // here would spend nine 404s to arrive at the same answer.
  if (pool.status === 200) return { voiceId: "", alternates: [], status: 200 };

  // The list was UNREADABLE, which is the case that shipped broken. A 401 here
  // can mean a bad key, but it equally means a good key without `voices_read`,
  // and those are indistinguishable from this side. Try to speak anyway — if
  // the key really is bad the synthesis call says so, and that answer is
  // strictly better than assuming it.
  const rotated = premadeRotation(speaker);
  return { voiceId: rotated[0], alternates: rotated.slice(1), status: pool.status };
}

/**
 * The premade library, rotated so each character starts at a different voice.
 *
 * Keyed on the speaker's fixed seat index rather than on anything per-request,
 * so two instances answering two lines for the same shark walk the same list in
 * the same order. That determinism is the point: a "fallback" that picked
 * differently per process is how a shark's voice changed mid-sentence.
 */
function premadeRotation(speaker: Speaker): string[] {
  const seat = SPEAKERS.indexOf(speaker);
  return PREMADE_VOICES.map((_, i) => PREMADE_VOICES[(seat + i) % PREMADE_VOICES.length]);
}

/**
 * GET /api/tts — "is the voice actually working, and if not, what did
 * ElevenLabs say?"
 *
 * The sibling of GET /api/stt, and it exists because of how this feature failed
 * in production: the key was set, the route was deployed, and the player heard
 * the browser voice — which is exactly what a deploy with NO key sounds like.
 * From outside there was no way to tell "no key" from "rejected key" from
 * "key that may not list voices", and the server was the only thing that knew.
 *
 * So it says. No key material is echoed, only the provider's own status slug
 * and message, which is the fact an operator needs and cannot otherwise reach
 * without a redeploy or a log dig.
 */
export async function GET() {
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { ...NOT_CONFIGURED, voices: 0, reason: "ELEVENLABS_API_KEY is not set." },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const pool = await voices();
  const mapped = SPEAKERS.filter((s) => process.env[VOICE_ENV[s]]?.trim()).length;

  return NextResponse.json(
    {
      configured: true,
      // The account's own voices. Zero with a 200 is a real, reportable state:
      // the key works and there is nothing on the account to speak with.
      voices: pool.ids.length,
      /** Voices pinned by ELEVENLABS_VOICE_*, which bypass the list entirely. */
      mapped,
      /** What the player will actually hear. */
      willSpeak: pool.ids.length > 0 || mapped > 0 || pool.status !== 200,
      source:
        mapped === SPEAKERS.length
          ? "env"
          : pool.ids.length > 0
            ? "account"
            : "premade-fallback",
      listStatus: pool.status,
      ...(lastVoiceError ? { lastError: lastVoiceError } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

async function voices(): Promise<{ ids: string[]; status: number }> {
  if (voicePool && Date.now() - voicePoolAt < VOICE_TTL_MS) {
    return { ids: voicePool, status: 200 };
  }
  // A failed lookup is remembered too, briefly. Without this a rejected key is
  // re-sent to ElevenLabs once per spoken line — twenty round trips per panel
  // to be told "no" twenty times. A minute is short enough that fixing the key
  // takes effect on its own, with no redeploy.
  if (lastVoiceError && Date.now() - voiceFailAt < VOICE_FAIL_TTL_MS) {
    return { ids: voicePool ?? [], status: lastVoiceError.http };
  }
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      signal: timeoutSignal(15_000),
    });
    if (!res.ok) {
      noteVoiceError(await describeFailure(res));
      return { ids: voicePool ?? [], status: res.status };
    }
    const raw = (await res.json()) as { voices?: { voice_id?: string }[] };
    const ids = (raw.voices ?? [])
      .map((v) => v.voice_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      // Sorted so the assignment above does not shuffle when the API returns
      // the same set in a different order — a shark whose voice changes
      // mid-session reads as a different person.
      .sort();
    // An account with a working key and no voices on it is a real configuration
    // to report, not a transport failure: 200 with nothing to say.
    if (ids.length === 0) {
      lastVoiceError = null;
      return { ids: voicePool ?? [], status: 200 };
    }
    voicePool = ids;
    voicePoolAt = Date.now();
    lastVoiceError = null;
    return { ids, status: 200 };
  } catch (err) {
    noteVoiceError({ http: 502, message: String((err as Error)?.message ?? err).slice(0, 200) });
    return { ids: voicePool ?? [], status: 502 };
  }
}

/**
 * ElevenLabs' own account of why it said no.
 *
 * Its errors carry a machine-readable slug — `invalid_api_key`,
 * `missing_permissions`, `detected_unusual_activity`, `quota_exceeded` — and
 * that slug is the entire difference between "you typed the key wrong" and
 * "your key is fine, tick the voices permission". Reading the status code alone
 * throws that away, and 401 covers all four.
 */
async function describeFailure(res: Response): Promise<VoiceError> {
  let status: string | undefined;
  let message: string | undefined;
  try {
    const body = (await res.json()) as {
      detail?: { status?: string; message?: string } | string;
    };
    if (typeof body?.detail === "string") {
      message = body.detail;
    } else {
      status = body?.detail?.status;
      message = body?.detail?.message;
    }
  } catch {
    // A non-JSON error body tells us nothing beyond the status code, which the
    // caller already has. Not worth a second read of the stream.
  }
  return {
    http: res.status,
    ...(status ? { status } : {}),
    ...(message ? { message: message.slice(0, 200) } : {}),
  };
}

/**
 * Remember the last refusal, and say it once where an operator will find it.
 *
 * Logged rather than swallowed because the whole failure this file is fixing
 * was invisible: a key that ElevenLabs rejects and a key that was never set
 * sound identical from the sofa. One line in the platform log, on the
 * transition only — a per-request log of a latched failure is how you make a
 * log useless.
 */
function noteVoiceError(err: VoiceError): void {
  const changed =
    !lastVoiceError || lastVoiceError.http !== err.http || lastVoiceError.status !== err.status;
  lastVoiceError = err;
  voiceFailAt = Date.now();
  if (changed) {
    console.error(
      `[tts] ElevenLabs refused: HTTP ${err.http}` +
        (err.status ? ` · ${err.status}` : "") +
        (err.message ? ` · ${err.message}` : "") +
        (err.status === "missing_permissions"
          ? " — the key is valid but lacks a permission; enable voices_read and text_to_speech on it."
          : ""),
    );
  }
}
