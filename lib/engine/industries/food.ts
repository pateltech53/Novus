import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import {
  elasticityBand,
  ensurePortfolio,
  liveItems,
  portfolioCap,
  priceRatio,
} from "../portfolio";

/**
 * 01 · FOOD & BEVERAGE — the reference lens.
 *
 * Addendum A's build order says ship FOOD alone and playtest it before touching
 * the other eleven, because it is the clearest case, the player's own example,
 * and a free-tier industry. Every other industry file in this folder is modelled
 * on this one.
 *
 * ── Signature mechanic · SPOILAGE & PREP WASTE ──────────────────────────────
 *
 * Every live item carries a hidden waste rate driven by how predictable its
 * demand is. Volatile items — seasonal tags, a price miles off what people think
 * it's worth — waste more, because you cannot guess how much to prep. Waste hits
 * gross margin directly and is invisible until the year-end report breaks it
 * out: "You lost 11% of Pumpkin Bowl to spoilage. That's your margin gap."
 *
 * Teaches: demand forecasting, and that gross margin is destroyed by operations
 * rather than by pricing alone.
 *
 * The `cut_waste` activity lowers it at a morale cost — a tighter kitchen is an
 * angrier kitchen — and `lock_supplier` lowers it by making cost predictable.
 */

const FOOD_TAGS = ["vegetarian", "spicy", "seasonal", "premium", "breakfast", "shareable"];

function spoilage(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // A well-understood item wastes little. Three things make demand hard to
  // predict, and every one of them is a real kitchen problem.
  let waste = 0.05;

  // Seasonal things spike and vanish; you over-prep on the good week.
  if (item.tags.includes("seasonal")) waste += 0.06;

  // Price a long way from perceived value makes volume erratic in both
  // directions — too cheap and you run out, too dear and it sits.
  const band = elasticityBand(priceRatio(item, state, spec));
  if (band === "greedy") waste += 0.07;
  else if (band === "underpriced") waste += 0.03;

  // A kitchen that has been told to tighten up wastes less and likes you less.
  if (state.flags.waste_tight) waste -= 0.04;
  // A locked supplier contract makes ordering predictable.
  if (state.flags.supplier_locked) waste -= 0.02;

  // Quality investment shows up here: better ops waste less.
  waste -= 0.02 * item.investTier;

  // Real kitchens vary week to week.
  waste += (rng() - 0.5) * 0.03;
  return waste;
}

export const SPEC: IndustrySpec = {
  code: "FOOD",
  noun: "Menu item",
  nounPlural: "Menu items",
  demandUnit: "covers",
  reportLabel: "THE MENU",
  priceMin: 3,
  priceMax: 40,
  priceStep: 0.5,
  baselinePrice: 13,
  baseUnits: 2600,
  baselineGmPt: 62,
  tags: FOOD_TAGS,
  namePlaceholder: "Midnight Chili Oil",
  leakLabel: "Spoilage",
  leakMax: 0.28,
  investTiers: [
    { label: "Cheap and fast", costS: 0.5, costMult: 1.18, valueMult: 0.82 },
    { label: "Do it properly", costS: 1.5, costMult: 1.0, valueMult: 1.0 },
    { label: "Go all out", costS: 3, costMult: 0.88, valueMult: 1.22 },
  ],
  signatureLeak: (item, state, rng, spec) => spoilage(item, state, rng, spec),
};

/**
 * FOOD's eight activities, from the appendix table.
 *
 * The launch flow itself (§6 — name it, price it, confirm) lives in the product
 * sheet rather than here, because an Activity takes no input and the three taps
 * ARE the mechanic. `add-menu-item` opens that sheet and deliberately carries no
 * `costS`: the invest tier is charged by `launchItem` on commit, and billing here
 * as well would take the money twice.
 */
