import type { PanelContext, AttackPoint } from "./panel-context";
import type { SharkId, SharkOffer, SharkQuestions, SharkOfferTurn, SharkNegotiateTurn } from "./types";
import { CAST } from "./panel-cast";
import { scoreAnswer, scoreAnswers, DEFENCE_FLOOR } from "./pitch-content";
import { hashString, mulberry32 } from "@/lib/engine/rng";

/**
 * THE OFFLINE SHARK — the panel, with no model behind it.
 *
 * ── Why this is not the old fallback ───────────────────────────────────────
 *
 * The previous offline panel was `lib/ai/fixtures/panel-scripts.json`: three
 * scripts chosen by score band and replayed word for word. It is the reason
 * players report that the sharks ask the same thing every time and that the
 * questions have nothing to do with their company — because they were written
 * before the company existed and there were only ever three of them.
 *
 * This reads the same attack points the live route reads
 * (`lib/ai/panel-context.ts`), which are computed from the player's actual
 * books, their actual brief, and which of the seven pitch beats they actually
 * covered. So the offline room asks about the runway when the runway is short,
 * about churn when churn is high, and about the ask when they forgot to make
 * one. Two different companies get two different interrogations, and no
 * question is ever asked twice in a session because asked questions are removed
 * from the pool.
 *
 * It is a worse room than the live one — it cannot follow up on the CONTENT of
 * an answer, only on whether one was given. That is a real limitation and the
 * debrief says so. But it is a defensible room on its own, which is the bar a
 * fallback has to clear in a codebase where every AI feature degrades to one.
 *
 * ── The rules it inherits ──────────────────────────────────────────────────
 *
 * · It never writes the founder's dialogue.
 * · It never comments on delivery — not pace, not fillers, not nerves.
 * · Its arithmetic ties out: implied valuation is always amount ÷ equity.
 */

/** How each shark opens on a weakness, in their own register. */
const OPENERS: Record<SharkId, string[]> = {
  marcus: [
    "Before we tour the dream, let's tour the books.",
    "One number, and then I'll stop.",
    "I've been recomputing while you talked. Something doesn't tie out.",
    "Revenue is vanity. Margin is sanity. Let's do sanity.",
  ],
  serena: [
    "Forget this quarter — I want to know how big this gets.",
    "I'm already three steps ahead of you, so let me jump.",
    "Everyone else will ask you about today. I don't care about today.",
    "Here's the version of this I'm excited about. Tell me if I'm wrong.",
  ],
  dev: [
    "I've built one of these. So I'll ask the boring question.",
    "Let's talk about the part that breaks.",
    "Walk me through it like I'm going to have to run it Monday.",
    "I want the mechanics, not the story.",
  ],
  lily: [
    "I want to talk about the people on the other end of this.",
    "Somebody bought this and then didn't come back. Let's talk about them.",
    "You've told me what you sell. Tell me who you sell it to.",
    "I noticed who you thanked. Now tell me who you didn't.",
  ],
  viktor: [
    "I'm going to describe how this dies. Correct me where I'm wrong.",
    "Not being cruel. Being early.",
    "Every company at this table has one thing that kills it. Here's yours.",
    "I'll ask the question nobody enjoys.",
  ],
};

/** What they say when the founder gave them a real answer. */
const AFTER_GOOD: Record<SharkId, string[]> = {
  marcus: ["That's a number. Thank you.", "Fine. That one ties out."],
  serena: ["Okay — now I'm listening.", "That's the first thing you've said that scales."],
  dev: ["Good. That's how someone who's done it answers.", "That's the right answer to that question."],
  lily: ["That's a person, not a segment. I like that.", "You've actually talked to them. It shows."],
  viktor: ["Noted. That delays it, it doesn't prevent it.", "Alright. That one I'll grant you."],
};

