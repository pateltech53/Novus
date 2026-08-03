import type { RunState } from "@/lib/engine/types";
import type { SharkId } from "./types";
import { companyMetrics, briefIsUsable, beatsCovered, PITCH_FRAMEWORK } from "@/lib/engine/company-brief";
import { STAGE_NAME, industryByCode } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { CAST } from "./panel-cast";

/**
 * WHAT THE ROOM KNOWS — the brief every shark is handed before they speak.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * The panel used to run on `lib/ai/fixtures/panel-scripts.json`: three canned
 * scripts, chosen by score band, replayed verbatim. That is the single root
 * cause behind most of what players report about The Tank — the same questions
 * every session, questions that have nothing to do with the company on the
 * screen, and feedback that quotes a founder who does not exist.
 *
 * A shark can only ask a real question if it is given real material. So this
 * assembles, from the run itself:
 *
 *   · the public brief — what the founder said the company is
 *   · the books — every figure the founder can also see on their notes card
 *   · the derived deck — churn, LTV:CAC, market share, competitors
 *   · the ATTACK POINTS — the specific weaknesses in THIS company, computed
 *     from those numbers rather than guessed at
 *   · a fair valuation range, so an offer can be checked against something
 *
 * The attack points are the important half. They are what makes a shark's
 * question about the player's company instead of about a company in a fixture,
 * and they are what the local fallback uses when there is no model at all.
 *
 * ── Deliberately NOT here ──────────────────────────────────────────────────
 *
 * Nothing about how the founder sounded. No words per minute, no filler count,
 * no confidence reading, nothing from the delivery coach. The panel judges the
 * business and what was said about it; delivery is coached separately and
 * scored nowhere (Brand Law 5). The debrief is the only surface that shows both,
 * and it shows them in separate sections for exactly this reason.
 */

export interface AttackPoint {
  id: string;
  /** What is wrong, in the sharks' own terms. */
  claim: string;
  /** The question this weakness deserves, if nobody thinks of a better one. */
  question: string;
  /** Which shark cares most. Used to route questions to the right seat. */
  owner: SharkId;
  /** Bigger is worse. Orders which weakness gets hit first. */
  severity: number;
  /** Glossary key, so the term coach can explain the jargon in the question. */
  term?: string;
}

export interface PanelContext {
  founderName: string;
  company: {
    name: string;
    industry: string;
    stage: string;
    year: number;
    cash: number;
    burnMonthly: number;
    runwayMonths: number;
    revenueAnnual: number;
    grossMarginPt: number;
    netMarginPt: number;
    valuation: number;
    founderEquityPct: number;
    employees: number;
    customerSatisfaction: number;
  };
  brief: {
    companyType: string;
    whatItDoes: string;
    usp: string;
    whyCustomers: string;
    mission: string;
    /** True when the founder never wrote one. The sharks are told, and ask. */
    missing: boolean;
  };
  metrics: ReturnType<typeof companyMetrics>["raw"];
  competitors: { name: string; angle: string; scale: string }[];
  attackPoints: AttackPoint[];
  fairValuation: { low: number; high: number };
  /**
   * What the founder is asking for — their own numbers, set on the notes card
   * (`lib/ai/ask.ts`), with `standardAsk` as the never-touched-the-sliders
   * default. `impliedValuationUsd` is amount ÷ equity, carried explicitly so
   * every reader — the model, the offline shark, the help card — sees the
   * valuation the founder just claimed, not merely the two numbers it hides in.
   */
  ask: { amountUsd: number; equityPct: number; impliedValuationUsd: number };
  /** Which of the seven beats the pitch actually reached. */
  coveredBeats: { beat: string; covered: boolean }[];
}

/**
 * The fair range.
 *
 * Anchored to the sim's own valuation rather than to a multiple the model
 * invents, because `app/api/panel/route.ts` lets the model write deal terms and
 * a range it made up would let it write any terms at all. Wide enough that a
 * shark has room to argue, narrow enough that "he paid four times fair" is a
 * thing a player can be told and understand.
 */
export function fairValuationRange(run: RunState): { low: number; high: number } {
  const base = Math.max(run.stats.valuation, 1);
  return { low: Math.round(base * 0.7), high: Math.round(base * 1.45) };
}

