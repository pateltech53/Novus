import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED, OPENROUTER_API_KEY } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";
import { sharkSystemPrompt } from "@/lib/ai/server/panel-prompts";
import { scoreAnswers, DEFENCE_FLOOR } from "@/lib/ai/pitch-content";
import { CAST, PANEL } from "@/lib/ai/panel-cast";
import {
  isSharkId,
  lastOtherBeat,
  nothingToPriceLine,
  relationOf,
  whoWalked,
} from "@/lib/ai/panel-dynamics";
import type { PanelLogLine, SharkId } from "@/lib/ai/types";

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
  const raw = String(body.shark ?? "marcus");
  const shark: SharkId = isSharkId(raw) ? raw : "marcus";
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
    user: turnBrief(body, phase, shark),
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

  return NextResponse.json(shapeTurn(result.data, phase, body, shark));
}

/** What the shark is shown for this turn. */
function turnBrief(body: PanelRequest, phase: string, you: SharkId) {
  const ctx = body.context ?? ({} as PanelRequest["context"]);
  const defence = scoreAnswers(answerRecords(body));
  const log = panelLog(body);
  const walked = whoWalked(log);
  return {
    phase,
    round: Number(body.round ?? 1),
    you_are: body.shark,
    founder_name: str(ctx?.founderName, 48) || "the founder",

    /*
     * ── The other four ────────────────────────────────────────────────────
     *
     * Panel Rulebook rule 2 asks every shark to react to the panel log in
     * character, name the others, spar with them and team up with them. It has
     * never been possible: the log arrived as `{speaker: "serena"}` and nothing
     * in the request said who Serena is, what she wants, whether she is still
     * in, or what she just put on the table. A model cannot agree with somebody
     * it has not been introduced to, so it did the only safe thing and ignored
     * the other four entirely — five monologues sharing a table, and in the
     * situations where they all reach the same verdict, five identical ones.
     *
     * `how_you_read_them` is this shark's own PANEL DYNAMICS line from their
     * persona file, turned into data (`lib/ai/panel-dynamics.ts`) so it is
     * about the specific person who just spoke rather than a general
     * instruction to be panel-aware.
     */
    the_room: {
      you_are: CAST[you]?.name,
      the_other_four: PANEL.filter((s) => s.id !== you).map((s) => {
        const theirLast = [...log].reverse().find((l) => l.speaker === s.id);
        const bid = body.offersOnTable?.find(
          (o) => (o as { shark?: string }).shark === s.id,
        );
        return {
          name: s.name,
          known_as: s.tag,
          they_care_about: s.cares,
          how_you_read_them: relationOf(you, s.id).read,
          status: walked.includes(s.id)
            ? "has gone out"
            : bid
              ? "has an offer on the table"
              : theirLast
                ? "still in"
                : "has not spoken yet",
          their_offer: bid ?? null,
          the_last_thing_they_said: str(theirLast?.spoken, 300) || null,
          what_they_asked: theirLast?.questions?.[0] ?? null,
        };
      }),
      /*
       * The specific line you are answering. Handed over separately from the
       * log because "react to the conversation" is vague and "here is the
       * sentence spoken immediately before yours" is not.
       */
      who_spoke_immediately_before_you: speakerBefore(log, you),
      how_to_use_this:
        "Take a position on the last thing another shark said — agree and add, or disagree and say why — using their name. Never invent a line they did not say. If you reach the same verdict as somebody above you, credit them by name and say the part they missed; never repeat their sentence in your own mouth.",
    },

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
       * shaky / dodged — where keyboard mash, non-words, answers about
       * something nobody asked, and the same sentence pasted twice all grade
       * as dodged. The model reads the answers itself, but this readout keeps
       * a nonsense answer from being priced as a real one, and rule 4 says a
       * dodge costs.
       */
      answers_substance_readout: defence.perAnswer.slice(-MAX_ANSWERS).map((a) => ({
        question: str(a.question, 160),
        held_up: a.tier,
        answered_a_different_question: a.offTopic,
        why: a.note,
      })),
      /*
       * And the whole defence as one number, because the per-answer labels did
       * not stop a model from being charmed by a good balance sheet. This is
       * the same 0..1 the offline room prices on and the same one the server
       * enforces below, stated in the brief so the shark is not surprised by
       * its own override.
       */
      how_much_of_the_questioning_they_stood_up_to: {
        score_0_to_1: Number(defence.held.toFixed(2)),
        questions_asked: defence.asked,
        questions_actually_answered: defence.answered,
        below_this_nobody_invests: DEFENCE_FLOOR,
      },
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

    /*
     * Everything said so far, so nobody repeats anybody — now with the
     * speaker's NAME and what they decided, not just their id and their words.
     * "marcus" is a database key; "Marcus Cole, went out" is something a shark
     * can answer.
     */
    panel_log: log.slice(-MAX_LOG).map((entry) => ({
      speaker: entry.speaker,
      speaker_name: CAST[entry.speaker as SharkId]?.name ?? "The Chair",
      spoken: entry.spoken,
      questions: entry.questions,
      decision: entry.decision,
      offer: entry.offer ?? undefined,
    })),
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

/** The public record, defensively shaped from the wire. */
function panelLog(body: PanelRequest): PanelLogLine[] {
  return (Array.isArray(body.log) ? body.log : []).map((entry) => {
    // Defensive down to the entry: this is parsed straight off the wire, and a
    // null in the array must not be able to throw the route.
    const e = (entry && typeof entry === "object" ? entry : {}) as Partial<PanelLogLine>;
    return {
      speaker: typeof e.speaker === "string" ? e.speaker : "",
      spoken: typeof e.spoken === "string" ? e.spoken : "",
      questions: Array.isArray(e.questions) ? e.questions.filter((q) => typeof q === "string") : undefined,
      decision: typeof e.decision === "string" ? e.decision : undefined,
      offer: e.offer && typeof e.offer === "object" ? e.offer : null,
    };
  });
}

/**
 * The line this shark is about to answer.
 *
 * Null on the first turn, and it says so in words rather than by omission: a
 * model handed an absent field improvises, and the improvisation here is
 * agreeing with somebody who has not spoken.
 */
function speakerBefore(log: PanelLogLine[], you: SharkId) {
  const beat = lastOtherBeat(log, you);
  if (!beat) {
    return {
      nobody_yet:
        "You are the first shark to speak this round. There is nothing to react to — do not pretend otherwise, and do not reference anybody else's position.",
    };
  }
  return {
    name: CAST[beat.shark]?.name,
    what_they_did:
      beat.did === "bid"
        ? "put an offer on the table"
        : beat.did === "walked"
          ? "went out"
          : beat.did === "held"
            ? "held their offer where it was"
            : "asked the founder a question",
    their_exact_words: str(beat.spoken, 400),
    the_question_they_asked: beat.question ?? null,
    their_offer: beat.offer ?? null,
    how_you_read_them: relationOf(you, beat.shark).read,
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
function shapeTurn(raw: RawTurn, phase: string, body: PanelRequest, you: SharkId) {
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
     * that offers anyway after the room was given nothing but silence, keyboard
     * mash, or three sentences about something nobody asked is corrected here,
     * exactly as an absurd valuation is.
     *
     * The threshold used to be 0.15, which was unreachable: the old per-answer
     * scorer gave 0.4 to any string of English, so a founder answering every
     * question with a joke averaged 0.4 and this override never once fired.
     * `DEFENCE_FLOOR` is above what an off-topic answer can score on purpose,
     * and it is the same number the offline room walks at, so the two rooms
     * cannot disagree about whether a founder answered anything.
     */
    const defence = scoreAnswers(answerRecords(body));
    if (defence.asked >= 2 && defence.held < DEFENCE_FLOOR) {
      return {
        /*
         * ── The one line five sharks used to say word for word ────────────
         *
         * This override fires for every seat in turn, so when it fires at all
         * it fires five times — and it used to emit one identical sentence
         * each time. A founder who answered nothing watched five investors
         * deliver the same paragraph in a row, which reads as a bug rather
         * than as a verdict, and it is the clearest case of the complaint
         * that the panel says the same thing in specific situations.
         *
         * `nothingToPriceLine` gives each seat their own sentence and lets
         * the later ones acknowledge whoever already walked, so the same
         * conclusion is reached five times instead of being announced once
         * and echoed four times. It stays a server override: the point of
         * the override is that the model does not get a vote here.
         */
        spoken: nothingToPriceLine(you, whoWalked(panelLog(body))),
        decision: "out",
        offer: null,
        join_with: "",
        reason: "The questions went unanswered.",
        private_notes: `Answer substance ${defence.held.toFixed(2)} across ${defence.asked} questions (${defence.answered} answered) — overridden to out.`,
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
