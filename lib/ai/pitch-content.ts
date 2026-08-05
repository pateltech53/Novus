import type { RunState } from "@/lib/engine/types";
import { developedSentences, saidIn } from "@/lib/engine/company-brief";

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
 * All four are scaled by COHERENCE — whether the transcript is a person saying
 * things at all, rather than one line looped to fill the time or a keyword list
 * assembled by someone who worked out that the words are the score. Coverage is
 * keyword matching and keyword matching is gameable; the coherence read is what
 * stops the cheapest way of gaming it. It never scales a PENALTY: being caught
 * claiming a profit you do not have costs the same either way.
 *
 * ── The other half: answers ────────────────────────────────────────────────
 *
 * `scoreAnswer` and `scoreAnswers` further down grade what the founder said
 * under questioning in The Tank, on the same principle and with the same
 * transparency. They are here rather than beside the panel because they share
 * this file's vocabulary and its one rule: judge the substance of what was
 * said, never the person who said it or the way they said it.
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

  /*
   * Is this a pitch at all?
   *
   * Coverage is keyword matching, and keyword matching is gameable by anyone
   * who works out that the words are the score: say "customers", "revenue" and
   * "investment" enough times, in any order, and the old scorer paid out. The
   * coherence read is the guard — it asks whether the transcript is language,
   * and whether it is the same six words on a loop — and it scales everything
   * this function CREDITS. It never scales what this function PENALISES: being
   * caught claiming a profit you do not have still costs, gibberish or not.
   */
  const coherence = transcriptCoherence(transcript ?? "");
  if (words >= 8 && coherence < 0.25) {
    return {
      score: 0,
      words,
      empty: false,
      findings: [
        {
          kind: "missing",
          note: "There was no pitch in that — the same handful of words, or none that mean anything. Say what the business is, who pays for it, and what you want.",
          weight: 0,
        },
      ],
    };
  }

  /*
   * Is this about a business at all?
   *
   * The coherence read above catches gibberish and a line on a loop. It does
   * not catch fluent English about nothing, and that is the other half of what
   * players reported: "I am the pickle man… Pickles are in the supermarket. I
   * want money" came back at 2.5/10 having supposedly covered three of the
   * seven beats, and a transcript about someone's trip to the shop scored 1.3
   * for covering "what the business actually is".
   *
   * Coverage is per topic, so ONE stray trade word — shop, sell, customers —
   * used to be worth a topic and a compliment. A pitch talks about a business
   * throughout; a joke brushes past a business word on its way somewhere else.
   * Three distinct trade words is the line, and a figure counts as one because
   * numbers are what pitches are made of. A real pitch of any length clears it
   * without trying; nothing that isn't a pitch clears it at all.
   */
  if (words >= 8 && businessSubstance(transcript ?? "") < 3) {
    return {
      score: 0,
      words,
      empty: false,
      findings: [
        {
          kind: "missing",
          note: "There was no business in that. A pitch has to say what you sell, who buys it, what it costs and what you want — this said none of them.",
          weight: 0,
        },
      ],
    };
  }

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

  /*
   * 1 · Coverage — up to 5 of the 10 points, because doing the four jobs is the
   *     floor of a competent pitch rather than the ceiling of a good one.
   *
   * Matched the same way `beatsCovered` matches, and for the same reason: a
   * term has to appear as a whole word inside a sentence that develops
   * something. `text.includes("shop")` was true of "I went to the workshop",
   * and a player who talked about their weekend was told they had covered what
   * the business actually is.
   */
  const claims = developedSentences(transcript ?? "");
  let covered = 0;
  for (const topic of TOPICS) {
    const hit = claims.some((s) => topic.terms.some((t) => saidIn(s, t)));
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

  const earned = (covered * 1.25 + (hasNumber ? 2 : 0) + relevance) * coherence;
  if (coherence < 1) {
    findings.push({
      kind: "vague",
      note: "Most of that was the same thing said again. Repeating a line is not covering a topic.",
      weight: 0,
    });
  }
  const raw = earned + honesty;
  // Clamped to the 0..10 scale the panel, the year gate and the autopsy share.
  const score = Math.max(0, Math.min(10, Number(raw.toFixed(1))));
  return { score, findings, words, empty: false };
}