export const ACTIVITIES: Activity[] = [
  // ── Product ───────────────────────────────────────────────────────────
  {
    id: "food-add-item",
    tab: "product",
    label: "Add a menu item",
    signal: "Name it. Price it. Live with it.",
    detail:
      "A dish, a price you choose with nothing in front of you, and a decision about how well to make it.",
    available: (s) => liveItems(ensurePortfolio(s)).length < portfolioCap(s),
    apply: (s) =>
      spend(
        s,
        "food-add-item",
        { setFlags: ["launch_sheet_open"] },
        "You start writing a new dish onto the menu. Nothing is committed until you name it and price it.",
      ),
  },
  {
    id: "food-reformulate",
    tab: "product",
    label: "Reformulate an item",
    signal: "Same name, better version. Buys time.",
    detail:
      "A dish people have stopped ordering, remade. Each time you do this to the same dish it buys less than the last.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "food-reformulate",
        { setFlags: ["refresh_sheet_open"] },
        "You take a dish back into the kitchen. Same name on the menu, different plate.",
      ),
  },
  {
    /*
     * A seasonal special is a real LineItem with a forced short life and a
     * novelty bump — limited-time-offer economics, which is a different lesson
     * from ordinary pricing: you are buying urgency and paying for it in waste,
     * because a four-quarter dish never gets predictable enough to prep well.
     */
    id: "food-seasonal",
    tab: "product",
    label: "Run a seasonal special",
    signal: "Burns bright, then it's gone.",
    detail:
      "On the menu for a few months only. People come for it because it will not be there later.",
    costS: 0.5,
    apply: (s) =>
      spend(
        s,
        "food-seasonal",
        { setFlags: ["launch_sheet_open", "launch_seasonal"] },
        "You plan a special. It has an end date before it has a first cover.",
      ),
  },

  // ── Company ───────────────────────────────────────────────────────────
  {
    id: "food-change-supplier",
    tab: "company",
    label: "Change suppliers",
    signal: "Cheaper per unit. You'll find out why.",
    detail: "A better price from someone whose kitchen you have not stood in.",
    apply: (s) =>
      spend(
        s,
        "food-change-supplier",
        {
          effects: [
            { stat: "gm_pt", amount: 4 },
            { stat: "suploy", amount: -1 },
            { stat: "risk", amount: 2 },
          ],
          clearFlags: ["supplier_locked"],
        },
        "You switch suppliers. The invoice improves immediately. The rest reveals itself later.",
      ),
  },
  {
    id: "food-lock-supplier",
    tab: "company",
    label: "Lock a supplier contract",
    signal: "Predictable. Even when the market moves your way.",
    detail:
      "A fixed price for two years. It protects you from the spikes and denies you the dips.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "food-lock-supplier",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "suploy", amount: 2 },
          ],
          setFlags: ["supplier_locked"],
        },
        "You sign a two-year price. Ordering gets boring, which is the point.",
      ),
  },
  {
    id: "food-cut-waste",
    tab: "company",
    label: "Cut prep waste",
    signal: "Tighter kitchen. Angrier kitchen.",
    detail:
      "Smaller batches, stricter counts, no comfortable margin for a busy Friday.",
    apply: (s) =>
      spend(
        s,
        "food-cut-waste",
        {
          effects: [
            { stat: "gm_pt", amount: 3 },
            { stat: "morale", amount: -6 },
            { stat: "csat", amount: -2 },
          ],
          setFlags: ["waste_tight"],
        },
        "You tighten every prep list. Less goes in the bin and the kitchen notices who decided that.",
      ),
  },

  // ── Assets ────────────────────────────────────────────────────────────
  {
    id: "food-second-location",
    tab: "assets",
    label: "Open a second location",
    signal: "Twice the covers. Twice of everything else.",
    detail:
      "Another room, another lease, another set of people who have never met you.",
    costS: 12,
    minStage: 2,
    apply: (s) => {
      // Capacity, not a stat bump: the second kitchen is why the menu can carry
      // more items at all.
      s.portfolioCapBonus = (s.portfolioCapBonus ?? 0) + 2;
      spend(
        s,
        "food-second-location",
        {
          effects: [
            { stat: "cash_S", amount: -12 },
            { stat: "burn_S_mo", amount: 0.8 },
            { stat: "rev_pct", amount: 16, durationQ: 4 },
            { stat: "energy", amount: -10 },
          ],
          setFlags: ["second_location"],
        },
        "You open the second site. Everything that was hard once is now hard twice, and the covers are real.",
      );
    },
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    id: "food-get-reviewed",
    tab: "market",
    label: "Get reviewed",
    signal: "You don't get to pick the reviewer.",
    detail:
      "An invitation to somebody whose opinion carries. They will write what they find.",
    apply: (s) =>
      spend(
        s,
        "food-get-reviewed",
        { setFlags: ["invited_review"] },
        "You invite a critic in. What happens next is not up to you.",
      ),
  },
];

export default SPEC;
