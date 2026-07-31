import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import { priceRatio, elasticityBand, ensurePortfolio, liveItems } from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 10 · SUSTAINABILITY — the lens where the sentence on the box is the product.
 *
 * Modelled on `food.ts`, which is the reference implementation. Everything
 * shared lives in `portfolio.ts`; only the signature mechanic below is bespoke.
 *
 * ── Signature mechanic · THE GREEN PREMIUM & VERIFICATION COST ───────────────
 *
 * FOOD loses money because demand is unpredictable and you prepped the wrong
 * amount. Nothing here is about forecasting. SUSTAIN loses money on the gap
 * between what you assert and what you can prove, and that is a structurally
 * different hole: it does not reset each year, it widens.
 *
 * A claim is what lets you charge $180 for a tote. Substantiating it costs real
 * cash, takes three or four quarters, and during that window the claim has to
 * come off the box while the price stays on it. Skip the substantiation and you
 * keep the premium, but the premium is now a liability being carried at full
 * value: retailer deductions, chargebacks, substantiation reserves, the quiet
 * markdowns you take when a buyer's compliance desk asks for a file you do not
 * have. That charge grows every year the claim stays unbacked and grows again
 * with brand, because the claim only costs you where it is heard.
 *
 * So three states, three different bills, and the player picks:
 *   verified   — a small permanent toll. Re-audits and a chain-of-custody clerk.
 *   in-window  — the worst quarter of the three. Paid, waiting, cannot say it.
 *   unverified — cheapest now, compounds forever, and it is the one the
 *                journalist event reads to decide whether to run the story.
 *
 * Teaches: claim substantiation, and reputational risk as a financial liability
 * that sits on the balance sheet whether or not you have written it down.
 *
 * `sustain-certify` moves a line from unverified to in-window and pays the cash.
 * `sustain-recycled-inputs` and `sustain-supply-audit` narrow the gap without
 * buying a certificate. `sustain-offsets` widens it and is deliberately cheap.
 * `sustain-drop-claim` closes the hole by giving up the premium, which is the
 * correct move and reads as a loss on the way through.
 */

const SUSTAIN_TAGS = ["recycled", "refillable", "carbon", "local", "certified", "offset"];

/**
 * How much proof each claim owes. Local you can substantiate by driving there;
 * carbon needs a consultant, an agreed boundary and somebody else's numbers,
 * and offset is a claim you bought from a third party rather than a change you
 * made. This is the real asymmetry in the industry and it is not about volume.
 */
const SUBSTANTIATION_LOAD: Record<string, number> = {
  local: 0.4,
  refillable: 0.5,
  recycled: 0.8,
  certified: 1.0,
  offset: 1.3,
  carbon: 1.4,
};

/**
 * How strongly the line is worded, chosen at launch and stored in
 * `meta.claim`. "Made with recycled content" and "climate positive" are not the
 * same promise and do not carry the same bill. Absent on lines launched before
 * the key existed, which read as the middle case.
 */
const CLAIM_PITCH: Record<string, number> = { modest: 0.6, strong: 1, absolute: 1.5 };

