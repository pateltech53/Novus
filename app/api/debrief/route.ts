import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED, OPENROUTER_API_KEY } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";
import { debriefSystemPrompt } from "@/lib/ai/server/panel-prompts";

/**
 * POST /api/debrief — the report, after the whole session.
 *
 * ── Two things were wrong, and this fixes both ─────────────────────────────
 *
 * 1. THE FEEDBACK CAME BEFORE THE ROOM. The verdict card appeared straight
 *    after the pitch and the panel happened afterwards, so the report could not
 *    possibly cover the questioning — which is arguably the harder half, and is
 *    certainly the half where a founder is actually tested. The debrief now
 *    runs last and reads the entire session.
 *
 * 2. THE FEEDBACK WAS A FIXTURE. `stubAi.scoreLanguage()` returned a canned
 *    report from `lib/ai/fixtures/coach-reports.json`, whose line edits quote a
 *    founder saying "Hi. I'm sixteen, and I've been running this company for
 *    eleven months." That sentence is in the fixture. It is why players saw
 *    feedback about being sixteen regardless of what they said — the report was
 *    never reading their transcript at all. Nothing on this path can quote
 *    anything the founder did not say.
 *
 * ── What the model gets, and what it may not do with it ────────────────────
 *
 * It gets everything: the brief, the books, the attack points, the pitch
 * transcript, every question and answer, every private note, the offers, and
 * the outcome. It may reveal the private notes — that is the pack's §9 job and
 * the most useful thing in the report.
 *
 * It does NOT get the delivery measurements. Eye contact, gestures, sway,
 * volume and filler counts are measured on the player's device and assembled
 * into the report client-side, deliberately never sent here: they are not this
 * analyst's business, a model asked to weigh them would weigh them, and Brand
 * Law 5 says that must never happen. The player sees both halves in one
 * document; only one of them was ever judged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TRANSCRIPT = 8_000;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    outcome_summary: { type: "string" },
    deal_analysis: {
      type: "object",
      properties: {
        final_result: { type: "string", enum: ["deal", "no_deal", "walked_away"] },
        accepted_offer_summary: { type: "string" },
        vs_fair_range: { type: "string" },
        decision_verdict: { type: "string" },
      },
      required: ["final_result", "accepted_offer_summary", "vs_fair_range", "decision_verdict"],
      additionalProperties: false,
    },
    turning_points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          moment: { type: "string" },
          founder_quote: { type: "string" },
          consequence: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["moment", "founder_quote", "consequence", "evidence"],
        additionalProperties: false,
      },
    },
    shark_reads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shark: { type: "string" },
          public_stance: { type: "string" },
          private_read: { type: "string" },
          what_would_have_won_them: { type: "string" },
        },
        required: ["shark", "public_stance", "private_read", "what_would_have_won_them"],
        additionalProperties: false,
      },
    },
    attack_points_scorecard: {
      type: "array",
      items: {
        type: "object",
        properties: {
          attack_point: { type: "string" },
          status: { type: "string", enum: ["defended", "exposed", "untouched"] },
          detail: { type: "string" },
        },
        required: ["attack_point", "status", "detail"],
        additionalProperties: false,
      },
    },
    qa_review: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          asked_by: { type: "string" },
          answer_quality: { type: "string", enum: ["strong", "adequate", "dodged"] },
          note: { type: "string" },
        },
        required: ["question", "asked_by", "answer_quality", "note"],
        additionalProperties: false,
      },
    },
    what_was_missing: { type: "array", items: { type: "string" } },
    what_was_unclear: { type: "array", items: { type: "string" } },
    what_to_add: { type: "array", items: { type: "string" } },
    what_worked: { type: "array", items: { type: "string" } },
    next_run_playbook: { type: "array", items: { type: "string" } },
    grades: {
      type: "object",
      properties: {
        deal_outcome: { type: "number" },
        pitch_performance: { type: "number" },
        overall_grade: { type: "string" },
      },
      required: ["deal_outcome", "pitch_performance", "overall_grade"],
      additionalProperties: false,
    },
  },
  required: [
    "headline",
    "outcome_summary",
    "deal_analysis",
    "turning_points",
    "shark_reads",
    "attack_points_scorecard",
    "qa_review",
    "what_was_missing",
    "what_was_unclear",
    "what_to_add",
    "what_worked",
    "next_run_playbook",
    "grades",
  ],
  additionalProperties: false,
};

/**
 * What this codebase asks for on top of the pack's §9 prompt.
 *
 * The pack's schema is a post-mortem: what happened and why. Players asked for
 * something the post-mortem does not contain — what was MISSING, what was
 * UNCLEAR, and what to ADD next time, as lists rather than as prose. Those four
 * arrays are the addition, and this block is where they are specified.
 */
