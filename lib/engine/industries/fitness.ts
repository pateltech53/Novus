import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import {
  priceRatio,
  elasticityBand,
  ensurePortfolio,
  earningItems,
  retireItem,
} from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 07 · FITNESS — the capacity lens.
 *
 * Built on FOOD's shape (see industries/food.ts) with one deliberate departure:
 * FOOD is a product business where the cost follows the demand, and this is a
 * service business where the cost is committed months before the demand arrives.
 *
 * ── Signature mechanic · CAPACITY UTILIZATION ───────────────────────────────
 *
 * Every program has a slot count the player commits to at launch and can only
 * change with capital. Demand is then divided by that committed capacity to give
 * a UTILIZATION RATE, and the loss is a function of how far that rate sits from
 * a narrow band — roughly three-quarters to seven-eighths full.
 *
 * Both tails cost money, for different reasons:
 *
 *   Under-filled — the coach is paid, the room is rented and the timetable runs
 *   whether four people came or forty. Every empty slot-hour is a fixed cost
 *   with nothing against it.
 *
 *   Over-filled — the room is unpleasant, the regulars stop coming, and you lose
 *   members you had already counted on. You got paid before they left, which is
 *   why crowding costs less per point than vacancy does.
 *
 * That two-tailed shape is the whole difference from FOOD. Spoilage is monotone:
 * more unpredictability, more waste, always. Utilization is a band, so success
 * and failure sit on the same axis and growth can overshoot into a loss. It also
 * means the fix for one tail is the cause of the other — expand the floor to
 * relieve crowding and you have just widened the denominator you now have to
 * fill, forever.
 *
 * Teaches: fixed versus variable cost, capacity planning, and why service
 * businesses scale in steps rather than curves.
 *
 * ── Signature failure · THE JANUARY CLIFF ──────────────────────────────────
 *
 * The 1.2 Q1 seasonality is the trap. `swing` below is how far Q1 and Q3 sit
 * either side of the annual mean, and a January promo widens it. A wide swing
 * puts BOTH tails outside the band in the same year — rammed in January,
 * echoing in June — so the promo can lose money while the average utilization
 * looks correct. `retention_program` is the only thing that narrows the swing,
 * and it is the activity that never feels urgent.
 *
 * ── Per-item meta keys ─────────────────────────────────────────────────────
 *
 *   meta.classSize  "small" | "standard" | "large"   committed at launch
 *   meta.online     boolean                          set by the go-online activity
 *
 * Both are read defensively: a program launched before these existed falls back
 * to a standard class in a room. The `online` launch tag counts as `meta.online`
 * too — a program the player deliberately puts on a screen has no room to fill,
 * and the activity is only the retrofit of one that already had one.
 */

const FITNESS_TAGS = ["strength", "cardio", "group", "personal", "online", "beginner"];

/** Below this, you are paying for air. */
const EMPTY_FLOOR = 0.75;
/** Above this, the floor is unpleasant and the regulars start voting with their feet. */
const CROWD_CEILING = 0.88;

const isOnline = (item: LineItem): boolean =>
  item.meta.online === true || item.tags.includes("online");

/**
 * Committed capacity, indexed so that 1.0 is a standard class in the room you
 * already have. This is the denominator of the whole mechanic, and the only way
 * it moves is capital — which is the point.
 */
function committedCapacity(item: LineItem, state: RunState): number {
  const size = item.meta.classSize;
  let cap = size === "small" ? 0.72 : size === "large" ? 1.4 : 1.0;

  // A one-to-one program is a coach and a diary; a group program is a room.
  if (item.tags.includes("personal")) cap *= 0.7;
  if (item.tags.includes("group")) cap *= 1.2;

  // These three are company-wide and that is correct: an extra hour on the
  // timetable, another coach and a bigger floor serve every program on the
  // schedule. Only class size and delivery model belong to one program.
  if (state.flags.extra_class_times) cap *= 1.35;
  if (state.flags.coach_on_staff) cap *= 1.18;
  // A step, not a slope. Rent does not come back down.
  if (state.flags.floor_expanded) cap *= 1.6;

  return cap;
}

/**
 * How many members this program pulls, on the same index as capacity. Brand and
 * word of mouth fill classes; price decides who walks past.
 */
