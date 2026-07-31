import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import {
  priceRatio,
  elasticityBand,
  earningItems,
  liveItems,
  ensurePortfolio,
  portfolioCap,
} from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 09 · EDTECH — the lens where revenue is the lagging indicator.
 *
 * Addendum A, §09: this is the only industry whose primary metric is not
 * revenue, and the note at the end of that section is the brief for the whole
 * file — Novus is itself EdTech, so this lens should be the sharpest one in the
 * set and the player should feel slightly seen.
 *
 * ── Signature mechanic · COMPLETION RATE AS THE REAL PRODUCT ─────────────────
 *
 * Every course carries a hidden completion rate. Nothing in the enrollment
 * numbers reflects it. A course can be commercially excellent and
 * pedagogically worthless for two straight years, and the engine will let it —
 * enrollments land, the year closes green, and the report has nothing to say.
 *
 * Then the bill arrives. Finishers are the only people who refer anyone, so a
 * catalog nobody finishes starts buying the seats it used to be given:
 * discounts, scholarships, affiliate rebates, refund desks. Institutional
 * buyers ask for completion data, because it is the one number a procurement
 * officer knows to ask for, and they do not renew. None of that shows up as a
 * cost line — it shows up as revenue that never arrives, which is exactly what
 * `signatureLeak` is for.
 *
 * Structurally this is not FOOD wearing a lab coat. FOOD's spoilage is
 * memoryless: it prices one year's forecast error and forgets. This leak has a
 * TIME DIMENSION — `yearsSelling` ramps the referral term — because the whole
 * lesson is that the consequence lands years after the decision. And the price
 * term is asymmetric rather than symmetric: underpricing hurts finishing (cheap
 * reads as optional) while overpricing hurts refunds. Different cause,
 * different shape, different failure.
 *
 * Teaches: leading vs lagging indicators, that the metric which is easy to
 * measure is rarely the metric that matters, and referral-driven growth.
 *
 * ── Signature failure · THE ENROLLMENT MILL ──────────────────────────────────
 *
 * Cheap self-paced content, priced to move, two excellent years, and then the
 * referral well goes dry while refunds and non-renewals eat a third of gross.
 * The slowest death available. `improve-completion` is the counter and it is
 * the one activity in the file that buys nothing you can see this year.
 */

const EDTECH_TAGS = ["self-paced", "cohort", "k12", "adult", "certification", "free"];

/**
 * The bar. Not a game constant — it is roughly where a refund desk, a review
 * thread and a district's evaluation office all independently stop asking
 * questions. Everything in the leak is priced off the GAP to this number rather
 * than off completion itself, so a course that clears it leaks almost nothing
 * no matter how it got there.
 */
const COMPLETION_BENCHMARK = 0.55;

type Delivery = "cohort" | "self_paced";

/**
 * `meta.delivery` is set by the launch flow. Read defensively: courses launched
 * before the key existed fall back to their tag, and a course with neither is
 * self-paced, which is both the safe default and the honest one — self-paced is
 * what you get when nobody decided.
 */
function deliveryOf(item: LineItem): Delivery {
  const declared = item.meta?.delivery;
  if (declared === "cohort" || declared === "self_paced") return declared;
  if (item.tags.includes("cohort")) return "cohort";
  return "self_paced";
}

/**
 * The hidden number. Never shown pre-launch, never shown mid-year, and the only
 * thing in this lens that actually predicts the next three years.
 */