/** What they say when the founder dodged or said nothing. */
const AFTER_DODGE: Record<SharkId, string[]> = {
  marcus: [
    "Every time that question goes unanswered, my valuation drops. It just did.",
    "That wasn't a number. I asked for a number.",
  ],
  serena: [
    "That's a mood, not a plan.",
    "I wanted the big version and you gave me a shrug.",
  ],
  dev: [
    "That's the answer of someone who hasn't run it yet.",
    "You don't know. That's fine — but say you don't know.",
  ],
  lily: [
    "You didn't answer, and I think you know why.",
    "That's the part you haven't looked at, isn't it.",
  ],
  viktor: [
    "The silence is the diligence.",
    "Right. So that's the thing that kills it.",
  ],
};

const pickFrom = <T,>(list: T[], rng: () => number): T => list[Math.floor(rng() * list.length)];

/**
 * Two questions that a founder would experience as the same question.
 *
 * Compares the significant words rather than the string, so "What's your
 * monthly churn?" and "Tell me your churn rate per month" collide while two
 * genuinely different churn questions do not. The mirror of `similar()` in
 * lib/ai/panel.ts, which guards the live path; this one guards the offline one.
 */
function sameQuestion(a: string, b: string): boolean {
  const key = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const A = key(a);
  const B = key(b);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

function rngFor(ctx: PanelContext, salt: string): () => number {
  return mulberry32(hashString(`panel:${ctx.company.name}:${ctx.company.year}:${salt}`));
}

/**
 * One shark's question.
 *
 * Prefers an unasked weakness this shark personally cares about, falls back to
 * the worst unasked weakness overall, and only then to a general question. The
 * `asked` set is what guarantees a session never repeats itself.
 */
export function localQuestionTurn(opts: {
  shark: SharkId;
  ctx: PanelContext;
  /** Attack-point ids already used this session, by anybody. */
  usedIds: string[];
  /**
   * Every question already asked, live or offline.
   *
   * The id list alone is not enough: a session that starts on the live route
   * and falls back mid-round has asked questions this shark never logged an id
   * for, and re-asking one of those is the single most-reported thing about
   * this room. So the text is checked too.
   */
  askedQuestions?: string[];
  /**
   * The previous answer, for the reaction line — with the question it was an
   * answer to, because "did they say anything" and "did they answer THAT" are
   * different questions and only the second one is worth reacting to.
   */
  lastAnswer?: { text: string; declined: boolean; question?: string } | null;
  round: number;
}): SharkQuestions & { attackId?: string; term?: string } {
  const { shark, ctx } = opts;
  const rng = rngFor(ctx, `${shark}:q:${opts.round}:${opts.usedIds.length}`);
  const asked = opts.askedQuestions ?? [];
  const unused = ctx.attackPoints.filter(
    (a) => !opts.usedIds.includes(a.id) && !asked.some((q) => sameQuestion(q, a.question)),
  );
  const mine = unused.filter((a) => a.owner === shark);
  const point: AttackPoint | undefined = mine[0] ?? unused[0];

  const reaction = reactionLine(shark, opts.lastAnswer, rng);
  const opener = pickFrom(OPENERS[shark], rng);
  const spoken = [reaction, opener].filter(Boolean).join(" ");

  if (!point) {
    // Everything genuinely wrong with this company has already been raised.
    // Rather than inventing a weakness, ask the closing question — which is a
    // real question a room asks when it has run out of holes to poke.
    return {
      spoken,
      questions: [genericClose(shark, ctx, rng)],
      private_notes: `${CAST[shark].name}: no attack points left unasked. Closing on judgement.`,
    };
  }

  return {
    spoken,
    questions: [point.question],
    private_notes: `${CAST[shark].name} on "${point.claim}" — severity ${point.severity}.`,
    attackId: point.id,
    term: point.term,
  };
}

function reactionLine(
  shark: SharkId,
  last: { text: string; declined: boolean; question?: string } | null | undefined,
  rng: () => number,
): string {
  if (!last) return "";
  /*
   * The offline shark reads an answer for substance, never for delivery: a
   * short, correct answer is a good answer, and nothing here scores length,
   * speed, or rhythm. But an answer with no language in it — keyboard mash, a
   * string of non-words — or one that is about something nobody asked, is a
   * dodge wearing a costume, and thanking the founder for it ("That's a number.
   * Thank you.") was the most visible tell that the room wasn't reading.
   * `scoreAnswer` gives both the same zero that silence gets, which is why the
   * question is passed in: without it there is nothing to be off-topic ABOUT.
   */
  const graded = scoreAnswer(last.question ?? "", last.text);
  const nothing = last.declined || graded.quality === 0 || graded.offTopic;
  return pickFrom(nothing ? AFTER_DODGE[shark] : AFTER_GOOD[shark], rng);
}

function genericClose(shark: SharkId, ctx: PanelContext, rng: () => number): string {
  const closes: Record<SharkId, string[]> = {
    marcus: [
      `If I gave you ${money(ctx.ask.amountUsd)} tomorrow, what is the first cheque you write with it?`,
      "What's the number you're least proud of, and why is it that number?",
    ],
    serena: [
      "What does this look like in five years if everything goes right?",
      "What would have to be true for this to be a hundred times bigger?",
    ],
    dev: [
      "What's the one thing you'd fix first if I handed you a month and no money?",
      "Who does the work when you're ill for a week?",
    ],
    lily: [
      "Who is the customer you'd most hate to lose, and do they know that?",
      "What do people say about you when you're not in the room?",
    ],
    viktor: [
      "What's the thing you're hoping nobody at this table asks about?",
      "If this company is gone in two years, what killed it?",
    ],
  };
  return pickFrom(closes[shark], rng);
}

/**
 * One shark's decision on the deal.
 *
 * The whole session prices it. Answering questions raises the offer; dodging
 * them lowers it and eventually ends it — which is Panel Rulebook rule 4, and
 * is the only mechanism in the room that makes answering worth doing.
 */
export function localOfferTurn(opts: {
  shark: SharkId;
  ctx: PanelContext;
  answers: { question: string; answer: string; declined: boolean }[];
  offersOnTable: { shark: SharkId; offer: SharkOffer }[];
  /** 0..10, this year's pitch score. */
  score: number;
}): SharkOfferTurn {
  const { shark, ctx } = opts;
  const rng = rngFor(ctx, `${shark}:offer`);
  /*
   * Each answer counts for what it was worth, not merely for existing. The old
   * test here was `answer.trim().length > 0`, which priced "asdf asdf" exactly
   * like a real figure — so a founder who mashed the keyboard three times held
   * the room as well as one who defended every number. `scoreAnswers` grades
   * substance (real words, a figure, on the subject that was asked about) and
   * gives silence, gibberish, off-topic answers and the same sentence pasted
   * five times the zero each of them is worth.
   */
  const defence = scoreAnswers(opts.answers);
  const { asked, answered, held } = defence;

  // A founder who gave the room nothing it asked for does not get a cheque on
  // the strength of the books alone. Dodging the questions ends the deal; that
  // is rulebook rule 4, enforced rather than hoped for.
  if (asked >= 2 && held < DEFENCE_FLOOR) {
    return {
      spoken: outLine(shark, ctx, rng),
      decision: "out",
      offer: null,
      join_with: "",
      reason: "The questions went unanswered, and unanswered questions are the diligence.",
      private_notes: `Held ${held.toFixed(2)} across ${asked} questions — nothing to price.`,
    };
  }

  /*
   * Conviction: the pitch, the questioning, and this shark's own appetite.
   *
   * The questioning is now the largest single term, and it is also a CEILING —
   * see below. The rulebook is explicit that a sloppy pitch of a good business
   * should cost the founder valuation and a strong defence should earn it back,
   * and the complaint that produced this shape was the reverse: good numbers
   * were buying offers that the founder had said nothing to deserve.
   */
  const appetite = APPETITE[shark](ctx);
  /*
   * ── Why the defence is a ceiling and not just a term ──────────────────────
   *
   * With three weighted terms, a company with excellent books and a lucky
   * industry draw can clear any threshold on statistics alone — the founder's
   * answers move the total, but never enough to matter. That is precisely what
   * players reported: joke answers, offers anyway, because the spreadsheet was
   * good. An investor does not work that way. However attractive the numbers,
   * the cheque is written to a person who could account for them, and a founder
   * who would not do that in the room does not get funded on the strength of
   * the room's own arithmetic.
   *
   * So the defence caps conviction. Answer nothing and no shark can be more
   * than 0.3 convinced, which is under every seat's walk-away line including
   * Lily's 0.36 — the most forgiving in the room. Answer well and the cap lifts
   * clear of the maths entirely and stops binding.
   */
  const conviction = Math.min(
    0.35 * (opts.score / 10) + 0.45 * held + 0.2 * appetite,
    0.3 + held * 0.75,
  );

  if (conviction < OUT_BELOW[shark]) {
    return {
      spoken: outLine(shark, ctx, rng),
      decision: "out",
      offer: null,
      join_with: "",
      reason: outReason(shark, ctx),
      private_notes: `Conviction ${conviction.toFixed(2)} under ${OUT_BELOW[shark]}. Held ${answered}/${asked}.`,
    };
  }

  /*
   * Where in the fair range this shark prices it. Marcus anchors low and
   * structures; Serena pays up for the story; the rest sit between. Then
   * conviction moves them within that band, so a founder who defended well is
   * genuinely paid more for it.
   */
  const anchor = ANCHOR[shark];
  const span = ctx.fairValuation.high - ctx.fairValuation.low;
  const valuation = Math.max(
    1,
    Math.round(ctx.fairValuation.low + span * (anchor + (conviction - 0.5) * 0.5)),
  );

  /*
   * ── The equity ceiling, and why it is per shark ───────────────────────
   *
   * The first cut of this took the ask, converted it to equity, and clamped the
   * result at a flat 45%. A year-one company asks for a year of burn, which is
   * routinely MORE than 45% of what a garage is worth — so every shark hit the
   * same clamp and the table showed five identical offers at the same
   * percentage. Five investors with five thesis statements handing over
   * identical term sheets is the exact opposite of what this room is for, and
   * it was visible on the very first playthrough.
   *
   * A real investor does not solve an oversized ask by taking most of the
   * company. They cut the CHEQUE: "I'll do less money for the equity I'm
   * comfortable with." So when the ask overshoots, the equity is pinned to this
   * shark's own ceiling and the amount is derived from it — which makes the
   * amounts differ too, because each shark values the company differently.
   */
  const cap = MAX_EQUITY[shark];
  let amount = roundMoney(ctx.ask.amountUsd * (0.6 + conviction * 0.7));
  let equityRaw = (amount / valuation) * 100;
  if (equityRaw > cap) {
    equityRaw = cap;
    amount = roundMoney((valuation * cap) / 100);
  }
  const equity = Number(Math.max(3, equityRaw).toFixed(1));

  const offer: SharkOffer = {
    amount_usd: amount,
    equity_pct: equity,
    // Recomputed from the two numbers above, never carried. The player is being
    // taught to read this; a worked example must be right.
    implied_valuation_usd: Math.round(amount / (equity / 100)),
    deal_type: DEAL_TYPE[shark],
    conditions: conditionsFor(shark, ctx),
  };

  return {
    spoken: offerLine(shark, ctx, offer, opts.offersOnTable, rng),
    decision: "offer",
    offer,
    join_with: "",
    reason: `Priced on ${answered} of ${asked} questions answered and a ${ctx.company.grossMarginPt}% gross margin.`,
    private_notes: `Conviction ${conviction.toFixed(2)}. Anchored at ${anchor} of the fair band.`,
  };
}

/** The founder pushed back. Hold, move, or leave. */
export function localNegotiateTurn(opts: {
  shark: SharkId;
  ctx: PanelContext;
  current: SharkOffer;
  /** What the founder said when they countered. */
  counter: string;
}): SharkNegotiateTurn {
  const { shark, ctx } = opts;
  const rng = rngFor(ctx, `${shark}:nego:${opts.counter.length}`);
  const said = opts.counter.trim();

  // A counter with a number in it is an argument. A counter without one is a
  // request. Rooms move for arguments.
  const hasNumber = /\d/.test(said);

  if (!said) {
    return {
      spoken: "You didn't counter. So the offer stands as it is.",
      decision: "hold",
      offer: opts.current,
      reason: "No counter made.",
      private_notes: "Founder declined to negotiate.",
    };
  }

  if (!hasNumber) {
    return {
      spoken: pickFrom(
        [
          "That's a reason, not a number. Give me the number you actually want and I'll tell you if it exists.",
          "I hear you. I move for arithmetic, not for enthusiasm. What's the figure?",
          "Name the terms you'd sign right now. Then we're negotiating.",
        ],
        rng,
      ),
      decision: "hold",
      offer: opts.current,
      reason: "Counter contained no terms.",
      private_notes: "Held. Founder pushed without proposing anything.",
    };
  }

  // Move the STRUCTURE before the price — the thing every one of these
  // personas actually does, and the more useful lesson for the player.
  const improved: SharkOffer = {
    ...opts.current,
    equity_pct: Number(Math.max(3, opts.current.equity_pct * 0.88).toFixed(1)),
    implied_valuation_usd: Math.round(
      opts.current.amount_usd / (Math.max(3, opts.current.equity_pct * 0.88) / 100),
    ),
    conditions: [...opts.current.conditions, "Terms revised once. This is the last move."],
  };

  return {
    spoken: pickFrom(
      [
        `Alright. Same money, less of your company — ${improved.equity_pct}% instead of ${opts.current.equity_pct}%. That's me moving the structure, not the price, and it's the only move I have.`,
        `You argued with a number, so you get one back: ${improved.equity_pct}%. I don't go again.`,
        `Fine. ${improved.equity_pct}% and I keep the conditions. Take it or take somebody else's.`,
      ],
      rng,
    ),
    decision: "revise",
    offer: improved,
    reason: "Founder countered with terms.",
    private_notes: `Conceded ${(opts.current.equity_pct - improved.equity_pct).toFixed(1)} points of equity.`,
  };
}

// ── Persona dials ───────────────────────────────────────────────────────────

/** How much this shark inherently wants THIS business, 0..1. */
const APPETITE: Record<SharkId, (ctx: PanelContext) => number> = {
  marcus: (c) => clamp01(c.company.grossMarginPt / 80),
  serena: (c) => clamp01(c.metrics.growthYoyPct / 120 + (c.metrics.tam > 5e11 ? 0.3 : 0)),
  dev: (c) => clamp01(0.4 + (c.company.revenueAnnual > 0 ? 0.3 : 0)),
  lily: (c) => clamp01(c.company.customerSatisfaction / 100),
  viktor: (c) => clamp01(c.company.runwayMonths / 24),
};

/** Below this conviction they walk. Viktor's default position is nearly out. */
const OUT_BELOW: Record<SharkId, number> = {
  marcus: 0.42,
  serena: 0.38,
  dev: 0.4,
  lily: 0.36,
  viktor: 0.62,
};

/**
 * The most of your company each shark will take, whatever you asked for.
 *
 * This is a character trait rather than a rule: Marcus buys control cheaply and
 * says so; Serena wants a small slice of something enormous and would rather
 * write a smaller cheque than own a third of a burger shop; Dev prices his own
 * labour into the equity. It is also what stops an oversized ask collapsing
 * five different investors into one identical offer — see `localOfferTurn`.
 */
const MAX_EQUITY: Record<SharkId, number> = {
  marcus: 40,
  serena: 18,
  dev: 30,
  lily: 25,
  viktor: 34,
};

/** Where in the fair range they anchor, 0 = the low end. */
const ANCHOR: Record<SharkId, number> = {
  marcus: 0.15,
  serena: 0.85,
  dev: 0.45,
  lily: 0.5,
  viktor: 0.25,
};

const DEAL_TYPE: Record<SharkId, SharkOffer["deal_type"]> = {
  marcus: "debt+equity",
  serena: "equity",
  dev: "equity",
  lily: "equity",
  viktor: "milestone",
};

function conditionsFor(shark: SharkId, ctx: PanelContext): string[] {
  switch (shark) {
    case "marcus":
      return [`Monthly management accounts, and gross margin above ${ctx.company.grossMarginPt + 5}% within a year.`];
    case "serena":
      return ["I want the next round led by somebody I introduce you to."];
    case "dev":
      return ["A weekly operations call with me, and I sit in on your first three hires."];
    case "lily":
      return [`Monthly churn under ${Math.max(1, Math.floor(ctx.metrics.monthlyChurnPct))}% before the next raise.`];
    case "viktor":
      return ["Half now, half when you hit the number we just agreed on."];
  }
}

function outLine(shark: SharkId, ctx: PanelContext, rng: () => number): string {
  const worst = ctx.attackPoints[0];
  const because = worst ? ` ${worst.claim}` : "";
  switch (shark) {
    case "marcus":
      return `I priced this while you were talking and it doesn't work at any number I'd defend.${because} I'm out.`;
    case "serena":
      return `I believe you. I don't believe it's big — and that's my problem, not yours. I'm out.`;
    case "dev":
      return `I've run one of these and I can see where it breaks.${because} Not for me. I'm out.`;
    case "lily":
      return `The people side of this isn't ready yet.${because} I'm out, and I'd like to be wrong.`;
    case "viktor":
      return pickFrom(
        [
          `Here is how this dies:${because} I'm out. Write down the reason — it's free diligence.`,
          `I'm out. Not because it's bad, because I can already see the ending.${because}`,
        ],
        rng,
      );
  }
}

function outReason(shark: SharkId, ctx: PanelContext): string {
  const worst = ctx.attackPoints[0];
  return worst ? worst.claim : `${CAST[shark].name} was not convinced by the round.`;
}

function offerLine(
  shark: SharkId,
  ctx: PanelContext,
  offer: SharkOffer,
  onTable: { shark: SharkId; offer: SharkOffer }[],
  rng: () => number,
): string {
  const terms = `${money(offer.amount_usd)} for ${offer.equity_pct}%, which values you at ${money(
    offer.implied_valuation_usd,
  )}`;
  // React to the room, which is what makes it a panel rather than five
  // monologues. Only ever to an offer already visible on screen.
  const rival = onTable[onTable.length - 1];
  const nod = rival
    ? ` ${CAST[rival.shark].name} is already in at ${money(rival.offer.amount_usd)}. `
    : " ";

  switch (shark) {
    case "marcus":
      return `Here's real money with a real structure:${nod}${terms}, half of it as a note. Numbers don't have moods, and neither does my offer.`;
    case "serena":
      return `I'll pay for where this goes, not where it is.${nod}${terms}. I want the whole thing, not the safe version of it.`;
    case "dev":
      return `${terms} — and my hands come with it.${nod}You'd be buying an operator, not just a cheque.`;
    case "lily":
      return `${terms}.${nod}And I want to spend a day with your customers before we sign, because that's where I'll earn my share.`;
    case "viktor":
      return pickFrom(
        [
          `${terms}, and it's staged.${nod}Half now, half when the number we discussed is real. I'm not betting on the story.`,
          `I'll do ${terms} in milestones.${nod}You get the second half when you prove the first half wasn't luck.`,
        ],
        rng,
      );
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function roundMoney(n: number): number {
  if (n >= 1_000_000) return Math.round(n / 50_000) * 50_000;
  if (n >= 100_000) return Math.round(n / 10_000) * 10_000;
  if (n >= 10_000) return Math.round(n / 1_000) * 1_000;
  return Math.max(500, Math.round(n / 100) * 100);
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
