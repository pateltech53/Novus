import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import { priceRatio, elasticityBand } from "../portfolio";
import { applyOutcome } from "../effects";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";
import { refreshBooks } from "../sim";

/**
 * 05 · FASHION / STREETWEAR — the drop lens.
 *
 * Built on `food.ts`, which is the reference file for this folder. Same
 * contract, same silence before the year closes.
 *
 * ── Signature mechanic · SELL-THROUGH & SCARCITY ────────────────────────────
 *
 * You do not sell units here, you sell out — or you do not. A drop commits to a
 * quantity before anybody has voted with money (`meta.runSize`), and the number
 * the trade reports is not units, it is the share of that run that left at
 * ticket price.
 *
 * So the loss is two-sided, and both sides are the same decision:
 *
 *   · Made too many → the overhang goes to markdown. You clear it below ticket,
 *     and the deeper the pile the worse the recovery, because a rack of
 *     leftovers is an end-of-season sale and a warehouse of them is a phone call
 *     to a liquidator.
 *   · Made too few → you sold out and turned away a queue. A little of that
 *     queue waits for the next drop. Most of it buys something else.
 *
 * Which is why this is not spoilage wearing a different coat. Waste is physical
 * and the kitchen forgets it by the next quarter. A markdown is not forgotten by
 * anyone: it teaches your best customers that waiting is the rational move, so
 * it lowers demand at ticket on every drop that follows. The loss has memory,
 * carried by `discounter` and then `trained_to_wait`, and it feeds itself —
 * weaker demand at ticket leaves more overhang, which asks for another markdown.
 * The only exit is holding price and eating the cash, which is what `hold-price`
 * is for and why it looks like doing nothing.
 *
 * The other half of the lesson is that under-producing is a strategy rather
 * than a mistake. A tight run caps your downside at the queue you turned away,
 * leaves ticket price intact, and hands you a sold-out drop you can choose to
 * restock — for money, at the cost of the scarcity that sold it.
 *
 * Teaches: scarcity as a pricing tool, brand equity as a balance-sheet item,
 * and why a discount is the most expensive way to raise cash.
 */

const FASHION_TAGS = ["tee", "outerwear", "accessory", "limited", "core", "collab"];

/**
 * The quantity decision. Nothing in the shared `LineItem` has a slot for it, so
 * it rides in `meta.runSize`, set by the launch flow. Drops that predate the key
 * read as `planned`, which is the neutral guess and the one that loses least.
 */
type RunSize = "tight" | "planned" | "deep";

/**
 * Units cut, relative to what a median drop at this brand would move. These are
 * the whole quantity decision: the numbers are close together on purpose,
 * because in a real line the difference between selling out and sitting on a
 * pallet is a third of a run, not a multiple of one.
 */
const RUN_CAPACITY: Record<RunSize, number> = { tight: 0.75, planned: 1, deep: 1.35 };

/** You buy a size curve, not a pile. Both ends of it always linger. */
const SIZE_CURVE_RESIDUE = 0.025;

/** How much of an unserved queue never comes back. */
const QUEUE_LOST = 0.45;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function runSizeOf(item: LineItem): RunSize {
  const raw = item.meta ? item.meta.runSize : undefined;
  return raw === "tight" || raw === "deep" ? raw : "planned";
}

/**
 * Demand for THIS drop, in units of a planned run. Everything in here is
 * something a buyer at a trade show would tell you, and none of it is visible to
 * the player before the year closes.
 */
