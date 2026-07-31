import type { Industry, RunState } from "./types";
import { makeLine } from "./log";
import { resolveTokens } from "./interpolate";
import { ensurePortfolio, liveItems } from "./portfolio";

/**
 * THE STRATEGY LAYER — Addendum B §5.
 *
 * Positioning is the layer between the portfolio (what you sell) and the
 * Closet (what you look like): what you're FOR. One axis, three stances, and
 * one number — clarity — that the player never sees as a number (§9.5): it
 * surfaces as flags the event library gates on, as seasoning at year close,
 * and as what the shark decides to ask.
 *
 * Pure TS, no React, no RNG. The provider calls three seams:
 *   - shouldOfferStance()      after a draw — open PositioningSheet or not
 *   - syncPositioning()        after any outcome applies — reconcile flags
 *   - positioningYearTick()    at year close, before closeYear()
 * plus setStance() when the sheet answers without a drawn card, and
 * stanceQuestionFor() from the shark panel.
 *
 * Free for everyone. Positioning is strategy content, never pack content
 * (Brand Law 4 — packs buy more world, not a better game).
 */

// ── Model (§5.1) ────────────────────────────────────────────────────────────

export type Stance = "imitate" | "balance" | "differentiate";

/** Remembered so the shark can bring the flip-flop up by year (§5.1). */
export interface PriorStance {
  stance: Stance;
  switchedYear: number;
  heldYears: number;
}

/**
 * Brand identity (§5.4). The split is the whole point: glyph and colour are
 * Closet content — purchasable, zero-effect. Placement and price signal are
 * strategy content — free, small-effect. Effects are NOT wired in this pass;
 * the type ships so saves and the Closet build against the real shape.
 */
export interface BrandIdentity {
  /** COSMETIC — never touches any stat. Closet rules apply (Brand Law 4). */
  logoGlyph: string;
  logoColor: string;
  /** CONSEQUENTIAL — "this changes how the market reads you." */
  logoPlacement: "loud" | "subtle" | "hidden";
  priceSignal: "value" | "neutral" | "premium";
}

export const DEFAULT_IDENTITY: BrandIdentity = {
  logoGlyph: "",
  logoColor: "",
  logoPlacement: "subtle",
  priceSignal: "neutral",
};

export interface Positioning {
  /** The stance on the industry's strategic axis (§5.3). */
  stance: Stance;
  /** Consistency compounds; flip-flopping costs. */
  heldSinceYear: number;
  /** 0–100. Rises with stance-aligned choices, falls hard on contradiction. */
  clarity: number;
  /** Set on a switch, so the next raise can ask which company it's funding. */
  prior?: PriorStance;
  identity?: BrandIdentity;
}

// ── Flags — the contract with the event library ─────────────────────────────

/*
 * Events can't read state.positioning (isEligible is protected and flag-based),
 * so this module mirrors positioning into flags and keeps them canonical.
 * Authored events both GATE on these and SET the stance ones — the stance
 * question is answerable through a plain drawn card, which is what keeps the
 * whole layer headlessly simulatable with no UI in the loop.
 */
export const FLAG_POSITIONING_SET = "positioning_set";
export const FLAG_CLARITY_LOW = "clarity_low";
export const FLAG_CLARITY_HIGH = "clarity_high";
export const FLAG_REPOSITIONED = "repositioned_recent";
/** One-shot: consumed by syncPositioning(), never lingers. */
export const FLAG_RECOMMIT = "pos_recommit";

export const STANCE_FLAGS: Record<Stance, string> = {
  imitate: "stance_imitate",
  balance: "stance_balance",
  differentiate: "stance_differentiate",
};

/** One-shot directional moves authored choices set (copy fast, counter, hold the lane). */
const MOVE_FLAGS: [flag: string, direction: Stance][] = [
  ["pos_move_imitate", "imitate"],
  ["pos_move_differentiate", "differentiate"],
];

