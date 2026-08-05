import type { Industry, RunState } from "./types";
import { hashString, mulberry32 } from "./rng";
import { INDUSTRIES, industryByCode } from "./constants";
import { ensurePortfolio, earningItems } from "./portfolio";
import { specForRun } from "./industries/index";

/**
 * WHAT THE COMPANY IS — the half of a pitch the books cannot hold.
 *
 * ── The problem this file exists to fix ────────────────────────────────────
 *
 * A run used to be a name and an industry code. The engine knew the company's
 * cash, margin and churn to the dollar, and knew nothing whatsoever about what
 * it SOLD. So a player walking into The Tank had to invent a product, a
 * customer and a reason to exist on the spot, every single time, and then
 * remember what they invented well enough to defend it under questioning.
 *
 * That is not the skill the game is teaching. A real founder walks into a room
 * having already decided what the company is; the room tests whether they can
 * say it and whether it survives contact. So the company is decided ONCE, at
 * founding, and is on screen from then on.
 *
 * ── Two halves, deliberately different in kind ─────────────────────────────
 *
 * `CompanyBrief` is AUTHORED — by the player, or by the model on their behalf
 * when they do not yet know how to write one. It is prose, it is theirs, and
 * nothing in the engine reads it for a number. It is stored on the run.
 *
 * `CompanyMetrics` is DERIVED — computed from the run's own books plus its
 * seed, never stored. That distinction is not tidiness:
 *
 *   · Stored metrics would drift out of sync with the books the moment a year
 *     closed, and a pitch deck that contradicts the P&L is the exact failure
 *     the content scorer punishes the player for.
 *   · Stored metrics would also have to be replayed byte-for-byte by
 *     `lib/leaderboard/replay.ts`. Derived from `seed` and state, they
 *     reproduce anywhere for free.
 *
 * So: every figure below is either read straight off the books, or a stable
 * function of the seed. Two runs in the same industry get different customer
 * counts, different competitors and a different market size; the same run gets
 * the same ones on every device, forever.
 *
 * ── What this is NOT allowed to do ────────────────────────────────────────
 *
 * Nothing here feeds a score, a survival outcome or a leaderboard rank. It is
 * material the founder is entitled to have in front of them — the deck they
 * would have brought. `scorePitchContent` still checks their claims against
 * `state.stats`, which is why the derivations below are anchored to those same
 * stats rather than invented alongside them.
 */

// ── The authored half ───────────────────────────────────────────────────────

export interface CompanyBrief {
  /** "Burger joint", "Study app", "Sneaker label" — the player's own words. */
  companyType: string;
  /** What the company actually does, in a sentence or two. */
  whatItDoes: string;
  /** The single biggest thing that makes it different. The USP. */
  usp: string;
  /** Why a customer picks this over the alternative sitting next to it. */
  whyCustomers: string;
  /** What it is ultimately for. Optional — a mission is a nice-to-have. */
  mission: string;
  /** "player" when they wrote it, "ai" when it was generated for them. */
  source: "player" | "ai";
}

export const EMPTY_BRIEF: CompanyBrief = {
  companyType: "",
  whatItDoes: "",
  usp: "",
  whyCustomers: "",
  mission: "",
  source: "player",
};

/** Enough of a brief to be worth showing. A type alone is not a company. */
export const briefIsUsable = (b?: CompanyBrief | null): boolean =>
  Boolean(b && (b.whatItDoes.trim() || b.usp.trim()));

/** Trim and cap every field, so nothing pasted can blow out a layout or a prompt. */
export function sanitizeBrief(raw: Partial<CompanyBrief> | null | undefined): CompanyBrief {
  const cut = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return {
    companyType: cut(raw?.companyType, 48),
    whatItDoes: cut(raw?.whatItDoes, 240),
    usp: cut(raw?.usp, 200),
    whyCustomers: cut(raw?.whyCustomers, 200),
    mission: cut(raw?.mission, 160),
    source: raw?.source === "ai" ? "ai" : "player",
  };
}

