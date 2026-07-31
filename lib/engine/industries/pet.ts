import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import { priceRatio, elasticityBand, ensurePortfolio, liveItems, recallItem } from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 12 · PET — the recurring-revenue lens.
 *
 * Built on food.ts, which is the reference. Same contract, same comment density,
 * one genuinely different way to lose money.
 *
 * ── Signature mechanic · CONSUMABLE SUBSCRIPTION & THE TRUST GATE ────────────
 *
 * PET splits down the middle. Durables — toys, harnesses, crates — sell once to
 * a buyer who was never coming back this year. Consumables — food, treats,
 * supplements — sell forever to a buyer who is feeding an animal twice a day.
 * Consumables are the better business by a wide margin, and the engine lets the
 * player find that out rather than saying it.
 *
 * The catch is that consumables are ingested, and nobody puts an unknown thing
 * in their dog. Every consumable passes through a hidden TRUST GATE: vet
 * credibility, third-party testing, formula work, and the service record you
 * have actually accumulated. The gate does not touch the first order at all.
 * First orders are easy — the bag looks good and the animal is hungry. The gate
 * governs the SECOND order, and the second order is where all the money is.
 *
 * So the loss here is not product going bad. It is a customer relationship that
 * was booked and never collected: `leakLabel` is "Lapsed renewals", and what it
 * eats is the back half of a lifetime you already paid acquisition cost for.
 *
 * The trap is the inversion. Autoship is the best trade in the industry when
 * the gate is open — you discount the first order and recover it by the fourth.
 * It is the worst trade in the industry when the gate is shut, because you gave
 * away the only margin you were ever going to collect. Same button, opposite
 * sign, and the thing that flips it is invisible until the year closes.
 *
 * Teaches: recurring versus transactional revenue, LTV/CAC, and trust as a
 * precondition for retention rather than a marketing garnish.
 *
 * ── Signature failure · THE RECALL ──────────────────────────────────────────
 *
 * Handled by the event library, not here, but this file is where it lands. A
 * forced recall sets `trust_broken`, which the gate reads for the rest of the
 * run and never forgives — consequences are permanent in this industry in a way
 * they are not elsewhere, because it was someone's animal. The `pet-recall-self`
 * activity is the voluntary version: expensive, awful, and much cheaper than
 * being made to do it.
 */

const PET_TAGS = ["food", "treat", "toy", "health", "gear", "subscription"];

/**
 * Ingested, therefore repeat-purchase, therefore gated. Supplements count:
 * "health" is a pill or a powder, and the trust question is identical. Toys and
 * gear are durables and sit outside the whole mechanic.
 */
const CONSUMABLE_TAGS = ["food", "treat", "health"];

const isConsumable = (item: LineItem): boolean =>
  item.tags.some((t) => CONSUMABLE_TAGS.includes(t));

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

type RevenueModel = "subscription" | "one_time";

/**
 * `item.meta.model` is set by the launch flow. Read defensively — items launched
 * before this lens existed have no such key, and the run must not care.
 *
 * The `autoship` flag is deliberately retroactive: switching autoship on is a
 * company-wide decision about how the consumable shelf is sold, so it converts
 * the existing consumable book too. That is what turning it on means, and it is
 * why the activity is worded as a commitment rather than an experiment.
 */
function revenueModel(item: LineItem, state: RunState): RevenueModel {
  const declared = item.meta?.model;
  if (declared === "subscription" || declared === "one_time") return declared;
  if (item.tags.includes("subscription")) return "subscription";
  if (state.flags.autoship && isConsumable(item)) return "subscription";
  return "one_time";
}

/**
 * 0..1 — how much of the credibility a repeat buyer needs you can actually
 * show them. Not a quality score: quality you cannot evidence buys nothing here.
 * A cheap white-label bag with a good story still fails the gate.
 */