/** Choice order in the E-POS-ASK-* events. PositioningSheet maps stance → index with this. */
export const STANCE_CHOICE_ORDER: readonly Stance[] = [
  "imitate",
  "balance",
  "differentiate",
];

// ── Tuning ──────────────────────────────────────────────────────────────────

/*
 * §8.1 binds these: positioning is seasoning, and if it moves the survival
 * curve the numbers shrink, not the system. Thresholds 70/30 are §5.2 verbatim;
 * the switch reset of 25 is §5.1 verbatim.
 */
const CLARITY_FIRST = 50; // a claim, not yet backed by anything
const CLARITY_SWITCH = 25; // §5.1: switching resets clarity to 25
const CLARITY_GRADUATE = 40; // balance → a lane: a first bet, not a betrayal
const HIGH = 70;
const LOW = 30;
const ALIGNED_GAIN = 6;
const CONTRADICTION_LOSS = 15; // "falls hard"
const RECOMMIT_GAIN = 8;
const HOLD_GAIN = 2; // consistency compounds, slowly
const BALANCE_DRIFT = 6; // per year, toward the middle
const BALANCE_TARGET_EARLY = 40; // hedge-band: no bonus, no penalty
const BALANCE_TARGET_LATE = 15; // §5.2: viable early, deliberately weak late

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── The axis per industry (§5.3, exact language) ────────────────────────────

export interface StanceAxis {
  /** The axis, as the player sees it. */
  question: string;
  /** What imitate looks like here. */
  imitate: string;
  /** What differentiate looks like here. */
  differentiate: string;
}

/** Balance is the same refusal everywhere (§5.2: "take no strong bet"). */
export const BALANCE_LINE =
  "Take no strong bet yet. Keep every option open and let the market talk first.";

export const STANCE_AXES: Record<Industry, StanceAxis> = {
  FOOD: {
    question: "Crowd-pleaser or destination?",
    imitate: "Menu tracks what the street sells; compete on price and speed.",
    differentiate: "One thing nobody else makes; people cross town for it.",
  },
  ECOM: {
    question: "Everything store or the one thing?",
    imitate: "Stock what's trending, race on price and shipping.",
    differentiate: "Own a niche so hard the niche means you.",
  },
  TECH: {
    question: "Feature parity or opinionated product?",
    imitate: "Match the market leader's checklist.",
    differentiate: "Refuse features on purpose; the product has a point of view.",
  },
  CONTENT: {
    question: "Trend-surfer or format-owner?",
    imitate: "Ride what the algorithm rewards this month.",
    differentiate: "Invent a format people name after you.",
  },
  FASHION: {
    question: "On-trend or house style?",
    imitate: "Read the season, ship it fast, price it under.",
    differentiate: "A recognisable look that ignores the season.",
  },
  GAMING: {
    question: "Genre-plus or genre-defining?",
    imitate: "The proven genre with one twist, shipped fast.",
    differentiate: "The weird one that becomes its own genre or dies.",
  },
  FITNESS: {
    question: "Full-service gym or the method?",
    imitate: "Every class everyone else has.",
    differentiate: "A named method that exists only here.",
  },
  BEAUTY: {
    question: "Dupe culture or original formulation?",
    imitate: "The $12 version of the $60 product.",
    differentiate: "The formulation others dupe.",
  },
  EDTECH: {
    question: "Curriculum coverage or outcomes brand?",
    imitate: "Teach everything the syllabus lists.",
    differentiate: "Be famous for one outcome, provably.",
  },
  SUSTAIN: {
    question: "Green option or the standard-setter?",
    imitate: "The sustainable version of the normal thing.",
    differentiate: "Redefine what the category must be.",
  },
  TOYS: {
    question: "Licensed safety or original IP?",
    imitate: "Ride licensed characters.",
    differentiate: "Build IP worth licensing out.",
  },
  PET: {
    question: "Shelf brand or vet brand?",
    imitate: "Win the retail shelf on price and packaging.",
    differentiate: "Win the vet's recommendation and never discount.",
  },
};