const ADDENDUM = `
=== NOVUS DEBRIEF ADDENDUM — four extra arrays, on top of the schema above ===

Alongside the report, return four lists. They are the part the founder will actually act on, so they are specific or they are worthless.

what_was_missing — things a pitch of this business needed and this pitch never contained. You are given which of the seven standard beats (Problem, Solution, Market, Business model, Traction, Financials, Ask) the transcript reached; anything false there belongs here, along with anything else genuinely absent. Name the beat and say in one sentence what should have been said in it. 2 to 5 items.

what_was_unclear — things that WERE said but could not be understood, checked or believed from what was given: a claim with no number, an ask with no rationale, a market size with no working, a competitor never named. Quote the founder's own words for each. Judge only clarity of MEANING, never of speech — never mention grammar, pronunciation, accent, pace, hesitation or fluency. 1 to 4 items.

what_to_add — concrete sentences' worth of substance to bring next time, each tied to something in this session. "Bring your CAC payback period" beats "add more detail". 2 to 5 items.

what_worked — what genuinely landed, quoted. At least one, always, even after a bad session: a debrief with nothing good in it stops being read, and there is always something.

Every item in all four lists is one sentence. No headings, no numbering, no emoji.
=== END ADDENDUM ===
`;

interface RawDebrief {
  headline?: unknown;
  outcome_summary?: unknown;
  deal_analysis?: Record<string, unknown>;
  turning_points?: unknown;
  shark_reads?: unknown;
  attack_points_scorecard?: unknown;
  qa_review?: unknown;
  what_was_missing?: unknown;
  what_was_unclear?: unknown;
  what_to_add?: unknown;
  what_worked?: unknown;
  next_run_playbook?: unknown;
  grades?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) return NextResponse.json(NOT_CONFIGURED, { status: 501 });

  let body: DebriefRequest;
  try {
    body = (await req.json()) as DebriefRequest;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const system = debriefSystemPrompt();
  if (!system) return NextResponse.json({ error: "Analyst unavailable." }, { status: 502 });

  const limited = await claimAiCall(req, "debrief", {
    perIp: AI_LIMITS.debriefPerIp,
    perDay: AI_LIMITS.debriefPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Debrief budget spent." }, { status: 429 });
  }

  const result = await askOpenRouter<RawDebrief>({
    system: `${system}\n\n${ADDENDUM}`,
    user: {
      founder_name: str(body.context?.founderName, 48) || "the founder",
      business_brief: body.context?.brief,
      the_books: body.context?.company,
      derived_metrics: body.context?.metrics,
      evaluator_notes: {
        attack_points: (body.context?.attackPoints ?? []).map((a) => a.claim),
        fair_valuation_range: body.context?.fairValuation,
      },
      which_pitch_sections_they_covered: body.context?.coveredBeats,
      founders_pitch_transcript: str(body.pitchTranscript, MAX_TRANSCRIPT),
      panel_log: body.log ?? [],
      questions_and_answers: body.answers ?? [],
      shark_private_notes: body.privateNotes ?? [],
      offers_made: body.offers ?? [],
      outcome: body.outcome ?? { result: "no_deal" },
      /*
       * The one thing deliberately withheld. Delivery measurements exist —
       * eye contact, gestures, pace, fillers — and the player will read them
       * two screens further down. They are not sent here because an analyst
       * given them would weigh them, and nothing may weigh them.
       */
      you_were_not_given: "anything about how the founder sounded or looked",
      never_comment_on: [
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
    },
    schema: SCHEMA,
    schemaName: "tank_debrief",
    // A post-mortem judged against evidence. Consistency beats surprise here.
    temperature: 0.5,
    maxTokens: 2200,
    timeoutMs: 90_000,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: "No debrief." }, { status: result.status });
  }

  return NextResponse.json(shape(result.data));
}

const list = (value: unknown, max: number, cap: number): string[] =>
  Array.isArray(value) ? value.map((v) => str(v, cap)).filter(Boolean).slice(0, max) : [];

function shape(raw: RawDebrief) {
  const deal = raw.deal_analysis ?? {};
  const grades = raw.grades ?? {};
  const grade = (v: unknown) => Math.max(1, Math.min(10, Math.round(Number(v) || 0) || 1));

  return {
    report: {
      headline: str(raw.headline, 200),
      outcome_summary: str(raw.outcome_summary, 900),
      deal_analysis: {
        final_result: ["deal", "no_deal", "walked_away"].includes(String(deal.final_result))
          ? String(deal.final_result)
          : "no_deal",
        accepted_offer_summary: str(deal.accepted_offer_summary, 300),
        vs_fair_range: str(deal.vs_fair_range, 400),
        decision_verdict: str(deal.decision_verdict, 600),
      },
      turning_points: mapArray(raw.turning_points, 5, (t) => ({
        moment: str(t.moment, 120),
        founder_quote: str(t.founder_quote, 300),
        consequence: str(t.consequence, 300),
        evidence: str(t.evidence, 400),
      })),
      shark_reads: mapArray(raw.shark_reads, 5, (t) => ({
        shark: str(t.shark, 40),
        public_stance: str(t.public_stance, 220),
        private_read: str(t.private_read, 320),
        what_would_have_won_them: str(t.what_would_have_won_them, 320),
      })),
      attack_points_scorecard: mapArray(raw.attack_points_scorecard, 10, (t) => ({
        attack_point: str(t.attack_point, 180),
        status: ["defended", "exposed", "untouched"].includes(String(t.status))
          ? String(t.status)
          : "untouched",
        detail: str(t.detail, 300),
      })),
      qa_review: mapArray(raw.qa_review, 8, (t) => ({
        question: str(t.question, 260),
        asked_by: str(t.asked_by, 40),
        answer_quality: ["strong", "adequate", "dodged"].includes(String(t.answer_quality))
          ? String(t.answer_quality)
          : "adequate",
        note: str(t.note, 300),
      })),
      next_run_playbook: list(raw.next_run_playbook, 5, 220),
      grades: {
        deal_outcome: grade(grades.deal_outcome),
        pitch_performance: grade(grades.pitch_performance),
        overall_grade: str(grades.overall_grade, 4) || "C",
      },
    },
    critique: {
      missing: list(raw.what_was_missing, 5, 220),
      unclear: list(raw.what_was_unclear, 4, 220),
      add: list(raw.what_to_add, 5, 220),
      strengths: list(raw.what_worked, 4, 220),
    },
  };
}

function mapArray<T extends Record<string, unknown>, R>(
  value: unknown,
  max: number,
  fn: (item: T) => R,
): R[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((v) => fn((v ?? {}) as T));
}

interface DebriefRequest {
  pitchTranscript?: string;
  context?: {
    founderName?: string;
    company?: Record<string, unknown>;
    brief?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    attackPoints?: { claim: string }[];
    fairValuation?: { low: number; high: number };
    coveredBeats?: unknown[];
  };
  log?: unknown[];
  answers?: unknown[];
  privateNotes?: unknown[];
  offers?: unknown[];
  outcome?: Record<string, unknown>;
}