function trustGate(item: LineItem, state: RunState): number {
  // What the packaging itself earns you. Cheap tiers earn almost nothing,
  // because the label is where an owner looks first and a co-packer's label
  // reads like a co-packer's label.
  let t = 0.06 + 0.17 * item.investTier;

  // The one thing that actually moves this, per the industry: a clinician's
  // name on the formula. Everything else is a supporting document.
  if (state.flags.vet_endorsed) t += 0.34;
  if (state.flags.safety_tested) t += 0.1;
  if (state.flags.formula_improved) t += 0.08;
  // Shelters vouching for you is credibility you did not buy directly.
  if (state.flags.shelter_partner) t += 0.05;

  // Service history is evidence. An owner who has had one good year with you
  // extends more benefit of the doubt than any claim on the bag does.
  t += 0.14 * (state.stats.csat / 100);
  t += 0.1 * (state.stats.qual / 100);

  // A recall never fully unwinds. Everything launched after it starts from
  // suspicion, which is the permanence the industry deserves.
  if (state.flags.trust_broken) t *= 0.45;

  return clamp01(t);
}

function lapsedRenewal(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  const consumable = isConsumable(item);
  const model = revenueModel(item, state);
  const gate = trustGate(item, state);

  // Durables barely leak. A chew toy either sells or sits on the shelf, and the
  // only loss is warranty and returns. This is why durables feel safe and why
  // the safe half of this industry is also the poor half.
  let leak = consumable ? 0.06 : 0.03;

  if (consumable) {
    // THE GATE. Credibility you have not earned turns into a first order that
    // never repeats. Nothing else in this file is this large, on purpose.
    leak += 0.22 * (1 - gate);
  }

  if (model === "subscription") {
    if (consumable) {
      // Autoship gives up first-order price to buy a lifetime. With the gate
      // open that is recovered inside the first year and the book compounds
      // from there, so recurring beats transactional outright. Note where the
      // crossover sits: a mostly-open gate is not enough. Autoship only pays
      // once trust is genuinely earned, which is the whole lesson in one term.
      leak -= 0.1 * gate;
      // With the gate shut, the same discount is pure donation: you handed away
      // the margin on the only order these subscribers were ever going to place.
      leak += 0.14 * (1 - gate);
    } else {
      // Nobody needs a second harness. A billing relationship with no
      // consumption cycle behind it gets cancelled at the second charge, and
      // putting a durable on autoship is a mistake the engine will not warn about.
      leak += 0.13;
    }

    // Non-renewal is not spread evenly across the year. It happens at the
    // second charge, when the novelty is gone and the line on the statement is
    // just a cost. Price a recurring charge above what it reads as worth and
    // that is the month they cancel — which is why the same price ratio hurts
    // a subscription more than it hurts a one-time sale.
    const band = elasticityBand(priceRatio(item, state, spec));
    if (band === "greedy") leak += 0.07;
    else if (band === "rich") leak += 0.03;

    // Company churn feeds straight into a subscription book. In a transactional
    // business churn costs you a future you never counted; here it is revenue
    // that was already on the plan.
    leak += Math.min(0.05, (state.stats.churnPt / 100) * 0.35);

    // Subscribers you paid a premium to acquire and then failed to keep are
    // written off at that premium. Cheap acquisition survives a leaky book.
    // Expensive acquisition is how a subscription business dies with growing
    // revenue and no money — the LTV/CAC lesson, charged rather than explained.
    leak += 0.04 * (1 - state.stats.cacPt / 100);
  }

  // Cohort behaviour, so less week-to-week noise than a kitchen has. Renewal
  // rates move slowly, which is exactly what makes them easy to ignore.
  leak += (rng() - 0.5) * 0.02;
  return leak;
}