/** The three sheet rows, in STANCE_CHOICE_ORDER, in the industry's vocabulary. */
export function stanceOptionsFor(
  industry: Industry,
): { stance: Stance; label: string }[] {
  const axis = STANCE_AXES[industry];
  return [
    { stance: "imitate", label: axis.imitate },
    { stance: "balance", label: BALANCE_LINE },
    { stance: "differentiate", label: axis.differentiate },
  ];
}

/** Real words only (Brand Law 6). Used by the sheet and the dossier. */
export function stanceLabel(stance: Stance): string {
  switch (stance) {
    case "imitate":
      return "Fast follower";
    case "balance":
      return "Undecided";
    case "differentiate":
      return "The only one";
  }
}

// ── Asking the question ─────────────────────────────────────────────────────

/**
 * First market contact: the first rival card, or Year 2 if no rival showed up
 * first. NEVER at founding (§9.3) — founding is busy and the question means
 * nothing before you've met the market. `drawnCategories` is the categories of
 * whatever just surfaced this month.
 */
export function shouldOfferStance(
  state: RunState,
  drawnCategories: readonly string[] = [],
): boolean {
  if (state.positioning) return false;
  if (!state.alive) return false;
  return drawnCategories.includes("RIV") || state.year >= 2;
}

// ── Setting and switching ───────────────────────────────────────────────────

/**
 * The sheet's entry point. The drawn-card path never calls this — authored
 * choices set stance flags and syncPositioning() converges on the same state,
 * so a headless bot and a thumb on glass produce identical runs.
 */
export function setStance(state: RunState, stance: Stance): void {
  const p = state.positioning;
  if (!p) {
    state.positioning = {
      stance,
      heldSinceYear: state.year,
      clarity: CLARITY_FIRST,
    };
    state.log.push(
      makeLine(
        state,
        "narration",
        resolveTokens(`{company} has an answer now: ${stanceLabel(stance).toLowerCase()}.`, state),
      ),
    );
  } else if (p.stance !== stance) {
    switchStance(state, stance);
  }
  syncFlags(state);
}

function switchStance(state: RunState, stance: Stance): void {
  const p = state.positioning;
  if (!p) return;
  const fromBalance = p.stance === "balance";
  p.prior = {
    stance: p.stance,
    switchedYear: state.year,
    heldYears: Math.max(0, state.year - p.heldSinceYear),
  };
  p.stance = stance;
  p.heldSinceYear = state.year;
  /*
   * Balance → a lane is the intended graduation (§5.2: "a legitimate opening"),
   * not a walk-back — there was no promise to break, so no repositioning event
   * and a softer reset. Every other switch is the §5.1 flip-flop: clarity to
   * 25 and the aftermath card comes looking for you.
   */
  if (fromBalance) {
    p.clarity = CLARITY_GRADUATE;
  } else {
    p.clarity = CLARITY_SWITCH;
    state.flags[FLAG_REPOSITIONED] = true;
  }
  state.log.push(
    makeLine(
      state,
      "narration",
      resolveTokens(
        fromBalance
          ? `{company} finally placed its bet: ${stanceLabel(stance).toLowerCase()}.`
          : `{company} changed its answer. The market heard both versions.`,
        state,
      ),
    ),
  );
}

// ── Reconciling after outcomes ──────────────────────────────────────────────

/**
 * Call after anything that applies an Outcome (resolveChoice, resolveAuto,
 * activity applications). Authored events speak in flags; this is where flags
 * become positioning: stance flags initialize or switch the stance, and the
 * one-shot move flags are consumed into clarity — aligned moves build it,
 * contradictions cost double and change (§5.1: "falls hard").
 */
