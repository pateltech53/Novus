import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import {
  clampPrice,
  earningItems,
  elasticityBand,
  ensurePortfolio,
  priceRatio,
  retireItem,
  tierFor,
} from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 03 · TECH APP — the highest multiple in the game and the fastest way to lose
 * money while every chart points up.
 *
 * Modelled on food.ts, which is the reference lens. Everything shared lives in
 * portfolio.ts; the only genuinely bespoke thing here is the leak function.
 *
 * ── Signature mechanic · THE PRICING LADDER & COHORT CHURN ──────────────────
 *
 * FOOD loses money to prep waste: you cannot forecast demand, so you buy inputs
 * you throw away. Nothing here works like that. Software has almost no cost of
 * goods — see the invest tiers below — so TECH cannot lose margin at the stove.
 * It loses revenue it has already booked, after the sale, to people leaving.
 *
 * A plan is a rung on a ladder, not a dish on a menu. Every rung is the same
 * product at a different price, which means the rungs interact in two ways the
 * shared cannibalization model cannot see:
 *
 *   1. CHURN is a monthly rate, compounded across twelve months. That is the
 *      whole reason this file exists. A fee is linear; an exponent is not, and
 *      the difference between two points and four points of monthly churn is
 *      the difference between a company and a slow leak with a logo.
 *   2. CONTRACTION is the customer who stays and pays you less. Launch a
 *      cheaper rung and you do not merely fail to add revenue — you invite the
 *      rung above it to step down. Founders see churn coming. Nobody sees this.
 *
 * On top of that sits the free tier. Serving free users costs real money and
 * the money comes out of paid revenue, because there is nowhere else for it to
 * come from. So a free plan books nothing, leaks nothing itself, and raises the
 * leak on every paid rung above it — worst when those rungs are cheap. That is
 * the free-tier trap, and it is never warned about.
 *
 * Teaches: MRR mechanics, net revenue retention, good churn versus bad churn,
 * and why users are not money.
 *
 * `tech-ship-feature` lowers churn at the cost of tech debt, `tech-cut-infra`
 * raises it in exchange for gross margin now, and `tech-reprice` forces the one
 * decision that has no safe answer: migrate the existing base and eat one bad
 * year, or grandfather them and carry a cohort that gets cheaper forever.
 */

const TECH_TAGS = ["free", "consumer", "prosumer", "enterprise", "integration", "platform"];

/**
 * `meta.billing` — "monthly" | "annual", chosen at launch. Read defensively:
 * plans launched before this key existed bill monthly, which is the honest
 * default because monthly is what you get if you never asked for a commitment.
 */
function billing(item: LineItem): "monthly" | "annual" {
  return item.meta.billing === "annual" ? "annual" : "monthly";
}