/**
 * The ask.
 *
 * You raise to buy runway, not to match a valuation: a year of burn, or a fifth
 * of the company, whichever is larger. Lifted out of SharkPanel so the client,
 * the route and the local fallback all price the same deal.
 */
export function standardAsk(run: RunState, floorUsd: number): { amountUsd: number; equityPct: number } {
  const amountUsd = Math.max(
    run.stats.valuation * 0.2,
    Math.max(0, run.stats.burnMonthly) * 12,
    floorUsd,
  );
  const post = Math.max(run.stats.valuation, amountUsd * 2);
  return {
    amountUsd: Math.round(amountUsd),
    equityPct: Number(Math.min(40, Math.max(5, (amountUsd / post) * 100)).toFixed(1)),
  };
}

/**
 * Where this company is actually weak.
 *
 * Every entry is computed from a figure the founder can see on their own notes
 * card, which is what makes the questions fair: nothing here is a gotcha, it is
 * a number they were shown and did not address.
 */
export function attackPointsFor(
  run: RunState,
  pitchTranscript: string,
  ask?: { amountUsd: number; equityPct: number },
): AttackPoint[] {
  const s = run.stats;
  const m = companyMetrics(run).raw;
  const runway = deriveRunwayMonths(run);
  const covered = beatsCovered(pitchTranscript);
  const out: AttackPoint[] = [];

  const push = (p: AttackPoint) => out.push(p);

  // ── The books ──────────────────────────────────────────────────────────
  if (s.burnMonthly > 0 && runway < 9) {
    push({
      id: "runway",
      claim: `Runway is ${runway} months at the current burn.`,
      question: `You have about ${runway} months of cash left. What happens in month ${runway + 1} if nobody at this table invests?`,
      owner: "viktor",
      severity: runway < 5 ? 10 : 7,
      term: "runway",
    });
  }
  if (m.ltvCacRatio < 3) {
    push({
      id: "ltvcac",
      claim: `LTV to CAC is ${m.ltvCacRatio}×, under the 3× bar.`,
      question: `Your lifetime value is about ${m.ltvCacRatio} times what a customer costs you to win. Investors want three. Which half of that are you fixing — the cost, or the lifetime?`,
      owner: "marcus",
      severity: m.ltvCacRatio < 1.5 ? 9 : 6,
      term: "ltv:cac",
    });
  }
  if (m.monthlyChurnPct >= 5) {
    push({
      id: "churn",
      claim: `Monthly churn is ${m.monthlyChurnPct}%.`,
      question: `You're losing ${m.monthlyChurnPct}% of customers every month. Do you know why they leave, or are you guessing?`,
      owner: "lily",
      severity: m.monthlyChurnPct >= 9 ? 9 : 6,
      term: "churn",
    });
  }
  if (s.grossMarginPt < 45) {
    push({
      id: "margin",
      claim: `Gross margin is ${s.grossMarginPt}%.`,
      question: `You keep ${s.grossMarginPt} cents on the dollar before you've paid anybody. Where does the rest go, and can you move it?`,
      owner: "marcus",
      severity: 7,
      term: "gross margin",
    });
  }
  if (s.revenueAnnual <= 0) {
    push({
      id: "prerevenue",
      claim: "No revenue on the books.",
      question: "Nobody has paid you yet. What is the first thing that has to be true before somebody does?",
      owner: "dev",
      severity: 8,
    });
  } else if (m.growthYoyPct <= 0) {
    push({
      id: "flat",
      claim: "Revenue is flat or falling year on year.",
      question: "Your revenue isn't growing. Is that the market, the product, or you?",
      owner: "serena",
      severity: 7,
    });
  }
  if (s.csat < 55) {
    push({
      id: "csat",
      claim: `Customer satisfaction is ${s.csat}/100.`,
      question: "Your customers aren't happy. What's the complaint you hear most, word for word?",
      owner: "lily",
      severity: 6,
    });
  }
  if (s.qual < 50) {
    push({
      id: "quality",
      claim: `Product quality sits at ${s.qual}/100.`,
      question: "What breaks first when you triple the volume? Be specific — I've built one of these.",
      owner: "dev",
      severity: 6,
    });
  }
  if (s.morale < 50 && s.employees > 0) {
    push({
      id: "team",
      claim: `Morale is ${s.morale}/100 across ${s.employees} people.`,
      question: "Who on your team would leave tomorrow if somebody offered them ten percent more, and what are you doing about it?",
      owner: "lily",
      severity: 5,
    });
  }
  if (m.marketSharePct < 1 && s.revenueAnnual > 0) {
    push({
      id: "share",
      claim: `${m.marketSharePct}% of a serviceable market this size.`,
      question: `You have ${m.marketSharePct}% of the market you say you're in. What stops a bigger competitor taking the rest before you get there?`,
      owner: "serena",
      severity: 5,
      term: "market share",
    });
  }
  if (run.founderEquityPct < 60) {
    push({
      id: "captable",
      claim: `The founder holds ${run.founderEquityPct}%.`,
      question: `You already own less than sixty percent. After my cheque you'd own less again — at what point do you stop being motivated?`,
      owner: "marcus",
      severity: 5,
      term: "dilution",
    });
  }

  /*
   * An ask the company cannot support.
   *
   * A year-one founder asks for a year of burn, and for a garage that is
   * routinely more than the whole company is worth. The room's answer is to cut
   * the cheque rather than take 45% (see MAX_EQUITY in lib/ai/panel-local.ts) —
   * but the founder should be TOLD why they got less than they asked for, and
   * being asked about it out loud is how they learn to price a raise.
   */
  if (ask && ask.amountUsd > Math.max(1, s.valuation) * 0.4) {
    push({
      id: "bigask",
      claim: `The ask is ${Math.round((ask.amountUsd / Math.max(1, s.valuation)) * 100)}% of what the company is currently worth.`,
      question: `You're asking for close to what this whole company is valued at. Talk me through how you got to that number — and what you'd do with half of it.`,
      owner: "marcus",
      severity: 7,
      term: "valuation",
    });
  }

  /*
   * The valuation the ask IMPLIES, checked against the fair band.
   *
   * The ask is the player's own two numbers now, and amount ÷ equity is a
   * price on the whole company whether they realised it or not. Realising it
   * is the point: a founder who slides to $200K for 2% has just said their
   * garage is worth $10M, and the room telling them so — with the division
   * shown — is the fastest way anyone learns what equity costs.
   */
  if (ask && ask.equityPct > 0) {
    const implied = ask.amountUsd / (ask.equityPct / 100);
    const fair = fairValuationRange(run);
    if (implied > fair.high * 1.5) {
      push({
        id: "pricey",
        claim: `The ask implies a ${fmtMoney(implied)} valuation against ${fmtMoney(s.valuation)} on the books.`,
        question: `Run your own math with me: ${fmtMoney(ask.amountUsd)} for ${ask.equityPct}% says the whole company is worth ${fmtMoney(implied)}. Your books say ${fmtMoney(s.valuation)}. Which of those numbers is wrong?`,
        owner: "viktor",
        severity: 8,
        term: "valuation",
      });
    }
  }

  // ── What the pitch itself left out ─────────────────────────────────────
  /*
   * The most useful question in the room is often about the thing that was
   * never said. These are graded lower than a broken number, because a missing
   * beat is a presentation failure and a bad ratio is a business one — but they
   * are here so that a founder who skipped the ask gets asked about the ask.
   */
  for (const beat of PITCH_FRAMEWORK) {
    if (covered[beat.n]) continue;
    push({
      id: `missing:${beat.n}`,
      claim: `The pitch never covered ${beat.title.toLowerCase()}.`,
      question: missingBeatQuestion(beat.n),
      owner: beatOwner(beat.n),
      severity: 4,
    });
  }

  // ── What the founder said the company is ───────────────────────────────
  const brief = run.brief;
  if (!briefIsUsable(brief)) {
    push({
      id: "nobrief",
      claim: "The founder has never written down what the company is.",
      question: "In one sentence, without using the word 'platform' — what does this company actually do?",
      owner: "dev",
      severity: 8,
    });
  } else {
    if (!brief!.usp.trim()) {
      push({
        id: "nousp",
        claim: "No stated differentiator.",
        question: "What can you do that the nearest competitor could not copy by Friday?",
        owner: "serena",
        severity: 6,
      });
    }
    if (!brief!.whyCustomers.trim()) {
      push({
        id: "noreason",
        claim: "No stated reason a customer picks them.",
        question: "Somebody is about to buy from your competitor instead. What is the sentence that changes their mind?",
        owner: "lily",
        severity: 6,
      });
    }
  }

  return out.sort((a, b) => b.severity - a.severity);
}

