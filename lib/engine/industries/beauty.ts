import type { Activity } from "../activities";
import { spend } from "../activities";
import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import {
  earningItems,
  elasticityBand,
  ensurePortfolio,
  liveItems,
  priceRatio,
  refreshItem,
  retireItem,
} from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 08 · BEAUTY — modelled on `industries/food.ts`, which is the reference lens.
 *
 * ── Signature mechanic · SHADE RANGE & THE INCLUSIVITY DIVIDEND ──────────────
 *
 * A color SKU launches with a range breadth the player picks: narrow, standard
 * or full. FOOD loses money to forecast error — it cannot guess how much to
 * prep. BEAUTY loses money to MIX error, which is a different problem with a
 * different shape: demand here is split across shades, and you are not guessing
 * the size of it, you are deciding how much of it you are willing to serve.
 *
 * Both ends of that decision leak, for opposite reasons:
 *
 *  · Narrow ranges lose at the counter. The customer whose shade you never made
 *    either walks or buys the nearest thing and returns it. That loss is a
 *    percentage of gross and it GROWS as brand grows, because the bigger the
 *    audience you pull into the room, the bigger the slice of it your range does
 *    not fit. Narrow gets worse the better you do, which is the whole lesson
 *    about an addressable-market ceiling and the one thing no player expects.
 *
 *  · Full ranges lose in the warehouse. The deep and the light end turn maybe
 *    twice a year, sit in finished packaging, and end their life marked down or
 *    written off. That is tail-SKU economics, it is expensive up front, and it
 *    SHRINKS as brand grows, because a wider customer base eventually absorbs
 *    the tail.
 *
 * So the two curves cross. Narrow is genuinely the right answer for a small
 * brand and genuinely the wrong answer for a big one, and the crossover arrives
 * years after the money was committed. A long-payback investment where the
 * correct move is expensive, slow, and indistinguishable from a mistake for
 * about four fiscal years.
 *
 * Teaches: addressable market, long-payback investment, tail-SKU economics, and
 * that inclusive design is a market decision with real numbers behind it.
 *
 * ── Signature failure · THE CLAIMS PROBLEM ──────────────────────────────────
 *
 * The gap between what marketing says and what the formulation does. Modelled
 * as `brand` running ahead of `qual` rather than as a stored counter, because
 * that gap is already the thing the player is creating when they buy reach
 * instead of a lab. It shows up here as refunds and complaint volume, it raises
 * the teardown odds on `beauty-seed-influencers`, and it is stashed per item as
 * `meta.claimRisk` so the recall event has a number to weight itself by.
 *
 * `beauty-extend-range` buys breadth after the fact at a worse price than
 * buying it at launch. `beauty-derm-tested` and `beauty-reformulate` close the
 * claims gap. `beauty-retail-partner` widens the leak permanently, which is
 * what channel power costs and is never said out loud.
 */

const BEAUTY_TAGS = ["skincare", "color", "fragrance", "tool", "clean", "refill"];

type RangeBreadth = "narrow" | "standard" | "full";

/**
 * `meta.range` is set by the launch sheet. Items launched before this key
 * existed, or in another lens entirely, read as standard — the middle option is
 * the only honest default, since assuming either end would invent a decision
 * the player never made.
 */
function rangeOf(item: LineItem): RangeBreadth {
  const raw = item.meta?.range;
  return raw === "narrow" || raw === "full" ? raw : "standard";
}

