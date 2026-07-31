import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import { priceRatio, elasticityBand, ensurePortfolio, liveItems, retireItem } from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 11 · TOYS & COLLECTIBLES — the lens where the money is made in December and
 * decided in March.
 *
 * ── Signature mechanic · WAVES, CHASE RATES & THE SECONDARY MARKET ──────────
 *
 * FOOD loses margin to time: you prepped it, nobody ate it, it went in the bin.
 * TOYS loses margin to two decisions taken before any information exists, and
 * neither of them is perishability with a new label.
 *
 * ONE · THE COMMITTED RUN. Seasonality here is the most extreme in the game and
 * the factory needs three quarters, so the size of the run is signed against a
 * December nobody can see yet. The error is two-sided and asymmetric. Commit
 * high and you liquidate a warehouse in January at whatever the closeout buyer
 * feels like paying — cash you already spent, gone. Commit low and you stock out
 * in the only quarter that matters, which costs you the sale but not the cash,
 * and hands the shelf to whoever guessed better. There is no forecast anywhere
 * in this file, and there is not supposed to be.
 *
 * TWO · THE SCARCITY YOU DID NOT PRICE. A chase variant is a unit you
 * deliberately did not make enough of. Collectors move, brand heat rises, and
 * the clearing price — what the resale market actually settles on — is a number
 * you never invoice. Price a scarce wave at what an ordinary wave is worth and
 * the whole spread between your shelf price and the clearing price becomes
 * income you handed to whoever queued at six in the morning. The shared engine
 * already pays you volume for underpricing; this is the invoice for it.
 *
 * Both terms surface in the same place — a fraction of gross you never see — but
 * one is a quantity error under lead time and the other is a pricing error under
 * manufactured scarcity. Neither is spoilage.
 *
 * Teaches: scarcity engineering and who captures it, forecasting under lead
 * time, licensing economics (a royalty comes off the top line, not the bottom),
 * and brand heat as a leading indicator you can read but cannot bank.
 *
 * The levers are the honest ones. `commit_production` moves the run size and
 * nothing tells you whether it helped. A loyal factory (`suploy`) will split an
 * order and take a late reorder, which is the only real hedge against lead time
 * and has to be earned. Tooling investment buys a second run. Nothing removes
 * the guess.
 *
 * `item.meta` carries the two per-wave decisions the shared launch flow knows
 * nothing about — `chase` and `commit` — and the leak writes back `secondary`,
 * the resale index. Every read is defensive: a wave launched before these keys
 * existed reads as a median, single-run, lightly-chased set.
 */

