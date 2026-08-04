import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED, OPENROUTER_API_KEY } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";
import { sharkSystemPrompt } from "@/lib/ai/server/panel-prompts";
import { scoreAnswer } from "@/lib/ai/pitch-content";

/**
 * POST /api/panel — one shark, one turn, in The Tank.
 *
 * ── What was actually broken ───────────────────────────────────────────────
 *
 * The panel never called a model. `SharkPanel` called `stubAi.runPanel()`,
 * which picked one of three canned scripts out of
 * `lib/ai/fixtures/panel-scripts.json` by score band and replayed it verbatim.
 * That one fact explains nearly every complaint about this room at once: the
 * questions repeat because there are only three scripts; they ignore the
 * company because they were written before it existed; and the debrief quoted
 * a founder who does not exist because it was reading a fixture too.
 *
 * This is the other end of that. One request per spoken turn, carrying the
 * whole session so far, so the shark can ask something that follows from what
 * the founder just said.
 *
 * ── Why one turn per request, rather than a whole script ───────────────────
 *
 * Because the founder answers in between, and the answer has to be able to
 * change the next question. A script generated up front cannot react, which is
 * how the old version ended up feeling like a cutscene with a microphone. It
 * costs more requests; that is the feature.
 *
 * ── What the model is allowed to decide ────────────────────────────────────
 *
 * What is said, what is asked, and — unlike the cold call — the deal terms,
 * because the terms are the point of the round. They are bounded on the way out
 * rather than trusted: an offer is clamped to a sane multiple of the fair
 * valuation range this server was given, and the implied valuation is
 * RECOMPUTED here from amount and equity so the arithmetic always ties out.
 * A model that writes "$300K for 10%, valuing you at $12M" is corrected, not
 * shown, because a player learning what a valuation is must never be taught it
 * from a broken example.
 *
 * Every failure path returns non-2xx and the client falls to its offline shark
 * in `lib/ai/panel-local.ts`, which reads the same attack points and produces a
 * real question. There is no state in which this route failing ends the round.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Two minutes of speech is ~350 words. This is the abuse ceiling. */
const MAX_TRANSCRIPT = 8_000;
/** Enough of the room's history to stay coherent without paying for all of it. */
const MAX_LOG = 24;
const MAX_ANSWERS = 12;

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    spoken: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    private_notes: { type: "string" },
  },
  required: ["spoken", "questions", "private_notes"],
  additionalProperties: false,
};

const OFFER_SCHEMA = {
  type: "object",
  properties: {
    spoken: { type: "string" },
    decision: { type: "string", enum: ["offer", "out", "join"] },
    amount_usd: { type: "number" },
    equity_pct: { type: "number" },
    deal_type: {
      type: "string",
      enum: ["equity", "equity+royalty", "debt+equity", "milestone", "none"],
    },
    conditions: { type: "array", items: { type: "string" } },
    join_with: { type: "string" },
    reason: { type: "string" },
    private_notes: { type: "string" },
  },
  required: [
    "spoken",
    "decision",
    "amount_usd",
    "equity_pct",
    "deal_type",
    "conditions",
    "join_with",
    "reason",
    "private_notes",
  ],
  additionalProperties: false,
};

const NEGOTIATE_SCHEMA = {
  type: "object",
  properties: {
    spoken: { type: "string" },
    decision: { type: "string", enum: ["hold", "revise", "out"] },
    amount_usd: { type: "number" },
    equity_pct: { type: "number" },
    deal_type: {
      type: "string",
      enum: ["equity", "equity+royalty", "debt+equity", "milestone", "none"],
    },
    conditions: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    private_notes: { type: "string" },
  },
  required: [
    "spoken",
    "decision",
    "amount_usd",
    "equity_pct",
    "deal_type",
    "conditions",
    "reason",
    "private_notes",
  ],
  additionalProperties: false,
};

interface RawTurn {
  spoken?: unknown;
  questions?: unknown;
  decision?: unknown;
  amount_usd?: unknown;
  equity_pct?: unknown;
  deal_type?: unknown;
  conditions?: unknown;
  join_with?: unknown;
  reason?: unknown;
  private_notes?: unknown;
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) return NextResponse.json(NOT_CONFIGURED, { status: 501 });

  let body: PanelRequest;
  try {
    body = (await req.json()) as PanelRequest;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const phase =
    body.phase === "offer" || body.phase === "negotiate" ? body.phase : "questions";
  const shark = String(body.shark ?? "marcus");
  const system = sharkSystemPrompt(shark);
  if (!system) {
    // The prompt files did not make it into the bundle. Reported as 502 rather
    // than 501: something IS configured, it is simply broken, and the client
    // should keep trying next deploy instead of latching for the session.
    return NextResponse.json({ error: "Panel prompts unavailable." }, { status: 502 });
  }

  const limited = await claimAiCall(req, "panel", {
    perIp: AI_LIMITS.panelPerIp,
    perDay: AI_LIMITS.panelPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Panel budget spent." }, { status: 429 });
  }

  const schema =
    phase === "offer" ? OFFER_SCHEMA : phase === "negotiate" ? NEGOTIATE_SCHEMA : QUESTIONS_SCHEMA;

  const result = await askOpenRouter<RawTurn>({
    system,
    user: turnBrief(body, phase),
    schema,
    schemaName: `shark_${phase}`,
    /*
     * Warmer than the cold call's 0.4 on purpose. That route judges against a
     * fixed rubric and wants consistency; this one exists because every player
     * complained the room said the same thing every time. The rulebook and the
     * attack points hold the substance; the temperature buys the phrasing.
     */
    temperature: 0.85,
    maxTokens: phase === "questions" ? 420 : 520,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: "The room is quiet." }, { status: result.status });
  }

  return NextResponse.json(shapeTurn(result.data, phase, body));
}

