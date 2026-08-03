import type { DeliveryCoaching } from "./delivery-coach";

/**
 * THE DEBRIEF — one report, after the whole thing.
 *
 * ── Why this is not `DebriefReport` in lib/ai/types.ts ─────────────────────
 *
 * That shape is a verbatim transcription of the pack's §9 schema and it is
 * excellent, but it is missing two things this product needs and the pack never
 * had a reason to carry:
 *
 *   · A COACHING half. Players asked for eye contact, gestures, posture, pace,
 *     filler words and speaking confidence in the same report as the business
 *     feedback. The pack keeps the language coach entirely separate, which is
 *     right for the model's job and wrong for the reader's.
 *   · A structure scorecard. Which of the seven pitch beats were covered, what
 *     was missing, what was unclear, and what to add — the "how do I get better
 *     next time" half, said explicitly rather than implied by prose.
 *
 * So `TankDebrief` wraps the pack's report rather than replacing it: `report`
 * is exactly the pack shape (and is what the model is asked for), and the rest
 * is computed here or measured on the device.
 *
 * ── The line that must not blur ────────────────────────────────────────────
 *
 * `delivery` and `report` sit in the same document and are rendered in the same
 * scroll, but they are different KINDS of thing and the UI says so on every
 * render: the business half judged the pitch, the delivery half did not and
 * never touches a score anywhere (Brand Law 5). Putting them in one report was
 * a request; merging them into one grade would be a violation.
 */

/** The pack's §9 shape, restated here so this module stands alone. */
export interface DebriefBody {
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
  next_run_playbook: string[];
  grades: {
    deal_outcome: number;
    pitch_performance: number;
    overall_grade: string;
  };
}

/** One of the seven beats, marked off against what was actually said. */
export interface BeatCheck {
  n: number;
  title: string;
  covered: boolean;
  /** What to say here next time, when it was missed. */
  fix: string;
}

/**
 * The teaching half, in the four shapes players asked for by name:
 * what was weak, what was missing, what was unclear, what to add.
 */
export interface PitchCritique {
  /** Beats never reached. The single most actionable list in the report. */
  missing: string[];
  /** Said, but not backed by anything checkable. */
  unclear: string[];
  /** Claims the books contradict. The expensive kind. */
  contradictions: string[];
  /** What was genuinely good — a debrief with no wins in it stops being read. */
  strengths: string[];
  /** Concrete additions for the next attempt. */
  add: string[];
}

export interface DeliveryReview {
  /** Straight from the on-device coach. Null when the camera never ran. */
  coaching: DeliveryCoaching | null;
  /** Words per minute, filler count and rate — reported, never scored. */
  metrics: {
    word_count: number;
    wpm: number;
    filler_count: number;
    fillers_per_minute: number;
    top_fillers: string[];
    /** False when the transcript path silently strips "um" and "uh". */
    verbatim_capable: boolean;
  };
  /** Plain-language notes across eyes, hands, posture, pace, fillers, volume. */
  notes: { topic: string; text: string; tone: "ok" | "watch" }[];
}

export interface TankDebriefData {
  report: DebriefBody;
  critique: PitchCritique;
  beats: BeatCheck[];
  delivery: DeliveryReview;
  /** Business terms the founder actually used. Vocabulary is a skill. */
  termsUsed: string[];
  /** True when nothing in this report came from a model. Said out loud. */
  offline: boolean;
}
