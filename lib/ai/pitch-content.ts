import type { RunState } from "@/lib/engine/types";

/**
 * WHAT YOU SAID — content scoring for a pitch.
 *
 * This is the offline half of pitch judging. When a model endpoint is configured
 * it does the understanding and this file is not consulted. Without one, this is
 * what reads the transcript.
 *
 * ── What replaced, and why ─────────────────────────────────────────────────
 *
 * The old path scored a pitch on two things: how LONG you recorded, and how many
 * filler words you used per minute. `transcribePitch` took the audio blob as
 * `_audio` and threw it away, returning a canned fixture chosen by duration. So
 * a player who spoke for ninety seconds of nonsense out-scored one who made a
 * tight, honest case in forty.
 *
 * That is also a Brand Law 5 violation sitting in the scoring path:
 *
 *   NEVER score accent, pitch of voice, energy level, or speech rhythm.
 *
 * "Ums per minute" is speech rhythm. Words per minute is speech rhythm. Neither
 * may touch the score. They survive in `delivery_metrics` as COACHING — worth
 * telling a teenager who wants to present better — but they are reported, never
 * graded.
 *
 * ── What this scores instead ───────────────────────────────────────────────
 *
 * Four things, all of them about substance, all of them checkable:
 *
 *   1. COVERAGE — did the pitch do the jobs a pitch has to do? What the business
 *      is, who pays, the economics, the ask. A pitch that never mentions money is
 *      missing something, and that is a fact about content.
 *
 *   2. SPECIFICITY — did you cite anything concrete, or was it all adjectives?
 *      "Margins are strong" and "margins are 62%" are different pitches.
 *
 *   3. HONESTY — the good one, and the reason this is worth doing offline at all.
 *      The engine already knows your books. If you claim you are profitable while
 *      burning cash, it can catch you, because it can check. Investors do exactly
 *      this and it is the most transferable lesson in the whole feature.
 *
 *   4. RELEVANCE — for a cold call, did you talk about the thing this particular
 *      person said they were listening for?
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * It is not comprehension. It is keyword and claim analysis over real business
 * vocabulary, and it is deliberately transparent about that: every point it gives
 * or takes comes back as a named `note` the player can read. A black box that
 * felt smart would be worse than an explainable one that is merely fair.
 */

export interface ContentFinding {
  kind: "covered" | "missing" | "specific" | "vague" | "honest" | "contradiction" | "relevant";
  /** Shown to the player verbatim. Never about how they sounded. */
  note: string;
  /** Points added to the 0..10 content score. Negative for contradictions. */
  weight: number;
}