// ── The derived half ────────────────────────────────────────────────────────

export interface MetricRow {
  /** The trade term, verbatim. Brand Law 6 — never a euphemism. */
  label: string;
  value: string;
  /** One line on what the figure means or where it came from. */
  note: string;
  /** A term key into GLOSSARY, when there is one worth explaining. */
  term?: string;
  /** How this reads against the industry benchmark. */
  tone: "good" | "bad" | "flat";
}

export interface Competitor {
  name: string;
  /** What they are, and why they are a threat, in one clause. */
  angle: string;
  /** Rough revenue scale, so "bigger than us" is a number rather than a vibe. */
  scale: string;
}

export interface CompanyMetrics {
  /** The headline block a founder would put on slide five. */
  traction: MetricRow[];
  /** Market size, competition, and where the company sits between them. */
  market: MetricRow[];
  competitors: Competitor[];
  /** What "normal" looks like in this industry, so a number has a yardstick. */
  benchmarks: MetricRow[];
  /** The raw figures, for the model and for anything that needs arithmetic. */
  raw: {
    monthlyChurnPct: number;
    payingCustomers: number;
    mrr: number;
    arpu: number;
    growthYoyPct: number;
    retention90Pct: number;
    tam: number;
    sam: number;
    marketSharePct: number;
    ltv: number;
    cac: number;
    ltvCacRatio: number;
  };
}

/**
 * Industry-shaped constants for the figures the sim does not itself model.
 *
 * The sim tracks churn as a yearly percentage and market share as a percentage
 * of nothing in particular. A founder pitches monthly churn and a dollar TAM,
 * so these convert — they do not invent. `tam` is the addressable market the
 * share percentage is a share OF, and it is the only genuinely new number here.
 */
const INDUSTRY_SHAPE: Record<
  Industry,
  {
    /** Total addressable market in dollars, order-of-magnitude honest. */
    tam: number;
    /** The slice a company of this kind could ever realistically serve. */
    samShare: number;
    /** What a healthy monthly churn looks like here. */
    churnGood: number;
    /** Typical gross margin, for the benchmark row. */
    marginTypical: number;
    /** What the customer is called. */
    customerNoun: string;
    /** Rivals, named. Seeded pick of three. */
    rivals: [string, string][];
  }