function demandPull(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  let pull = 1;

  // Price against what the market thinks the piece is worth. Cheap moves, steep
  // sits — and the punishment for steep is harsher here than in most lenses,
  // because an overpriced hoodie has a visible price tag next to a rival's.
  switch (elasticityBand(priceRatio(item, state, spec))) {
    case "underpriced":
      pull *= 1.18;
      break;
    case "sweet":
      break;
    case "rich":
      pull *= 0.84;
      break;
    case "greedy":
      pull *= 0.58;
      break;
  }

  // Brand is the demand curve in this industry. It is not a garnish on units the
  // way it is in food; it is the reason a queue exists at all.
  pull *= 0.72 + 0.56 * (state.stats.brand / 100);

  // What the piece is. `limited` pulls a queue forward, `core` moves steadily
  // because it is the thing people replace, outerwear carries the highest ticket
  // in the range and the fewest impulse buys, a collab arrives with an audience.
  if (item.tags.includes("limited")) pull *= 1.12;
  if (item.tags.includes("core")) pull *= 1.06;
  if (item.tags.includes("outerwear")) pull *= 0.9;
  if (item.tags.includes("collab")) pull *= 1.1;

  // Better fabric only shows up in demand once the brand has earned the benefit
  // of the doubt. Below that, you paid for a hand-feel nobody credits you for.
  if (state.flags.fabric_upgraded && state.stats.brand >= 55) pull *= 1.06;

  // The trained cohort. Every markdown moves a slice of your best customers out
  // of the launch-day queue and into the waiting game.
  if (state.flags.discounter) pull *= 0.9;
  if (state.flags.trained_to_wait) pull *= 0.86;
  // Restocking a sellout tells the queue there will always be more of it.
  if (state.flags.restocked) pull *= 0.94;

  // A drop is a bet on one week. Weeks vary more than menus do.
  pull *= 0.86 + rng() * 0.28;
  return pull;
}

function sellThroughLeak(
  item: LineItem,
  state: RunState,
  rng: Rng,
  spec: IndustrySpec,
): number {
  const capacity = RUN_CAPACITY[runSizeOf(item)];
  const pull = demandPull(item, state, rng, spec);
  const sellThrough = Math.min(1, pull / capacity);

  // Recorded, not predicted. Demand is seeded per year and cannot be recovered
  // afterwards, so the one figure this industry actually reports has to be
  // written down as the books close — the same moment the player is told it.
  item.meta.sellThroughPct = Math.round(sellThrough * 100);
  item.meta.soldOut = sellThrough >= 0.99;

  let leak = SIZE_CURVE_RESIDUE;

  if (pull > capacity) {
    // Sold out. The loss is the demand you had no stock for, less the part of it
    // that comes back next time. Nothing to discount, so the markdown terms
    // below do not apply — a house that sells out is not training anyone to wait.
    return leak + (1 - capacity / pull) * QUEUE_LOST;
  }

  const leftover = 1 - sellThrough;

  // Markdown depth is not a constant. A small overhang goes on sale at your own
  // shop; a large one leaves the building at whatever a liquidator offers. A
  // better-made piece holds more of its ticket either way, which is the only
  // place investment tier pays off in this lens — everywhere else it is already
  // priced into perceived value.
  const depth = clamp(0.34 + 0.36 * leftover - 0.04 * item.investTier, 0.2, 0.68);

  // Leftovers are counted against the run; the leak is charged against what
  // actually sold, because that is the revenue line it comes out of.
  leak += depth * (leftover / Math.max(sellThrough, 0.2));

  // The customers you taught. They were buying anyway — now they buy on sale, so
  // this comes off even a drop that mostly clears.
  if (state.flags.discounter) leak += 0.03;
  if (state.flags.trained_to_wait) leak += 0.05;
  // A house that held its price through a bad quarter realizes full ticket.
  if (state.flags.held_the_line) leak -= 0.02;

  return leak;
}

/**
 * Calibration against FOOD, which is the yardstick for the folder.
 *
 * A drop is a bigger, rarer bet than a menu item: a $60 anchor instead of $13,
 * a few hundred pieces a year instead of thousands of covers, and invest tiers
 * roughly half again as expensive because a factory has a minimum order and a
 * kitchen does not. The cheap tier costs the least up front and the most per
 * unit — blanks bought at retail have no order leverage — which is the same
 * shape FOOD uses and the reason it is worth keeping.
 *
 * Gross margin reads a few points under FOOD before anything goes wrong, and
 * the markdown leak is where the rest of it goes: a label that discounts twice
 * closes the year in the forties. That gap is the whole industry.
 */