function missingBeatQuestion(n: number): string {
  switch (n) {
    case 1:
      return "You told me what you built. You never told me what was broken. What problem is this fixing?";
    case 2:
      return "I still don't know what the product actually is. Describe it as if I were buying it.";
    case 3:
      return "How many people have this problem, and what is that worth in dollars?";
    case 4:
      return "How does this make money? Price, and who pays it.";
    case 5:
      return "What has actually happened so far? Customers, orders, repeat rate — anything real.";
    case 6:
      return "Give me the numbers. Revenue, margin, burn. Any of them.";
    default:
      return "You never made the ask. How much do you want, for how much of the company, and what does the money do?";
  }
}

function beatOwner(n: number): SharkId {
  // Routed by obsession, not by rota — Marcus takes the money beats, Serena the
  // market ones, Dev the product, Lily the customer, Viktor the ask.
  return ([, "dev", "dev", "serena", "marcus", "lily", "marcus", "viktor"][n] ?? "marcus") as SharkId;
}

/** Everything a shark is handed before it speaks. */
export function buildPanelContext(opts: {
  run: RunState;
  pitchTranscript: string;
  askFloorUsd: number;
  /**
   * The founder's own ask, when they set one (`lib/ai/ask.ts`). Absent falls
   * back to `standardAsk` — same behaviour every caller had before the ask
   * became the player's to decide.
   */
  ask?: { amountUsd: number; equityPct: number };
}): PanelContext {
  const { run } = opts;
  const s = run.stats;
  const deck = companyMetrics(run);
  const brief = run.brief;
  const covered = beatsCovered(opts.pitchTranscript);
  // The ask is resolved first: it is itself something the room can attack.
  const chosen =
    opts.ask && opts.ask.amountUsd > 0 && opts.ask.equityPct > 0
      ? opts.ask
      : standardAsk(run, opts.askFloorUsd);
  const ask = {
    amountUsd: Math.round(chosen.amountUsd),
    equityPct: Number(chosen.equityPct.toFixed(1)),
    impliedValuationUsd: Math.round(chosen.amountUsd / (chosen.equityPct / 100)),
  };

  return {
    founderName: run.founderName || "the founder",
    company: {
      name: run.companyName,
      industry: industryByCode(run.industry).name,
      stage: STAGE_NAME[run.stage],
      year: run.year,
      cash: Math.round(s.cash),
      burnMonthly: Math.round(s.burnMonthly),
      runwayMonths: deriveRunwayMonths(run),
      revenueAnnual: Math.round(s.revenueAnnual),
      grossMarginPt: s.grossMarginPt,
      netMarginPt: s.netMarginPt,
      valuation: Math.round(s.valuation),
      founderEquityPct: run.founderEquityPct,
      employees: s.employees,
      customerSatisfaction: s.csat,
    },
    brief: {
      companyType: brief?.companyType ?? "",
      whatItDoes: brief?.whatItDoes ?? "",
      usp: brief?.usp ?? "",
      whyCustomers: brief?.whyCustomers ?? "",
      mission: brief?.mission ?? "",
      missing: !briefIsUsable(brief),
    },
    metrics: deck.raw,
    competitors: deck.competitors,
    attackPoints: attackPointsFor(run, opts.pitchTranscript, ask),
    fairValuation: fairValuationRange(run),
    ask,
    coveredBeats: PITCH_FRAMEWORK.map((b) => ({ beat: b.title, covered: covered[b.n] })),
  };
}

/** The seat that cares most about an attack point, for routing questions. */
export const sharkName = (id: SharkId): string => CAST[id]?.name ?? "The Chair";