> = {
  FOOD: {
    tam: 900_000_000_000,
    samShare: 0.0004,
    churnGood: 4,
    marginTypical: 62,
    customerNoun: "regulars",
    rivals: [
      ["Grillhouse Co.", "twelve locations and a central kitchen"],
      ["Corner & Co.", "the independent two streets over"],
      ["Pantry Line", "supermarket chilled range at half your price"],
      ["Fold Kitchen", "delivery-only, no rent, undercuts everyone"],
      ["Marlow Foods", "regional group with buying power you do not have"],
    ],
  },
  ECOM: {
    tam: 1_200_000_000_000,
    samShare: 0.0002,
    churnGood: 6,
    marginTypical: 45,
    customerNoun: "buyers",
    rivals: [
      ["Northgate", "the marketplace that can delist you on a Tuesday"],
      ["Stack Goods", "same category, three years of reviews ahead"],
      ["Direct Import Co.", "your product, unbranded, forty percent cheaper"],
      ["Halo Retail", "owns the shelf you are trying to reach"],
      ["Loop Commerce", "subscription model, better retention"],
    ],
  },
  TECH: {
    tam: 400_000_000_000,
    samShare: 0.0006,
    churnGood: 2,
    marginTypical: 78,
    customerNoun: "seats",
    rivals: [
      ["Meridian Software", "incumbent, slow, already in every procurement list"],
      ["Junction", "free tier that is good enough for most of your users"],
      ["Backline", "funded competitor twelve months ahead on features"],
      ["Ashford Suite", "bundles this in with something people already buy"],
      ["OpenStack Tools", "open source, zero price, real community"],
    ],
  },
  CONTENT: {
    tam: 250_000_000_000,
    samShare: 0.0008,
    churnGood: 5,
    marginTypical: 70,
    customerNoun: "subscribers",
    rivals: [
      ["Loop Media", "same audience, four years of back catalogue"],
      ["The Feed", "platform-native, algorithm does their distribution"],
      ["Kindred Studio", "brand deals you are too small to be offered"],
      ["Northwind Press", "legacy name, declining but still trusted"],
      ["Signal Group", "aggregator that could hire your whole audience away"],
    ],
  },
  FASHION: {
    tam: 1_700_000_000_000,
    samShare: 0.00015,
    churnGood: 7,
    marginTypical: 55,
    customerNoun: "customers",
    rivals: [
      ["Ninefold", "same aesthetic, established wholesale accounts"],
      ["Fastline", "copies a drop within three weeks"],
      ["Atlas Group", "owns the stores you want to be stocked in"],
      ["Second Cut", "resale platform eating your full-price demand"],
      ["Kindred Stores", "regional chain with real footfall"],
    ],
  },
  GAMING: {
    tam: 200_000_000_000,
    samShare: 0.0005,
    churnGood: 8,
    marginTypical: 72,
    customerNoun: "players",
    rivals: [
      ["Pelican Interactive", "funded studio in the same genre"],
      ["Freeplay Labs", "free-to-play, monetises the same hour of attention"],
      ["Junction Store", "the platform that takes thirty percent"],
      ["Nightfall Games", "a franchise your players already own"],
      ["Sandbox Collective", "user-generated content, infinite supply, zero cost"],
    ],
  },
  FITNESS: {
    tam: 100_000_000_000,
    samShare: 0.0009,
    churnGood: 6,
    marginTypical: 65,
    customerNoun: "members",
    rivals: [
      ["Ironline", "chain gym with a twenty-dollar membership"],
      ["Home Circuit", "app-only, no premises, national reach"],
      ["Kindred Health", "insurer-subsidised, effectively free to the member"],
      ["Studio Row", "boutique studios with a waiting list"],
      ["Open Track", "free community programme in the same city"],
    ],
  },
  BEAUTY: {
    tam: 500_000_000_000,
    samShare: 0.0003,
    churnGood: 5,
    marginTypical: 68,
    customerNoun: "customers",
    rivals: [
      ["Ninefold Beauty", "same formulation story, bigger lab"],
      ["Halo Retail", "owns the shelf and its own private label"],
      ["Second Skin", "dermatologist-backed, clinical claims you cannot make"],
      ["Bloom & Co.", "creator-led, distribution you cannot buy"],
      ["Kindred Labs", "contract manufacturer now selling direct"],
    ],
  },
  EDTECH: {
    tam: 300_000_000_000,
    samShare: 0.0005,
    churnGood: 3,
    marginTypical: 74,
    customerNoun: "learners",
    rivals: [
      ["Westbrook Systems", "already in the district's procurement framework"],
      ["Open Curriculum", "free, public, and good enough for most schools"],
      ["Meridian Learning", "incumbent with a five-year contract"],
      ["Study Loop", "consumer app, bypasses schools entirely"],
      ["Chalkline", "teacher-built, beloved, and free"],
    ],
  },
  SUSTAIN: {
    tam: 600_000_000_000,
    samShare: 0.0004,
    churnGood: 4,
    marginTypical: 52,
    customerNoun: "customers",
    rivals: [
      ["Meridian Impact Co.", "certified, audited, and three years ahead"],
      ["Greenline", "same claim, no evidence, half the price"],
      ["Atlas Group", "incumbent that just launched its own eco range"],
      ["Circular Works", "refill model with real unit economics"],
      ["Northwind Energy", "utility-scale, makes your effort look small"],
    ],
  },
  TOYS: {
    tam: 120_000_000_000,
    samShare: 0.0007,
    churnGood: 9,
    marginTypical: 58,
    customerNoun: "buyers",
    rivals: [
      ["Brightbox", "licensed characters children already ask for"],
      ["Fold Toys", "flat-pack, cheap to ship, undercuts you"],
      ["Halo Retail", "decides whether you get a peg on the shelf"],
      ["Collector Line", "secondary market that competes with your own new stock"],
      ["Nightfall Play", "same age bracket, better TV spend"],
    ],
  },
  PET: {
    tam: 260_000_000_000,
    samShare: 0.0006,
    churnGood: 4,
    marginTypical: 60,
    customerNoun: "owners",
    rivals: [
      ["Kindred Pet", "vet-recommended, and vets are the channel"],
      ["Pantry Line", "supermarket own-brand at a third of your price"],
      ["Loop Subscriptions", "auto-ship model with brutal retention"],
      ["Northgate", "the marketplace where price is the only axis"],
      ["Barkline", "creator-led brand with a million followers"],
    ],
  },
};