export const SPEC: IndustrySpec = {
  code: "FASHION",
  noun: "Drop",
  nounPlural: "Drops",
  demandUnit: "units",
  reportLabel: "THE LOOKBOOK",
  priceMin: 15,
  priceMax: 500,
  priceStep: 5,
  baselinePrice: 60,
  baseUnits: 900,
  baselineGmPt: 58,
  tags: FASHION_TAGS,
  namePlaceholder: "Concrete Bloom Hoodie",
  leakLabel: "Markdowns and stockouts",
  leakMax: 0.34,
  investTiers: [
    { label: "Blanks and a screen print", costS: 0.75, costMult: 1.22, valueMult: 0.78 },
    { label: "Cut and sew, properly", costS: 2, costMult: 1.0, valueMult: 1.0 },
    { label: "Milled fabric, real factory", costS: 4, costMult: 0.86, valueMult: 1.28 },
  ],
  launchChoice: {
    metaKey: "runSize",
    label: "How many exist?",
    options: [
      { value: "tight", label: "Tight run" },
      { value: "planned", label: "A planned run" },
      { value: "deep", label: "Go deep" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => sellThroughLeak(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * `activities.ts` keeps its `spend` helper module-private and that file is not
 * ours to edit, so the same four steps live here: seed a per-activity rng, apply
 * the outcome, refresh the Books, log the line with its deltas. If the two ever
 * drift, this copy is the one that is wrong.
 */

/**
 * Both gates read `meta` written when the books closed, which is the same moment
 * the report hands the player their sell-through. An activity that appeared
 * before that number was public would be an answer key with a button on it;
 * these appear alongside it. Read defensively — a save may have no portfolio at
 * all, and a drop may predate these keys.
 */
const earning = (s: RunState): LineItem[] =>
  (s.portfolio?.items ?? []).filter((i) => i.state === "live" || i.state === "declining");

const hasSellout = (s: RunState): boolean =>
  earning(s).some((i) => (i.meta ? i.meta.soldOut : false) === true);

const hasOverhang = (s: RunState): boolean =>
  earning(s).some((i) => {
    const st = i.meta ? i.meta.sellThroughPct : undefined;
    return typeof st === "number" && st < 90;
  });

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The three-tap launch flow from Addendum A §6, plus the quantity control
     * this lens adds. `apply` is deliberately inert: the drop's name is
     * player-authored and its run size is a choice, so the product screen owns
     * both and this entry is only the door. A stray dispatch must not be able to
     * conjure a drop nobody named.
     */
    id: "plan-drop",
    tab: "product",
    label: "Plan a drop",
    signal: "Name it, price it, decide how many exist.",
    detail:
      "A name, a ticket price, a build, and the count. The count is the part you cannot change once the fabric is cut.",
    apply: () => {},
  },
  {
    /**
     * The tempting wrong move, and it has to stay tempting: proven demand, no
     * acquisition cost, cash this quarter. What it spends is the reason the first
     * run cleared, and `restocked` keeps spending it on every drop after.
     */
    id: "restock",
    tab: "product",
    label: "Restock a sellout",
    signal: "Money on the table. Hype off the table.",
    detail: "The demand is proven and the pattern is paid for. That is the whole argument.",
    costS: 1,
    available: hasSellout,
    apply: (s) =>
      spend(
        s,
        "restock",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "rev_pct", amount: 14, durationQ: 4 },
            { stat: "brand", amount: -6 },
          ],
          setFlags: ["restocked"],
        },
        "You cut the run again. It sells, and the queue learns that waiting works.",
      ),
  },
  {
    /**
     * The signature failure, on a ladder. The first markdown is a bad quarter.
     * The second one is a business model: it sets `trained_to_wait`, which comes
     * off demand at ticket on every drop from here, and only `hold-price` walks
     * it back.
     */
    id: "mark-down",
    tab: "product",
    label: "Mark down leftovers",
    signal: "Cash back. Your next drop is watching.",
    detail: "Dead stock becomes working capital at a price you do not get to set.",
    available: hasOverhang,
    apply: (s) => {
      const again = Boolean(s.flags.discounter);
      spend(
        s,
        "mark-down",
        {
          effects: [
            { stat: "cash_S", amount: 2 },
            { stat: "brand", amount: again ? -9 : -6 },
            { stat: "gm_pt", amount: again ? -4 : -3 },
            { stat: "csat", amount: 2 },
          ],
          setFlags: again ? ["discounter", "trained_to_wait"] : ["discounter"],
          clearFlags: ["held_the_line"],
        },
        again
          ? "You run the sale again. The people who paid full price the first time did the maths."
          : "The rack clears and the money lands. Somebody screenshots the price.",
      );
    },
  },
  {
    /**
     * Reach you cannot buy, on terms you do not set. The margin split is the
     * honest cost — two names on a label means two sets of economics — and the
     * brand upside is real but rented.
     */
    id: "collab",
    tab: "product",
    label: "Do a collab",
    signal: "Their audience. Split margin. Whose brand is it?",
    detail: "Two names on the label, one production budget, and a conversation about whose customer this is.",
    costS: 2,
    apply: (s) =>
      spend(
        s,
        "collab",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "brand", amount: 8 },
            { stat: "rev_pct", amount: 16, durationQ: 4 },
            { stat: "gm_pt", amount: -5 },
            { stat: "risk", amount: 1 },
          ],
        },
        "Two logos, one garment. Their people show up, and some of them stay for you.",
      ),
  },
  {
    /**
     * Costs per unit rather than in a cheque, which is why there is no `costS`:
     * the money leaves through gross margin every time you cut. It only comes
     * back if the brand is far enough along that people believe the difference,
     * which is what `fabric_upgraded` is checked against in the leak.
     */
    id: "fabric",
    tab: "product",
    label: "Upgrade the fabric",
    signal: "Costs more. Feels it. Some people can tell.",
    detail: "A heavier weight and a better mill. The cost is per piece, forever, not a one-off.",
    apply: (s) =>
      spend(
        s,
        "fabric",
        {
          effects: [
            { stat: "gm_pt", amount: -4 },
            { stat: "qual", amount: 5 },
            { stat: "csat", amount: 2 },
            { stat: "suploy", amount: 1 },
          ],
          setFlags: ["fabric_upgraded"],
        },
        "You move to a better mill. The piece is heavier in the hand and thinner on the margin.",
      ),
  },
  {
    /**
     * Marketing spend with no attribution and no revenue line — the purest
     * version of the thing every founder argues about. It buys the images the
     * next drop is sold with, and you will never be able to prove it worked.
     */
    id: "lookbook",
    tab: "market",
    label: "Run a lookbook shoot",
    signal: "Nothing to sell yet. Everything to signal.",
    detail: "A location, a crew, a day. No product moves. The pictures are how the next drop is read.",
    costS: 1.5,
    apply: (s) =>
      spend(
        s,
        "lookbook",
        {
          effects: [
            { stat: "cash_S", amount: -1.5 },
            { stat: "brand", amount: 7 },
            { stat: "ctr_pt", amount: 3 },
            { stat: "energy", amount: -6 },
          ],
        },
        "You spend a day making pictures instead of product. Nothing sells. Everything reads differently.",
      ),
  },
  {
    /**
     * A short lease, a real till, and the only place in this lens where you watch
     * somebody pick the garment up and put it back down. Expensive per week and
     * over when the window closes — no permanent burn, because a pop-up that
     * turns into a lease is a different decision.
     */
    id: "popup",
    tab: "market",
    label: "Open a pop-up",
    signal: "Real people, real reactions, real rent.",
    detail: "Six weeks of somebody else's storefront. You find out what people say when they think you cannot hear.",
    costS: 4,
    minStage: 2,
    apply: (s) =>
      spend(
        s,
        "popup",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "csat", amount: 6 },
            { stat: "brand", amount: 5 },
            { stat: "rev_pct", amount: 8, durationQ: 2 },
            { stat: "energy", amount: -9 },
            { stat: "respect", amount: 1 },
          ],
        },
        "You open a door for six weeks and stand behind the till. People tell you things a dashboard cannot.",
      ),
  },
  {
    /**
     * The repair, and it is meant to look like nothing. You refuse the sale, take
     * the cash hit for a quarter, and clear one rung of the markdown ladder:
     * `trained_to_wait` first, then `discounter`. Two markdowns take two years of
     * discipline to undo, which is the correct exchange rate and the reason
     * discounting is the expensive option.
     */
    id: "hold-price",
    tab: "product",
    label: "Hold the price",
    signal: "Nothing happens. That's the point.",
    detail: "The stock sits, the sale does not come, and the price on the tag is the price.",
    yearly: true,
    apply: (s) => {
      const deep = Boolean(s.flags.trained_to_wait);
      spend(
        s,
        "hold-price",
        {
          effects: [
            { stat: "brand", amount: 3 },
            { stat: "gm_pt", amount: 2 },
            { stat: "rev_pct", amount: -6, durationQ: 2 },
          ],
          setFlags: ["held_the_line"],
          clearFlags: deep ? ["trained_to_wait"] : ["discounter"],
        },
        deep
          ? "No sale this season. The people waiting for one wait through it, and some of them stop waiting."
          : "You leave the tags alone. The quarter is worse and the tag still means something.",
      );
    },
  },
];

export default SPEC;