/** What the shark is shown for this turn. */
function turnBrief(body: PanelRequest, phase: string) {
  const ctx = body.context ?? ({} as PanelRequest["context"]);
  return {
    phase,
    round: Number(body.round ?? 1),
    you_are: body.shark,
    founder_name: str(ctx?.founderName, 48) || "the founder",

    // The company, exactly as the founder sees it on their own notes card.
    business_brief: ctx?.brief,
    the_books: ctx?.company,
    derived_metrics: ctx?.metrics,
    competitors: ctx?.competitors,

    /*
     * Investor-only. The founder cannot see this, which is what makes it worth
     * having: it is the difference between a shark who sounds sharp and one who
     * has actually read the accounts.
     */
    evaluator_notes: {
      attack_points: (ctx?.attackPoints ?? []).slice(0, 8).map((a) => ({
        what_is_wrong: a.claim,
        a_question_that_gets_at_it: a.question,
      })),
      fair_valuation_range: ctx?.fairValuation,
      which_pitch_sections_they_covered: ctx?.coveredBeats,
      /*
       * A cheap substance read on each answer so far — strong / adequate /
       * shaky / dodged — where keyboard mash and non-words grade as dodged.
       * The model reads the answers itself, but this readout keeps a nonsense
       * answer from being priced as a real one, and rule 4 says a dodge costs.
       */
      answers_substance_readout: answerRecords(body)
        .slice(-MAX_ANSWERS)
        .map((a) => ({
          question: str(a.question, 160),
          held_up: a.declined ? "dodged" : scoreAnswer(a.question, a.answer).tier,
        })),
    },

    /*
     * The founder's OWN numbers — they set the amount and the equity on their
     * notes card, and `implied_valuation_usd` is the price those two numbers
     * put on the whole company. Handed over explicitly so a shark can hold the
     * founder to the valuation they just claimed, not merely to the cheque.
     */
    the_ask: ctx?.ask
      ? {
          amount_usd: ctx.ask.amountUsd,
          equity_pct: ctx.ask.equityPct,
          implied_valuation_usd:
            ctx.ask.impliedValuationUsd ??
            (ctx.ask.equityPct > 0
              ? Math.round(ctx.ask.amountUsd / (ctx.ask.equityPct / 100))
              : 0),
          set_by: "the founder themselves — these are their chosen terms",
        }
      : undefined,

    founders_pitch_transcript:
      str(body.pitchTranscript, MAX_TRANSCRIPT) ||
      "(The transcript did not come through. Ask them to state the business plainly; never comment on their microphone, their speech or their delivery.)",

    // Everything said so far, so nobody repeats anybody.
    panel_log: (body.log ?? []).slice(-MAX_LOG),
    questions_already_asked_by_anyone: (body.askedQuestions ?? []).slice(-MAX_LOG),
    founder_answers_so_far: (body.answers ?? []).slice(-MAX_ANSWERS),
    offers_on_the_table: body.offersOnTable ?? [],
    max_questions_this_turn: Math.max(1, Math.min(2, Number(body.maxQuestions ?? 1))),

    // Restated as data as well as in the prompt. BUILD-PROMPT §B is explicit
    // that Brand Law 5 goes in the prompt text and not just in our intentions,
    // and saying it in both places costs nothing.
    never_judge: [
      "accent",
      "grammar",
      "fluency",
      "pace",
      "hesitation",
      "filler words",
      "nerves",
      "volume",
      "confidence",
    ],
  };
}

/**
 * The model's answer, made safe and made to tie out.
 *
 * Three things happen here and all three are load-bearing:
 *
 *   1. Free text is trimmed and capped, so nothing can blow out a layout or the
 *      800-character ceiling on `/api/tts`.
 *   2. Deal terms are clamped to a band around the fair valuation this server
 *      was handed. A model improvising a $40M valuation for a garage company
 *      is not a fun surprise, it is a player learning the wrong thing.
 *   3. `implied_valuation_usd` is COMPUTED, never copied. Panel Rulebook rule 3
 *      asks the model to do that division correctly; a game that teaches
 *      valuation must not ship an example where it was done wrong.
 */