const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

const fmtCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1_000)}K`
      : n.toLocaleString();

const fmtDollars = (n: number) =>
  n >= 1_000_000_000
    ? `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}K`
        : `$${Math.round(n)}`;

/**
 * The deck, derived.
 *
 * Every figure traces to `state.stats` or to `state.seed`. Nothing is stored,
 * so this can be called as often as a render wants it.
 */
export function companyMetrics(state: RunState): CompanyMetrics {
  const s = state.stats;
  const shape = INDUSTRY_SHAPE[state.industry];
  const industry = industryByCode(state.industry);
  const spec = specForRun(state);
  // Seeded on the run, not on the clock: the same company reports the same
  // deck on every device and after every reload.
  const rng = mulberry32(hashString(`deck:${state.seed}:${state.industry}`));

  // ── Customers and price ────────────────────────────────────────────────
  /*
   * ARPU comes from what the player actually priced, when they have priced
   * anything. That matters: a founder who set a $4 item and a founder who set
   * a $400 one should not be told they have the same number of customers.
   */
  const earning = [...earningItems(ensurePortfolio(state))];
  const listedPrices = earning.map((i) => i.price).filter((p) => p > 0);
  const avgPrice = listedPrices.length
    ? listedPrices.reduce((a, b) => a + b, 0) / listedPrices.length
    : (spec.priceMin + spec.priceMax) / 2;
  /** Annual spend per customer: price × how often they come back in a year. */
  const purchasesPerYear = 1 + (1 - s.churnPt / 100) * (3 + rng() * 5);
  const arpu = Math.max(1, avgPrice * purchasesPerYear);
  const payingCustomers = Math.max(
    0,
    Math.round(s.revenueAnnual > 0 ? s.revenueAnnual / arpu : 0),
  );

  // ── Churn and retention ────────────────────────────────────────────────
  /*
   * The sim carries churn as a yearly percentage. A founder pitches the
   * monthly figure, so it is converted rather than reinvented: a yearly rate
   * compounds, so monthly = 1 − (1 − yearly)^(1/12).
   */
  const yearly = Math.min(0.95, Math.max(0, s.churnPt / 100));
  const monthlyChurnPct = Number(((1 - Math.pow(1 - yearly, 1 / 12)) * 100).toFixed(1));
  const retention90Pct = Number((Math.pow(1 - monthlyChurnPct / 100, 3) * 100).toFixed(1));

  // ── Growth ─────────────────────────────────────────────────────────────
  /*
   * Real, from the trailing quarters the sim already keeps. A company with one
   * quarter on the books has no year-over-year figure and is told so rather
   * than shown a fabricated one.
   */
  const q = state.quarters ?? [0, 0, 0, 0];
  const recent = q[q.length - 1] ?? 0;
  const older = q[0] ?? 0;
  const growthYoyPct =
    older > 0 ? Math.round(((recent - older) / older) * 100) : recent > 0 ? 100 : 0;

  // ── Market ─────────────────────────────────────────────────────────────
  // Jittered per run so two FOOD companies do not quote the same TAM.
  const tam = round(shape.tam * (0.85 + rng() * 0.3), 1_000_000);
  const sam = round(tam * shape.samShare * (0.7 + rng() * 0.6), 100_000);
  const marketSharePct = sam > 0 ? Number(((s.revenueAnnual / sam) * 100).toFixed(2)) : 0;

  // ── Unit economics ─────────────────────────────────────────────────────
  /*
   * LTV and CAC are the two terms a shark reaches for first, and the sim holds
   * both as 0–100 indices rather than dollars. Converted here, anchored to the
   * player's real margin and churn so the ratio moves when the business does.
   */
  const ltv = Math.round(
    arpu * (s.grossMarginPt / 100) * (monthlyChurnPct > 0 ? 12 / monthlyChurnPct : 24),
  );
  // cacPt is an efficiency index — higher means cheaper. Inverted into money.
  const cac = Math.max(1, Math.round(arpu * (1.4 - s.cacPt / 100)));
  const ltvCacRatio = Number((ltv / Math.max(1, cac)).toFixed(1));

  const mrr = Math.round(s.revenueAnnual / 12);

  // ── Competitors ────────────────────────────────────────────────────────
  const pool = [...shape.rivals];
  const competitors: Competitor[] = [];
  for (let i = 0; i < 3 && pool.length; i += 1) {
    const [name, angle] = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    competitors.push({
      name,
      angle,
      // Rivals are bigger than a garage and smaller than the whole market.
      scale: fmtDollars(round(sam * (0.04 + rng() * 0.22), 10_000)),
    });
  }

  const churnTone = monthlyChurnPct <= shape.churnGood ? "good" : "bad";
  const marginTone: MetricRow["tone"] =
    s.grossMarginPt >= shape.marginTypical
      ? "good"
      : s.grossMarginPt >= shape.marginTypical - 10
        ? "flat"
        : "bad";

  return {
    traction: [
      {
        label: "Monthly recurring revenue",
        value: fmtDollars(mrr),
        note: "trailing twelve months, divided by twelve",
        tone: "flat",
      },
      {
        label: "Paying customers",
        value: fmtCount(payingCustomers),
        note: `${shape.customerNoun} who have actually paid`,
        tone: payingCustomers > 0 ? "flat" : "bad",
      },
      {
        label: "Monthly churn",
        value: `${monthlyChurnPct}%`,
        note: `${shape.churnGood}% or under is healthy in this industry`,
        term: "churn",
        tone: churnTone,
      },
      {
        label: "90-day retention",
        value: `${retention90Pct}%`,
        note: "of customers still here three months later",
        tone: retention90Pct >= 70 ? "good" : retention90Pct >= 50 ? "flat" : "bad",
      },
      {
        label: "Growth",
        value: older > 0 ? `${growthYoyPct > 0 ? "+" : ""}${growthYoyPct}%` : "no full year yet",
        note: "newest quarter against the one four quarters back",
        tone: growthYoyPct > 0 ? "good" : growthYoyPct < 0 ? "bad" : "flat",
      },
      {
        label: "Average revenue per customer",
        value: fmtDollars(Math.round(arpu)),
        note: "per year, at your own prices",
        tone: "flat",
      },
    ],
    market: [
      /*
       * TAM and SAM by their trade names, glossary-wired. The sharks say
       * "TAM" out loud; a founder whose notes said only "total addressable
       * market" had never been shown that the two are the same thing.
       */
      {
        label: "TAM — total addressable market",
        value: fmtDollars(tam),
        note: `everyone buying ${industry.name.toLowerCase()}, worldwide`,
        term: "tam",
        tone: "flat",
      },
      {
        label: "SAM — serviceable market",
        value: fmtDollars(sam),
        note: "the slice a company your shape could actually reach",
        term: "sam",
        tone: "flat",
      },
      {
        label: "Your share of it",
        value: `${marketSharePct}%`,
        note: "revenue divided by the serviceable market",
        term: "market share",
        tone: "flat",
      },
    ],
    benchmarks: [
      {
        label: "Gross margin",
        value: `${s.grossMarginPt}%`,
        note: `${shape.marginTypical}% is typical here`,
        term: "gross margin",
        tone: marginTone,
      },
      {
        label: "LTV",
        value: fmtDollars(ltv),
        note: "what one customer is worth over their life",
        term: "ltv",
        tone: "flat",
      },
      {
        label: "CAC",
        value: fmtDollars(cac),
        note: "what it costs to win one",
        term: "cac",
        tone: "flat",
      },
      {
        label: "LTV : CAC",
        value: `${ltvCacRatio}×`,
        note: "3× or better is the bar investors use",
        term: "ltv:cac",
        tone: ltvCacRatio >= 3 ? "good" : ltvCacRatio >= 1.5 ? "flat" : "bad",
      },
    ],
    competitors,
    raw: {
      monthlyChurnPct,
      payingCustomers,
      mrr,
      arpu: Math.round(arpu),
      growthYoyPct,
      retention90Pct,
      tam,
      sam,
      marketSharePct,
      ltv,
      cac,
      ltvCacRatio,
    },
  };
}

// ── The offline brief writer ────────────────────────────────────────────────

/**
 * A brief with no model behind it.
 *
 * This is what a player gets when they tap "write it for me" on a deploy with
 * no OpenRouter key, and it has to be good enough to pitch — not a placeholder
 * with the word TODO in it. It is deliberately generic in the RIGHT places: it
 * names the industry's actual customer and the actual failure mode, and leaves
 * the specifics as something the player can edit.
 *
 * Seeded on the company name so pressing it twice on the same company gives the
 * same answer, and two different companies never get the same sentence.
 */
export function localBrief(opts: {
  companyName: string;
  industry: Industry;
  companyType: string;
}): CompanyBrief {
  const shape = INDUSTRY_SHAPE[opts.industry];
  const industry = INDUSTRIES.find((i) => i.code === opts.industry)!;
  const rng = mulberry32(hashString(`brief:${opts.companyName}:${opts.industry}:${opts.companyType}`));
  const pick = <T,>(list: T[]): T => list[Math.floor(rng() * list.length)];

  /*
   * The player types "Smash burger shop" into a labelled field, so they
   * capitalise it — and it then lands mid-sentence as "is a Smash burger shop",
   * which reads like a typo. Lowercase the first letter only, and only when the
   * rest of the word has no capitals in it, so "eBay reseller" and "SaaS tool"
   * survive intact.
   */
  const typed = opts.companyType.trim();
  const kind = typed
    ? /[A-Z]/.test(typed.slice(1, typed.indexOf(" ") === -1 ? typed.length : typed.indexOf(" ")))
      ? typed
      : typed.charAt(0).toLowerCase() + typed.slice(1)
    : industry.name.toLowerCase();
  const name = opts.companyName.trim() || "The company";
  const customer = shape.customerNoun;

  const angles = [
    "does one thing properly instead of ten things adequately",
    "is built around the part everyone else treats as an afterthought",
    "costs less to run, so it can charge less without losing money",
    "was designed by someone who was the customer first",
    "keeps the part people actually pay for, and cuts the rest",
  ];
  const reasons = [
    `${customer} come back because it works the second time as well as the first`,
    `the alternative is cheaper once and more expensive every month after that`,
    `nobody else in this category will put the number on the label`,
    `switching away costs them something, and staying costs them nothing`,
    `they were recommended it by someone who had no reason to lie`,
  ];
  const missions = [
    `Make ${industry.name.toLowerCase()} something people do not have to think about.`,
    `Give ${customer} the version of this they assumed already existed.`,
    `Prove this category can be run honestly and still make money.`,
    `Be the last ${kind} they ever have to try.`,
  ];

  return {
    companyType: kind,
    whatItDoes: `${name} is a ${kind}. It sells to ${customer} who are currently making do with something that almost works, and it replaces that with one thing that does the whole job.`,
    usp: `It ${pick(angles)}.`,
    whyCustomers: capitalise(pick(reasons)) + ".",
    mission: pick(missions),
    source: "ai",
  };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── The pitch framework ─────────────────────────────────────────────────────

/**
 * The seven beats, in the order a room expects them.
 *
 * Shown, not enforced. A player who wants to open on traction and back into the
 * problem is doing something a real founder does; the framework is there so that
 * a player who has never seen a pitch is not staring at a red light with no idea
 * what comes next. `PitchNotes` renders it and the debrief marks off which beats
 * the transcript actually hit.
 */
export interface PitchBeat {
  n: number;
  title: string;
  /** The question this beat answers, in the founder's own head. */
  prompt: string;
  /** Words that suggest the beat was reached. Used by the debrief's checklist. */
  markers: string[];
}

export const PITCH_FRAMEWORK: PitchBeat[] = [
  {
    n: 1,
    title: "Problem",
    prompt: "What is broken right now, and who is living with it?",
    markers: ["problem", "broken", "struggle", "frustrat", "waste", "hard to", "nobody", "instead of", "currently", "right now"],
  },
  {
    n: 2,
    title: "Solution",
    prompt: "What you built, in one sentence a stranger would repeat correctly.",
    markers: ["we make", "we built", "we sell", "our product", "solution", "we offer", "it works by", "we run", "our app", "our service"],
  },
  {
    n: 3,
    title: "Market",
    prompt: "How many people have this problem, and what is that worth?",
    markers: ["market", "billion", "million people", "addressable", "industry", "category", "customers in", "tam", "segment"],
  },
  {
    n: 4,
    title: "Business model",
    prompt: "How the money actually arrives. Price, and who pays it.",
    markers: ["we charge", "price", "pricing", "subscription", "per month", "per unit", "margin", "revenue model", "we make money", "commission"],
  },
  {
    n: 5,
    title: "Traction",
    prompt: "What has already happened. Customers, orders, repeat rate.",
    markers: ["customers", "so far", "since", "grew", "growth", "repeat", "retention", "sold", "signed", "waiting list", "orders"],
  },
  {
    n: 6,
    title: "Financials",
    prompt: "Revenue, margin, burn, runway. The numbers you can defend.",
    markers: ["revenue", "margin", "burn", "runway", "profit", "cash", "churn", "cac", "ltv", "break even", "breakeven"],
  },
  {
    n: 7,
    title: "The ask",
    prompt: "How much, for what percentage, and what the money does.",
    markers: ["raising", "asking for", "looking for", "we need", "investment", "in exchange", "equity", "percent", "%", "use of funds", "valuation"],
  },
];

/**
 * Which beats a transcript actually reached. Used by the debrief and the score
 * card, and read by the sharks so they can ask about what was never said.
 *
 * ── Why this is not `text.includes(marker)` any more ───────────────────────
 *
 * It was, and it produced feedback players correctly called nonsense. Two
 * separate faults, both visible in one reported transcript — "I am the pickle
 * man… Pickles are in the supermarket. I want money." — which came back rated
 * as having covered Solution, Market and Traction:
 *
 *   1. NO WORD BOUNDARIES. "market" matched inside "super*market*". The Market
 *      beat — how many people have this problem and what is it worth — was
 *      awarded for the word supermarket. The same bug hands "since" to
 *      "sincere", "sold" to "soldier" and "shop" to "workshop".
 *
 *   2. ONE WORD IS NOT A BEAT. Even matched correctly, "we sell pickles" is
 *      not a Solution and "customers like pickles" is not Traction. A beat is
 *      a thing the founder ARGUED, and three words is not an argument.
 *
 * So a marker now has to appear as a whole word or phrase, and it has to
 * appear inside a sentence that develops something — enough content to be a
 * claim, or a figure, which is a claim by itself. That is a deliberately low
 * bar. It is not a test of eloquence and it cannot be failed by imperfect
 * grammar or a short pitch (Brand Law 5): "We charge £34 a hoodie" clears it
 * on its figure alone. It is only a test of whether anything was said.
 */
export function beatsCovered(transcript: string): Record<number, boolean> {
  const claims = developedSentences(transcript ?? "");
  const out: Record<number, boolean> = {};
  for (const beat of PITCH_FRAMEWORK) {
    out[beat.n] = claims.some((s) => beat.markers.some((m) => saidIn(s, m)));
  }
  return out;
}

/**
 * True when `text` contains `marker` as a whole word or whole phrase.
 *
 * Built by escaping the marker and fencing it with non-letter lookarounds
 * rather than `\b`, because several markers end in punctuation ("%") or hold
 * spaces ("we charge", "break even"), and `\b` behaves differently on each.
 * Trailing inflection is allowed — "customers" matches "customer" — so a
 * founder is not penalised for a plural.
 */
export function saidIn(text: string, marker: string): boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /*
   * One word may sit inside a multi-word marker, so "we make" is also found in
   * "we are making", "we is making" and "we just make". Brand Law 5 forbids
   * scoring fluency, and a marker list written in textbook English quietly
   * does exactly that: a founder pitching in a second language says the same
   * thing and loses the beat on grammar. One word of slack, not two, so the
   * phrase still has to be a phrase rather than two words in the same
   * paragraph.
   */
  const parts = marker.split(/\s+/);
  /*
   * The last word carries the inflection, and a silent -e is dropped before
   * -ing: make/making, charge/charging, offer/offering. Without this, "we are
   * making hoodies" misses the marker "we make" on a spelling rule, which is
   * the same Brand Law 5 problem in smaller print.
   */
  const last = parts[parts.length - 1];
  const inflected = /[a-z]$/i.test(last)
    ? last.endsWith("e")
      ? `${escape(last.slice(0, -1))}(?:e|es|ed|ing)?(?![a-z])`
      : `${escape(last)}(?:s|es|d|ed|ing)?(?![a-z])`
    : escape(last);
  const body = [...parts.slice(0, -1).map(escape), inflected].join("(?:\\s+\\w+)?\\s+");
  const lead = /^[a-z0-9]/i.test(marker) ? "(?<![a-z0-9])" : "";
  return new RegExp(`${lead}${body}`, "i").test(text);
}

/**
 * The sentences in a transcript that actually assert something.
 *
 * A figure makes a sentence a claim at almost any length — "240K revenue" is
 * two words and the most checkable thing in most pitches. Otherwise it takes
 * five words and three of them carrying content. Speech transcripts are punctuated
 * badly or not at all, so a run of text with no sentence breaks is treated as
 * one long sentence and clears the bar easily — the guard is against
 * fragments, not against people who do not say "full stop" out loud, and it is
 * deliberately too weak to be the only thing standing between a joke and a
 * score. `scorePitchContent` carries the other half.
 */
export function developedSentences(transcript: string): string[] {
  const FILLER = new Set(
    ("the a an and or but so if it is are was were be been am do does did have has had " +
      "i we you they he she them us our my your their this that these those there here " +
      "of to in on at by for from with about into over under not no yes very really just " +
      "like want going get got what which who when where why how").split(/\s+/),
  );
  return (transcript ?? "")
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.split(/\s+/).filter(Boolean);
      if (/\d/.test(s)) return words.length >= 2;
      if (words.length < 5) return false;
      const content = words.filter(
        (w) => w.length > 2 && !FILLER.has(w.toLowerCase().replace(/[^a-z']/g, "")),
      );
      return content.length >= 3;
    });
}