function completionRate(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // Delivery model dominates every other term and it is not close. Self-serve
  // content completes in the teens across the entire sector; a cohort with a
  // start date, classmates and somebody expecting you on Tuesday clears half.
  // Cohorts also cost real payroll to run, which is the trade.
  let c = deliveryOf(item) === "cohort" ? 0.52 : 0.13;

  // A credential is what pulls people through the last third. An unfinished
  // certificate is worth nothing, and learners know it.
  if (item.tags.includes("certification")) c += 0.1;
  // Somebody else enforces attendance in K12. Adult learners are competing with
  // a job, and on any given Wednesday the job wins.
  if (item.tags.includes("k12")) c += 0.06;
  if (item.tags.includes("adult")) c -= 0.05;
  // Free enrollment is the cheapest signup and the worst learner: nothing was
  // sunk, so nothing is owed.
  if (item.tags.includes("free") || item.price <= 0) c -= 0.09;

  // Price is commitment, and this is where the lens inverts FOOD. Underpricing
  // does not only cost margin here, it costs finishing — cheap reads as
  // optional. Overpricing does not hurt completion much; it hurts refunds,
  // which is handled in the leak. Hence one-sided.
  if (elasticityBand(priceRatio(item, state, spec)) === "underpriced") c -= 0.04;

  // Instructional design is the actual job, and launch tier is the only place
  // anyone pays for it before the course exists.
  c += 0.05 * item.investTier;

  // The three things a player can buy afterwards that move this and little else.
  if (state.flags.completion_program) c += 0.08;
  if (state.flags.live_sessions) c += 0.06;
  if (state.flags.accredited) c += 0.04;

  // Teaching quality and support surface here months before they surface in
  // brand or revenue. That lag is the entire point of the industry.
  c += 0.1 * ((state.stats.qual + state.stats.csat) / 200 - 0.5);

  // Content rots faster here than anywhere else in the game. A syllabus citing
  // last year's tooling loses the room in week two, so age is measured from the
  // last refresh rather than from launch.
  const sinceRefresh = Math.max(0, state.year - (item.lastRefreshedYear ?? item.launchedYear));
  c -= Math.min(0.06, 0.015 * sinceRefresh);

  // Some rooms gel and some do not.
  c += (rng() - 0.5) * 0.06;
  return Math.min(0.9, Math.max(0.03, c));
}

function nonCompletion(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  const completion = completionRate(item, state, rng, spec);
  const shortfall = Math.max(0, COMPLETION_BENCHMARK - completion);

  // Failed cards, duplicate seats, the ordinary friction of selling anything.
  let leak = 0.03;

  // Refunds. A learner who stalled in week two and paid real money asks for it
  // back, and one who paid a lot asks louder and escalates further. This term
  // is why an expensive bad course is worse than a cheap bad one.
  const band = elasticityBand(priceRatio(item, state, spec));
  leak += 0.2 * shortfall * (band === "rich" || band === "greedy" ? 1.35 : 1);

  // THE ENROLLMENT MILL, as a ramp rather than a cliff, because that is how a
  // referral well actually runs dry. Years one and two sell on the word of
  // mouth of people who bought before the reviews landed. After that you are
  // buying the seats you used to be given — scholarships, coupons, affiliate
  // rebates — and none of that arrives as revenue. A course that clears the bar
  // keeps a small version of this term: even good courses age out of a network.
  const yearsSelling = Math.max(0, state.year - item.launchedYear);
  leak += 0.025 * Math.min(4, yearsSelling) * (shortfall > 0.15 ? 1 : 0.2);

  // Institutional revenue is a leveraged bet on this mechanic. The contract you
  // already spent against renews on an evaluation you cannot argue with, and a
  // district that reads your completion data simply does not re-up.
  if (state.flags.district_contract) leak += 0.22 * shortfall;

  // Publishing outcomes is only a gift when the numbers are good. Once the data
  // is public it keeps working in whichever direction it points, forever.
  if (state.flags.outcomes_public) leak += shortfall > 0.05 ? 0.05 : -0.025;

  // Accreditation gives learners a reason to finish and gives the refund desk a
  // rulebook to point at.
  if (state.flags.accredited) leak -= 0.02;

  // Leave the completion figure on the item so the year-end report and the
  // autopsy can name it after the fact. Written here, never read back: reading
  // it would let a re-tick of the same year compound itself, and every term
  // above is derived from state a replay reproduces exactly.
  item.meta.completionPct = Math.round(completion * 100);

  return leak;
}