/** `meta` is a loose bag by design and older items will not have these keys. */
function metaNum(item: LineItem, key: string): number | null {
  const v = item.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function claimLoad(item: LineItem): number {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const raw = tags.reduce((sum, t) => sum + (SUBSTANTIATION_LOAD[t] ?? 0), 0);
  const pitch = CLAIM_PITCH[String(item.meta?.claim ?? "strong")] ?? 1;
  return raw * pitch;
}

const isVerified = (item: LineItem, year: number): boolean => {
  const cleared = metaNum(item, "verifiedYear");
  return cleared !== null && year >= cleared;
};

/** Filed and still with the certifier: paid for, not yet allowed to be said. */
const auditOpen = (item: LineItem, year: number): boolean =>
  !isVerified(item, year) && metaNum(item, "auditFiledYear") !== null;

function verificationCost(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // Paperwork exists whether or not you claim anything — bills of materials,
  // country of origin, the packaging levy somebody has to file. The floor under
  // every line in this business.
  let leak = 0.02;

  const load = claimLoad(item);
  // A line that claims nothing owes nothing. There is no premium to defend and
  // no reduction to earn, so it sits on the floor and stays there.
  if (load <= 0) return leak + (rng() - 0.5) * 0.006;

  const year = state.year;
  const ratio = priceRatio(item, state, spec);
  const verified = isVerified(item, year);

  if (verified) {
    // Doing it properly does not become free once the certificate arrives. The
    // annual re-audit, the sample testing, the clerk who keeps chain of custody
    // and the label redesign every time a standard moves are a permanent charge
    // off the top. This is the honest cost of a sentence you can defend, and it
    // is small enough that the year-end report usually does not bother to
    // mention it — which is the reward.
    leak += 0.025 * load;
  } else if (auditOpen(item, year)) {
    // The file is open, so the wording comes off the box until it closes. The
    // price does not come off with it, so for three or four quarters you are
    // selling a premium product with nothing to justify the premium, on top of
    // the certifier's own fees and the legal read of every label. This is the
    // bill the player is actually deciding whether to pay.
    leak += 0.04 + 0.03 * load;
  } else {
    // Unverified and not even filed. The premium is the exposure, so the charge
    // scales with how much of the price is resting on the claim rather than on
    // the object.
    const premium = Math.max(0, ratio - 1);
    // And it grows every year the claim stays unbacked, because the number of
    // people repeating it grows too: more retailers holding the file open, more
    // deductions, a bigger reserve your accountant insists on. Standing still is
    // not neutral here, which is the part players get wrong.
    const yearsUnbacked = Math.max(0, year - item.launchedYear);
    leak += 0.03 * load * (0.6 + premium * 1.2) * (1 + 0.22 * yearsUnbacked);

    // An unbacked claim only costs you where it is heard. Brand is the
    // multiplier on your own exposure — the one place in this engine where
    // being well known makes a hole deeper instead of shallower.
    leak += 0.025 * load * (state.stats.brand / 100);

    // Offsets are a certificate someone emailed you, not a change you made.
    // Cheapest thing on the activity sheet and the easiest thing in the file for
    // a journalist or a buyer to take apart.
    if (state.flags.bought_offsets) leak += 0.03;

    // A compliance desk reads the price before it reads the label. Price this
    // far above what the thing reads as worth and the substantiation file gets
    // requested, then deducted against when it does not arrive.
    if (elasticityBand(ratio) === "greedy") leak += 0.03;
  }

  // Work rather than wording. None of these are claims, they are changes to the
  // product, so they narrow the gap in every state — including after the
  // certificate arrives, because a re-audit of a genuinely clean supply chain is
  // a cheaper week for everyone.
  if (state.flags.recycled_inputs) leak -= 0.03;
  if (state.flags.supply_audit) leak -= 0.025;
  if (state.flags.b_corp) leak -= 0.015;

  // The investment tier is the difference between a claim about the product and
  // a claim about the marketing. A well-made line is a cheap line to defend.
  leak -= 0.012 * item.investTier;

  // The certifier does not discount for good behaviour. A verified line cannot
  // reduce its way below the standing fee no matter how clean the chain is, and
  // that floor is the thing the player is meant to internalise: substantiation
  // is not a project you finish, it is a line on the P&L that never comes off.
  if (verified) leak = Math.max(0.02 + 0.012 * load, leak);

  // Auditor scheduling, deduction cycles, when the letter lands.
  leak += (rng() - 0.5) * 0.02;
  return leak;
}

export const SPEC: IndustrySpec = {
  code: "SUSTAIN",
  noun: "Product line",
  nounPlural: "Product lines",
  demandUnit: "units",
  reportLabel: "THE LINE",
  // $10–$400 per the appendix. Wide, because a refill pouch and a jacket are the
  // same noun here. $5 steps: fine enough to price a pouch, coarse enough that
  // the stepper does not need a hundred taps to reach the top of the band.
  priceMin: 10,
  priceMax: 400,
  priceStep: 5,
  // Geometric centre of the band, the same place FOOD's 13 sits in $3–$40. The
  // anchor has to be a median line, not the midpoint of a lopsided range.
  baselinePrice: 60,
  // Fewer, dearer units than FOOD's 2600 covers. A product line at stage 1 is a
  // pallet and a spreadsheet, not a dining room.
  baseUnits: 900,
  // Clearly below FOOD's 62. Inputs here are chosen for what they are made of
  // rather than what they cost, and that shows up in gross margin before it
  // shows up anywhere else. The premium is what you are trying to earn back.
  baselineGmPt: 54,
  tags: SUSTAIN_TAGS,
  namePlaceholder: "Second Life Tote",
  leakLabel: "Verification cost",
  // Above FOOD's 0.28 on purpose. No kitchen wastes a third of its food, and a
  // claim you cannot back can take a third of the line's gross. That asymmetry
  // is the whole argument of the industry.
  leakMax: 0.34,
  investTiers: [
    // Dearer than FOOD's 0.5/1.5/3 at every step. You can improvise a recipe;
    // you cannot improvise a supplier who will let you audit them.
    { label: "Claim it and move", costS: 0.8, costMult: 1.22, valueMult: 0.76 },
    { label: "Do it properly", costS: 2, costMult: 1.0, valueMult: 1.0 },
    { label: "Build it right through", costS: 4, costMult: 0.9, valueMult: 1.3 },
  ],
  launchChoice: {
    metaKey: "claim",
    label: "What will you claim?",
    options: [
      { value: "modest", label: "Say the modest version" },
      { value: "strong", label: "Say the strong version" },
      { value: "absolute", label: "Say it absolutely" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => verificationCost(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * None of these advance time. They spend cash, energy and attention, same as
 * the shared library in `activities.ts`.
 */

/**
 * An activity's `apply` takes the run and nothing else, so a per-line action has
 * to choose its own target. It picks the line carrying the most unbacked claim —
 * the loudest wording on the least proof — which is the line a journalist would
 * pick too, and the line the player would pick if asked. Lines already filed are
 * skipped: they are mid-window, and filing twice buys nothing.
 */
function loudestUnverified(state: RunState): LineItem | null {
  const p = ensurePortfolio(state);
  let worst: LineItem | null = null;
  let worstLoad = 0;
  for (const item of liveItems(p)) {
    if (isVerified(item, state.year) || auditOpen(item, state.year)) continue;
    const load = claimLoad(item);
    if (load > worstLoad) {
      worstLoad = load;
      worst = item;
    }
  }
  return worst;
}

export const ACTIVITIES: Activity[] = [
  // ── Product ───────────────────────────────────────────────────────────
  {
    /**
     * The only activity here that resolves no outcome. The name, the price and
     * the strength of the claim are the player's to author, so this opens the
     * three-tap launch sheet and stops. Writing a default claim into the engine
     * would be answering the one question the industry exists to ask.
     */
    id: "sustain-launch-line",
    tab: "product",
    label: "Launch a line",
    signal: "Name it, price it, decide what you'll claim.",
    detail:
      "Three taps: the name, the price, and how strong a sentence you are willing to print on the box.",
    apply: (s) => {
      s.flags.launch_sheet_open = true;
    },
  },
  {
    /**
     * The signature decision. Filing does not buy the claim, it buys the right
     * to make the claim in about four quarters — and the line trades at a
     * premium it cannot justify for every one of them. Paying early is cheaper
     * than paying late and feels worse, which is the lesson.
     */
    id: "sustain-certify",
    tab: "product",
    label: "Get certified",
    signal: "Months of paperwork. Then you can say it.",
    detail:
      "An accredited body reads your invoices, visits two suppliers and disagrees with your wording. The claim comes off the box until they are done.",
    costS: 3,
    available: (s) => loudestUnverified(s) !== null,
    apply: (s) => {
      const target = loudestUnverified(s);
      if (!target) return;
      target.meta.auditFiledYear = s.year;
      target.meta.verifiedYear = s.year + 1;
      spend(
        s,
        "sustain-certify",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "energy", amount: -8 },
            { stat: "qual", amount: 3 },
            { stat: "risk", amount: -2 },
          ],
          setFlags: ["certification_filed"],
        },
        `You file ${target.name} for certification. The wording comes off the box until somebody else agrees with it.`,
      );
    },
  },
  {
    id: "sustain-recycled-inputs",
    tab: "product",
    label: "Switch to recycled inputs",
    signal: "Costs more per unit. Means what you said.",
    detail:
      "Post-consumer stock instead of virgin. Your unit cost goes up and your claim stops being a claim.",
    available: (s) => !s.flags.recycled_inputs,
    apply: (s) =>
      spend(
        s,
        "sustain-recycled-inputs",
        {
          effects: [
            { stat: "gm_pt", amount: -4 },
            { stat: "qual", amount: 4 },
            { stat: "csat", amount: 2 },
            // You have just told a supplier to rebuild their sourcing for you.
            // They will do it. They will not enjoy it.
            { stat: "suploy", amount: -1 },
          ],
          setFlags: ["recycled_inputs"],
        },
        "You move to post-consumer stock. Your supplier reprices everything and your claim becomes a description.",
      ),
  },
  {
    /**
     * Strips the claim wording and nothing else. The units it costs come through
     * the shared elasticity path — those words were carrying perceived value, so
     * the line now reads overpriced at the same price. No bespoke penalty, which
     * is how you can tell the move is honest rather than punished.
     */
    id: "sustain-drop-claim",
    tab: "product",
    label: "Drop a claim you can't back",
    signal: "Quiet. Correct.",
    detail:
      "The wording comes off the box and the price stays where it is. Nobody writes a story about a company that stopped saying something.",
    available: (s) => loudestUnverified(s) !== null,
    apply: (s) => {
      const target = loudestUnverified(s);
      if (!target) return;
      target.meta.claimDropped = true;
      target.meta.droppedClaims = target.tags.join(" and ");
      target.tags = [];
      spend(
        s,
        "sustain-drop-claim",
        {
          effects: [
            { stat: "brand", amount: -4 },
            { stat: "risk", amount: -3 },
            { stat: "respect", amount: 1 },
          ],
          special: ["karma:+1"],
        },
        `You take the wording off ${target.name}. Nothing happens, which is the point.`,
      );
    },
  },

  // ── Company ───────────────────────────────────────────────────────────
  {
    /**
     * Radical honesty prices in. The brand gain is large and durable because
     * publishing your own failures is not something a competitor can copy
     * cheaply — but the failures are now on the record with a date on them, and
     * a documented problem is a different legal object from an undocumented one.
     */
    id: "sustain-supply-audit",
    tab: "company",
    label: "Publish a supply-chain audit",
    signal: "Radical honesty. Including the bad parts.",
    detail:
      "Every tier, every site, named. The good pages and the ones your lawyer wanted cut.",
    costS: 1.5,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "sustain-supply-audit",
        {
          effects: [
            { stat: "cash_S", amount: -1.5 },
            { stat: "brand", amount: 9 },
            { stat: "respect", amount: 1 },
            { stat: "invsent", amount: 1 },
            { stat: "energy", amount: -6 },
            // The problem you published is now dated and attributable.
            { stat: "risk", amount: 2 },
          ],
          setFlags: ["supply_audit"],
          special: ["karma:+1"],
        },
        "You publish the whole chain, including the two sites you would rather nobody visited. Somebody will visit them.",
      ),
  },
  {
    /**
     * Governance with teeth. Investors respect it out loud and mark you down
     * quietly, because you have just written a duty to people who are not them
     * into the articles. Both of those are true at once and the player should
     * see both.
     */
    id: "sustain-b-corp",
    tab: "company",
    label: "Go B-Corp",
    signal: "Slow. Structural. Investors will ask.",
    detail:
      "You rewrite the articles so the company owes something to people who do not own it. It goes on the record and it does not come off.",
    costS: 4,
    minStage: 2,
    available: (s) => !s.flags.b_corp,
    apply: (s) =>
      spend(
        s,
        "sustain-b-corp",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "brand", amount: 10 },
            { stat: "invsent", amount: 2 },
            { stat: "respect", amount: 1 },
            // Annual impact reporting is staff, forever, same as an audit.
            { stat: "burn_S_mo", amount: 0.1 },
            // The market prices a constrained profit motive lower. It is right to.
            { stat: "val_pct", amount: -2 },
          ],
          setFlags: ["b_corp"],
          special: ["karma:+1"],
        },
        "You rewrite the articles. The obligation is structural now, which means it survives you changing your mind.",
      ),
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    /**
     * Deliberately the cheapest thing on the sheet and deliberately the worst
     * value. It buys the sentence without the change, so it lifts brand now and
     * widens the verification hole for every unverified line at once. The
     * temptation has to be real or the lesson is free.
     */
    id: "sustain-offsets",
    tab: "market",
    label: "Buy offsets",
    signal: "The cheap version of the claim.",
    detail:
      "A certificate saying someone else planted something somewhere. It arrives by email and it is on the packaging by Friday.",
    costS: 0.5,
    apply: (s) =>
      spend(
        s,
        "sustain-offsets",
        {
          effects: [
            { stat: "cash_S", amount: -0.5 },
            { stat: "brand", amount: 5 },
            { stat: "ctr_pt", amount: 2 },
            { stat: "risk", amount: 1 },
          ],
          setFlags: ["bought_offsets"],
        },
        "You buy the certificate. The claim is on the packaging by Friday and the change is still on the to-do list.",
      ),
  },

  // ── Assets ────────────────────────────────────────────────────────────
  {
    /**
     * A worse business every month except for the part where nobody leaves.
     * Returns, cleaning, refilling and shipping empties back are permanent fixed
     * cost against a churn number that stops moving. The clearest fixed-cost-for-
     * retention trade in the lens, and the maths only works if you last.
     */
    id: "sustain-refill-system",
    tab: "assets",
    label: "Build a refill system",
    signal: "Harder logistics. Customers who never leave.",
    detail:
      "Empties come back, get cleaned, go out again. Every step is a cost centre and none of them are the product.",
    costS: 3,
    apply: (s) =>
      spend(
        s,
        "sustain-refill-system",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "burn_S_mo", amount: 0.25 },
            { stat: "churn_pt", amount: -5 },
            { stat: "csat", amount: 5 },
            { stat: "brand", amount: 3 },
            { stat: "gm_pt", amount: -2 },
          ],
          setFlags: ["refill_system"],
        },
        "You build the loop. It costs you every month and the people on it never shop anywhere else.",
      ),
  },
];

export default SPEC;
