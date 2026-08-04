import { NextResponse, type NextRequest } from "next/server";

import {
  AI_LIMITS,
  NOT_CONFIGURED,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  timeoutSignal,
} from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { PITCH_SYSTEM_PROMPT } from "@/lib/ai/server/pitch-prompt";

/**
 * POST /api/pitch — a person on the other end of a cold call, played by a model.
 *
 * The other end of the URL `lib/ai/callers.ts` has always posted to. The request
 * body is assembled there and is not re-specified here; the response is the
 * `CallOutcome` shape that file already parses.
 *
 * ── The model decides two things, and the game decides the rest ────────────
 *
 * `accepted` and `reply` come from the model. `cashS`, `dilutionPct`, `respect`
 * and `invsent` do not — they are read from the same difficulty table
 * `resolveLocally()` uses, so an accepted call pays identically whether a model
 * or the offline resolver answered it.
 *
 * That is the whole reason this route is safe to ship. `scripts/simulate.mjs`
 * is the balance harness and it never calls an endpoint, so any number a model
 * invented here would be a balance change no simulation could observe, in a
 * codebase whose DO-NOT-TOUCH says a balance shift is a real regression. Giving
 * the model no arithmetic to do removes the failure mode rather than monitoring
 * for it.
 *
 * ── Failure is a first-class path ──────────────────────────────────────────
 *
 * Every non-2xx here sends `judgePitch` to its local resolver, which reads the
 * same transcript and reaches its own verdict. A cold call is one of three a
 * real day; losing one to a model's rate limit would be the worst possible way
 * to spend it, so there is no state in which this route ending badly ends the
 * attempt.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Two minutes of speech is ~350 words. This is the abuse ceiling. */
const MAX_TRANSCRIPT = 8_000;

/** The whole assembled brief, serialized. Far above any real call (a couple of
 *  KB); only a payload built to amplify cost reaches it. */
const MAX_BRIEF_CHARS = 24_000;

/**
 * Difficulty 1…5 → what an accepted call pays. Copied from `resolveLocally()`
 * in lib/ai/callers.ts and must stay identical to it: two payout tables that
 * disagree is a balance bug that only shows up on deploys that have a key.
 */
const CASH_BY_DIFFICULTY = [2, 4, 7, 11, 16];
const DILUTION_BY_DIFFICULTY = [3, 5, 7, 9, 12];

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(NOT_CONFIGURED, { status: 501 });
  }

  let body: PitchRequest;
  try {
    body = (await req.json()) as PitchRequest;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const difficulty = clampDifficulty(body?.caller?.difficulty);
  if (!body?.caller?.name || !body?.company) {
    return NextResponse.json({ error: "Incomplete call." }, { status: 400 });
  }

  const transcript = (body.pitch?.transcript ?? "").slice(0, MAX_TRANSCRIPT);

  /*
   * The transcript is capped, but `their_company` and the caller fields were
   * forwarded to the model verbatim — an uncapped object under a request-
   * counting rate limit is a cost-amplification hole (one counted call carrying
   * a ~megabyte `company` object costs hundreds of times the designed spend).
   * Bounding the whole assembled payload closes it without truncating any single
   * legitimate field; a real call's brief is a couple of KB. Over the ceiling
   * falls through to the local resolver, which reads the same transcript.
   */
  const brief = callBrief(body, transcript, difficulty);
  if (JSON.stringify(brief).length > MAX_BRIEF_CHARS) {
    return NextResponse.json({ error: "Call payload too large." }, { status: 413 });
  }

  const limited = await claimAiCall(req, "pitch", {
    perIp: AI_LIMITS.pitchPerIp,
    perDay: AI_LIMITS.pitchPerDay,
  });
  if (!limited.allowed) {
    // The client falls through to the local resolver on any failure, so the
    // player still gets a real verdict on the same words. Nothing is lost but
    // the model's phrasing.
    return NextResponse.json({ error: "Call budget spent." }, { status: 429 });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        // OpenRouter attributes traffic by these; they are not credentials and
        // are sent server-to-server only.
        "http-referer": process.env.NEXT_PUBLIC_SITE_URL || "https://www.novuspitch.com",
        "x-title": "Novus",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        // Judging against a fixed rubric wants consistency, not surprise. The
        // variety a player sees comes from the five temperaments and their own
        // words, not from sampling.
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: "system", content: PITCH_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(brief) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "call_outcome",
            strict: true,
            schema: {
              type: "object",
              properties: {
                accepted: { type: "boolean" },
                reply: { type: "string" },
              },
              required: ["accepted", "reply"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      const status = res.status === 401 || res.status === 429 ? res.status : 502;
      return NextResponse.json({ error: "Caller unavailable." }, { status });
    }

    const raw = (await res.json()) as OpenRouterResponse;
    const content = raw.choices?.[0]?.message?.content ?? "";
    const verdict = parseVerdict(content);
    if (!verdict) {
      // A model that answered in prose is a model that ignored the schema.
      // Rather than show whatever it said, hand the call to the local resolver,
      // which is guaranteed to produce something in character.
      return NextResponse.json({ error: "Unreadable answer." }, { status: 502 });
    }

    const accepted = verdict.accepted;
    return NextResponse.json({
      accepted,
      reply: verdict.reply,
      cashS: accepted ? CASH_BY_DIFFICULTY[difficulty - 1] : 0,
      dilutionPct: accepted ? DILUTION_BY_DIFFICULTY[difficulty - 1] : 0,
      respect: accepted ? difficulty : 0,
      invsent: accepted ? 1 : 0,
    });
  } catch {
    return NextResponse.json({ error: "Caller unavailable." }, { status: 502 });
  }
}

/**
 * What the model is shown.
 *
 * Rebuilt from the request rather than forwarded whole, so that a field added
 * to the client payload later cannot silently start reaching the model. The
 * prohibition list is sent as data as well as being in the system prompt —
 * BUILD-PROMPT §B is explicit that Brand Law 5 goes in the prompt text and not
 * just in our intentions, and saying it twice costs nothing.
 */
function callBrief(body: PitchRequest, transcript: string, difficulty: number) {
  return {
    you: {
      name: body.caller.name,
      title: body.caller.title,
      temperament: body.caller.temperament,
      you_are_listening_for: body.caller.wants,
      difficulty,
    },
    their_company: body.company,
    their_pitch: {
      // Sent so the caller does not describe a typed pitch as something they
      // heard. It must not move the verdict — the system prompt says so.
      delivered_by: body.pitch?.spoken ? "phone" : "written message",
      words: transcript,
    },
    never_judge: body.constraints?.neverScore ?? [
      "accent",
      "pitch of voice",
      "energy level",
      "speech rhythm",
    ],
    judge_only: body.constraints?.scoreOnly ?? [
      "substance",
      "whether the numbers hold up",
      "answering what the caller asked",
    ],
  };
}

/** Models occasionally fence JSON even under a strict schema. */
function parseVerdict(content: string): { accepted: boolean; reply: string } | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { accepted?: unknown; reply?: unknown };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (typeof parsed.accepted !== "boolean" || !reply) return null;
    return { accepted: parsed.accepted, reply };
  } catch {
    return null;
  }
}

function clampDifficulty(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

interface PitchRequest {
  caller: {
    id?: string;
    name: string;
    title?: string;
    temperament?: string;
    wants?: string;
    difficulty?: number;
  };
  company: Record<string, unknown>;
  pitch?: { seconds?: number; spoken?: boolean; transcript?: string | null };
  constraints?: { neverScore?: string[]; scoreOnly?: string[] };
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
}