function inclusivityGap(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // Testers, samples, gift-with-purchase and the units that arrive dented.
  // Every SKU in this industry pays this whatever else it does.
  let leak = 0.03;

  // How much of this SKU's demand is shade-matched at all. A foundation lives
  // or dies on range; a serum has skin types, which is a softer version of the
  // same problem; a fragrance or a brush has no shade to miss.
  const exposure = item.tags.includes("color")
    ? 1
    : item.tags.includes("skincare")
      ? 0.6
      : 0.25;

  // Brand is the proxy for how many people are actually in the room. It is the
  // multiplier on both halves of the mechanic, in opposite directions.
  const reach = state.stats.brand / 100;

  let breadth: number;
  switch (rangeOf(item)) {
    case "narrow":
      // Cheap to make, excellent per SKU, and the unserved half of your
      // audience becomes a return or a walk-away. Scales straight off reach.
      breadth = 0.02 + 0.2 * reach;
      break;
    case "full":
      // The tail-shade bill. Front-loaded and self-liquidating: the deep end
      // stops being dead stock once the base is wide enough to buy it.
      breadth = 0.15 - 0.07 * reach;
      break;
    default:
      // Standard covers the middle of the curve and neither end of the room.
      breadth = 0.05 + 0.08 * reach;
  }
  leak += breadth * exposure;

  // Refills rescue the tail first: one body, many refills, so the slow shades
  // stop sitting in finished primary packaging waiting to be written off.
  if (item.tags.includes("refill") || item.meta?.refill === true) leak -= 0.02;

  // A near-miss shade at a mass price gets kept and used up. The same near-miss
  // at a prestige price comes back in the post. Price raises return tolerance
  // requirements, not just volume.
  const band = elasticityBand(priceRatio(item, state, spec));
  if (band === "greedy") leak += 0.05;
  else if (band === "rich") leak += 0.02;

  // Shelf space is not free even after the slotting fee: the retailer returns
  // what did not sell, charges the markdown back to you, and culls the slow
  // shades first. You wanted volume and you bought their returns policy too.
  if (state.flags.retail_partner) leak += 0.03;

  // The claims problem. Marketing ahead of formulation buys refunds, complaint
  // handling and adverse-reaction credits. Kept as brand-minus-qual because
  // that gap IS the overclaim, and stashed on the item because the recall event
  // needs a per-SKU weight and this is the only per-SKU hook the lens gets.
  const overclaim = Math.max(0, state.stats.brand - state.stats.qual) / 100;
  leak += 0.1 * overclaim;
  item.meta.claimRisk = Number(overclaim.toFixed(3));

  // Tested product argues back. Fewer credits, fewer refunds, same formula.
  if (state.flags.derm_tested) leak -= 0.02;

  // Investment shows up as shade QC at the fill line — fewer off-tone batches
  // scrapped before they ever reach a counter.
  leak -= 0.015 * item.investTier;

  // Batch to batch, counter to counter.
  leak += (rng() - 0.5) * 0.03;
  return leak;
}