export const SPEC: IndustrySpec = {
  code: "PET",
  noun: "Product",
  nounPlural: "Products",
  demandUnit: "subscribers",
  reportLabel: "THE SHELF",
  // $5 flea collar to a $200 orthopaedic bed, in steps a shelf price actually
  // moves in. Wide band on purpose: the durable/consumable split is also a
  // price split, and the stepper should make that obvious before you commit.
  priceMin: 5,
  priceMax: 200,
  priceStep: 2.5,
  baselinePrice: 40,
  baseUnits: 1200,
  // Runs a little richer than FOOD: premium pet has real pricing power and no
  // kitchen. It is nowhere near a software margin, because you are still
  // shipping sacks of protein.
  baselineGmPt: 64,
  tags: PET_TAGS,
  namePlaceholder: "Salmon Sunday",
  leakLabel: "Lapsed renewals",
  // Higher ceiling than FOOD's spoilage. Non-renewal can take a third of the
  // book, and when it does it is the loudest number in the year-end report.
  leakMax: 0.36,
  investTiers: [
    { label: "White-label it", costS: 0.5, costMult: 1.18, valueMult: 0.82 },
    { label: "Own formula, own tests", costS: 1.5, costMult: 1.0, valueMult: 1.0 },
    { label: "Vet-formulated, batch-traced", costS: 3, costMult: 0.88, valueMult: 1.22 },
  ],
  launchChoice: {
    metaKey: "model",
    label: "How do they buy it?",
    options: [
      { value: "onetime", label: "One purchase at a time" },
      { value: "subscription", label: "On a subscription" },
    ],
    defaultIndex: 0,
  },
  signatureLeak: (item, state, rng, spec) => lapsedRenewal(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Local mirror of `spend()` in activities.ts — same seeding, same ordering, same
 * log line — because that helper is module-private there and this file must not
 * edit it. If it is ever exported, delete this and import it.
 *
 * The header rule in activities.ts binds here absolutely: none of these advance
 * time. They spend cash, energy and attention.
 */

const liveConsumables = (state: RunState): LineItem[] =>
  liveItems(ensurePortfolio(state)).filter(isConsumable);

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The three-tap flow (§6) owns this: it collects a name, a price, an invest
     * tier and the revenue model, then calls `launchItem()` with
     * `meta.model`. There is nothing to charge until the player confirms, and a
     * headless caller arrives here with no input, so `apply` logs and stops
     * rather than shipping an unnamed product on the player's behalf.
     */
    id: "pet-launch",
    tab: "product",
    label: "Launch a product",
    signal: "Name it, price it, one-time or subscription.",
    detail:
      "A name, a price, and how they pay for it. The last of those three matters more than it looks.",
    apply: (s) => {
      s.log.push(makeLine(s, "decision", "You clear a space on the shelf and start with a blank label."));
    },
  },
  {
    /**
     * The gate opener, and the only activity in the lens that moves it far. Slow
     * and dear relative to what it visibly buys — a clinical panel reads your
     * formula for a season before anyone's name goes near it — which is why most
     * players skip it and find out what it was for in the year-end report.
     */
    id: "pet-vet-endorse",
    tab: "product",
    label: "Get vet-endorsed",
    signal: "Slow, expensive, and the only thing that works.",
    detail:
      "A clinical panel reads your formula, argues with it, and eventually puts a name behind it.",
    costS: 3,
    available: (s) => !s.flags.vet_endorsed,
    apply: (s) =>
      spend(
        s,
        "pet-vet-endorse",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "energy", amount: -8 },
            { stat: "qual", amount: 3 },
            { stat: "csat", amount: 4 },
            { stat: "brand", amount: 6 },
            { stat: "risk", amount: -1 },
          ],
          setFlags: ["vet_endorsed"],
        },
        "A veterinary panel spends a season with your formula and then lets you say so out loud.",
      ),
  },
  {
    /**
     * The inversion, as one button. It costs revenue per order immediately and
     * pays back over a lifetime you may or may not have earned the right to.
     * Deliberately cheap to press, because the price of this decision is not the
     * cash — it is that it converts the whole consumable shelf.
     */
    id: "pet-autoship",
    tab: "product",
    label: "Start a subscription",
    signal: "Smaller checks. Every month. Forever.",
    detail:
      "Autoship on the consumable shelf. Less per order, more orders, and a renewal date you now depend on.",
    costS: 1,
    available: (s) => !s.flags.autoship && liveConsumables(s).length > 0,
    apply: (s) => {
      // Stamp the existing book explicitly rather than leaving it to be inferred
      // from the flag. Items launched after this still read the flag, because the
      // launch sheet may not have asked.
      for (const item of liveConsumables(s)) item.meta.model = "subscription";
      spend(
        s,
        "pet-autoship",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "rev_pct", amount: -8, durationQ: 4 },
            { stat: "churn_pt", amount: -3 },
            { stat: "csat", amount: 2 },
          ],
          setFlags: ["autoship"],
        },
        "You put the shelf on autoship. Every order is smaller and the calendar now sends them.",
      );
    },
  },
  {
    /**
     * No cash line. You pay for this in unit cost, forever, which is the harder
     * kind of spending to notice and the reason gm_pt carries it instead.
     */
    id: "pet-formula",
    tab: "product",
    label: "Improve the formula",
    signal: "Costs more. The dog can tell.",
    detail: "Better protein, fewer fillers, a longer ingredient argument. It shows up in unit cost.",
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "pet-formula",
        {
          effects: [
            { stat: "gm_pt", amount: -3 },
            { stat: "qual", amount: 5 },
            { stat: "csat", amount: 3 },
            { stat: "energy", amount: -4 },
            { stat: "risk", amount: -1 },
          ],
          setFlags: ["formula_improved"],
        },
        "You reformulate upward. It costs more every single bag, and the animals eat it faster.",
      ),
  },
  {
    /**
     * Bought almost exclusively by players who have already survived a recall,
     * which is itself the lesson: insurance is priced by people who know what
     * the bad day costs and sold to people who do not.
     */
    id: "pet-safety-test",
    tab: "product",
    label: "Third-party safety testing",
    signal: "Boring insurance against the worst day.",
    detail: "An independent lab pulls batches at random and tells you things you would rather not hear.",
    costS: 2,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "pet-safety-test",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "risk", amount: -3 },
            { stat: "qual", amount: 2 },
            { stat: "suploy", amount: 1 },
          ],
          setFlags: ["safety_tested"],
        },
        "An outside lab starts pulling batches without asking. The invoice is dull and the file is not.",
      ),
  },
  {
    /**
     * Mission and marketing as the same line of spend, which is true here and
     * rarely true elsewhere. The margin cost is real — you are giving product
     * away — and it is smaller than what the credibility is worth.
     */
    id: "pet-shelters",
    tab: "market",
    label: "Partner with shelters",
    signal: "Good. Also genuinely good marketing.",
    detail: "Pallets to rescues, your name on the intake paperwork, and people who now vouch for you.",
    costS: 1,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "pet-shelters",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "brand", amount: 6 },
            { stat: "csat", amount: 5 },
            { stat: "gm_pt", amount: -1 },
            { stat: "respect", amount: 1 },
          ],
          setFlags: ["shelter_partner"],
          special: ["karma:1"],
        },
        "You send pallets to rescues. It is the good version of the thing and it also works.",
      ),
  },
  {
    /**
     * A new addressable market that arrives with a discount on everything you
     * learned in the old one. Cats are not small dogs, the channel is different,
     * and your acquisition efficiency resets while you find that out.
     */
    id: "pet-species",
    tab: "product",
    label: "Expand to a new species",
    signal: "New market. Everything you know is slightly wrong.",
    detail:
      "A second animal, a second set of buying habits, and a formulation team that has to start over.",
    costS: 2,
    minStage: 2,
    apply: (s) =>
      spend(
        s,
        "pet-species",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "share_pt", amount: 2 },
            { stat: "cac_pt", amount: -5 },
            { stat: "qual", amount: -2 },
            { stat: "brand", amount: 2 },
            { stat: "energy", amount: -10 },
          ],
          setFlags: ["multi_species"],
        },
        "You open a second species. Half of what you know transfers and nobody tells you which half.",
      ),
  },
  {
    /**
     * The best decision available in this industry, and it feels like a
     * catastrophe, because it is one you chose. Pulling the shelf yourself costs
     * the year; being made to pull it costs the run — `trust_broken` is
     * permanent and this path does not set it.
     *
     * Absent when there is no consumable live, rather than present and inert: a
     * greyed-out recall button advertises a failure mode the player cannot yet
     * reach and cannot be told about.
     */
    id: "pet-recall-self",
    tab: "product",
    label: "Recall it yourself",
    signal: "Before they make you. It still costs everything.",
    detail:
      "You pull the ingested line, eat the freight, and write to every owner before anyone makes you.",
    costS: 3,
    available: (s) => liveConsumables(s).length > 0,
    apply: (s) => {
      // Pull the line first so the burn relief and the recalled states are in
      // place before the books refresh inside spend().
      const pulled = liveConsumables(s);
      const names = pulled.map((i) => i.name);
      for (const item of pulled) recallItem(s, item.id);
      spend(
        s,
        "pet-recall-self",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "brand", amount: -7 },
            { stat: "csat", amount: -4 },
            { stat: "morale", amount: -3 },
            { stat: "risk", amount: -4 },
          ],
          setFlags: ["voluntary_recall"],
          clearFlags: ["autoship"],
        },
        `You pull ${names.join(", ")} off the shelf yourself and tell people why before they ask.`,
      );
    },
  },
];

export default SPEC;
