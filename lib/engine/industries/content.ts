import type { IndustrySpec, LineItem } from "../portfolio";
import type { Outcome, RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import { ensurePortfolio, liveItems, priceRatio, elasticityBand } from "../portfolio";
import { hashString, mulberry32, runRng } from "../rng";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";

/**
 * 04 · CONTENT / CREATOR — the rented-distribution lens.
 *
 * Modelled on `food.ts`, which is the reference implementation. Everything
 * shared — elasticity, lifecycle, cannibalization, verdicts — lives in
 * portfolio.ts. Only the signature mechanic below is bespoke.
 *
 * ── Signature mechanic · THE ALGORITHM & CADENCE DEBT ───────────────────────
 *
 * FOOD loses gross margin: prep you paid for goes in the bin, so COGS survives
 * and revenue doesn't. CONTENT loses the top line instead, and that is the
 * whole structural difference. The cost of a video is sunk the moment it is
 * cut; what the platform decides is how many people ever see it. So a bad year
 * here reads as *strong margin on collapsing revenue* — the most confusing
 * financial shape a young creator business can produce, and the one worth
 * teaching.
 *
 * Two forces drive it, and neither is spoilage with a new label:
 *
 * 1. CADENCE DEBT. Each series commits to a cadence at launch — weekly,
 *    biweekly, monthly. Every quarter you do not publish against that promise
 *    is a quarter of debt, it accrues for the life of the series, and it
 *    compounds: the recommendation surface stops testing a series it has
 *    already learned to ignore. Nothing about this is physical. You did not
 *    waste anything. You simply were not there, and the distribution you had
 *    earned went to someone who was.
 *
 * 2. THE REWEIGHT. Once or twice a run the platform changes what it favours,
 *    and it does so on the same fiscal year for every series in the slate at
 *    once. Concentration risk here is structural rather than chosen: a slate of
 *    four shorts channels is one business with one point of failure. Owned
 *    distribution — the newsletter, a product you sell yourself — is the only
 *    real defence, and it is deliberately the slowest, dullest thing to build.
 *
 * Teaches: platform risk, owned versus rented distribution, and that
 * consistency compounds in both directions.
 *
 * `content-post-schedule` pays the debt down a quarter at a time and costs
 * energy every time. `content-newsletter` and `content-own-product` blunt the
 * reweight permanently. Neither is ever the exciting choice on the sheet, which
 * is the point.
 *
 * ── One unit is one thousand views ──────────────────────────────────────────
 *
 * The appendix gives CONTENT no price band: the player commits to a cadence,
 * not a price, and the money arrives indirectly. The engine still needs a price
 * per unit, and `clampPrice` rounds to whole cents, so per-view dollars round to
 * nothing and the field would be dead. The trade already solved this: it counts
 * views in thousands and prices them per thousand — RPM. So a unit here is a
 * mille, and `price` is the series' effective RPM, blended across ads,
 * sponsorship and whatever else it clears. Renderers should multiply units by a
 * thousand for display.
 *
 * That mapping is not a workaround, it earns its keep: RPM varies enormously by
 * format and niche, `tierFor` reads it as a real price tier, and two series on
 * similar RPMs in similar formats cannibalize each other — which is exactly what
 * two channels chasing one audience and one advertiser pool do.
 */

const CONTENT_TAGS = ["longform", "shorts", "podcast", "newsletter", "livestream", "collab"];

type Cadence = "weekly" | "biweekly" | "monthly";

/**
 * What a missed quarter costs, by what you promised. A weekly series that goes
 * dark for three months has broken a promise the audience could feel; a monthly
 * one has been slightly late. The platform reads it the same way.
 */
const CADENCE_WEIGHT: Record<Cadence, number> = { weekly: 1, biweekly: 0.7, monthly: 0.45 };

/**
 * How exposed a format is to the recommendation surface. Shorts live and die
 * there and have no back catalogue; longform keeps earning through search;
 * podcasts and newsletters are subscribed to, which is a different and better
 * relationship. Collab reach is borrowed and behaves like it.
 */
const ALGO_EXPOSURE: Record<string, number> = {
  shorts: 0.05,
  livestream: 0.03,
  collab: 0.02,
  longform: -0.02,
  podcast: -0.03,
  newsletter: -0.07,
};

/** The launch sheet writes this. Absence means the series predates the ledger. */
function committed(item: LineItem): boolean {
  const raw = item.meta.cadence;
  return raw === "weekly" || raw === "biweekly" || raw === "monthly";
}

/** Items launched before this lens existed have no cadence. Assume the middle. */
function cadenceOf(item: LineItem): Cadence {
  const raw = item.meta.cadence;
  return raw === "weekly" || raw === "monthly" ? raw : "biweekly";
}

/**
 * Quarters this series has owed since it launched, counting the one closing
 * now. A series launched in Q4 owes one quarter in its launch year, not four —
 * the promise starts when you make it.
 */
function quartersOwed(item: LineItem, year: number): number {
  const launchQ = Math.min(4, Math.max(1, item.launchedQuarter));
  return 5 - launchQ + 4 * Math.max(0, year - item.launchedYear);
}

/**
 * Quarters actually published against, banked by `content-post-schedule`.
 *
 * A series carrying no cadence at all predates this ledger — a run migrated
 * mid-flight, or an item written by an earlier build. Unmeasured is not the same
 * as missed, so those are credited for the life they have already had rather
 * than opening the slate with five series that all read as abandoned. Anything
 * launched through the sheet carries a cadence and starts at zero, which is what
 * makes the debt real for series the player actually committed to.
 */
function banked(item: LineItem, year: number): number {
  const raw = item.meta.cadenceBank;
  if (typeof raw === "number" && raw > 0) return raw;
  return committed(item) ? 0 : quartersOwed(item, year);
}

/**
 * How much of this series' audience is yours rather than the platform's. A
 * newsletter is a list you own outright. A podcast is subscribed to through
 * someone else's app but arrives without being recommended, which is most of
 * the way there. Everything else is rented.
 */
function ownedShare(item: LineItem): number {
  if (item.meta.owned === true || item.tags.includes("newsletter")) return 0.75;
  if (item.tags.includes("podcast")) return 0.4;
  return 0;
}

/**
 * THE REWEIGHT. Deterministic on seed and year rather than on the per-item rng,
 * because a platform change is one event that hits the whole slate in the same
 * year — that simultaneity is the lesson, and drawing it per item would turn a
 * structural risk into bad luck spread thin. Fires in roughly one year in six,
 * so a ten-year run sees it once or twice.
 */
function reweight(state: RunState): number {
  const roll = mulberry32(hashString(`content:algo:${state.seed}:${state.year}`))();
  if (roll > 0.18) return 0; // most years the surface sits still
  // How hard it moved. The quiet reweights are the ones nobody writes about.
  let shock = 0.1 + roll * 0.4;

  // Revenue you collect yourself does not care what the platform favours.
  if (state.flags.owned_product) shock *= 0.85;
  // A list you own is the one asset a reweight cannot touch.
  if (state.flags.owned_audience) shock *= 0.5;
  return shock;
}

function cadenceDebt(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  // Even a series published on time forever loses some reach it produced for.
  // The surface never serves everything you make.
  let lost = 0.05;

  // ── The debt ──────────────────────────────────────────────────────────────
  let missed = Math.max(0, quartersOwed(item, state.year) - banked(item, state.year));
  // An editor does not keep the promise for you, but a week you cannot cut
  // yourself stops being a week you automatically miss.
  if (state.flags.editor_hired) missed *= 0.7;

  // Linear in quarters missed, plus a compounding term: the second dark quarter
  // costs more than the first because by then the series has been reclassified,
  // not merely overlooked. Capped, because a series three years dark is being
  // killed by the lifecycle curve, not by this.
  const weight = CADENCE_WEIGHT[cadenceOf(item)];
  lost += Math.min(0.24, weight * (0.04 * missed + 0.01 * missed * missed));

  // ── The reweight ──────────────────────────────────────────────────────────
  let shock = reweight(state);
  if (shock > 0) {
    // Owned audience absorbs its share of the hit for this series specifically.
    shock *= 1 - ownedShare(item);
    // Concentration: every additional series fed by the same surface is another
    // one that moves when the surface moves. Nobody chose this risk; they chose
    // four formats that happen to share a distributor.
    const exposed = liveItems(ensurePortfolio(state)).filter((i) => ownedShare(i) < 0.4).length;
    shock *= Math.min(1.6, 1 + 0.18 * Math.max(0, exposed - 1));
  }
  lost += shock;

  // ── Format ────────────────────────────────────────────────────────────────
  for (const tag of item.tags) lost += ALGO_EXPOSURE[tag] ?? 0;

  // ── Monetization load ─────────────────────────────────────────────────────
  // An RPM far above what the audience will sit through is not free money: it
  // is mid-rolls and sponsor reads, and watch-through pays for them. Unlike
  // FOOD, the cheap side of the band costs nothing here — leaving RPM on the
  // table loses revenue per view, which the elasticity band already handles.
  const band = elasticityBand(priceRatio(item, state, spec));
  if (band === "greedy") lost += 0.06;
  else if (band === "rich") lost += 0.025;
  // Sponsorship taken repeatedly stacks on top of that, across the whole slate.
  if (state.flags.sponsor_heavy) lost += 0.04;

  // ── Production ────────────────────────────────────────────────────────────
  // Retention is what the surface actually rewards, and retention is bought in
  // the edit. A cheap series is dropped faster after a gap.
  lost -= 0.015 * item.investTier;

  // A series built on a trend is holding a distribution position it never
  // earned, and the trend is not coming back.
  const chasing = item.meta.trendChase === true;
  if (chasing) lost += 0.06;

  // Platform variance is wider than a kitchen's — the same series can double or
  // halve its reach on identical work. Wider still on a trend.
  lost += (rng() - 0.5) * (chasing ? 0.16 : 0.08);
  return lost;
}

export const SPEC: IndustrySpec = {
  code: "CONTENT",
  noun: "Series",
  nounPlural: "Series",
  demandUnit: "views",
  reportLabel: "THE SLATE",
  // RPM in dollars per thousand views. A shorts feed clears very little; a
  // niche business podcast clears more than most people believe.
  priceMin: 1,
  priceMax: 45,
  priceStep: 0.5,
  baselinePrice: 9,
  // Milles, so 3.6M views in a median series' peak year at stage 1. Lands the
  // same revenue per line as FOOD's 2,600 covers at $13 — deliberately, so the
  // shared burn and stage maths behave identically across lenses.
  baseUnits: 3600,
  // Structurally higher than FOOD's 62: there is no cost of goods in a video.
  // Which is precisely why a creator can post a beautiful margin during the
  // year their business quietly stops working.
  baselineGmPt: 78,
  tags: CONTENT_TAGS,
  namePlaceholder: "The Sunday Cut",
  leakLabel: "Cadence debt",
  // Higher than FOOD's 0.28. Spoilage takes a slice of what you made; a
  // reweight takes the audience.
  leakMax: 0.4,
  investTiers: [
    // Unit costs run far below FOOD's because thumbnails and an edit are not
    // ingredients. The value spread is wider, though: the difference between a
    // cheap cut and a good one is visible in the first three seconds, where a
    // good dish and a great dish look the same on the plate.
    { label: "Shoot it on your phone", costS: 0.5, costMult: 0.58, valueMult: 0.78 },
    { label: "Do it properly", costS: 1.5, costMult: 0.5, valueMult: 1.0 },
    { label: "Go all out", costS: 3, costMult: 0.42, valueMult: 1.26 },
  ],
  launchChoice: {
    metaKey: "cadence",
    label: "What are you committing to?",
    options: [
      { value: "weekly", label: "Every week" },
      { value: "biweekly", label: "Every other week" },
      { value: "monthly", label: "Once a month" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => cadenceDebt(item, state, rng, spec),
};

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The launch flow (§6), routed by id to the three-tap sheet, where cadence
     * takes the price stepper's place. `apply` is the fallback and it does
     * nothing on purpose: a series with a name the player did not choose is
     * worth less than no series, and nothing here may invent one.
     */
    id: "content-start-series",
    tab: "product",
    label: "Start a series",
    signal: "Name it. Commit to a cadence.",
    detail:
      "The cadence is the promise. The platform keeps score of the promise, not of your intentions.",
    apply: () => {},
  },
  {
    /**
     * The whole mechanic, in the least interesting button on the sheet. It buys
     * down cadence debt one quarter at a time and it never stops being
     * available, which means a disciplined player presses it four times a year
     * for forty years and wins with it.
     *
     * The buffer cap is real practice: creators film ahead. Two quarters in the
     * can is a working buffer; more than that is not banking consistency, it is
     * pretending you can pay a promise in advance.
     */
    id: "content-post-schedule",
    tab: "product",
    label: "Post on schedule",
    signal: "Boring. Compounds.",
    detail: "You publish what you said you would publish, when you said you would publish it.",
    apply: (s) => {
      for (const item of liveItems(ensurePortfolio(s))) {
        const ceiling = quartersOwed(item, s.year) + 2;
        item.meta.cadenceBank = Math.min(ceiling, banked(item, s.year) + 1);
      }
      spend(
        s,
        "content-post-schedule",
        {
          effects: [
            { stat: "energy", amount: -8 },
            { stat: "csat", amount: 1 },
          ],
        },
        "You publish on the day you said you would. Nothing happens, which is the whole idea.",
      );
    },
  },
  {
    /**
     * The ceiling on this is hidden and emergent rather than a lockout: each
     * sponsorship sets the next one's terms, and the third one starts showing
     * up in the leak as ad load the audience will not sit through. A player who
     * funds the year this way finds out at year end, from the report.
     */
    id: "content-sponsorship",
    tab: "market",
    label: "Take a sponsorship",
    signal: "Money now. A little trust, spent.",
    detail: "A brand pays for the middle of your series. You read the copy they wrote.",
    apply: (s) => {
      if (s.flags.sponsor_heavy) {
        spend(
          s,
          "content-sponsorship",
          {
            effects: [
              { stat: "cash_S", amount: 1.6 },
              { stat: "brand", amount: -3 },
              { stat: "csat", amount: -3 },
              { stat: "churn_pt", amount: 1 },
            ],
          },
          "Another read. The comments have started counting them.",
        );
        return;
      }
      if (s.flags.sponsor_load) {
        spend(
          s,
          "content-sponsorship",
          {
            effects: [
              { stat: "cash_S", amount: 1.6 },
              { stat: "brand", amount: -2 },
              { stat: "csat", amount: -2 },
            ],
            setFlags: ["sponsor_heavy"],
          },
          "You take the second one. The audience notices the pattern before you do.",
        );
        return;
      }
      spend(
        s,
        "content-sponsorship",
        {
          effects: [
            { stat: "cash_S", amount: 1.6 },
            { stat: "brand", amount: -1 },
          ],
          setFlags: ["sponsor_load"],
        },
        "The money lands the week you need it. Some of the trust goes with it.",
      );
    },
  },
  {
    /**
     * The escape hatch, and the only revenue in this lens the platform cannot
     * reweight. Priced and paced to be worse than a sponsorship for a year and
     * better than one forever, which is the actual trade in the creator economy
     * and the reason most creators never make it.
     */
    id: "content-own-product",
    tab: "product",
    label: "Sell your own product",
    signal: "Harder. Yours.",
    detail:
      "Your own thing, sold direct. Fulfilment, support and refunds are now also yours.",
    costS: 2,
    apply: (s) =>
      spend(
        s,
        "content-own-product",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "energy", amount: -8 },
            { stat: "rev_pct", amount: 5 },
            { stat: "gm_pt", amount: 3 },
            { stat: "brand", amount: 2 },
          ],
          setFlags: ["owned_product"],
        },
        "You sell something of your own. Smaller than a sponsorship, and nobody can switch it off.",
      ),
  },
  {
    /**
     * Owned versus rented distribution, as a single button that looks like a
     * waste of a week. The flag it sets halves every future reweight for the
     * rest of the run — the largest permanent protection in this lens, bought
     * for the least money, and the reason a diversified creator survives the
     * event that ends a channel.
     */
    id: "content-newsletter",
    tab: "market",
    label: "Start the newsletter",
    signal: "Slow. Nobody can take it from you.",
    detail: "Email addresses, in a list, that you own. It grows slower than everything else.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "content-newsletter",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "energy", amount: -6 },
            { stat: "churn_pt", amount: -2 },
            { stat: "csat", amount: 1 },
            { stat: "brand", amount: 1 },
          ],
          setFlags: ["owned_audience"],
        },
        "You start a list. It is the least exciting thing you will build and the only one you own.",
      ),
  },
  {
    /**
     * Borrowed reach, and the variance is the honest part: their audience either
     * transfers or watches one video and leaves, and which of those happens is
     * not something either of you controls. Rolled explicitly rather than left
     * to the luck band, because the spread between a dud and a hit collab is far
     * wider than the band models.
     */
    id: "content-collab",
    tab: "market",
    label: "Collab with a bigger creator",
    signal: "Their audience. Their terms.",
    detail: "A bigger channel, their schedule, their edit, their idea of what your series is.",
    apply: (s) => {
      const roll = runRng(s.seed, s.year, s.month, hashString("content-collab"))();
      if (roll < 0.35) {
        spend(
          s,
          "content-collab",
          {
            effects: [
              { stat: "energy", amount: -10 },
              { stat: "brand", amount: 1 },
              { stat: "ctr_pt", amount: 1 },
            ],
          },
          "Their audience watches once and goes back to them. You spent the week.",
        );
        return;
      }
      if (roll < 0.85) {
        spend(
          s,
          "content-collab",
          {
            effects: [
              { stat: "energy", amount: -10 },
              { stat: "brand", amount: 5 },
              { stat: "ctr_pt", amount: 3 },
              { stat: "csat", amount: -1 },
              { stat: "rev_pct", amount: 9, durationQ: 2 },
            ],
          },
          "Some of their audience stays. Your own audience mentions that you sounded different.",
        );
        return;
      }
      spend(
        s,
        "content-collab",
        {
          effects: [
            { stat: "energy", amount: -10 },
            { stat: "brand", amount: 10 },
            { stat: "ctr_pt", amount: 6 },
            { stat: "csat", amount: -2 },
            { stat: "rev_pct", amount: 18, durationQ: 3 },
          ],
        },
        "It travels. For a quarter you are the channel people found through someone else.",
      );
    },
  },
  {
    /**
     * Cadence sustainability, bought as payroll instead of as energy. The burn
     * never goes away and the debt discount is a multiplier, not an amnesty:
     * an editor cuts faster than you, and cannot decide what the series is.
     */
    id: "content-hire-editor",
    tab: "team",
    label: "Hire an editor",
    signal: "Faster output. Less of you in it.",
    detail: "Somebody else in the timeline. The turnaround halves and the voice drifts.",
    apply: (s) =>
      spend(
        s,
        "content-hire-editor",
        {
          effects: [
            { stat: "burn_S_mo", amount: 0.3 },
            { stat: "emp", amount: 1 },
            { stat: "energy", amount: 9 },
            { stat: "qual", amount: 2 },
            { stat: "brand", amount: -1 },
          ],
          setFlags: ["editor_hired"],
        },
        "You hand over the timeline. The output speeds up and starts sounding like a channel.",
      ),
  },
  {
    /**
     * Cheap, loud, and it mortgages the newest series: the trend hands you a
     * distribution position the series did not earn, and the leak collects on
     * that for the rest of its life. Marked in `meta` on the newest live series,
     * since that is the one a trend actually gets attached to.
     */
    id: "content-chase-trend",
    tab: "product",
    label: "Chase a trend",
    signal: "Might spike. Might age badly in a week.",
    detail: "You make the thing everyone is making, while everyone is still making it.",
    costS: 0.5,
    apply: (s) => {
      const newest = [...liveItems(ensurePortfolio(s))].sort(
        (a, b) => b.launchedYear - a.launchedYear || b.launchedQuarter - a.launchedQuarter,
      )[0];
      if (newest) newest.meta.trendChase = true;

      const roll = runRng(s.seed, s.year, s.month, hashString("content-chase-trend"))();
      if (roll < 0.55) {
        spend(
          s,
          "content-chase-trend",
          {
            effects: [
              { stat: "cash_S", amount: -0.5 },
              { stat: "energy", amount: -6 },
              { stat: "ctr_pt", amount: 2 },
            ],
          },
          "You post it two days after the trend turned. It reads as late, because it is.",
        );
        return;
      }
      spend(
        s,
        "content-chase-trend",
        {
          effects: [
            { stat: "cash_S", amount: -0.5 },
            { stat: "energy", amount: -6 },
            { stat: "ctr_pt", amount: 5 },
            { stat: "brand", amount: 2 },
            { stat: "rev_pct", amount: 22, durationQ: 1 },
          ],
        },
        "It catches. For three weeks you are the channel that did the thing, and then you are not.",
      );
    },
  },
];

export default SPEC;