export const SPEC: IndustrySpec = {
  code: "BEAUTY",
  noun: "SKU",
  nounPlural: "SKUs",
  demandUnit: "units",
  reportLabel: "THE LINE",
  // Addendum A's band: mass at the bottom, prestige at the top, dollar steps.
  priceMin: 8,
  priceMax: 150,
  priceStep: 1,
  // Prestige-adjacent anchor, sat about a fifth up the band the way FOOD's is.
  baselinePrice: 32,
  // Fewer transactions than a restaurant's covers, worth far more each.
  baseUnits: 1600,
  // Clearly above FOOD: beauty's cost of goods is small and its cost of
  // *convincing you* is enormous. Which is exactly where the claims gap starts.
  baselineGmPt: 70,
  tags: BEAUTY_TAGS,
  namePlaceholder: "Ashen Peach 07",
  leakLabel: "Range gap",
  leakMax: 0.26,
  investTiers: [
    // Dearer than FOOD's across the board: a fill run has a minimum order and
    // compliance paperwork before anything reaches a shelf.
    { label: "White-label it", costS: 0.75, costMult: 1.2, valueMult: 0.8 },
    { label: "Custom formulation", costS: 2, costMult: 1.0, valueMult: 1.0 },
    { label: "Lab, testing, the works", costS: 4, costMult: 0.88, valueMult: 1.25 },
  ],
  launchChoice: {
    metaKey: "range",
    label: "How wide is the range?",
    options: [
      { value: "narrow", label: "A few shades" },
      { value: "standard", label: "A standard range" },
      { value: "full", label: "The full range" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => inclusivityGap(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Local copy of the private helper in `activities.ts`. Same contract, and the
 * header rule of that file binds here without exception: NONE of these advance
 * time. They spend cash, energy and attention.
 */

const latestUnits = (item: LineItem) => item.history.at(-1)?.units ?? 0;

/** The SKU with the most demand behind it — where breadth is worth most. */
function widestReach(state: RunState): LineItem | null {
  const live = liveItems(ensurePortfolio(state)).filter((i) => rangeOf(i) !== "full");
  return live.sort((a, b) => latestUnits(b) - latestUnits(a))[0] ?? null;
}

/** Declining first: a reformulation is worth most where the clock has run. */
function reformulationTarget(state: RunState): LineItem | null {
  const live = liveItems(ensurePortfolio(state));
  const declining = live.filter((i) => i.state === "declining");
  const pool = declining.length > 0 ? declining : live;
  return pool.sort((a, b) => latestUnits(b) - latestUnits(a))[0] ?? null;
}

function weakestEarner(state: RunState): LineItem | null {
  const earning = earningItems(ensurePortfolio(state));
  return earning.sort((a, b) => latestUnits(a) - latestUnits(b))[0] ?? null;
}

export const ACTIVITIES: Activity[] = [
  // ── Product ───────────────────────────────────────────────────────────
  {
    /**
     * The entry point to the launch flow, not the launch itself. Name, price and
     * range breadth are the player's to author, so `apply` deliberately does
     * nothing: the sheet collects the three taps, writes `meta.range`, and the
     * cash moves inside `launchItem`. An `apply` that invented a name and spent
     * the money would be the engine playing the game.
     */
    id: "beauty-launch-sku",
    tab: "product",
    label: "Launch a SKU",
    signal: "Name it, price it, decide how many shades.",
    detail:
      "A formula, a price and a decision about how much of the room you intend to serve. The third one is the one you will still be paying for in six years.",
    apply: () => {},
  },
  {
    /**
     * Breadth bought late, at a worse price than breadth bought at launch: a
     * second fill run, second compliance pass, second set of packaging. The
     * brand and CSAT dividend is real and durable; the margin cost is real and
     * permanent. Both are true at once, which is the point of the mechanic.
     */
    id: "beauty-extend-range",
    tab: "product",
    label: "Extend the shade range",
    signal: "Expensive. Overdue. Worth it.",
    detail:
      "Deeper and lighter than you launched with. The new shades will turn slowly and the people who waited for them will not forget which order that happened in.",
    costS: 2,
    available: (s) => widestReach(s) !== null,
    apply: (s) => {
      const item = widestReach(s);
      if (!item) return;
      const next: RangeBreadth = rangeOf(item) === "narrow" ? "standard" : "full";
      item.meta.range = next;
      spend(
        s,
        "beauty-extend-range",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "brand", amount: 7 },
            { stat: "csat", amount: 5 },
            { stat: "cwp_pt", amount: 2 },
            { stat: "gm_pt", amount: -2 },
          ],
          // Only a complete range opens the retail conversations. Half a range
          // is a buyer's objection with your name on it.
          setFlags: next === "full" ? ["full_range"] : [],
        },
        `You add shades to ${item.name}. The tail turns slowly. The room notices anyway.`,
      );
    },
  },
  {
    /**
     * Lifecycle refresh via the shared `refreshItem`, which charges the cash and
     * carries the diminishing-returns curve. The claims value is the other half:
     * a formula that finally does what the ad said stops generating refunds.
     */
    id: "beauty-reformulate",
    tab: "product",
    label: "Reformulate",
    signal: "Same promise. Better delivery.",
    detail:
      "Same name on the front, different chemistry inside. Nobody re-reviews it. The refund rate knows.",
    costS: 1.5,
    available: (s) => reformulationTarget(s) !== null,
    apply: (s) => {
      const item = reformulationTarget(s);
      if (!item) return;
      // refreshItem moves the cash and resets the decay clock, so the effect
      // list below must not charge for it twice.
      if (!refreshItem(s, item.id, 1.5)) return;
      spend(
        s,
        "beauty-reformulate",
        {
          effects: [
            { stat: "qual", amount: 6 },
            { stat: "csat", amount: 3 },
            { stat: "energy", amount: -4 },
          ],
        },
        `You reformulate ${item.name}. Same promise. Now the jar can keep it.`,
      );
    },
  },
  {
    /**
     * The unglamorous purchase that makes a premium price defensible instead of
     * merely charged. Bought once, applies to the whole line, and the claims
     * term in the leak is the only place it visibly pays — years later.
     */
    id: "beauty-derm-tested",
    tab: "product",
    label: "Get dermatologist-tested",
    signal: "Slower. Defensible.",
    detail:
      "A panel, a protocol and a wait. At the end of it you can say the thing you have been implying, and say it in writing.",
    costS: 2,
    available: (s) => !s.flags.derm_tested,
    apply: (s) =>
      spend(
        s,
        "beauty-derm-tested",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "qual", amount: 5 },
            { stat: "csat", amount: 3 },
            { stat: "cwp_pt", amount: 4 },
            { stat: "risk", amount: -2 },
          ],
          setFlags: ["derm_tested"],
        },
        "You test it properly. The claim stops being a hope and becomes a document.",
      ),
  },
  {
    /**
     * The consumable derived from a durable. Smaller checks, better retention,
     * cheaper packaging — and it quietly rescues the tail shades, because a
     * refill sachet is not sitting in a glass bottle waiting to be marked down.
     */
    id: "beauty-launch-refills",
    tab: "product",
    label: "Launch refills",
    signal: "Cheaper for them. Stickier for you.",
    detail:
      "They keep the bottle and buy the inside of it. Every order is worth less and every customer is worth more.",
    costS: 1,
    available: (s) => liveItems(ensurePortfolio(s)).length > 0,
    apply: (s) => {
      const live = liveItems(ensurePortfolio(s)).sort((a, b) => latestUnits(b) - latestUnits(a));
      const item = live[0];
      if (!item) return;
      item.meta.refill = true;
      spend(
        s,
        "beauty-launch-refills",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "churn_pt", amount: -3 },
            { stat: "csat", amount: 4 },
            { stat: "gm_pt", amount: 2 },
            { stat: "rev_pct", amount: -5, durationQ: 4 },
          ],
          setFlags: ["refill_system"],
        },
        `You put ${item.name} in a refill. Smaller orders, arriving for longer.`,
      );
    },
  },
  {
    /**
     * The retire flow with a pointed edge. Discontinuing a shade is arithmetic
     * on a spreadsheet and a small betrayal at a counter, and this industry is
     * the one where the second half of that sentence has a CSAT cost.
     */
    id: "beauty-discontinue",
    tab: "product",
    label: "Discontinue a shade",
    signal: "Somebody's favorite. Nobody's profit.",
    detail:
      "It never earned its slot. Someone has been buying it for four years and will write to you about it.",
    available: (s) => weakestEarner(s) !== null,
    apply: (s) => {
      const item = weakestEarner(s);
      if (!item) return;
      retireItem(s, item.id);
      spend(
        s,
        "beauty-discontinue",
        {
          effects: [
            { stat: "csat", amount: -3 },
            { stat: "brand", amount: -1 },
          ],
        },
        `You discontinue ${item.name}. The margin improves. The mentions do not.`,
      );
    },
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    /**
     * The cheapest reach in the industry and the only one where you hand the
     * script to someone else. The teardown odds are weighted by the claims gap,
     * so this activity is where marketing-ahead-of-substance gets its bill —
     * from the exact channel that made the overclaim profitable.
     */
    id: "beauty-seed-influencers",
    tab: "market",
    label: "Seed to influencers",
    signal: "Cheap reach. You don't control the review.",
    detail:
      "Boxes out to people with an audience and no obligation to like it. Most say something kind. One of them films the swatch that does not match.",
    costS: 0.5,
    apply: (s) => {
      const roll = runRng(s.seed, s.year, s.month, hashString("beauty-seed-influencers"))();
      // A brand running well ahead of its formulation is a teardown waiting for
      // a camera. This is the claims failure arriving through the front door.
      const overclaim = Math.max(0, s.stats.brand - s.stats.qual) / 100;
      const teardownOdds = 0.12 + 0.35 * overclaim;

      if (roll < teardownOdds) {
        spend(
          s,
          "beauty-seed-influencers",
          {
            effects: [
              { stat: "cash_S", amount: -0.5 },
              { stat: "brand", amount: -8 },
              { stat: "csat", amount: -6 },
              { stat: "risk", amount: 1 },
            ],
          },
          "One of them films the swatch under daylight, side by side with the ad. It travels further than the ad did.",
        );
        return;
      }
      if (roll > 0.84) {
        spend(
          s,
          "beauty-seed-influencers",
          {
            effects: [
              { stat: "cash_S", amount: -0.5 },
              { stat: "brand", amount: 14 },
              { stat: "ctr_pt", amount: 5 },
              { stat: "rev_pct", amount: 14, durationQ: 2 },
            ],
          },
          "One of them loves it out loud, unpaid, for ninety seconds. You could not have bought that and you did not.",
        );
        return;
      }
      spend(
        s,
        "beauty-seed-influencers",
        {
          effects: [
            { stat: "cash_S", amount: -0.5 },
            { stat: "brand", amount: 4 },
            { stat: "ctr_pt", amount: 3 },
          ],
        },
        "Most of the boxes get a polite mention. A few get nothing. That is the deal you took.",
      );
    },
  },
  {
    /**
     * Channel power, priced honestly. Volume arrives, margin leaves, and the
     * standing cost lands in the leak as returns-to-vendor and markdown
     * chargebacks — permanently, because the terms do not soften. They can also
     * drop you, which is what the risk is for.
     */
    id: "beauty-retail-partner",
    tab: "market",
    label: "Land a retail partner",
    signal: "Shelf space. Their terms. Their margin.",
    detail:
      "A buyer says yes and hands you the terms: their price, their margin, their returns policy, their decision about whether you are there next year.",
    costS: 3,
    minStage: 2,
    available: (s) => !s.flags.retail_partner,
    apply: (s) =>
      spend(
        s,
        "beauty-retail-partner",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "rev_pct", amount: 22, durationQ: 4 },
            { stat: "gm_pt", amount: -6 },
            { stat: "share_pt", amount: 2 },
            { stat: "cac_pt", amount: 4 },
            { stat: "risk", amount: 1 },
          ],
          setFlags: ["retail_partner"],
        },
        "You get the shelf. They set the price, keep the margin, and send back what did not move.",
      ),
  },
];

export default SPEC;