export interface ContentScore {
  /** 0..10, the same scale the panel and the year gate already use. */
  score: number;
  findings: ContentFinding[];
  /** Word count — reported for the coach, never scored. */
  words: number;
  /** True when there was nothing to read. */
  empty: boolean;
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * The four jobs. Real trade vocabulary only (Brand Law 6) and generous synonym
 * lists, because a fifteen-year-old should not lose points for saying "how we
 * make money" instead of "unit economics".
 */
const TOPICS: { id: string; label: string; terms: string[] }[] = [
  {
    id: "product",
    label: "what the business actually is",
    terms: [
      "we make", "we sell", "we build", "product", "service", "app", "brand",
      "menu", "shop", "store", "platform", "our thing", "we run", "we offer",
      "business", "company", "launch", "range", "line",
    ],
  },
  {
    id: "customer",
    label: "who pays for it",
    terms: [
      "customer", "customers", "client", "clients", "buyer", "buyers", "market",
      "audience", "users", "user", "subscriber", "subscribers", "member",
      "members", "people who", "diners", "players", "parents", "schools",
      "demand", "repeat", "retention", "churn",
    ],
  },
  {
    id: "money",
    label: "the economics",
    terms: [
      "revenue", "profit", "profitable", "margin", "margins", "gross margin",
      "burn", "runway", "cash", "cost", "costs", "unit cost", "price", "pricing",
      "break even", "breakeven", "cac", "ltv", "mrr", "arr", "turnover",
      "we charge", "per unit", "per month", "per year",
    ],
  },
  {
    id: "ask",
    label: "what you want from them",
    terms: [
      "looking for", "raising", "raise", "asking for", "ask", "investment",
      "invest", "funding", "capital", "cheque", "check", "equity", "stake",
      "percent of", "%", "valuation", "we need", "i need", "in exchange",
      "shelf space", "distribution", "partner", "partnership", "order",
    ],
  },
];

/** Anything that reads as a real figure rather than an adjective. */
const SPECIFIC = /\b\d/;
const MONEY = /[$£€]\s?\d|\b\d+\s?(k|m|bn|thousand|million|percent|%)\b/i;

/**
 * Claims the engine can actually verify, because it holds the books.
 *
 * Each entry is a pattern plus a predicate over live state. A claim that holds is
 * worth credit; a claim that does not is worth a penalty and a named note,
 * because being caught out on your own numbers is the lesson.
 *
 * Only unambiguous claims are here. "We're doing well" is not checkable and is
 * not checked — a scorer that punished vagueness as dishonesty would be lying
 * about its own confidence.
 */
const CLAIMS: {
  id: string;
  pattern: RegExp;
  holds(s: RunState): boolean;
  trueNote: string;
  falseNote: string;
}[] = [
  {
    id: "profitable",
    pattern: /\b(profitable|in profit|making a profit|we'?re profitable|turning a profit)\b/i,
    holds: (s) => s.stats.burnMonthly <= 0,
    trueNote: "You said you were profitable, and the books agree.",
    falseNote: "You said you were profitable while the company is burning cash. That is checkable, and they checked.",
  },
  {
    id: "growing",
    pattern: /\b(growing|growth|scaling|taking off|doubling|tripled|doubled)\b/i,
    holds: (s) => s.stats.revenueAnnual > 0,
    trueNote: "You claimed growth and there is revenue behind it.",
    falseNote: "You claimed growth with no revenue on the books yet.",
  },
  {
    id: "margin",
    pattern: /\b(strong margins?|good margins?|healthy margins?|high margins?)\b/i,
    holds: (s) => s.stats.grossMarginPt >= 55,
    trueNote: "Your margin claim stands up.",
    falseNote: "You called your margins strong. They are not, and this room can read a P&L.",
  },
  {
    id: "runway",
    pattern: /\b(plenty of runway|lots of runway|runway is fine|we'?re fine on cash)\b/i,
    holds: (s) => s.stats.burnMonthly <= 0 || s.stats.cash / Math.max(1, s.stats.burnMonthly) >= 12,
    trueNote: "The runway is as comfortable as you said.",
    falseNote: "You said the runway was fine. It is under a year, and that is the first thing anyone checks.",
  },
  {
    id: "loved",
    pattern: /\b(customers love|people love|they love it|everyone loves)\b/i,
    holds: (s) => s.stats.csat >= 60,
    trueNote: "Your customers do rate you, and you were right to lead with it.",
    falseNote: "You said customers love it. Your satisfaction numbers say otherwise.",
  },
  {
    id: "team",
    pattern: /\b(great team|strong team|the team is|my team)\b/i,
    holds: (s) => s.stats.morale >= 55,
    trueNote: "You talked about the team, and the team is in good shape.",
    falseNote: "You talked up the team. Morale is low enough that it would show in a reference call.",
  },
];

// ── Scoring ─────────────────────────────────────────────────────────────────

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * Score a transcript on substance.
 *
 * `wants` is the cold-call caller's stated interest. Omit it for the Tank pitch,
 * where there is no single listener to be relevant to.
 */
export function scorePitchContent(
  transcript: string,
  state: RunState,
  wants?: string,
): ContentScore {
  const text = (transcript ?? "").toLowerCase();
  const words = wordCount(transcript ?? "");
  const findings: ContentFinding[] = [];

  if (words < 8) {
    return {
      score: 0,
      words,
      empty: true,
      findings: [
        {
          kind: "missing",
          note: "There was not enough here to judge. Say what the business is and why it is worth their money.",
          weight: 0,
        },
      ],
    };
  }

  // 1 · Coverage — up to 5 of the 10 points, because doing the four jobs is the
  //     floor of a competent pitch rather than the ceiling of a good one.
  let covered = 0;
  for (const topic of TOPICS) {
    const hit = topic.terms.some((t) => text.includes(t));
    if (hit) {
      covered += 1;
      findings.push({ kind: "covered", note: `You covered ${topic.label}.`, weight: 1.25 });
    } else {
      findings.push({
        kind: "missing",
        note: `You never got to ${topic.label}.`,
        weight: 0,
      });
    }
  }

  // 2 · Specificity — a figure, any figure. Two points.
  const hasNumber = SPECIFIC.test(transcript) || MONEY.test(transcript);
  findings.push(
    hasNumber
      ? { kind: "specific", note: "You put real numbers in it.", weight: 2 }
      : {
          kind: "vague",
          note: "Not one number in the whole pitch. Adjectives are free; figures are not.",
          weight: 0,
        },
  );

  // 3 · Honesty — the checkable part. Credit for claims that hold, a real
  //     penalty for ones the books contradict.
  let honesty = 0;
  for (const claim of CLAIMS) {
    if (!claim.pattern.test(transcript)) continue;
    if (claim.holds(state)) {
      honesty += 0.75;
      findings.push({ kind: "honest", note: claim.trueNote, weight: 0.75 });
    } else {
      honesty -= 1.75;
      findings.push({ kind: "contradiction", note: claim.falseNote, weight: -1.75 });
    }
  }
  honesty = Math.max(-3.5, Math.min(2, honesty));

  // 4 · Relevance — cold calls only. One point for answering the actual person.
  let relevance = 0;
  if (wants) {
    const wantWords = wants
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const touched = wantWords.filter((w) => text.includes(w)).length;
    if (touched > 0) {
      relevance = 1;
      findings.push({
        kind: "relevant",
        note: "You answered what they actually asked about.",
        weight: 1,
      });
    } else {
      findings.push({
        kind: "missing",
        note: "They told you what they were listening for. You talked about something else.",
        weight: 0,
      });
    }
  }

  const raw = covered * 1.25 + (hasNumber ? 2 : 0) + honesty + relevance;
  // Clamped to the 0..10 scale the panel, the year gate and the autopsy share.
  const score = Math.max(0, Math.min(10, Number(raw.toFixed(1))));
  return { score, findings, words, empty: false };
}

/**
 * Delivery figures, for the coach panel only.
 *
 * Separated into its own function so the boundary is structural rather than a
 * comment someone can miss: nothing in here is allowed near `scorePitchContent`,
 * and a future edit that tries to fold it in has to delete this note first.
 */
export function deliveryMetrics(transcript: string, durationSeconds: number) {
  const words = wordCount(transcript);
  /*
   * Two lexicons, because the browser lies by omission.
   *
   * Chrome's recognizer CLEANS the transcript: "um" and "uh" are stripped before
   * we ever see them, which is why the first user test reported that fillers
   * were not detected — they had been laundered out upstream. So:
   *
   *   · HEARABLE — fillers that survive browser recognition ("like", "you
   *     know", "basically", "I mean"…). Counted from any transcript.
   *   · VERBATIM-ONLY — "um/uh/er". These only exist in the text when a server
   *     STT in verbatim mode produced it. Counted when present, and the coach
   *     card says plainly that the browser cannot hear these.
   *
   * Hesitation PAUSES are the browser-safe proxy for "um" — the delivery coach
   * counts them from the level meter (VolumeCoaching.dropouts), not from text.
   */
  const HEARABLE =
    /\b(like|you know|basically|literally|sort of|kind of|i mean|actually|honestly|right\?|whatever|stuff like that)\b/gi;
  const VERBATIM = /\b(um+|uh+|er+|erm+|hmm+|mhm+)\b/gi;
  const hearable = transcript.match(HEARABLE) ?? [];
  const verbatim = transcript.match(VERBATIM) ?? [];
  const all = [...hearable, ...verbatim];
  const minutes = durationSeconds > 0 ? durationSeconds / 60 : 0;
  return {
    word_count: words,
    wpm: minutes > 0 ? Math.round(words / minutes) : 0,
    filler_count: all.length,
    fillers_per_minute: minutes > 0 ? Number((all.length / minutes).toFixed(1)) : 0,
    top_fillers: [...new Set(all.map((f) => f.toLowerCase()))].slice(0, 3),
    /** True when the transcript could even contain um/uh. */
    verbatim_capable: verbatim.length > 0,
  };
}