export const SPEC: IndustrySpec = {
  code: "EDTECH",
  noun: "Course",
  nounPlural: "Courses",
  demandUnit: "enrollments",
  reportLabel: "THE CATALOG",
  // Zero has to be reachable: a free course is a real product decision in this
  // industry, not an absence of one. $25 steps keep the stepper thumb-able
  // across a band eighty times wider than FOOD's.
  priceMin: 0,
  priceMax: 2000,
  priceStep: 25,
  // The anchor is the mid-market self-paced course. It lands a $150 add-on in
  // budget and a bootcamp cohort in luxury, which is where they belong.
  baselinePrice: 300,
  // Enrollments, not covers: twenty-three times FOOD's price at a tenth of its
  // volume. Revenue per course lands around double a menu item's, which is what
  // a catalog with no kitchen should look like.
  baseUnits: 240,
  // Clearly above FOOD's 62 and clearly below pure software: delivery costs
  // almost nothing, but graders, TAs and support are payroll, and a cohort is
  // payroll that scales with enrollment.
  baselineGmPt: 78,
  tags: EDTECH_TAGS,
  namePlaceholder: "Algebra That Sticks",
  leakLabel: "Non-completion",
  // Higher ceiling than FOOD's spoilage on purpose. A mature enrollment mill
  // should be able to lose a third of gross, because that is the size of the
  // hole refunds plus non-renewal plus paid-for enrollment actually digs.
  leakMax: 0.34,
  investTiers: [
    // The cheap tier costs MORE per enrollment, not less: unedited video
    // generates support tickets, manual refunds and a re-record every year.
    { label: "Screen-record it yourself", costS: 0.5, costMult: 0.62, valueMult: 0.8 },
    { label: "Build it with an instructional designer", costS: 2, costMult: 0.5, valueMult: 1.0 },
    { label: "Studio, assessments, real grading", costS: 4, costMult: 0.42, valueMult: 1.26 },
  ],
  launchChoice: {
    metaKey: "delivery",
    label: "How is it taught?",
    options: [
      { value: "self-paced", label: "Self-paced, on their own" },
      { value: "cohort", label: "A cohort, on a schedule" },
    ],
    defaultIndex: 0,
  },
  signatureLeak: (item, state, rng, spec) => nonCompletion(item, state, rng, spec),
};

/**
 * Enrollment-weighted completion across the catalog — what an outcomes report
 * would actually say if you published one today. Used only by the publish
 * activity, which is a bet on this number the player cannot see.
 */
function catalogCompletion(state: RunState, rng: Rng): number {
  const items = earningItems(ensurePortfolio(state));
  if (items.length === 0) return 0;
  let weighted = 0;
  let units = 0;
  for (const item of items) {
    const u = Math.max(1, item.history.at(-1)?.units ?? 1);
    weighted += completionRate(item, state, rng, SPEC) * u;
    units += u;
  }
  return units === 0 ? 0 : weighted / units;
}

/**
 * `activities.ts` keeps its `spend()` helper private, so this mirrors it rather
 * than reaching for an export that does not exist. Same contract, and the same
 * rule from that file's header, which binds every activity below: NONE of these
 * advance time. They spend cash, energy and attention.
 */

const hasSlot = (state: RunState): boolean =>
  liveItems(ensurePortfolio(state)).length < portfolioCap(state);