function memberPull(item: LineItem, state: RunState, spec: IndustrySpec): number {
  const band = elasticityBand(priceRatio(item, state, spec));
  let pull =
    band === "underpriced" ? 1.3 : band === "sweet" ? 1.0 : band === "rich" ? 0.78 : 0.5;

  // Nobody joins a gym they have not heard of.
  pull *= 0.6 + 0.6 * (state.stats.brand / 100);
  // Referrals are how a studio actually fills. Satisfied members bring the room.
  pull *= 0.85 + 0.3 * (state.stats.csat / 100);
  // A promo buys signups, and signups are what makes the trap convincing.
  if (state.flags.january_promo) pull *= 1.22;

  return pull;
}

function utilizationLoss(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // Freezes, prorated refunds and the member who moved away in March. The floor
  // of running a service business, and cheap compared to either tail.
  let leak = 0.02;

  // Online has no ceiling, so vacancy is meaningless — you are not paying rent
  // on an unwatched session. What you lose instead is the reason anyone keeps
  // paying, so the leak becomes churn. Worse per member, unlimited in headroom:
  // that is the actual trade, not a free upgrade.
  if (isOnline(item)) {
    leak += 0.05 + Math.min(0.1, state.stats.churnPt / 300);
    if (state.flags.retention_program) leak -= 0.03;
    return leak + (rng() - 0.5) * 0.03;
  }

  const u = memberPull(item, state, spec) / committedCapacity(item, state);

  // How far Q1 and Q3 sit either side of the annual mean. The mean can be
  // perfect and both ends still be wrong, which is the January cliff in one
  // line of arithmetic.
  let swing = 0.1;
  if (state.flags.january_promo) swing += 0.18;
  // Beginner programs draw the resolution crowd, who are the least likely to
  // still be here in June.
  if (item.tags.includes("beginner")) swing += 0.05;
  swing += Math.min(0.12, state.stats.churnPt / 200);
  if (state.flags.retention_program) swing -= 0.05;

  const low = u * (1 - swing);
  const high = u * (1 + swing);

  // A small class tolerates being nearly full; forty people at ninety percent is
  // a different room from eight people at ninety percent.
  const ceiling =
    CROWD_CEILING + (item.meta.classSize === "small" ? 0.05 : 0) -
    (item.meta.classSize === "large" ? 0.05 : 0);

  // Vacancy is money already spent. Crowding is money you collected and then
  // lost, later, from people who cancelled. Hence the heavier coefficient on
  // the empty side.
  if (low < EMPTY_FLOOR) leak += (EMPTY_FLOOR - low) * 0.55;
  if (high > ceiling) leak += (high - ceiling) * 0.42;

  // A properly fitted-out program runs a tighter timetable and backfills the
  // gaps. Small, because scheduling discipline cannot fix a room that is twice
  // the size the demand justifies.
  leak -= 0.015 * item.investTier;

  // Weather, holidays, one coach's flu.
  return leak + (rng() - 0.5) * 0.03;
}

