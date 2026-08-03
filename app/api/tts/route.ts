import { NextResponse, type NextRequest } from "next/server";

import {
  AI_LIMITS,
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL,
  NOT_CONFIGURED,
  timeoutSignal,
} from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";

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

  // An explicit id from lib/ai/voices.ts wins; otherwise the account is asked
  // what it has. See resolveVoice for why that is not just a default constant.
  const explicit = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const cast = explicit ? { voiceId: explicit, status: 200 } : await resolveVoice(speaker);
  if (!cast.voiceId) {
    // A wrong key fails HERE rather than at the synthesis call, because the
    // voice list is what gets asked first. Reporting that as 502 would tell the
    // client "transient", and it would then re-ask on every line for the rest
    // of the session. Pass the real reason through so it latches instead.
    const status = cast.status === 401 || cast.status === 429 ? cast.status : 502;
    return NextResponse.json({ error: "No voice available." }, { status });
  }
  const voiceId = cast.voiceId;

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
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
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: timeoutSignal(),
      },
    );

    if (!res.ok) {
      // 401 is a wrong key, 429 is a spent quota. Both are permanent for this
      // session from the client's point of view, and both are already handled
      // there — pass the status through rather than flattening it to 502.
      const status = res.status === 401 || res.status === 429 ? res.status : 502;
      return NextResponse.json({ error: "Voice unavailable." }, { status });
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
  } catch {
    return NextResponse.json({ error: "Voice unavailable." }, { status: 502 });
  }
}

/**
 * Which ElevenLabs voice speaks for which character.
 *
 * Three sources, in order:
 *
 *   1. `ELEVENLABS_VOICE_MARCUS` and friends — an explicit mapping, and the one
 *      a finished deploy should use, because casting is a creative decision and
 *      `lib/ai/voices.ts` already writes the direction each shark needs.
 *   2. Whatever the account actually has, assigned deterministically so each
 *      character keeps the same voice between requests and no two share one.
 *   3. Nothing, and the caller falls back to the browser voice.
 *
 * Step 2 exists so that adding the key is genuinely all it takes. Hardcoding
 * ids from the public voice library would be shorter and is the reason this
 * kind of thing breaks six months later: those ids are not guaranteed to be on
 * any given account, and a 404 per line is indistinguishable to a player from
 * the feature not existing. Asking is cheap — once per process, cached below.
 */
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

/** The voice for this part, plus why there wasn't one when there isn't. */
interface Cast {
  voiceId: string;
  /** The voice-list lookup's HTTP status. 401 means the key itself is wrong. */
  status: number;
}

async function resolveVoice(speaker: Speaker): Promise<Cast> {
  const configured = process.env[VOICE_ENV[speaker]]?.trim();
  if (configured) return { voiceId: configured, status: 200 };

  const pool = await voices();
  if (pool.ids.length === 0) return { voiceId: "", status: pool.status };
  // Fixed position per character, so marcus is the same voice every time and a
  // five-voice account still gives five different sharks five different voices.
  return {
    voiceId: pool.ids[SPEAKERS.indexOf(speaker) % pool.ids.length],
    status: pool.status,
  };
}

async function voices(): Promise<{ ids: string[]; status: number }> {
  if (voicePool && Date.now() - voicePoolAt < VOICE_TTL_MS) {
    return { ids: voicePool, status: 200 };
  }
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      signal: timeoutSignal(15_000),
    });
    if (!res.ok) return { ids: voicePool ?? [], status: res.status };
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
    if (ids.length === 0) return { ids: voicePool ?? [], status: 200 };
    voicePool = ids;
    voicePoolAt = Date.now();
    return { ids, status: 200 };
  } catch {
    return { ids: voicePool ?? [], status: 502 };
  }
}