export const ACTIVITIES: Activity[] = [
  // ── Product ───────────────────────────────────────────────────────────
  {
    /**
     * The launch flow (§6, three taps) plus one lens-specific choice: delivery
     * model, stored as `meta.delivery`. It is the highest-leverage decision in
     * the industry and the player is given no forecast for it, which is the
     * design.
     *
     * `apply` is deliberately inert. `launchItem` needs a name, a price and a
     * tier that only the sheet can collect, and an activity that charged cash
     * or invented a course name would be worse than one that does nothing. The
     * work this entry does is the gate: it disappears at the cap, which is how
     * the player meets the cap.
     */
    id: "edtech-build-course",
    tab: "product",
    label: "Build a course",
    signal: "Name it, price it, pick self-paced or cohort.",
    detail:
      "Self-paced is cheap to run and cheap to abandon. A cohort has a start date, a room and a payroll line.",
    available: hasSlot,
    apply: () => {},
  },
  {
    /**
     * The correct invisible move, and the reason the file exists. It buys
     * nothing the player can see this year: no enrollments, no revenue, no
     * brand. It moves the only number that pays for the years after next.
     */
    id: "edtech-completion",
    tab: "product",
    label: "Improve completion",
    signal: "Nobody buys this. Everything depends on it.",
    detail:
      "You rebuild the middle third, where the drop-off actually happens. Nothing about the sales page changes.",
    costS: 1.5,
    apply: (s) =>
      spend(
        s,
        "edtech-completion",
        {
          effects: [
            { stat: "cash_S", amount: -1.5 },
            { stat: "qual", amount: 4 },
            { stat: "csat", amount: 3 },
            { stat: "energy", amount: -6 },
          ],
          setFlags: ["completion_program"],
        },
        "You rebuild the middle third of every course, where everyone quietly stops. No enrollment number moves.",
      ),
  },
  {
    id: "edtech-live-sessions",
    tab: "product",
    label: "Add live sessions",
    signal: "Better outcomes. Real payroll.",
    detail:
      "Somebody has to be online at seven on a Tuesday, every Tuesday, whether eight people show up or eighty.",
    available: (s) => !s.flags.live_sessions,
    apply: (s) =>
      spend(
        s,
        "edtech-live-sessions",
        {
          effects: [
            { stat: "burn_S_mo", amount: 0.35 },
            { stat: "gm_pt", amount: -4 },
            { stat: "csat", amount: 5 },
            { stat: "morale", amount: -2 },
          ],
          setFlags: ["live_sessions"],
        },
        "Live sessions go on the calendar. Finishing gets easier and margin becomes a staffing question.",
      ),
  },
  {
    /**
     * A launch flow with the price stepper pinned at zero and the `free` tag
     * pre-selected. Same inert `apply` as `build-course` and for the same
     * reason; `costS` is here as the affordability gate and the honest headline
     * cost of producing something you give away. It occupies a slot, which is
     * the whole tension: top-of-funnel competing with revenue for the cap.
     */
    id: "edtech-free-course",
    tab: "product",
    label: "Make a free course",
    signal: "No revenue. A lot of top-of-funnel.",
    detail:
      "The best advertisement this industry has, and it holds a slot a paying course could have had.",
    costS: 1,
    available: hasSlot,
    apply: () => {},
  },
  {
    /**
     * The retire flow. Pressed more often here than in any other lens because
     * content ages faster here than anywhere else — a course two syllabi behind
     * is not a quiet earner, it is a refund queue. Inert for the same reason as
     * the launch entries: the item detail screen owns which course.
     */
    id: "edtech-retire-course",
    tab: "product",
    label: "Retire a course",
    signal: "Content rots. Admit it.",
    detail: "Pull it from the catalog. The learners already enrolled finish out; nobody new starts.",
    available: (s) => liveItems(ensurePortfolio(s)).length > 0,
    apply: () => {},
  },

  // ── Company ───────────────────────────────────────────────────────────
  {
    /**
     * Long payback, authored as long payback: the cash leaves now and every
     * benefit is parked three quarters out, because that is how a site visit,
     * a self-study report and a review cycle actually run. It is also the gate
     * on institutional revenue, so a player who never does this never meets
     * half the industry.
     */
    id: "edtech-accredit",
    tab: "company",
    label: "Get accredited",
    signal: "Slow, expensive, opens doors that were locked.",
    detail:
      "A self-study, a site visit and a binder nobody enjoys. On the other side, buyers who would not previously take the meeting.",
    costS: 4,
    minStage: 2,
    available: (s) => !s.flags.accredited,
    apply: (s) =>
      spend(
        s,
        "edtech-accredit",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "energy", amount: -8 },
            { stat: "brand", amount: 7, afterQ: 3 },
            { stat: "cwp_pt", amount: 6, afterQ: 3 },
            { stat: "invsent", amount: 1, afterQ: 3 },
            { stat: "risk", amount: -1 },
          ],
          setFlags: ["accredited"],
        },
        "You start the self-study. The money goes out this quarter and the letter arrives whenever the reviewers feel like it.",
      ),
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    /**
     * Gated on accreditation AND on having completion data to show, because a
     * district asks for both and one of them cannot be bought late. Large,
     * lumpy and slow: procurement money lands three quarters out, and the
     * purchase order sets `district_contract`, which hands the leak a renewal
     * clause. Selling to institutions is a bet that your completion rate is
     * real.
     */
    id: "edtech-district",
    tab: "market",
    label: "Sell to a school district",
    signal: "One contract. Many students. Nine months of procurement.",
    detail:
      "An RFP, a pilot, a board meeting and a purchase order with a reporting clause attached to the renewal.",
    costS: 2,
    minStage: 3,
    available: (s) =>
      !!s.flags.accredited &&
      (!!s.flags.completion_program || !!s.flags.outcomes_public) &&
      !s.flags.district_contract,
    apply: (s) =>
      spend(
        s,
        "edtech-district",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "energy", amount: -10 },
            { stat: "cash_S", amount: 8, afterQ: 3 },
            { stat: "rev_pct", amount: 14, durationQ: 4, afterQ: 3 },
            { stat: "burn_S_mo", amount: 0.15 },
            { stat: "share_pt", amount: 1, afterQ: 3 },
          ],
          setFlags: ["district_contract"],
        },
        "Nine months of procurement for one signature. The purchase order arrives with a renewal clause you will be measured against.",
      ),
  },
  {
    /**
     * Genuine risk, resolved against the mechanic rather than a coin flip: the
     * branch reads the catalog's actual completion, which the player has never
     * been shown. Publish good numbers and you get the most durable brand gain
     * in the lens. Publish bad ones and you have handed every buyer and every
     * refund desk the argument. Either way `outcomes_public` sticks, because
     * you cannot unpublish a number.
     */
    id: "edtech-outcomes",
    tab: "market",
    label: "Publish outcome data",
    signal: "Only do this if the numbers are good.",
    detail:
      "Completion, pass rates, what happened to people afterwards. Audited, dated, and permanent once it is out.",
    costS: 0.5,
    available: (s) => earningItems(ensurePortfolio(s)).length > 0 && !s.flags.outcomes_public,
    apply: (s) => {
      const rng = runRng(s.seed, s.year, s.month, hashString("edtech-outcomes-read"));
      const good = catalogCompletion(s, rng) >= COMPLETION_BENCHMARK;
      spend(
        s,
        "edtech-outcomes",
        good
          ? {
              effects: [
                { stat: "cash_S", amount: -0.5 },
                { stat: "brand", amount: 9 },
                { stat: "csat", amount: 4 },
                { stat: "cwp_pt", amount: 4 },
                { stat: "invsent", amount: 1 },
              ],
              setFlags: ["outcomes_public"],
            }
          : {
              effects: [
                { stat: "cash_S", amount: -0.5 },
                { stat: "brand", amount: -8 },
                { stat: "csat", amount: -4 },
                { stat: "churn_pt", amount: 3 },
                { stat: "invsent", amount: -1 },
              ],
              setFlags: ["outcomes_public"],
            },
        good
          ? "You publish the completion data. It is the rare marketing spend that gets stronger the longer it sits there."
          : "You publish the completion data. Everyone reads the same row you were hoping they would skip.",
      );
    },
  },
];

export default SPEC;