export const SPEC: IndustrySpec = {
  code: "FITNESS",
  noun: "Program",
  nounPlural: "Programs",
  demandUnit: "members",
  reportLabel: "THE SCHEDULE",
  // The appendix band, in monthly sticker price, which is what a member is
  // quoted and therefore what the player should be setting.
  priceMin: 10,
  priceMax: 300,
  priceStep: 5,
  baselinePrice: 65,
  // Members, not member-months: the engine bills units × price once per closed
  // year, so this is sized against FOOD's revenue scale rather than against a
  // real studio's headcount. Getting the cross-lens pacing right matters more
  // than the headcount reading literally, and the alternative was abandoning
  // the monthly price band the appendix specifies.
  baseUnits: 520,
  // Higher than FOOD, and for a structural reason rather than a generous one:
  // one more body in a class that is already running costs almost nothing, so
  // cost of goods here is thin. The room and the coach are fixed cost, they sit
  // in burn, and utilization is what decides whether a rich gross margin turns
  // into a profit or into nothing at all.
  baselineGmPt: 68,
  tags: FITNESS_TAGS,
  namePlaceholder: "6am Barbell Club",
  leakLabel: "Empty slots",
  // Higher than FOOD's spoilage ceiling. A kitchen can tighten its way out of
  // waste; a half-empty timetable cannot be tightened, only re-sized, and
  // re-sizing costs capital and takes a year to show up.
  leakMax: 0.34,
  investTiers: [
    // The value spread is wider than FOOD's and the cost spread narrower,
    // because in a service the room IS the product. Cheap kit does not save you
    // much per member and it is the first thing anyone notices.
    { label: "Borrowed room, borrowed kit", costS: 0.5, costMult: 1.14, valueMult: 0.78 },
    { label: "Fit it out properly", costS: 1.5, costMult: 1.0, valueMult: 1.0 },
    { label: "Build the room they photograph", costS: 3, costMult: 0.9, valueMult: 1.28 },
  ],
  launchChoice: {
    metaKey: "classSize",
    label: "How big is the class?",
    options: [
      { value: "small", label: "Small and personal" },
      { value: "standard", label: "A normal room" },
      { value: "large", label: "Pack it out" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => utilizationLoss(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Local copy of the helper in activities.ts, which does not export it and which
 * this file may not edit. Same contract: apply the outcome, refresh the books,
 * log one line. Nothing here advances time.
 */

/** Programs with a closed year behind them, weakest first. */
function byWeakest(state: RunState): LineItem[] {
  return earningItems(ensurePortfolio(state))
    .filter((i) => i.history.length > 0)
    .sort((a, b) => (a.history.at(-1)?.units ?? 0) - (b.history.at(-1)?.units ?? 0));
}

export const ACTIVITIES: Activity[] = [
  {
    /**
     * A doorway, not a transaction: the name, the price and the class size are
     * the player's to set, so this only opens the launch flow and the invest
     * tier is charged there. `open_launch_flow` is a handshake flag for the
     * Product tab to consume and clear — see notes.
     */
    id: "fit-launch",
    tab: "product",
    label: "Launch a program",
    signal: "Name it, price it, set the class size.",
    detail:
      "A slot count is a promise to pay a coach for those hours whether or not anyone books them.",
    apply: (s) =>
      spend(
        s,
        "fit-launch",
        { setFlags: ["open_launch_flow"] },
        "You put a new program on the schedule and start paying for the hours.",
      ),
  },
  {
    id: "fit-class-times",
    tab: "product",
    label: "Add class times",
    signal: "More slots. More coach hours.",
    detail: "The timetable gets wider. So does payroll, every month, regardless of bookings.",
    apply: (s) =>
      spend(
        s,
        "fit-class-times",
        {
          effects: [
            { stat: "burn_S_mo", amount: 0.35 },
            { stat: "csat", amount: 3 },
            { stat: "morale", amount: -3 },
          ],
          setFlags: ["extra_class_times"],
        },
        "You open more slots. The rooms are calmer and the coaches are working later.",
      ),
  },
  {
    /**
     * The appendix gives coaches hidden retention modifiers. Drawn here off its
     * own salt so the personality is fixed at the moment of hiring, and never
     * previewed: you find out whether they hold a room by watching churn.
     */
    id: "fit-coach",
    tab: "team",
    label: "Hire a coach",
    signal: "Capacity and quality. Payroll and personality.",
    detail: "Coaches are the product. Some of them keep a room; you cannot tell which at interview.",
    apply: (s) => {
      const holds = runRng(s.seed, s.year, s.month, hashString("fit-coach:personality"))() < 0.55;
      spend(
        s,
        "fit-coach",
        {
          effects: [
            { stat: "emp", amount: 1 },
            { stat: "burn_S_mo", amount: 0.3 },
            { stat: "qual", amount: 3 },
            { stat: "churn_pt", amount: holds ? -3 : 1 },
            { stat: "csat", amount: holds ? 3 : 0 },
          ],
          setFlags: ["coach_on_staff"],
        },
        holds
          ? "You hire a coach. Within a month the regulars are asking which sessions are hers."
          : "You hire a coach. Qualified, punctual, and the room stays a room.",
      );
    },
  },
  {
    /**
     * The trap, unlabelled. It genuinely fills January — `memberPull` reads the
     * flag and goes up — and it widens `swing`, which is what quietly puts both
     * ends of the year outside the utilization band.
     */
    id: "fit-january",
    tab: "market",
    label: "Run a January promo",
    signal: "Packed in January. Empty in June.",
    detail: "Discounted joining, no commitment. It works exactly as well as it sounds like it will.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "fit-january",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "rev_pct", amount: 18, durationQ: 2 },
            { stat: "brand", amount: 3 },
            { stat: "churn_pt", amount: 4 },
          ],
          setFlags: ["january_promo"],
        },
        "The queue goes out the door in January. You sign every one of them.",
      ),
  },
  {
    /**
     * The correct answer that never feels urgent. It is the only thing in the
     * lens that narrows `swing`, which means it is the only thing that fixes
     * both tails at once — and it will never look like it did anything.
     */
    id: "fit-retention",
    tab: "product",
    label: "Build a retention program",
    signal: "Boring. It's the whole business.",
    detail:
      "Check-ins, milestones, someone noticing when a member stops coming. No launch, no photos.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "fit-retention",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "churn_pt", amount: -5 },
            { stat: "csat", amount: 4 },
            { stat: "energy", amount: -4 },
          ],
          setFlags: ["retention_program"],
        },
        "You build the unglamorous part. Nobody will ever compliment you on it.",
      ),
  },
  {
    /**
     * Lifts the ceiling off one program by setting `meta.online`, which routes
     * it down the churn branch of the leak instead of the vacancy branch. Picks
     * the program carrying the most members — the one you would actually film.
     */
    id: "fit-online",
    tab: "product",
    label: "Go online",
    signal: "Infinite capacity. Zero room presence.",
    detail:
      "Cameras, a platform, a library. Capacity stops being the constraint and so does the reason to stay.",
    costS: 3,
    available: (s) => earningItems(ensurePortfolio(s)).some((i) => !isOnline(i)),
    apply: (s) => {
      const target = earningItems(ensurePortfolio(s))
        .filter((i) => !isOnline(i))
        .sort((a, b) => (b.history.at(-1)?.units ?? 0) - (a.history.at(-1)?.units ?? 0))[0];
      if (target) target.meta.online = true;
      spend(
        s,
        "fit-online",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "share_pt", amount: 1 },
            { stat: "cwp_pt", amount: -4 },
            { stat: "csat", amount: -3 },
            { stat: "churn_pt", amount: 3 },
          ],
        },
        target
          ? `You put ${target.name} behind a camera. It reaches everyone and holds nobody.`
          : "You put the schedule behind a camera. It reaches everyone and holds nobody.",
      );
    },
  },
  {
    /**
     * The step function. Once only, because rent is a floor you never lower and
     * a lens that could buy capacity repeatedly would let the player dilute the
     * denominator until the mechanic stopped biting.
     */
    id: "fit-floor",
    tab: "assets",
    label: "Expand the floor",
    signal: "More space. More rent. Forever.",
    detail:
      "The unit next door. Capacity arrives all at once, in one lump, and the lease outlives the demand that justified it.",
    costS: 10,
    minStage: 2,
    available: (s) => !s.flags.floor_expanded,
    apply: (s) =>
      spend(
        s,
        "fit-floor",
        {
          effects: [
            { stat: "cash_S", amount: -10 },
            { stat: "burn_S_mo", amount: 0.9 },
            { stat: "csat", amount: 3 },
            { stat: "val_pct", amount: 2 },
          ],
          setFlags: ["floor_expanded"],
        },
        "You take the unit next door. The space is yours and so is the lease.",
      ),
  },
  {
    /**
     * Retiring a program hands its coach hours back — `retireItem` refunds the
     * standing burn — and the cost is entirely social. Gated on a closed year,
     * because "nobody came" is a fact you can only have after the books shut.
     */
    id: "fit-cull",
    tab: "product",
    label: "Cull a dead class",
    signal: "Nobody came. Say it out loud.",
    detail: "The slot goes back on the board. Its four regulars find out from a printed notice.",
    available: (s) => byWeakest(s).length > 0,
    apply: (s) => {
      const dead = byWeakest(s)[0];
      if (!dead) return;
      retireItem(s, dead.id);
      spend(
        s,
        "fit-cull",
        {
          effects: [
            { stat: "morale", amount: -2 },
            { stat: "csat", amount: -2 },
            { stat: "energy", amount: 3 },
          ],
        },
        `You take ${dead.name} off the schedule and say the reason out loud.`,
      );
    },
  },
];

export default SPEC;
