/**
 * AI adapter contract. Output shapes are copied VERBATIM from
 * AI-Pitching-Prompt-Pack-Detailed_1.docx (design/PROMPT_PACK.txt) so the stub
 * → live swap is a one-line change with no UI rework.
 *
 * NOTE: the Business Generator prompt is absent from the pack (referenced only
 * as "the full public_brief object from the Generator"), so PublicBrief is
 * inferred from those references and marked as such.
 */

// ── Speech-to-text (stub: canned verbatim transcript WITH fillers) ───────────

export interface TranscriptWord {
  w: string;
  /** seconds from recording start */
  start: number;
  end: number;
  filler?: boolean; // um, uh, like, you-know, false starts
}

export interface PitchTranscript {
  text: string; // verbatim, disfluencies preserved
  durationSeconds: number;
  words: TranscriptWord[];
}

// ── Language Coach (schema verbatim from pack §2) ────────────────────────────

export interface CoachScore {
  score: number;
  rationale: string;
}

export interface CoachReport {
  scores: {
    clarity: CoachScore;
    fluency: CoachScore;
    logic: CoachScore;
    grammar: CoachScore;
    overall: { score: number; summary: string };
  };
  delivery_metrics: {
    word_count: number;
    wpm: number;
    filler_count: number;
    fillers_per_minute: number;
    top_fillers: string[];
  };
  structure_map: {
    detected_sections: string[];
    missing_or_misplaced: string[];
  };
  line_edits: {
    quote: string;
    category: string;
    issue: string;
    better_version: string;
    confidence_note: string;
  }[];
  top_3_priorities: [string, string, string] | string[];
}

// ── Sharks (Panel Rulebook §3: one prompt, three phases) ─────────────────────

export type SharkId = "marcus" | "serena" | "dev" | "lily" | "viktor";

export type PanelPhase = "questions" | "offer" | "negotiate";

export interface SharkOffer {
  amount_usd: number;
  equity_pct: number;
  implied_valuation_usd: number;
  deal_type: "equity" | "equity+royalty" | "debt+equity" | "milestone";
  conditions: string[];
}

/** phase "questions" output — verbatim shape */
export interface SharkQuestions {
  spoken: string;
  questions: string[];
  private_notes: string;
}

/** phase "offer" output — verbatim shape */
export interface SharkOfferTurn {
  spoken: string;
  decision: "offer" | "out" | "join";
  offer: SharkOffer | null;
  join_with: string;
  reason: string;
  private_notes: string;
}

/** phase "negotiate" output — verbatim shape */
export interface SharkNegotiateTurn {
  spoken: string;
  decision: "hold" | "revise" | "out";
  offer: SharkOffer | null;
  reason: string;
  private_notes: string;
}

export interface PanelLogEntry {
  turn: number;
  phase: PanelPhase | "answers";
  speaker: SharkId | "founder" | "chair";
  content: unknown;
}

// ── Debrief Analyst (schema verbatim from pack §9) ───────────────────────────

export interface DebriefReport {
  headline: string;
  outcome_summary: string;
  deal_analysis: {
    final_result: "deal" | "no_deal" | "walked_away";
    accepted_offer_summary: string;
    vs_fair_range: string;
    decision_verdict: string;
  };
  turning_points: {
    moment: string;
    founder_quote: string;
    consequence: string;
    evidence: string;
  }[];
  shark_reads: {
    shark: string;
    public_stance: string;
    private_read: string;
    what_would_have_won_them: string;
  }[];
  attack_points_scorecard: {
    attack_point: string;
    status: "defended" | "exposed" | "untouched";
    detail: string;
  }[];
  qa_review: {
    question: string;
    asked_by: string;
    answer_quality: "strong" | "adequate" | "dodged";
    note: string;
  }[];
  language_link: string;
  next_run_playbook: string[];
  grades: {
    deal_outcome: number;
    pitch_performance: number;
    overall_grade: string;
  };
}

// ── Business Generator (INFERRED — prompt absent from the pack) ──────────────

export interface PublicBrief {
  company_name: string;
  one_liner: string;
  industry: string;
  product: string;
  customers: string;
  traction: {
    revenue_annual_usd: number;
    growth_yoy_pct: number;
    gross_margin_pct: number;
    churn_monthly_pct: number;
    customers_count: number;
  };
  ask: {
    amount_usd: number;
    equity_pct: number;
    implied_valuation_usd: number;
    use_of_funds: string;
  };
}

export interface EvaluatorNotes {
  attack_points: string[];
  fair_valuation_range: { low_usd: number; high_usd: number };
}

export interface BusinessBrief {
  public_brief: PublicBrief;
  evaluator_notes: EvaluatorNotes;
}

// ── Panel session plumbing ───────────────────────────────────────────────────

export interface PanelSession {
  brief: BusinessBrief;
  transcript: PitchTranscript;
  coach: CoachReport;
  log: PanelLogEntry[];
  offersOnTable: { shark_id: SharkId; offer: SharkOffer | null; status: "in" | "out" }[];
}

export interface PanelScriptBeat {
  phase: PanelPhase | "answers" | "resolution";
  speaker: SharkId | "founder" | "chair";
  /** The typed shark output for this beat (one of the three phase shapes). */
  payload: SharkQuestions | SharkOfferTurn | SharkNegotiateTurn | { spoken: string };
  /** ms of "thinking" latency the UI should simulate before showing the beat. */
  delayMs: number;
}

// ── The adapter surface (stubbed now; live later, same signatures) ───────────

export type SpeakTier = "narrator" | "shark";

export interface AiAdapter {
  generateBusinessBrief(): Promise<BusinessBrief>;
  transcribePitch(audio: Blob | null, durationSeconds: number): Promise<PitchTranscript>;
  scoreLanguage(transcript: PitchTranscript): Promise<CoachReport>;
  sharkRespond(context: {
    shark: SharkId;
    situation: string;
    score?: number;
  }): Promise<{ spoken: string }>;
  runPanel(session: {
    score: number;
    companyName: string;
    valuation: number;
    askUsd: number;
  }): Promise<PanelScriptBeat[]>;
  debrief(session: PanelSession | null): Promise<DebriefReport>;
}