function shapeTurn(raw: RawTurn, phase: string, body: PanelRequest) {
  const spoken = str(raw.spoken, 700);
  const privateNotes = str(raw.private_notes, 500);

  if (phase === "questions") {
    const questions = Array.isArray(raw.questions)
      ? raw.questions
          .map((q) => str(q, 260))
          .filter(Boolean)
          // One at a time. The founder answers each in turn, and a shark who
          // fires three at once gets one answer to whichever they remember.
          .slice(0, 1)
      : [];
    return { spoken, questions, private_notes: privateNotes };
  }

  const fair = body.context?.fairValuation ?? { low: 0, high: 0 };
  const decision = String(raw.decision ?? "out");
  const wantsOffer =
    decision === "offer" || decision === "join" || decision === "revise" || decision === "hold";

  const offer = wantsOffer ? clampOffer(raw, fair) : null;

  if (phase === "offer") {
    /*
     * The same "bound it rather than trust it" rule the deal terms get. The
     * prompt tells the model that dodged questions cost the founder; a model
     * that offers anyway after the room was given nothing but silence and
     * keyboard mash is corrected here, exactly as an absurd valuation is.
     */
    const answers = answerRecords(body);
    const held = answers.length
      ? answers.reduce(
          (sum, a) => sum + (a.declined ? 0 : scoreAnswer(a.question, a.answer).quality),
          0,
        ) / answers.length
      : 0.5;
    if (answers.length >= 2 && held < 0.15) {
      return {
        spoken:
          "You were asked real questions and the room got nothing back. Unanswered questions are the diligence. I'm out.",
        decision: "out",
        offer: null,
        join_with: "",
        reason: "The questions went unanswered.",
        private_notes: `Answer substance ${held.toFixed(2)} across ${answers.length} questions — overridden to out.`,
      };
    }
    return {
      spoken,
      decision: ["offer", "out", "join"].includes(decision) ? decision : "out",
      offer,
      join_with: str(raw.join_with, 40),
      reason: str(raw.reason, 260),
      private_notes: privateNotes,
    };
  }

  return {
    spoken,
    decision: ["hold", "revise", "out"].includes(decision) ? decision : "hold",
    offer,
    reason: str(raw.reason, 260),
    private_notes: privateNotes,
  };
}

function clampOffer(raw: RawTurn, fair: { low: number; high: number }) {
  const equity = Math.min(60, Math.max(1, Number(raw.equity_pct) || 0));
  let amount = Math.max(0, Number(raw.amount_usd) || 0);
  if (!amount || !Number.isFinite(amount)) return null;

  /*
   * The band. A shark is allowed to be greedy or generous — that is the round —
   * but not by an order of magnitude, because the implied valuation is a thing
   * the player is being taught to read. Half the low end to double the high end
   * leaves a very wide argument and rules out the absurd.
   */
  const implied = amount / (equity / 100);
  const floor = Math.max(1, fair.low * 0.5);
  const ceiling = Math.max(floor * 2, fair.high * 2);
  if (implied < floor) amount = Math.round((floor * equity) / 100);
  else if (implied > ceiling) amount = Math.round((ceiling * equity) / 100);

  const dealType = String(raw.deal_type ?? "equity");
  return {
    amount_usd: Math.round(amount),
    equity_pct: Number(equity.toFixed(1)),
    // Recomputed, always. Rule 3 of the rulebook, enforced rather than asked for.
    implied_valuation_usd: Math.round(amount / (equity / 100)),
    deal_type: ["equity", "equity+royalty", "debt+equity", "milestone"].includes(dealType)
      ? dealType
      : "equity",
    conditions: Array.isArray(raw.conditions)
      ? raw.conditions.map((c) => str(c, 140)).filter(Boolean).slice(0, 3)
      : [],
  };
}

/** The founder's answers so far, defensively shaped from the wire. */
function answerRecords(body: PanelRequest) {
  return (Array.isArray(body.answers) ? body.answers : []).map((entry) => {
    const a = entry as { question?: unknown; answer?: unknown; declined?: unknown };
    return {
      question: typeof a.question === "string" ? a.question : "",
      answer: typeof a.answer === "string" ? a.answer : "",
      declined: a.declined === true,
    };
  });
}

interface PanelRequest {
  phase?: string;
  shark?: string;
  round?: number;
  maxQuestions?: number;
  pitchTranscript?: string;
  context?: {
    founderName?: string;
    company?: Record<string, unknown>;
    brief?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    competitors?: unknown[];
    attackPoints?: { claim: string; question: string }[];
    fairValuation?: { low: number; high: number };
    ask?: { amountUsd: number; equityPct: number; impliedValuationUsd?: number };
    coveredBeats?: unknown[];
  };
  log?: unknown[];
  askedQuestions?: string[];
  answers?: unknown[];
  offersOnTable?: unknown[];
}