const TOYS_TAGS = ["plush", "figure", "game", "licensed", "original", "chase"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Waves predate these keys. A missing key is a median wave, never a zero. */
function metaNum(item: LineItem, key: string, fallback: number): number {
  const v = item.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * What fraction of the wave is the rare one. Hidden on purpose: a chase rate the
 * player can read off a tooltip is a chase rate the player optimises instead of
 * judging, and judging it is the whole ethical content of this industry.
 */
function chaseRate(item: LineItem, state: RunState): number {
  let chase = metaNum(item, "chase", 0.08);
  // The tag is a declaration of intent. A line sold as a chase line is one.
  if (item.tags.includes("chase")) chase = Math.max(chase, 0.16);
  // Once you are known for engineering scarcity, the whole lineup reads that way
  // whether or not you tooled a rare one for it.
  if (state.flags.chase_heavy) chase += 0.04;
  return clamp(chase, 0, 0.3);
}

/**
 * The run you signed, as a multiple of a median wave. One is the run a sane
 * planner would place; the player moves it with `commit_production` and finds
 * out nine months later.
 */
function committedRun(item: LineItem, state: RunState): number {
  let commit = metaNum(item, "commit", 1);
  // A big-box order is larger than the one you would have placed for yourself.
  // That is the deal — their volume, their quantity, your warehouse if it sits.
  if (state.flags.shelf_deal) commit += 0.15;
  return clamp(commit, 0.5, 2.2);
}

/**
 * Demand as it actually turned up, in the same units as the committed run. This
 * is the number the player was betting against and could not have had. Brand and
 * reach do most of the work, scarcity adds real heat, and the last multiplier is
 * the part nobody controls: Q4 is a coin flipped in March.
 */
function realizedPull(item: LineItem, state: RunState, rng: Rng): number {
  const st = state.stats;
  let pull = 0.72 + 0.42 * (st.brand / 100) + 0.18 * (st.ctrPt / 100);
  // Scarcity is a genuine demand driver, not only a tax. Collectors buy the set
  // because one of them is hard to get.
  pull += 0.5 * chaseRate(item, state);
  // A resale market that is running hot pulls in buyers who were not collecting
  // last year. You do not earn the resale price; you do earn the audience.
  pull += 0.12 * (metaNum(item, "secondary", 1) - 1);
  // A licensed character is recognised on the shelf without being explained.
  if (item.tags.includes("licensed") || state.flags.license_deal) pull += 0.15;
  return pull * (0.86 + rng() * 0.28);
}

function waveMiss(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  const st = state.stats;
  const chase = chaseRate(item, state);
  const commit = committedRun(item, state);
  const pull = realizedPull(item, state, rng);
  const secondaryLastYear = metaNum(item, "secondary", 1);

  // Every wave scraps something: case packs that arrive short, freight damage,
  // singles sorted out of mixed cases. A wave planned as a set packs as a set.
  let leak = state.flags.wave_designed ? 0.015 : 0.025;

  // ── The committed run ─────────────────────────────────────────────────────
  let miss = 0;
  const over = Math.max(0, commit - pull);
  const under = Math.max(0, pull - commit);
  // Overstock is money already spent, sitting in a warehouse, going out at
  // closeout in January. The heavier of the two errors, and the one that feels
  // like ambition when you sign it.
  miss += 0.3 * over;
  // A stockout costs the sale, not the cash — cheaper on the books and worse for
  // the franchise, because the shelf goes to whoever did have stock.
  miss += 0.2 * under;
  // Miss low with a big-box deal and you are not merely absent, you are fined:
  // fill-rate chargebacks are written into the contract you were proud of.
  if (state.flags.shelf_deal && under > 0.1) miss += 0.05;
  // A factory that likes you will split the order and take a late reorder. This
  // is the only real hedge against lead time and it cannot be bought in a
  // quarter — supplier loyalty is earned by how you behaved last time.
  miss *= 1 - 0.06 * clamp(st.suploy, -5, 5);
  // Tooling that supports a second run turns one bet into two smaller ones.
  miss *= 1 - 0.08 * item.investTier;
  leak += Math.max(0, miss);

  // ── The scarcity you did not price ────────────────────────────────────────
  // Making one of them rare costs money: a second tool, a separate case pack,
  // and a sorting step that gets it wrong sometimes. Scarcity is not free to
  // manufacture, which is the part that never appears in the fan theories.
  leak += 0.12 * chase;

  // Heat is what the resale market runs on: your name, plus whatever last year's
  // line is trading at. High heat means the flippers already know your calendar.
  const heat = 0.5 + 0.7 * (st.brand / 100) + 0.25 * (secondaryLastYear - 1);
  const band = elasticityBand(priceRatio(item, state, spec));
  // How much of the spread walks out the door. Underpriced scarcity is a
  // guaranteed arbitrage and gets cleared by people who resell it; something
  // already priced above what people think it is worth has no spread to take.
  const flip =
    band === "underpriced" ? 0.85 : band === "sweet" ? 0.35 : band === "rich" ? 0.14 : 0.04;
  leak += chase * flip * heat;

  // Park the resale index for next year and for the report. The player manages
  // an asset whose appreciation they do not collect, which is the collectibles
  // business stated as plainly as it can be stated.
  const secondary = 1 + 2.4 * chase * heat + (band === "underpriced" ? 0.45 : band === "sweet" ? 0.12 : 0);
  item.meta.secondary = Number(secondary.toFixed(2));

  // ── What comes off the top line ───────────────────────────────────────────
  // A royalty is a share of gross, not a share of profit. That distinction is
  // the entire lesson of licensing and it belongs here rather than in gm_pt.
  if (item.tags.includes("licensed") || state.flags.license_deal) {
    leak += 0.09;
    // Their approvals, their timetable. Sample sign-off arrives late, the date
    // does not move, and the difference gets flown in at four times the rate.
    if (st.risk >= 4) leak += 0.03;
  }
  // Markdown allowance and return-to-vendor. The buyer's volume is real and so
  // is the money they take back out of it after the season.
  if (state.flags.shelf_deal) leak += 0.03;

  // A chase rate that reads as manipulative comes back as returns, complaints,
  // and a buyer who wants the mixed cases taken away. Scarcity is tolerated by
  // customers who already trust you and punished when they do not.
  if (chase > 0.14 && st.csat < 55) leak += 0.04;

  // Certification is bought against the recall event, but it also means nothing
  // sits in a compliance hold at the port while the season runs.
  if (state.flags.safety_certified) leak -= 0.01;
  // Nobody revokes your own character mid-wave, and nobody takes a cut of it.
  if (state.flags.original_ip) leak -= 0.01;

  // Freight, yields and closeout prices all move a little year to year.
  leak += (rng() - 0.5) * 0.02;
  return leak;
}

export const SPEC: IndustrySpec = {
  code: "TOYS",
  noun: "Wave",
  nounPlural: "Waves",
  demandUnit: "units",
  reportLabel: "THE LINEUP",
  priceMin: 5,
  priceMax: 200,
  priceStep: 1,
  // A mass-market figure, not a plush and not a collector statue. Higher than
  // FOOD's plate, and the band above it is wide because the same lens has to
  // hold a blind-box keychain and a licensed centrepiece.
  baselinePrice: 24,
  baseUnits: 1700,
  // Clearly thinner than FOOD's 62. Wholesale pricing, a licensor's share, and
  // a retailer who takes money back after the season all sit between the shelf
  // price and this line.
  baselineGmPt: 44,
  tags: TOYS_TAGS,
  namePlaceholder: "Moss Folk Wave One",
  // Lowercased into "you lost 14% of X to wave miss." One phrase for both
  // errors, because naming a single cause would be a lie about a lens with two.
  leakLabel: "Wave miss",
  // The harshest ceiling in the folder, and earned: the appendix calls a Q4 miss
  // catastrophic, and a lens where the mistake is survivable teaches nothing
  // about committing production three quarters out.
  leakMax: 0.36,
  investTiers: [
    // A wider spread than FOOD. Collectors judge paint apps and seam lines
    // harshly and pay for them properly, so the cheap mold reads cheap on the
    // shelf and the good one carries a real premium.
    { label: "Cheap mold, fast", costS: 0.5, costMult: 1.15, valueMult: 0.74 },
    { label: "Tool it properly", costS: 1.5, costMult: 1.0, valueMult: 1.0 },
    { label: "Collector-grade", costS: 3, costMult: 0.9, valueMult: 1.3 },
  ],
  launchChoice: {
    metaKey: "commit",
    label: "How big is the production run?",
    options: [
      { value: 0.7, label: "Cautious" },
      { value: 1, label: "A normal wave" },
      { value: 1.6, label: "Bet on December" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => waveMiss(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * A local copy of the private `spend` in activities.ts. Duplicated rather than
 * exported, because exporting it means editing that file; five lines is the
 * cheaper of the two costs.
 */

/**
 * The wave currently in the factory — the newest thing launched. Item selection
 * belongs in the product sheet; until it exists, "the one you just started" is
 * the only target that cannot be ambiguous.
 */
function newestWave(state: RunState): LineItem | null {
  const live = liveItems(ensurePortfolio(state));
  return live.length === 0 ? null : live[live.length - 1];
}

/** Discontinue the tired one first, not the newest. */
function retirementCandidate(state: RunState): LineItem | null {
  const live = liveItems(ensurePortfolio(state));
  if (live.length === 0) return null;
  const byAge = [...live].sort((a, b) => a.launchedYear - b.launchedYear);
  return byAge.find((i) => i.state === "declining") ?? byAge[0];
}

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The design pass, not the launch. The launch itself goes through
     * `launchItem` in the product sheet, which is where price, tier, tags and
     * the chase rate are actually set. What this buys is a lineup planned as a
     * set: right case pack, right ratio, fewer singles sorted out at the port.
     */
    id: "toys-design-wave",
    tab: "product",
    label: "Design a wave",
    signal: "Name it, price it, decide how rare the rare one is.",
    detail:
      "Sculpts, colourways, and the decision nobody outside the room will ever see: which one of these is hard to get.",
    apply: (s) =>
      spend(
        s,
        "toys-design-wave",
        {
          effects: [
            { stat: "energy", amount: -8 },
            { stat: "qual", amount: 3 },
          ],
          setFlags: ["wave_designed"],
        },
        "You lay the whole wave out on the table and pick which one nobody will find.",
      ),
  },
  {
    /**
     * The signature decision. It raises the run and shows nothing, because the
     * information that would make it a calculation arrives nine months after
     * the money does. Pressable more than once: the size of the bet is how many
     * times you were willing to sign.
     */
    id: "toys-commit-production",
    tab: "product",
    label: "Commit production",
    signal: "Guess now. Find out in nine months.",
    detail:
      "The factory needs the quantity today for a season that has not happened. Nobody in this building knows the number.",
    costS: 2,
    available: (s) => newestWave(s) !== null,
    apply: (s) => {
      const wave = newestWave(s);
      if (!wave) return;
      wave.meta.commit = Number(Math.min(2.2, metaNum(wave, "commit", 1) + 0.25).toFixed(2));
      spend(
        s,
        "toys-commit-production",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            // A committed run is the only thing a factory really wants from you.
            { stat: "suploy", amount: 1 },
          ],
        },
        `You sign the run for ${wave.name}. The demand it is betting on does not exist yet.`,
      );
    },
  },
  {
    /**
     * Volume on sight, and a share of the top line that leaves before margin is
     * calculated. The royalty is modelled in `waveMiss` rather than as a gm_pt
     * hit, because a licensor takes a percentage of what you sold, not a
     * percentage of what you kept, and that is the distinction worth teaching.
     */
    id: "toys-license",
    tab: "product",
    label: "License a character",
    signal: "Instant recognition. Someone else's rules and royalty.",
    detail:
      "A character every kid already knows, an approval process you do not control, and a contract with a termination clause in it.",
    costS: 4,
    apply: (s) =>
      spend(
        s,
        "toys-license",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "brand", amount: 8 },
            { stat: "rev_pct", amount: 18, durationQ: 4 },
            { stat: "ctr_pt", amount: 3 },
            { stat: "risk", amount: 1 },
          ],
          setFlags: ["license_deal"],
        },
        "You sign the licence. The shelf understands you immediately and so does their legal team.",
      ),
  },
  {
    /**
     * The opposite trade. Nothing lands for a year, nothing is taken off the
     * top, and what you build stays on the balance sheet — which is why the
     * second brand effect is delayed rather than paid on signature.
     */
    id: "toys-original-ip",
    tab: "company",
    label: "Build an original IP",
    signal: "Slow. Nobody knows it. It's yours.",
    detail:
      "A character with no audience and no royalty. It compounds if you keep at it and it is an asset when someone comes to buy you.",
    costS: 2,
    apply: (s) =>
      spend(
        s,
        "toys-original-ip",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "brand", amount: 3 },
            { stat: "qual", amount: 3 },
            { stat: "val_pct", amount: 4 },
            { stat: "brand", amount: 6, delayed: true },
          ],
          setFlags: ["original_ip"],
        },
        "You start something nobody has heard of. It will be worth more than the licence eventually.",
      ),
  },
  {
    /**
     * Buys demand and brand heat with a rate that also raises the flip spill and
     * the complaint load. The trade is real in both directions, which is why the
     * signal names both sides and neither number.
     */
    id: "toys-chase-variant",
    tab: "product",
    label: "Add a chase variant",
    signal: "Collectors move. Parents complain.",
    detail:
      "One in the case is different. The collectors find out within a day; the parents find out at the till in December.",
    costS: 1,
    available: (s) => newestWave(s) !== null,
    apply: (s) => {
      const wave = newestWave(s);
      if (!wave) return;
      wave.meta.chase = Number(Math.min(0.3, metaNum(wave, "chase", 0.08) + 0.05).toFixed(3));
      spend(
        s,
        "toys-chase-variant",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "brand", amount: 5 },
            { stat: "cwp_pt", amount: 3 },
            { stat: "csat", amount: -4 },
          ],
          setFlags: ["chase_heavy"],
        },
        `One in every case of ${wave.name} is different now. The forums notice before the buyers do.`,
      );
    },
  },
  {
    /**
     * Bought against the recall event, which lives in the event library rather
     * than here. The small effect inside this lens is the honest one: certified
     * product does not sit in a compliance hold at the port while the season
     * runs past it.
     */
    id: "toys-safety-cert",
    tab: "product",
    label: "Get safety-certified",
    signal: "Non-negotiable. Do it before someone makes you.",
    detail:
      "Drop tests, small-parts testing, flammability, a lab that charges by the sample. Boring until the week it is not.",
    costS: 2,
    apply: (s) =>
      spend(
        s,
        "toys-safety-cert",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "risk", amount: -3 },
            { stat: "csat", amount: 3 },
            { stat: "qual", amount: 2 },
            // Certification is not a purchase, it is a standing programme. Every
            // new tool goes back to the lab.
            { stat: "burn_S_mo", amount: 0.05 },
          ],
          setFlags: ["safety_certified"],
        },
        "You pay a lab to try to break your own product. They manage it twice.",
      ),
  },
  {
    /**
     * The buyer's volume is enormous and none of the terms are yours: their
     * price, their quantity, their markdown money, their fill-rate penalties.
     * All four consequences are split deliberately — two visible here, two
     * inside the leak — because that is how the real deal reads.
     */
    id: "toys-shelf-space",
    tab: "market",
    label: "Land shelf space",
    signal: "The big-box buyer decides your year.",
    detail:
      "An endcap in the only quarter that matters, at the price they name, in the quantity they name.",
    costS: 3,
    minStage: 2,
    apply: (s) =>
      spend(
        s,
        "toys-shelf-space",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "rev_pct", amount: 22, durationQ: 4 },
            { stat: "share_pt", amount: 2 },
            { stat: "gm_pt", amount: -3 },
            { stat: "invsent", amount: 1 },
          ],
          setFlags: ["shelf_deal"],
        },
        "You get the endcap. A buyer you have met once now sets your December.",
      ),
  },
  {
    /**
     * Retiring is the ordinary shared flow, with one detail that is true and
     * costs nothing to model: a line stops being made and the resale index goes
     * up. You will watch it appreciate and earn none of it, and that lands
     * harder than any tooltip about scarcity would.
     */
    id: "toys-retire-line",
    tab: "product",
    label: "Retire a line",
    signal: "Discontinued. Watch the resale price.",
    detail:
      "Tooling comes off the floor. The people who did not buy it will pay more than you ever charged.",
    available: (s) => retirementCandidate(s) !== null,
    apply: (s) => {
      const wave = retirementCandidate(s);
      if (!wave || !retireItem(s, wave.id)) return;
      wave.meta.secondary = Number((metaNum(wave, "secondary", 1) * 1.35).toFixed(2));
      refreshBooks(s);
      s.log.push(
        makeLine(
          s,
          "decision",
          `${wave.name} is discontinued. The resale price starts climbing the week the tooling comes off.`,
        ),
      );
    },
  },
];

export default SPEC;
