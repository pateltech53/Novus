import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";

/**
 * POST /api/coach — help with a shark's question, in the room, mid-round.
 *
 * ── What this is for ───────────────────────────────────────────────────────
 *
 * A fourteen-year-old is asked "what is your gross margin and why is it
 * falling", and freezes. Not because they cannot answer it — the number is on
 * their own notes card two inches away — but because they do not yet know that
 * this question is about pricing, or that the honest answer to a falling margin
 * is a plan rather than a denial. That gap is the thing Novus exists to close,
 * and until now the room's answer to it was silence and a running clock.
 *
 * ── The line this must not cross, and how it is held ───────────────────────
 *
 * It gives HELP, never a script. The single rule this codebase does not bend
 * is that the player's words are the player's: `PitchNotes` says so in its own
 * header, and the reason is not squeamishness. A pitch you read aloud from a
 * generated sentence teaches nothing, scores something that is not you, and
 * turns the one part of the game that is genuinely yours into an autocomplete.
 *
 * Three things hold the line, in descending order of how much they matter:
 *
 *   1. The OUTPUT SHAPE cannot express a script. The schema is three short
 *      fields — what the shark is really testing, which of the founder's own
 *      numbers bear on it, and one trap to avoid. There is no field for
 *      "answer", so there is nothing to read out.
 *   2. The prompt forbids sentences in the founder's voice, in those words.
 *   3. Every field is truncated on the way out. A model that ignores both and
 *      writes a paragraph gets it cut mid-sentence, which is useless to read
 *      aloud and obviously so.
 *
 * A player who wants to be told what to say still has to say it themselves,
 * and by then they have thought about it — which is the entire exercise.
 *
 * ── Failure is silence, as everywhere else in this app ─────────────────────
 *
 * No key, no quota, a bad answer: non-2xx, and the client shows the offline
 * hint it can build from the founder's own notes. Nothing here can cost a turn.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  question?: unknown;
  shark?: unknown;
  /** The founder's own figures, so the hint can point AT them. */
  facts?: unknown;
}

const SYSTEM = `You are a pitch coach standing behind a teenage founder who has just been asked a question by an investor. You have a few seconds and you must not answer for them.

WHAT YOU DO
- Name what the investor is actually testing with this question. Investors rarely want the number; they want to know whether the founder understands what the number means.
- Point at which of the founder's OWN figures bear on it, using the ones you are given. Name the figure, not the sentence.
- Name the single most common way this question is answered badly.

WHAT YOU MUST NEVER DO
- Never write a sentence for the founder to say. No openers, no phrasing, no "you could say", no example answers, no quotes. Not one sentence in their voice.
- Never invent a number. Use only the figures you are given; if a figure you would want is missing, say which one is missing.
- Never tell them the answer is good or bad. You have not heard it.

STYLE
Plain, fast, and short enough to read in four seconds under pressure. No jargon that is not already in the question. You are talking to someone who is on camera right now.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["testing", "your_numbers", "trap"],
  properties: {
    testing: {
      type: "string",
      description: "What the investor is really testing. One short sentence.",
    },
    your_numbers: {
      type: "array",
      description:
        "Which of the founder's own figures bear on this, named, at most three. Never invented.",
      items: { type: "string" },
    },
    trap: {
      type: "string",
      description: "The commonest bad answer to this question. One short sentence.",
    },
  },
} as const;

/** Short enough that reading it aloud would be obviously absurd. */
const MAX_FIELD = 140;

export async function POST(req: NextRequest) {
  const limited = await claimAiCall(req, "coach", {
    perIp: AI_LIMITS.coachPerIp,
    perDay: AI_LIMITS.coachPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Coach budget spent." }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }

  const question = str(body.question, 400);
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const result = await askOpenRouter<{
    testing: string;
    your_numbers: string[];
    trap: string;
  }>({
    system: SYSTEM,
    user: {
      question,
      asked_by: str(body.shark, 40) || "an investor",
      founders_own_figures: body.facts ?? null,
    },
    schemaName: "answer_help",
    schema: SCHEMA,
    maxTokens: 300,
    temperature: 0.4,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.status === 501 ? NOT_CONFIGURED : "coach unavailable" },
      { status: result.status },
    );
  }

  const data = result.data;
  return NextResponse.json({
    testing: str(data.testing, MAX_FIELD),
    // Three at most, each short. A list is a list; a paragraph is a script.
    your_numbers: (Array.isArray(data.your_numbers) ? data.your_numbers : [])
      .slice(0, 3)
      .map((n) => str(n, 80))
      .filter(Boolean),
    trap: str(data.trap, MAX_FIELD),
  });
}