export function syncPositioning(state: RunState): void {
  const p = state.positioning;
  const flagged = (Object.keys(STANCE_FLAGS) as Stance[]).filter(
    (s) => state.flags[STANCE_FLAGS[s]],
  );

  if (!p) {
    // A stance event answered before the sheet ever opened.
    if (flagged.length >= 1) setStance(state, flagged[0]);
    else consumeMoves(state); // strays can't mean anything yet
    return;
  }

  // An authored choice picked a different lane ("pick the lane" in the
  // stuck-in-the-middle card) — same path as the sheet, same costs.
  const changed = flagged.find((s) => s !== p.stance);
  if (changed) switchStance(state, changed);

  consumeMoves(state);
  syncFlags(state);
}

function consumeMoves(state: RunState): void {
  const p = state.positioning;
  for (const [flag, direction] of MOVE_FLAGS) {
    if (!state.flags[flag]) continue;
    delete state.flags[flag];
    if (!p || p.stance === "balance") continue; // no bet, nothing to back or betray
    p.clarity =
      p.stance === direction
        ? clamp(p.clarity + ALIGNED_GAIN, 0, 100)
        : clamp(p.clarity - CONTRADICTION_LOSS, 0, 100);
  }
  if (state.flags[FLAG_RECOMMIT]) {
    delete state.flags[FLAG_RECOMMIT];
    // Recommitting is aligned by definition — the one-sentence test's reward.
    if (p) p.clarity = clamp(p.clarity + RECOMMIT_GAIN, 0, 100);
  }
}

/** Flags are derived state; positioning is the source of truth. Keep them canonical. */
function syncFlags(state: RunState): void {
  const p = state.positioning;
  if (!p) return;
  state.flags[FLAG_POSITIONING_SET] = true;
  for (const [stance, flag] of Object.entries(STANCE_FLAGS)) {
    if (stance === p.stance) state.flags[flag] = true;
    else delete state.flags[flag];
  }
  if (p.clarity < LOW) state.flags[FLAG_CLARITY_LOW] = true;
  else delete state.flags[FLAG_CLARITY_LOW];
  if (p.clarity > HIGH) state.flags[FLAG_CLARITY_HIGH] = true;
  else delete state.flags[FLAG_CLARITY_HIGH];
}

// ── Year close (§5.2 effects, as seasoning) ─────────────────────────────────

export interface PositioningYearSummary {
  /** Qualitative, digit-free (§9.5). Already pushed to the run log. */
  lines: string[];
}

/**
 * The provider calls this at year close, before closeYear(). Everything here
 * is deliberately small: high clarity pays a little (customers know what you
 * are and pay for it — §5.2), low clarity leaks a little (churn up, marketing
 * efficiency down), balance drifts toward the middle and, after Stage 2,
 * through it — a Stage 3 company nobody can describe is dying.
 */
export function positioningYearTick(state: RunState): PositioningYearSummary {
  const p = state.positioning;
  if (!p || !state.alive) return { lines: [] };
  const s = state.stats;
  const before = band(p.clarity);

  if (p.stance === "balance") {
    const target = state.stage >= 3 ? BALANCE_TARGET_LATE : BALANCE_TARGET_EARLY;
    const step = Math.min(BALANCE_DRIFT, Math.abs(p.clarity - target));
    p.clarity = clamp(p.clarity + (p.clarity > target ? -step : step), 0, 100);
  } else {
    p.clarity = clamp(p.clarity + HOLD_GAIN, 0, 100);
  }

  if (p.clarity > HIGH) {
    // Elasticity and brand compound when the market can describe you.
    s.brand = clamp(s.brand + 1, 0, 100);
    s.cwp = clamp(s.cwp + 1, 0, 100);
    // Sharks fund companies they can describe (§5.6).
    s.invsent = clamp(s.invsent + 0.5, -5, 5);
  } else if (p.clarity < LOW) {
    s.churnPt = clamp(s.churnPt + 0.5, 0, 80);
    s.cacPt = clamp(s.cacPt - 1, 0, 100);
    s.invsent = clamp(s.invsent - 0.5, -5, 5);
  }

  // The aftermath card gets one raise-cycle to find you; then the market moves on.
  if (
    state.flags[FLAG_REPOSITIONED] &&
    p.prior &&
    state.year > p.prior.switchedYear + 1
  ) {
    delete state.flags[FLAG_REPOSITIONED];
  }

  const lines: string[] = [];
  const after = band(p.clarity);
  // Log on transition only — a yearly clarity line would turn it into a score.
  if (after !== before) {
    const line =
      after === "high"
        ? "Strangers describe {company} the same way you would."
        : after === "low"
          ? "Nobody can finish the sentence about what {company} is."
          : before === "high"
            ? "The sentence about {company} is getting longer."
            : "People are starting to get what {company} is about.";
    lines.push(resolveTokens(line, state));
  }
  for (const line of lines) state.log.push(makeLine(state, "narration", line));

  syncFlags(state);
  return { lines };
}