/** `meta.features` — retention work shipped into this plan. Capped; see below. */
function featuresShipped(item: LineItem): number {
  const n = Number(item.meta.features ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 0;
}

/**
 * Cheaper live rungs on the same ladder. Deliberately ignores tags: on a menu,
 * two items with different tags are different food, so overlap has to be
 * measured. On a pricing page every plan is the same product, so anything
 * meaningfully cheaper is a downgrade path whether you designed it as one or
 * not. The 0.75 threshold is the bit that matters — a plan five percent cheaper
 * is not somewhere to step down to.
 */
function rungsBelow(item: LineItem, state: RunState): number {
  return earningItems(ensurePortfolio(state)).filter(
    (other) => other.id !== item.id && other.price > 0 && other.price < item.price * 0.75,
  ).length;
}

/**
 * The flag is set by the activity, but a player can also just launch a plan
 * priced at zero and never touch the activity. Both are a free tier and both
 * send you the same bill, so both are counted.
 */
function servesFreeUsers(state: RunState): boolean {
  if (state.flags.free_tier) return true;
  return earningItems(ensurePortfolio(state)).some(
    (other) => other.price <= 0 || other.tags.includes("free"),
  );
}

function cohortChurn(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // A free plan books no revenue, so there is nothing here for churn to take.
  // Its cost lands on the paid rungs, further down this function.
  if (item.price <= 0) return 0;

  // ── The monthly rate ──────────────────────────────────────────────────
  // Every term below is per month, because a month is the only honest unit for
  // a subscription. It gets compounded once, at the end.
  let monthly = 0.018;

  // Who you sold to is the largest single fact about your retention, and you
  // committed to it with a tag at launch. A person cancels on a whim; a company
  // cancels through procurement, which takes a quarter and rarely finishes.
  if (item.tags.includes("consumer")) monthly += 0.014;
  else if (item.tags.includes("prosumer")) monthly += 0.004;

  // Overpricing does not cost you the sale. You already made the sale. It costs
  // you the renewal, which is a different quarter and a different lesson.
  const band = elasticityBand(priceRatio(item, state, spec));
  if (band === "greedy") monthly += 0.022;
  else if (band === "rich") monthly += 0.008;
  else if (band === "underpriced") monthly -= 0.004; // cheap is sticky, and see contraction

  // Support and reliability are the entire retention story in software. Nothing
  // else in this function moves the rate as far, which is the point.
  monthly += 0.02 * (1 - state.stats.csat / 100);
  monthly += 0.012 * (1 - state.stats.qual / 100);

  // Enterprise cuts both ways and that is why it is a decision. Sold without
  // the engineering behind it, the security review turns one big logo into one
  // big hole. Sold with it, procurement inertia makes it the stickiest revenue
  // you will ever have.
  if (item.tags.includes("enterprise")) {
    const ready =
      Boolean(state.flags.enterprise_ready) && item.investTier > 0 && state.stats.qual >= 55;
    monthly += ready ? -0.011 : 0.026;
  }

  // Features are retention work, and each one buys less than the last. They pay
  // you back here rather than in price, because the shared perceivedValue model
  // reads tags and invest tier only — it cannot see what you shipped.
  monthly -= 0.004 * Math.sqrt(featuresShipped(item));

  // Integrations are switching cost wearing a friendlier word. Once you are
  // wired into someone's workflow, leaving you is a project with a budget.
  const wired =
    item.tags.includes("integration") ||
    item.tags.includes("platform") ||
    Boolean(state.flags.platform_api);
  if (wired) monthly -= 0.006;

  // Thin infra is cheaper every month until the month it is not, and an outage
  // churns the customers who were already wavering rather than the loyal ones.
  if (state.flags.infra_thin) monthly += 0.009;

  // Cutting the build does not cut your cost of goods in software — the invest
  // tiers barely touch unit cost. It cuts how long people stay. This line is
  // where "cheap and fast" actually gets paid for.
  monthly += 0.004 * (2 - item.investTier);

  // Floor before the commitment discount, so a well-run plan cannot arrive here
  // with a negative rate and have annual billing turn it into a smaller one.
  monthly = Math.max(0.004, monthly);

  // Annual prepay: a cohort cannot walk out of a year it has already paid for.
  // This hides churn rather than fixing it — the bill arrives at renewal — but
  // the cash is yours in the meantime, which is a real and legitimate trade.
  if (billing(item) === "annual") monthly *= 0.45;

  monthly = Math.max(0.002, monthly + (rng() - 0.5) * 0.006);

  // ── Compound it ───────────────────────────────────────────────────────
  // A cohort shrinking at `monthly` is worth (1-m)^k in month k. Average that
  // across the twelve months you booked and you have the share you actually
  // collected; the gap is the leak. Churn is an exponent, not a fee.
  const retained = (1 - Math.pow(1 - monthly, 12)) / (12 * monthly);
  let leak = 1 - retained;

  // ── Contraction ───────────────────────────────────────────────────────
  // Dollars lost from customers you kept. Capped, because a downgrade still
  // leaves you paid — this is the cheaper kind of damage, and the invisible one.
  // A greedy price makes stepping down obviously correct, so it hurts more.
  const below = rungsBelow(item, state);
  if (below > 0) leak += Math.min(0.06, 0.025 * below) * (band === "greedy" ? 1.8 : 1);

  // ── The free tier's bill ──────────────────────────────────────────────
  // Free users are served out of paid revenue. The cheaper your paid rungs, the
  // larger a share of each dollar that is — which is why a free tier is fatal
  // to a consumer product and survivable in an enterprise one.
  if (servesFreeUsers(state)) {
    leak += 0.05 * Math.min(2, spec.baselinePrice / Math.max(1, item.price));
  }

  // ── Migrate or grandfather ────────────────────────────────────────────
  // Neither is free and neither is safe, which is the only reason it is worth
  // asking. A migration churns the base once, hard — harder still when other
  // people have built on your API and cannot follow you where you are going.
  // Grandfathering keeps everybody and freezes their revenue where it was: no
  // churn, no expansion, and a cohort that quietly gets cheaper every year you
  // hold it. Roughly double the pain for one year against half of it forever.
  //
  // An absent mode means the host has not resolved the choice yet, and an unmade
  // decision is not charged for. A mode without a year is charged as this year,
  // so a host that only writes the mode still gets the hit.
  const mode = item.meta.repriceMode;
  const repricedYear = Number(item.meta.repricedYear ?? state.year);
  const sinceReprice = Number.isFinite(repricedYear) ? state.year - repricedYear : 99;
  if (mode === "migrate" && sinceReprice <= 1) leak += state.flags.platform_api ? 0.1 : 0.06;
  else if (mode === "grandfather") leak += 0.03;

  return leak;
}

export const SPEC: IndustrySpec = {
  code: "TECH",
  noun: "Plan",
  nounPlural: "Plans",
  demandUnit: "subscribers",
  reportLabel: "THE PRODUCT",
  // The appendix's band, monthly. Zero is a legal price and it is a trap the
  // engine scores honestly all by itself: revenue zero, cost positive, verdict
  // flop, year after year.
  priceMin: 0,
  priceMax: 999,
  priceStep: 1,
  baselinePrice: 39,
  // The shared tick books `units × price` once a year and has no concept of a
  // monthly rung, so this is calibrated to land a median plan's booked year in
  // FOOD's range rather than to be read as a subscriber headcount times twelve.
  // Getting an ARR figure onto the report needs a per-spec revenue period in
  // portfolio.ts, which is not this file's to add.
  baseUnits: 1100,
  baselineGmPt: 82,
  tags: TECH_TAGS,
  namePlaceholder: "Pro",
  leakLabel: "Churn",
  // Higher than FOOD's spoilage ceiling. A kitchen can only throw away what it
  // prepped; a subscription can lose a third of a year it already sold.
  leakMax: 0.34,
  // Software is expensive to write and nearly free to serve, so the money moves
  // to the left column: build costs are double FOOD's, cost multipliers are a
  // quarter of them. The consequence is the industry's real lesson — cutting
  // corners here does not save you a cent of gross margin, it only costs you
  // retention, and you find that out a year later in `cohortChurn`.
  investTiers: [
    { label: "Ship it this week", costS: 1, costMult: 0.3, valueMult: 0.8 },
    { label: "Build it properly", costS: 2.5, costMult: 0.24, valueMult: 1.0 },
    { label: "Build it to audit", costS: 5, costMult: 0.2, valueMult: 1.26 },
  ],
  launchChoice: {
    metaKey: "billing",
    label: "How do they pay?",
    options: [
      { value: "monthly", label: "Month to month" },
      { value: "annual", label: "A year up front" },
    ],
    defaultIndex: 0,
  },
  signatureLeak: (item, state, rng, spec) => cohortChurn(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Local copy of the private helper in activities.ts: seeded rng, apply, refresh
 * the books, log one line. None of these advance time. They spend cash, energy
 * and attention, and that separation is the whole point.
 */

/**
 * `Activity.apply` takes only the run state — there is no item argument — so a
 * per-plan activity has to resolve its own target.
 *
 * Ranked by revenue, not by subscriber count. The report's `{topItem}` token
 * ranks by units, and on a ladder that is actively wrong: the free rung always
 * has the most subscribers and is never the rung you reprice. Counting people
 * instead of money is the mistake this whole lens is about.
 */
function ranked(state: RunState): LineItem[] {
  return earningItems(ensurePortfolio(state))
    .map((item) => ({ item, rev: item.history.at(-1)?.revenue ?? 0 }))
    .sort((a, b) => b.rev - a.rev)
    .map((r) => r.item);
}

const newestPlan = (state: RunState): LineItem | null =>
  [...earningItems(ensurePortfolio(state))].sort((a, b) => b.launchedYear - a.launchedYear)[0] ?? null;

/** Highest-earning PAID rung. A free plan cannot be repriced upward from zero. */
const topPaidPlan = (state: RunState): LineItem | null =>
  ranked(state).find((item) => item.price > 0) ?? null;

const weakestPlan = (state: RunState): LineItem | null => ranked(state).at(-1) ?? null;

const hasPlans = (state: RunState): boolean => earningItems(ensurePortfolio(state)).length > 0;

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The three-tap launch flow from §6. The cash moves inside `launchItem`,
     * once the player has named the rung and set its price, so nothing is
     * charged here. This only opens the sheet: the host reads
     * `flags.launch_sheet_open`, runs the flow, and clears the flag. Naming and
     * pricing are the player's, and nothing in this file may do either.
     */
    id: "tech-launch-plan",
    tab: "product",
    label: "Launch a plan",
    signal: "Name the tier. Pick the price.",
    detail:
      "A price, a feature set, and a monthly or annual commitment. Every rung you add changes what the rungs above it are worth.",
    apply: (s) =>
      spend(
        s,
        "tech-launch-plan",
        { setFlags: ["launch_sheet_open"] },
        "You add a rung to the pricing page. The number on it is the whole decision.",
      ),
  },
  {
    /**
     * Attaches to the newest plan. Raises retention rather than price, because
     * the shared value model cannot see a feature — only tags and invest tier —
     * so this is paid back in `cohortChurn` and nowhere else. The tech debt is
     * the honest half: surface area is permanent and features are not free to
     * keep alive.
     */
    id: "tech-ship-feature",
    tab: "product",
    label: "Ship a feature",
    signal: "Helps retention. Adds surface area.",
    detail:
      "Engineering time against one plan. It gives people a reason to stay and gives you one more thing that can break.",
    costS: 2,
    apply: (s) => {
      const plan = newestPlan(s);
      if (plan) plan.meta.features = featuresShipped(plan) + 1;
      spend(
        s,
        "tech-ship-feature",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "qual", amount: 4 },
            { stat: "csat", amount: 2 },
            { stat: "tdebt", amount: 2 },
            { stat: "energy", amount: -5 },
          ],
        },
        plan
          ? `You ship into ${plan.name}. The people who wanted it stay. The surface area never shrinks again.`
          : "You ship a feature with no plan under it. The code is real, the revenue is not.",
      );
    },
  },
  {
    /**
     * Moves the top plan up a notch — the same ten percent the market-tab
     * `price-up` activity uses, so the two read as the same lever at different
     * scopes. The number is not the decision; the existing base is. That choice
     * is left open for the host to resolve, and until it does, `cohortChurn`
     * charges nothing for it.
     */
    id: "tech-reprice",
    tab: "product",
    label: "Reprice a tier",
    signal: "Existing customers will find out.",
    detail:
      "A new number on the pricing page, and then the real question: move the people already paying the old one, or let them keep it forever.",
    available: (s) => topPaidPlan(s) !== null,
    apply: (s) => {
      const plan = topPaidPlan(s);
      if (plan) {
        plan.price = clampPrice(plan.price * 1.1, SPEC);
        plan.tier = tierFor(plan.price, SPEC);
        plan.meta.repricedYear = s.year;
      }
      spend(
        s,
        "tech-reprice",
        {
          effects: [
            { stat: "energy", amount: -4 },
            { stat: "churn_pt", amount: 2 },
            { stat: "brand", amount: -1 },
          ],
          setFlags: ["reprice_choice_open"],
        },
        plan
          ? `${plan.name} costs more as of this morning. Everyone already paying for it is about to read an email.`
          : "You edit the pricing page. There is nothing on it yet.",
      );
    },
  },
  {
    /**
     * Kills the weakest rung. `retireItem` hands back the standing burn, which
     * is the only clean part of this: the cohort on that plan either climbs the
     * ladder or leaves, and the churn hit lands whichever they choose.
     */
    id: "tech-sunset",
    tab: "product",
    label: "Sunset a plan",
    signal: "Nobody thanks you. Some people leave.",
    detail:
      "You stop selling a rung and tell the people on it where to go instead. Some of them go. Some of them go elsewhere.",
    available: hasPlans,
    apply: (s) => {
      const plan = weakestPlan(s);
      if (plan) retireItem(s, plan.id);
      spend(
        s,
        "tech-sunset",
        {
          effects: [
            { stat: "churn_pt", amount: 3 },
            { stat: "csat", amount: -4 },
            { stat: "brand", amount: -2 },
          ],
          // Killing the free rung stops the bill it was sending the paid ones.
          // Leaving the flag set would keep charging for users you no longer serve.
          clearFlags: plan && plan.price <= 0 ? ["free_tier"] : undefined,
        },
        plan
          ? `${plan.name} stops selling today. The migration notice is the most-read thing you have ever written.`
          : "Nothing to sunset. The pricing page is already short.",
      );
    },
  },
  {
    /**
     * The trap. Growth is immediate and legible; the cost is a standing burn
     * increase plus a permanent tax on every paid rung inside `cohortChurn`.
     * Neither of those is previewed, because the whole instructional value is a
     * player watching a beautiful user-growth chart and running out of money
     * underneath it.
     */
    id: "tech-free-tier",
    tab: "product",
    label: "Add a free tier",
    signal: "Growth goes up. So does your bill.",
    detail:
      "A plan that costs nothing to buy and something to serve. It fills the top of the funnel with people who have not agreed to pay you.",
    costS: 2,
    available: (s) => !s.flags.free_tier,
    apply: (s) =>
      spend(
        s,
        "tech-free-tier",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "burn_S_mo", amount: 0.35 },
            { stat: "brand", amount: 6 },
            { stat: "ctr_pt", amount: 4 },
            { stat: "share_pt", amount: 2 },
            { stat: "rev_pct", amount: 12, durationQ: 4 },
          ],
          setFlags: ["free_tier"],
        },
        "You open the door and stop charging at it. The signup chart is the best thing you have ever seen.",
      ),
  },
  {
    /**
     * Gated on quality rather than priced on it: an enterprise motion without
     * the engineering behind it fails the security review, so below the gate the
     * activity is absent rather than offered-and-punished. The revenue arrives
     * three quarters late because that is how long the contract takes, and it is
     * the only permanent revenue shift in this file.
     */
    id: "tech-enterprise",
    tab: "product",
    label: "Go enterprise",
    signal: "Bigger checks. Longer sales cycles. Real security review.",
    detail:
      "Procurement, SSO, an audit questionnaire and a salesperson. Every part of it is slower than you want and stickier than you expect.",
    costS: 4,
    minStage: 2,
    available: (s) => s.stats.qual >= 55 && !s.flags.enterprise_ready,
    apply: (s) =>
      spend(
        s,
        "tech-enterprise",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "burn_S_mo", amount: 0.3 },
            { stat: "energy", amount: -8 },
            { stat: "qual", amount: 2 },
            { stat: "churn_pt", amount: -3 },
            { stat: "val_pct", amount: 12 },
            { stat: "respect", amount: 1 },
            { stat: "rev_pct", amount: 20, afterQ: 3 },
          ],
          setFlags: ["enterprise_ready"],
        },
        "You hire someone who owns a suit and start answering questionnaires. Nothing closes for two quarters.",
      ),
  },
  {
    /**
     * Gross margin now against retention later — the trade this lens exists to
     * teach, in one tap. `infra_thin` raises the monthly churn rate for every
     * paid plan, so the margin you bought shows up this year and the bill shows
     * up in the leak line of the next report.
     */
    id: "tech-cut-infra",
    tab: "company",
    label: "Cut infra cost",
    signal: "Cheaper to run. Riskier at 3am.",
    detail:
      "Smaller instances, fewer replicas, a longer backup window. It runs fine right up until the night it does not.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "tech-cut-infra",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "gm_pt", amount: 4 },
            { stat: "risk", amount: 2 },
            { stat: "tdebt", amount: 1 },
          ],
          setFlags: ["infra_thin"],
        },
        "You trim the bill. The graphs still look fine, which is the part that gets people.",
      ),
  },
  {
    /**
     * Revenue and stickiness in exchange for never being able to move again —
     * `platform_api` lowers churn on every plan and roughly doubles what a
     * migration costs, because other people's software now depends on yours.
     * `partner_dependency` already exists in the authored event library, so the
     * events that punish exactly this can find it.
     */
    id: "tech-open-api",
    tab: "product",
    label: "Open the API",
    signal: "Other people build on you. Now you can't move.",
    detail:
      "Documentation, keys, versioning and a promise you cannot take back. Other people's roadmaps become your constraints.",
    costS: 3,
    minStage: 3,
    available: (s) => !s.flags.platform_api,
    apply: (s) =>
      spend(
        s,
        "tech-open-api",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "rev_pct", amount: 12 },
            { stat: "brand", amount: 5 },
            { stat: "val_pct", amount: 8 },
            { stat: "tdebt", amount: 3 },
            { stat: "share_pt", amount: 2 },
          ],
          setFlags: ["platform_api", "partner_dependency"],
        },
        "You publish the docs. By Friday four companies depend on a decision you made on a Tuesday.",
      ),
  },
];

export default SPEC;