/**
 * 0..1 — how much of this transcript is a person saying things.
 *
 * Three reads, and the worst of them wins, because any one of them being bad
 * is enough to make the coverage score meaningless:
 *
 *   · LANGUAGE — the share of tokens that are real words. Keyboard mash and
 *     strings of non-words fail here.
 *   · REPETITION — the share of tokens that are distinct. One phrase looped
 *     to fill ninety seconds fails here, and it is the cheapest way to beat a
 *     keyword scorer.
 *
 * Short transcripts are exempt from the repetition read: a tight forty-word
 * pitch has a naturally high distinct-word ratio and a ten-word one tells you
 * nothing either way. This is deliberately not a fluency test — it cannot be
 * failed by an accent, a stumble or imperfect grammar, none of which change
 * whether the words are distinct words (Brand Law 5).
 */
function transcriptCoherence(transcript: string): number {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 8) return 1;

  const alpha = tokens.filter((t) => /[a-z]/.test(t));
  const mashShare = alpha.length ? alpha.filter(looksMashed).length / alpha.length : 0;
  if (mashShare >= 0.5) return 0;

  const anchoredShare =
    tokens.filter((t) => /\d/.test(t) || ANCHORS.has(t.replace(/[^a-z']/g, ""))).length /
    tokens.length;
  const language = clamp01((anchoredShare - 0.15) / 0.2);

  const distinct = new Set(tokens).size / tokens.length;
  const repetition = tokens.length >= 24 ? clamp01((distinct - 0.2) / 0.2) : 1;

  return Math.min(language, repetition);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * How many distinct pieces of business vocabulary a transcript actually uses.
 *
 * Whole-word matched, distinct-counted, and a figure is worth one — so
 * repeating "customers, customers, customers" is one word, not three, and
 * "we charge 34 dollars" is two signals rather than one. It is a count of
 * SUBJECTS raised, which is what separates a pitch from a sentence that
 * happened to contain the word "shop".
 */
function businessSubstance(transcript: string): number {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const distinct = new Set(tokens.filter((t) => TRADE.has(t)));
  return distinct.size + (SPECIFIC.test(transcript) || MONEY.test(transcript) ? 1 : 0);
}

// ── Answer quality ──────────────────────────────────────────────────────────

export interface AnswerQuality {
  /**
   * 0..1 — how much this answer should count as "held up under questioning".
   * 0 is silence, keyboard mash, or an answer to a question nobody asked;
   * 1 is a relevant answer with a figure and a reason in it.
   */
  quality: number;
  /** The tier the debrief shows and the offline sharks react to. */
  tier: "dodged" | "shaky" | "adequate" | "strong";
  /**
   * True when the founder said something, in English, about nothing that was
   * asked. "I like pickles" and "we sell pickles" both land here — the second
   * is at least about the business, and neither is an answer to a question
   * about churn. Kept separate from the tier because the debrief may not call
   * a real sentence "silence", but the room must not price it as a defence.
   */
  offTopic: boolean;
  /** Why it graded that way, in the founder's language. Never about delivery. */
  note: string;
  /** The three things this reads, exposed so every grade can be argued with. */
  signals: { onTopic: number; substance: number; reasoning: number };
}

/**
 * The defence floor.
 *
 * Below this, averaged across everything the room asked, no shark writes a
 * cheque — in the offline maths (`lib/ai/panel-local.ts`) and as a server-side
 * override on the live model (`app/api/panel/route.ts`). It sits above the
 * score an off-topic answer can earn on purpose: a founder who answers five
 * questions with five things that are not answers has not defended anything,
 * however good the books look.
 */
export const DEFENCE_FLOOR = 0.3;

/**
 * Words that anchor a sentence as an actual sentence. Function words plus the
 * business vocabulary the rest of this file already scores on. A real answer of
 * any length contains several of these; a fistful of keyboard mash contains
 * none. Deliberately a list rather than a model, for the same reason as
 * everything else in this file: every judgement it makes can be read.
 */
const ANCHORS = new Set(
  (
    "the a an i we our my you your it its they them their this that these those " +
    "is are was were be been am do does did have has had will would can could " +
    "should might must and or but so because if when then than as of to in on " +
    "at by for from with about into over under after before not no yes more " +
    "most less least very really just also still only even much many some few " +
    "make makes made sell sells sold buy build built run runs get got keep grow " +
    "growing know think want need say said per month monthly year yearly week " +
    "day people team customer customers client clients user users market money " +
    "revenue profit margin margins cost costs price pricing cash burn runway " +
    "churn growth sales product service plan number percent"
  ).split(/\s+/),
);

/**
 * Pure function words. Everything else in a sentence is content.
 *
 * Separate from ANCHORS on purpose: ANCHORS answers "is this language at all"
 * and therefore includes the trade vocabulary, while this answers "which words
 * in this question are the question" and must not. If "churn" counted as a stop
 * word, a churn question would have nothing left to be about.
 */
const STOP = new Set(
  (
    "the a an and or but so if then than that this these those there here it its " +
    "is are was were be been being am do does did done have has had will would " +
    "can could should might must shall may i we you they he she them us our my " +
    "your their his her me him what which who whom whose when where why how not " +
    "no yes of to in on at by for from with about into over under after before " +
    "again more most less least very really just also still only even much many " +
    "some few any all both each other another such own same too own get got give " +
    "tell talk say said walk take like want know think going go come make made " +
    "one two three now today thing things something anything nothing"
  ).split(/\s+/),
);

/**
 * What a question is ABOUT, and what an answer to it would sound like.
 *
 * The old relevance test was a substring check: an answer was "relevant" if it
 * repeated one of the question's own long words. That is a test a parrot passes
 * and a good founder fails — "how many of them cancel in the first month, and
 * do you know why" is answered by "most of them leave before the trial ends
 * because setup takes a week", which contains not one word of the question.
 *
 * So relevance is matched on TOPIC. Each cluster is a subject a shark asks
 * about and the vocabulary an honest answer to it uses. A question and an
 * answer that land in the same cluster are talking about the same thing, and
 * one that lands nowhere near it is talking about something else — which is
 * exactly the complaint this scoring exists to answer.
 *
 * Word matching is prefix-based (`churn` matches `churning`), so the lists hold
 * roots rather than every inflection. Multi-word entries are matched as
 * phrases. Deliberately a table rather than a model, like everything else here:
 * every judgement it makes can be read off the page and argued with.
 */
const CLUSTERS: { id: string; words: string[] }[] = [
  {
    id: "cash",
    words: [
      "runway", "cash", "burn", "month", "months", "fund", "funding", "raise",
      "raising", "bank", "reserve", "spend", "spending", "extend", "survive",
      "cut", "afford", "broke", "out of money", "bridge", "loan", "debt",
    ],
  },
  {
    id: "retention",
    words: [
      "churn", "cancel", "leave", "leaving", "left", "lose", "losing", "lost",
      "stay", "staying", "stick", "retain", "retention", "repeat", "return",
      "returning", "renew", "renewal", "subscribe", "subscription", "lapse",
      "loyal", "loyalty", "come back", "second order", "reorder", "trial",
      "cohort", "sign up", "signup", "first month", "first order", "drop off",
    ],
  },
  {
    id: "unit",
    words: [
      "cac", "ltv", "lifetime", "acquisition", "payback", "unit", "contribution",
      "per customer", "per order", "ad spend", "advertising", "marketing spend",
      "cost to acquire", "cost per",
    ],
  },
  {
    id: "margin",
    words: [
      "margin", "cogs", "cost", "costs", "supplier", "suppliers", "manufactur",
      "factory", "price", "pricing", "charge", "wholesale", "retail", "freight",
      "shipping", "packaging", "ingredient", "material", "labour", "labor",
      "overhead", "cent", "cents",
    ],
  },
  {
    id: "growth",
    words: [
      "grow", "growing", "growth", "market", "tam", "share", "expand", "scale",
      "scaling", "compet", "demand", "segment", "bigger", "double", "triple",
      "national", "international", "category", "audience size",
    ],
  },
  {
    id: "product",
    words: [
      "product", "build", "built", "feature", "quality", "ship", "shipping",
      "break", "breaks", "broken", "supply", "capacity", "inventory", "stock",
      "fulfil", "fulfill", "engineer", "develop", "prototype", "recipe",
      "app", "site", "platform", "service", "menu", "line",
      "sell", "selling", "sold", "brand", "range", "launch",
    ],
  },
  {
    id: "customer",
    words: [
      "customer", "customers", "client", "user", "users", "buyer", "member",
      "subscriber", "complain", "complaint", "feedback", "survey", "support",
      "interview", "review", "reviews", "rating", "satisfaction", "happy",
      "unhappy", "refund", "audience", "diner", "parent", "school", "shopper",
    ],
  },
  {
    id: "team",
    words: [
      "team", "hire", "hiring", "hired", "staff", "employee", "morale",
      "founder", "cofounder", "co-founder", "partner", "quit", "resign",
      "manager", "role", "headcount", "salary", "pay them",
    ],
  },
  {
    id: "deal",
    words: [
      "valuation", "worth", "equity", "dilution", "dilute", "stake", "offer",
      "deal", "terms", "invest", "investment", "investor", "round", "percent",
      "share of", "cheque", "check", "royalty", "milestone", "board",
    ],
  },
  {
    id: "plan",
    words: [
      "plan", "planning", "roadmap", "next", "milestone", "target", "goal",
      "first thing", "we would", "we will", "we'd", "we'll", "going to",
      "intend", "strategy", "fix", "fixing", "test", "tested", "trial", "pilot",
    ],
  },
];

/** Every trade word in the file, in one set, for the substance read. */
const TRADE = new Set<string>([
  ...CLUSTERS.flatMap((c) => c.words.filter((w) => !w.includes(" "))),
  ...TOPICS.flatMap((t) => t.terms.filter((w) => !w.includes(" "))),
]);

/**
 * Language that shows the founder thought about it rather than recited it.
 *
 * A cause, a consequence, a comparison or a plan. This is the closest thing in
 * a keyword scorer to reading for intelligence, and it is the difference
 * between "churn is 6%" and "churn is 6% because setup takes a week, so we're
 * rebuilding the first-run flow". Both are answers; the second is the one a
 * room pays for.
 */
const REASONING =
  /\b(because|since|so that|so we|which means|that means|the reason|therefore|due to|thanks to|in order to|that's why|thats why|if we|once we|after we|when we|instead of|whereas|compared|versus|vs|down from|up from|from \d|by cutting|by adding|we tested|we found|we learned|we tried|which is why)\b/i;

/** The keyboard's three letter rows, for spotting home-row mash like "asdf". */
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** True when a token reads as keyboard mash rather than a word. */
function looksMashed(token: string): boolean {
  const t = token.toLowerCase().replace(/[^a-z]/g, "");
  if (t.length < 3) return false;
  // No vowel at all in a 3+ letter token — "hjkl", "zxcv".
  if (!/[aeiouy]/.test(t)) return true;
  // One letter leaned on — "aaaa", "ssss".
  if (/(.)\1{2,}/.test(t)) return true;
  // Mostly keyboard-adjacent bigrams — "asdf", "qwerty", "sdfg".
  let adjacent = 0;
  for (let i = 0; i < t.length - 1; i += 1) {
    const row = KEY_ROWS.find((r) => r.includes(t[i]));
    if (row && Math.abs(row.indexOf(t[i]) - row.indexOf(t[i + 1])) === 1) adjacent += 1;
  }
  return adjacent / (t.length - 1) >= 0.6;
}

/** Lowercased, punctuation-flattened, padded so phrase lookups can't straddle. */
function normalize(s: string): { text: string; tokens: string[] } {
  const flat = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$£€%'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text: ` ${flat} `, tokens: flat ? flat.split(" ") : [] };
}

/** Prefix match, so one root covers its inflections. */
const wordHit = (tokens: string[], word: string) =>
  tokens.some((t) => t === word || (word.length >= 4 && t.startsWith(word)));

/**
 * What KIND of figure a piece of text contains — a percentage, a sum of money,
 * a length of time.
 *
 * A shark's question usually quotes one ("you're losing 9% of customers every
 * month"), and a founder who comes back with a figure of the same kind has
 * engaged with it even in four words. Without this, "About 9%, mostly the
 * free-trial cohort" reads as off-topic — it repeats none of the question's
 * vocabulary — and a terse, correct, numerate answer is the last thing this
 * scoring should punish.
 */
function figureKinds(s: string): Set<string> {
  const kinds = new Set<string>();
  if (/\d\s?%|\b\d+(\.\d+)?\s?percent\b/i.test(s)) kinds.add("pct");
  if (/[$£€]\s?\d|\b\d+(\.\d+)?\s?(k|m|bn|thousand|million|dollars?|cents?|quid|pounds?)\b/i.test(s)) {
    kinds.add("money");
  }
  if (/\b\d+(\.\d+)?\s?(day|days|week|weeks|month|months|year|years|quarter|quarters)\b/i.test(s)) {
    kinds.add("time");
  }
  if (/\b\d+(\.\d+)?\s?(x|times|people|customers|users|orders|units|staff|employees)\b/i.test(s)) {
    kinds.add("count");
  }
  return kinds;
}

/** Which subjects this text is talking about. */
function clustersIn(text: string, tokens: string[]): Set<string> {
  const found = new Set<string>();
  for (const cluster of CLUSTERS) {
    const hit = cluster.words.some((w) =>
      w.includes(" ") ? text.includes(` ${w}`) : wordHit(tokens, w),
    );
    if (hit) found.add(cluster.id);
  }
  return found;
}

/**
 * How much one answer to one shark question should count.
 *
 * The offline offer maths, the live route's floor and the debrief's per-answer
 * labels all read this one function, so a non-answer is worthless everywhere by
 * the same rule.
 *
 * ── What changed, and the complaint that changed it ────────────────────────
 *
 * The old version handed out 0.4 — nearly half credit — to ANY string of real
 * English that was not keyboard mash, and treated relevance as a 0.2 bonus for
 * repeating one of the question's own words. "I like pickles" therefore scored
 * 0.4, three of them held the room at 0.4, and 0.4 was comfortably enough to be
 * offered money. Players found that immediately and reported exactly the right
 * thing: the sharks were paying for the balance sheet and pretending to listen.
 *
 * So credit is now earned rather than granted, from three readable signals:
 *
 *   · ON TOPIC — does the answer land on the subject the question was about?
 *     Matched by topic cluster, not by echoing the question's words, so a
 *     founder can answer a churn question without ever saying "churn".
 *   · SUBSTANCE — figures, units and real trade vocabulary. What makes an
 *     answer checkable rather than merely agreeable.
 *   · REASONING — a cause, a consequence, a comparison or a plan. The signal
 *     that a person thought about the question instead of filling the silence.
 *
 * An answer that engages nothing that was asked cannot be rescued by the other
 * two: at best it is `offTopic` and worth a fifth of an answer, and with no
 * business content in it at all it is worth what silence is worth. That is the
 * whole fix — everything downstream already prices a zero correctly.
 *
 * What it still never reads: length for its own sake, spelling, grammar,
 * fluency, or anything about how the answer was delivered (Brand Law 5). A
 * short, plain, on-topic answer in imperfect English outscores a long
 * confident one about nothing, and that is the intended ordering.
 */
export function scoreAnswer(question: string, answer: string): AnswerQuality {
  const raw = (answer ?? "").trim();
  const nothing = (note: string, signals = ZERO_SIGNALS): AnswerQuality => ({
    quality: 0,
    tier: "dodged",
    offTopic: false,
    note,
    signals,
  });

  if (!raw) return nothing("No answer. In a real room, silence is priced.");

  const { text, tokens } = normalize(raw);
  const alphaTokens = tokens.filter((t) => /[a-z]/.test(t));
  const mashed = alphaTokens.filter(looksMashed).length;
  const anchored = tokens.filter(
    (t) => /\d/.test(t) || ANCHORS.has(t.replace(/[^a-z']/g, "")),
  ).length;

  // Keyboard mash, or a string of "words" none of which is one: worth exactly
  // what silence is worth, because it is silence wearing a costume.
  const mashHeavy = alphaTokens.length > 0 && mashed / alphaTokens.length >= 0.5;
  const noLanguage = tokens.length >= 3 && anchored === 0 && !/\d/.test(text);
  if (mashHeavy || noLanguage) {
    return nothing("That was not language. The room prices it exactly like silence.");
  }

  // ── The three signals ────────────────────────────────────────────────────
  const q = normalize(question ?? "");
  const askedAbout = clustersIn(q.text, q.tokens);
  const talkedAbout = clustersIn(text, tokens);
  const questionWords = q.tokens.filter((w) => w.length > 3 && !STOP.has(w));

  /*
   * The question, read back.
   *
   * Almost all of it is the shark's own words and almost none of it is the
   * founder's. It scores well on every relevance test ever written — it is
   * maximally on-topic — and it contains no information at all, which is why
   * it is checked before the signals rather than balanced against them.
   */
  const contentTokens = tokens.filter((t) => t.length > 3 && !STOP.has(t));
  const borrowed = contentTokens.filter((t) => questionWords.includes(t)).length;
  if (
    questionWords.length >= 3 &&
    contentTokens.length >= 3 &&
    borrowed / contentTokens.length >= 0.8
  ) {
    return nothing("That was the question read back with nothing added to it.");
  }

  // A figure of the kind the question was about. Four numerate words can be a
  // complete answer, and they rarely repeat any of the question's vocabulary.
  const askedFor = figureKinds(question ?? "");
  const sharedFigure = [...figureKinds(raw)].some((k) => askedFor.has(k)) ? 0.55 : 0;

  let onTopic: number;
  if (askedAbout.size > 0) {
    let shared = 0;
    for (const id of askedAbout) if (talkedAbout.has(id)) shared += 1;
    // Echoing the question's own content words is worth something, but less
    // than actually landing on the subject — a parrot should not outscore a
    // founder who answered in their own words.
    const echoed = questionWords.filter((w) => wordHit(tokens, w)).length;
    const echo = questionWords.length ? Math.min(1, echoed / questionWords.length) * 0.7 : 0;
    onTopic = Math.max(shared / askedAbout.size, echo, sharedFigure);
  } else if (questionWords.length > 0) {
    const echoed = questionWords.filter((w) => wordHit(tokens, w)).length;
    onTopic = Math.max(Math.min(1, echoed / Math.min(3, questionWords.length)), sharedFigure);
  } else {
    // No question to be relevant to — the seat reacting to the last thing said,
    // or a transcript where the question did not come through. Judge it on
    // substance alone rather than crediting relevance nobody can check.
    onTopic = -1;
  }

  const figure = /[$£€]\s?\d|\b\d+(\.\d+)?\s?(k|m|bn|%|percent|dollars?|cents?|months?|weeks?|days?|years?|times|x)\b/i.test(
    raw,
  )
    ? 0.5
    : /\d/.test(raw)
      ? 0.3
      : 0;
  const tradeWords = new Set(tokens.filter((t) => TRADE.has(t))).size;
  const substance = Math.min(1, figure + Math.min(0.5, tradeWords * 0.17));
  const reasoning = REASONING.test(raw) ? (tokens.length >= 12 ? 1 : 0.6) : 0;
  const signals = { onTopic: Math.max(0, onTopic), substance, reasoning };

  // ── The gate ─────────────────────────────────────────────────────────────
  // Answering a question nobody asked is not answering. This is the line the
  // old scorer did not have, and the only reason "I like pickles" was priced.
  if (onTopic >= 0 && onTopic < 0.2) {
    if (substance < 0.34) {
      return {
        quality: 0,
        tier: "dodged",
        offTopic: true,
        note: "That had nothing to do with what you were asked. The room prices it exactly like silence.",
        signals,
      };
    }
    return {
      quality: 0.2,
      tier: "shaky",
      offTopic: true,
      // Talking about the business is not the same as answering the question,
      // and a founder who does it five times has defended nothing.
      note: "You talked about the business, but not about what was actually asked.",
      signals,
    };
  }

  if (onTopic < 0) {
    // Substance-only path. A sentence with no trade content and no reasoning in
    // it is a shrug however grammatical it is.
    if (substance < 0.2 && reasoning === 0) {
      return {
        ...nothing("There was nothing in that the room could price.", signals),
        offTopic: true,
      };
    }
    const quality = Math.min(1, 0.3 + substance * 0.45 + reasoning * 0.25);
    return { quality, tier: tierFor(quality), offTopic: false, note: noteFor(quality), signals };
  }

  const quality = Math.min(
    1,
    0.35 + onTopic * 0.3 + substance * 0.2 + reasoning * 0.15,
  );
  return { quality, tier: tierFor(quality), offTopic: false, note: noteFor(quality), signals };
}

const ZERO_SIGNALS = { onTopic: 0, substance: 0, reasoning: 0 };

const tierFor = (q: number): AnswerQuality["tier"] =>
  q === 0 ? "dodged" : q >= 0.75 ? "strong" : q >= 0.5 ? "adequate" : "shaky";

const noteFor = (q: number): string =>
  q >= 0.75
    ? "You answered the question, with something checkable in it."
    : q >= 0.5
      ? "You answered, but without much in it a room could verify. A figure would have closed it."
      : "You engaged with the question and then said very little. That reads as not knowing.";

/**
 * Everything the founder said under questioning, priced as one defence.
 *
 * The offline offer maths and the live route's override both need the same
 * number, and before this they each computed their own — which meant the two
 * rooms could disagree about whether a founder had answered anything. This is
 * the single reading, and it also catches the one trick a per-answer scorer
 * cannot see by construction: SAYING THE SAME THING AGAIN. One prepared
 * sentence pasted into five questions is one answer, not five, and repeats
 * after the first are worth nothing — which is what they were worth in the
 * room. Everything else a single answer can be is decided by `scoreAnswer`, so
 * that a caller holding one question and one answer grades it identically.
 */
export interface AnswerRecord {
  question: string;
  answer: string;
  declined?: boolean;
}

export interface DefenceRead {
  /** How many questions the room actually put to them. */
  asked: number;
  /** How many got an answer worth anything at all. */
  answered: number;
  /** 0..1 — the share of the interrogation they stood up to. */
  held: number;
  perAnswer: (AnswerQuality & { question: string; answer: string })[];
}

export function scoreAnswers(answers: AnswerRecord[]): DefenceRead {
  const seen: Set<string>[] = [];
  const perAnswer = (answers ?? []).map((a) => {
    const question = typeof a.question === "string" ? a.question : "";
    const answer = typeof a.answer === "string" ? a.answer : "";
    if (a.declined || !answer.trim()) {
      return {
        question,
        answer,
        ...scoreAnswer(question, ""),
      };
    }

    let graded = scoreAnswer(question, answer);
    const { tokens } = normalize(answer);
    const content = new Set(tokens.filter((t) => t.length > 3 && !STOP.has(t)));

    // The same answer again. Compared on content words so re-wording it does
    // not launder it, and only for answers long enough that the overlap means
    // something — two terse figures that happen to match are not a trick.
    if (graded.quality > 0 && content.size >= 4) {
      const repeat = seen.some((prev) => overlap(prev, content) >= 0.8);
      if (repeat) {
        graded = {
          quality: 0,
          tier: "dodged",
          offTopic: graded.offTopic,
          note: "You had already given that exact answer. Saying it again answers nothing new.",
          signals: graded.signals,
        };
      }
      seen.push(content);
    }

    return { question, answer, ...graded };
  });

  const asked = perAnswer.length;
  const answered = perAnswer.filter((a) => a.quality > 0).length;
  const held = asked > 0 ? perAnswer.reduce((s, a) => s + a.quality, 0) / asked : 0.5;
  return { asked, answered, held, perAnswer };
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
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