// ── Reading clarity without a number (§9.5) ─────────────────────────────────

export type ClarityBand = "high" | "mid" | "low";

const band = (clarity: number): ClarityBand =>
  clarity > HIGH ? "high" : clarity < LOW ? "low" : "mid";

export const clarityBand = (p: Positioning): ClarityBand => band(p.clarity);

/** For the dossier and the sheet — never a number, never a bar. */
export function clarityPhrase(p: Positioning): string {
  switch (band(p.clarity)) {
    case "high":
      return "The market can describe you in one sentence.";
    case "mid":
      return "The market is still deciding what you are.";
    case "low":
      return "Nobody can say what you are. Including, lately, you.";
  }
}

// ── The shark (§5.6, minimal slice) ─────────────────────────────────────────

/** "Year 3 you were the cheap one. Year 5 you're premium." — epithets by stance. */
const EPITHET: Record<Stance, string> = {
  imitate: "the cheap fast one",
  balance: "undecided",
  differentiate: "the premium one",
};

/**
 * One stance-aware question line for the panel, or null when there's no
 * positioning to interrogate. Priority mirrors §5.1/§5.6: a fresh flip-flop
 * beats everything, then the one-sentence test, then the stance-specific
 * pressure question. Tokens are resolved here so the panel gets a
 * display-ready string.
 */
export function stanceQuestionFor(state: RunState): string | null {
  const p = state.positioning;
  if (!p) return null;

  // The next raise after a switch brings it up, by year (§5.1). Cite the year
  // the OLD answer began — "Year 5 you were X, Year 5 you're Y" reads like a
  // typo, and the panel has the run log, so it cites real history.
  if (p.prior && state.year <= p.prior.switchedYear + 1) {
    const began = p.prior.switchedYear - p.prior.heldYears;
    const cite = Math.max(1, began < p.prior.switchedYear ? began : p.prior.switchedYear - 1);
    return (
      `Year ${cite} you were ${EPITHET[p.prior.stance]}. ` +
      `Year ${state.year} you're ${EPITHET[p.stance]}. Which company am I investing in?`
    );
  }

  if (p.clarity < LOW) {
    return "Describe this company in one sentence. I'll wait.";
  }

  switch (p.stance) {
    case "imitate":
      return "Walk me through what happens when the originals cut price.";
    case "differentiate": {
      const depth = liveItems(ensurePortfolio(state)).length;
      // §5.6's line verbatim while it's literally true; adapted once it isn't.
      const line =
        depth <= 1
          ? "You're one product deep. What happens when {topItem} stops being special?"
          : "Everything here rides on {topItem} being special. Walk me through the day it isn't.";
      return resolveTokens(line, state);
    }
    case "balance":
      return "You've met the market. You still haven't picked a side of it. When does that become the strategy?";
  }
}
