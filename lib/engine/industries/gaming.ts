import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Rng } from "../rng";
import type { Activity } from "../activities";
import { spend } from "../activities";
import {
  priceRatio,
  elasticityBand,
  ensurePortfolio,
  liveItems,
  retireItem,
  refreshItem,
} from "../portfolio";
import { applyOutcome } from "../effects";
import { refreshBooks } from "../sim";
import { makeLine } from "../log";
import { hashString, runRng } from "../rng";

/**
 * 06 · GAMING — the revenue-model lens.
 *
 * Addendum A appendix §06. Paid tier, multiple 7 — the second-highest in the
 * game — and a Q4-loaded season curve, because the holidays are when titles are
 * bought and when they are played.
 *
 * ── Signature mechanic · THE MONETIZATION CHOICE ────────────────────────────
 *
 * FOOD loses money because it makes too much of a thing. GAMING loses money
 * because it reaches people it never charges. The demand unit here is PLAYERS,
 * not purchasers, and the whole industry is the gap between the two.
 *
 * At greenlight a title picks its revenue model and the two have opposite
 * cash-flow shapes, which the leak expresses directly:
 *
 *   PREMIUM — one payment, taken at the till. Almost everyone who decides to buy
 *   does pay you, so the leak starts low. It then CLIMBS with age, because a
 *   back-catalogue title only moves at a discount and the discount price is the
 *   one you are actually paid. A premium title is a spike.
 *
 *   FREE-TO-PLAY — the leak starts enormous, because the overwhelming majority
 *   of players never spend anything, and that is the model rather than a fault.
 *   It FALLS as the title matures, but only while you keep shipping: a fed title
 *   has a current season instead of a back catalogue, so `ship_update` resets its
 *   lifecycle as well as its conversion. An F2P title is an annuity you have to
 *   keep feeding, and the feeding never gets cheaper.
 *
 * The player never sees either curve coming. They see a title that made a
 * fortune in year one and nothing after, sitting next to a title that looked
 * like a failure for two years and then paid the rent for eight.
 *
 * Teaches: revenue-model design, lifetime value against upfront revenue, and the
 * real cost of live service.
 *
 * ── Signature failure · THE LIVE-SERVICE TREADMILL ──────────────────────────
 *
 * Feeding is studio-wide, because your live-ops team is one team. Every extra
 * live-service title thins it, so the third simultaneous live service is not a
 * third more work — it is the reason none of them get fed. A title nobody has
 * updated stops converting, and the lapse compounds: the players who were paying
 * were paying for new things. This is the most common real failure in the games
 * industry and it lands squarely on the portfolio cap.
 *
 * ── Ethics guard (Brand Law 4, appendix §06) ────────────────────────────────
 *
 * F2P revenue in this lens is cosmetics and a seasonal pass. Nothing here models
 * or rewards loot boxes, pay-to-win, or whale extraction, in fiction or out of
 * it. `battle_pass` sells a schedule of cosmetic content at a known price; it
 * never sells an advantage, and the burn it adds is the promise you now owe.
 *
 * ── meta keys this lens writes ──────────────────────────────────────────────
 *
 *   model    "premium" | "f2p"  — set at greenlight. Read defensively: titles
 *                                launched before this key fall back to tags,
 *                                then to price.
 *   fedYear  number             — fiscal year this title last got an update.
 *   pass     boolean            — a seasonal pass is attached.
 *   dlc      boolean            — an expansion sells to the existing audience.
 *   tested   boolean            — playtested before it shipped.
 *   delayed  boolean            — held back a quarter to finish it.
 */

const GAMING_TAGS = ["premium", "f2p", "mobile", "pc", "multiplayer", "dlc"];

type Model = "premium" | "f2p";

/**
 * The one per-item choice this lens needs and FOOD does not have. Items may
 * predate the key, so this never assumes it is there: the launch tags carry the
 * same information, and failing both, a title priced near the floor was never a
 * boxed product.
 */
function modelOf(item: LineItem): Model {
  const declared = item.meta.model;
  if (declared === "f2p" || declared === "premium") return declared;
  if (item.tags.includes("f2p")) return "f2p";
  if (item.tags.includes("premium")) return "premium";
  return item.price < 8 ? "f2p" : "premium";
}

/** Every live title the studio has taken on an obligation to keep updating. */
function liveService(state: RunState): LineItem[] {
  return liveItems(ensurePortfolio(state)).filter((i) => modelOf(i) === "f2p");
}

function unconverted(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  const age = Math.max(0, state.year - item.launchedYear);
  const band = elasticityBand(priceRatio(item, state, spec));
  let lost: number;
  // Nothing you do gets everybody to pay. The store takes its cut and somebody
  // always refunds, so each model keeps a floor under it no matter how well the
  // rest of the run is going.
  let floor: number;

  if (modelOf(item) === "premium") {
    // One transaction, at the store, at the sticker price. The floor is the
    // platform's cut and the refund window, and neither is negotiable.
    lost = 0.12;
    floor = 0.05;

    // Nobody argues with a price they think is too high. They wishlist it and
    // wait for the sale — and the sale price is the revenue you actually book.
    if (band === "greedy") lost += 0.2;
    else if (band === "rich") lost += 0.08;

    // Front-loaded by construction. Units decay through the shared lifecycle
    // curve; realised revenue per copy decays on top of that, because after the
    // launch window the only copies moving are discounted ones.
    lost += 0.05 * age;

    // Refunds are what shipping broken costs. Two hours of play is all it takes.
    lost += Math.min(0.1, 0.015 * state.stats.tdebt);
    // A frictionless refund button is one click away on desktop storefronts.
    if (item.tags.includes("pc")) lost += 0.03;
    // A title held back to be finished comes back with fewer refunds.
    if (item.meta.delayed === true) lost -= 0.04;

    // Production values are what stop the refund before it starts.
    lost -= 0.02 * item.investTier;
  } else {
    // Free to start. Most of the audience will never spend a cent, and that is
    // the model working, not the model failing. The number under management is
    // the share who do spend, and it starts small.
    lost = 0.46;
    // Even a beloved, perfectly fed live service converts a minority. Any lens
    // that lets this approach zero has quietly turned F2P into premium.
    floor = 0.14;

    // A paying cohort is built rather than bought: each year the title survives,
    // more of the audience has a reason to spend. This is the back-loading.
    lost -= Math.min(0.18, 0.06 * age);

    // THE TREADMILL. Stop shipping and conversion stops, then keeps stopping —
    // the players who were paying were paying for what comes next.
    const fed = Number(item.meta.fedYear ?? item.launchedYear);
    const stale = Math.max(0, state.year - fed);
    lost += Math.min(0.22, 0.09 * stale);

    // One live-ops team, divided by every live title you own. This is where the
    // portfolio cap stops being a game limit and starts being the lesson.
    lost += 0.05 * Math.max(0, liveService(state).length - 1);

    // A seasonal pass is the whole point of a seasonal pass: it converts a known
    // share of the audience on a schedule instead of hoping they wander in.
    if (state.flags.battle_pass || item.meta.pass === true) lost -= 0.1;

    // Cosmetics sell on how the game looks. Cheap art sells no cosmetics.
    lost -= 0.04 * item.investTier;

    // An empty lobby converts nobody. Multiplayer needs a population before it
    // needs a storefront, and a title nobody is updating loses its population.
    if (item.tags.includes("multiplayer") && stale > 0) lost += 0.06;

    // Mobile stores take more and the audience spends less per head.
    if (item.tags.includes("mobile")) lost += 0.05;
  }

  // An expansion sells to people who already bought once and already love it.
  // Nothing anywhere in this industry has a cheaper funnel.
  if (item.tags.includes("dlc") || item.meta.dlc === true) lost -= 0.08;

  // Word of mouth is the only conversion tool you do not pay for.
  lost -= (0.16 * (state.stats.csat - 55)) / 100;

  // Playtesting does not raise the average outcome. It finds the disasters early
  // and cuts the tails off the distribution. That is what insurance is, and it
  // is exactly why nobody buys it.
  const spread = item.meta.tested === true ? 0.03 : 0.1;
  lost += (rng() - 0.5) * spread;

  return Math.max(floor, lost);
}

export const SPEC: IndustrySpec = {
  code: "GAMING",
  noun: "Title",
  nounPlural: "Titles",
  demandUnit: "players",
  reportLabel: "THE PORTFOLIO",
  // The appendix band verbatim: free at the bottom, seventy at the top, whole
  // dollars in between. A price of zero books no revenue under the shared
  // formula — see `notes`, the launch sheet has to say what this field means.
  priceMin: 0,
  priceMax: 70,
  priceStep: 1,
  baselinePrice: 30,
  // A digital title has no seating and no shelf, so units run above FOOD's
  // covers — but not wildly, because a premium title only ever converts the
  // slice of its audience that pays at launch price, and the leak below takes a
  // far larger bite than spoilage does.
  baseUnits: 2400,
  // Far above FOOD's 62. There is no ingredient cost here: the money went out
  // the door at greenlight as development cash, not per player. That is why a
  // games studio can post a fat gross margin and still miss payroll.
  //
  // Set deliberately where it bites. A premium title built properly and priced
  // near its worth clears this; a cheap build at the same price does not, and no
  // free-to-play title ever does, because it carries a whole free audience at
  // real per-player cost. The margin gate is the industry's own verdict on which
  // of those three things you actually made.
  baselineGmPt: 80,
  tags: GAMING_TAGS,
  namePlaceholder: "Kessler Drift",
  leakLabel: "Unconverted players",
  // Higher than any other lens should need. Half an audience never paying you is
  // an ordinary Tuesday in free-to-play, not a catastrophe.
  leakMax: 0.55,
  investTiers: [
    // Roughly double FOOD's ladder. A title is a multi-year capital project, not
    // a recipe, and the cash goes out before a single player exists. costMult is
    // per-player running cost: a cheap build ships unoptimised and then bills you
    // for bandwidth and support tickets every month it stays up.
    { label: "Small team, tight scope", costS: 1, costMult: 0.55, valueMult: 0.78 },
    { label: "Do it properly", costS: 2.5, costMult: 0.34, valueMult: 1.0 },
    { label: "Go all out", costS: 5, costMult: 0.28, valueMult: 1.3 },
  ],
  launchChoice: {
    metaKey: "model",
    label: "How does it make money?",
    options: [
      { value: "premium", label: "Paid once, up front" },
      { value: "f2p", label: "Free, and you keep feeding it" },
    ],
    defaultIndex: 0,
  },
  signatureLeak: (item, state, rng, spec) => unconverted(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * `activities.ts` keeps its `spend` helper private, so it is restated here
 * rather than exported from under the engine. Same contract: seeded rng, one
 * `applyOutcome`, books refreshed, one log line. Nothing below advances time.
 */

/** Titles greenlit but not yet earning — the only ones still worth testing. */
const inDevelopment = (state: RunState): LineItem[] =>
  ensurePortfolio(state).items.filter((i) => i.state === "development");

export const ACTIVITIES: Activity[] = [
  {
    /**
     * The launch flow, not a stat move. Naming the title and choosing how it
     * makes money are player inputs, so this entry exists to be intercepted by
     * the launch sheet — see `notes`. `apply` deliberately changes nothing: an
     * activity cannot invent a name, and a placeholder name would throw away the
     * one field in the whole subsystem that is authored by the player.
     */
    id: "gaming-greenlight",
    tab: "product",
    label: "Greenlight a title",
    signal: "Name it. Pick how it makes money.",
    detail:
      "Premium or free to play. One is a spike, the other is an annuity you have to feed, and you pick before you know which you can afford.",
    apply: (s) =>
      spend(
        s,
        "gaming-greenlight",
        {},
        "Nothing ships until it has a name, a price, and a way of making money.",
      ),
  },
  {
    /**
     * The unglamorous one, and the load-bearing one. Two things happen here and
     * both are the annuity: the title's conversion stops lapsing (`fedYear`), and
     * its lifecycle clock resets, because a live service that keeps shipping does
     * not have a back catalogue — it has a current season. That is the whole
     * difference in shape between an annuity and a spike.
     *
     * Feeding is studio-wide because your live-ops team is one team. The cash is
     * flat and visible; the ENERGY is what scales with how many titles you have
     * promised to keep alive, which is the honest version of the treadmill. Three
     * live services do not cost three times the money. They cost you.
     *
     * `refreshItem` is called at zero cost because the cash is charged through
     * the effects below, where it routes through luck and lands in the log with
     * everything else.
     */
    id: "gaming-ship-update",
    tab: "product",
    label: "Ship a content update",
    signal: "Keeps the lights on. Never ends.",
    detail:
      "A season of content across every live title you run. The work does not end. That is what live service means.",
    costS: 1,
    available: (s) => liveService(s).length > 0,
    apply: (s) => {
      const fed = liveService(s);
      for (const item of fed) {
        // `fedYear` records that the content shipped, which it did. The lifecycle
        // reset is `refreshItem`'s own call: it declines titles that have not
        // launched yet and studios already in the red, and both of those are the
        // right answer.
        item.meta.fedYear = s.year;
        refreshItem(s, item.id, 0);
      }
      spend(
        s,
        "gaming-ship-update",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "energy", amount: -6 - 4 * Math.max(0, fed.length - 1) },
            { stat: "csat", amount: 3 },
            { stat: "morale", amount: -2 },
            { stat: "tdebt", amount: 1 },
          ],
        },
        "You ship the season on time. Nobody writes about a game that simply kept working.",
      );
    },
  },
  {
    /**
     * Smooths free-to-play revenue by converting on a schedule instead of on
     * hope — and the burn it adds never comes off, because a pass that skips a
     * season is worse than no pass at all. Cosmetic and seasonal only: this lens
     * does not sell an advantage, in fiction or otherwise.
     */
    id: "gaming-battle-pass",
    tab: "product",
    label: "Launch a battle pass",
    signal: "Predictable revenue. Predictable expectations.",
    detail:
      "A season of cosmetics at a known price, on a published date. Nothing in it makes anyone better at the game. The date is now a promise.",
    costS: 1,
    available: (s) => liveService(s).length > 0 && !s.flags.battle_pass,
    apply: (s) => {
      for (const item of liveService(s)) {
        item.meta.pass = true;
        item.meta.fedYear = s.year;
      }
      spend(
        s,
        "gaming-battle-pass",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "burn_S_mo", amount: 0.15 },
            { stat: "rev_pct", amount: 9, durationQ: 4 },
            { stat: "csat", amount: -2 },
          ],
          setFlags: ["battle_pass"],
        },
        "The pass goes live. Revenue gets a shape, and every season after this one is expected.",
      );
    },
  },
  {
    /**
     * Attaches to whichever title people actually love, because that is who
     * expansions sell to. No acquisition spend, no new slot, high margin — and
     * it pushes back the age term on a premium title that was starting to only
     * move at a discount.
     */
    id: "gaming-dlc",
    tab: "product",
    label: "Release DLC",
    signal: "Sells to people who already love it.",
    detail:
      "An expansion for your best title. You are not buying an audience here; you already have one, and it is waiting.",
    costS: 1.5,
    available: (s) => bestTitle(s) !== null,
    apply: (s) => {
      const item = bestTitle(s);
      if (!item) return;
      item.meta.dlc = true;
      spend(
        s,
        "gaming-dlc",
        {
          effects: [
            { stat: "cash_S", amount: -1.5 },
            { stat: "rev_pct", amount: 7, durationQ: 3 },
            { stat: "gm_pt", amount: 2 },
            { stat: "energy", amount: -4 },
          ],
        },
        `You build more ${item.name} for the people who already own it. They were always going to buy it.`,
      );
    },
  },
  {
    /**
     * The eternal decision, framed the way it actually is: a runway problem.
     * There is no `costS` here on purpose — a delay's bill does not arrive with
     * a price tag on it, it arrives as another quarter of payroll against no
     * revenue, which is precisely the thing studios keep failing to see coming.
     */
    id: "gaming-delay",
    tab: "product",
    label: "Delay the launch",
    signal: "Better game. Emptier bank account.",
    detail:
      "Another quarter in development. The team stops shipping something it is ashamed of and starts spending money it has not earned.",
    available: (s) => inDevelopment(s).length > 0,
    apply: (s) => {
      for (const item of inDevelopment(s)) item.meta.delayed = true;
      spend(
        s,
        "gaming-delay",
        {
          effects: [
            { stat: "cash_S", amount: -1.5 },
            { stat: "qual", amount: 6 },
            { stat: "tdebt", amount: -2 },
            { stat: "rev_pct", amount: -8, durationQ: 2 },
            { stat: "morale", amount: -3 },
          ],
        },
        "You move the date. The game gets better and the runway gets shorter, in that order.",
      );
    },
  },
  {
    /**
     * Same game, more players, and one more build to keep alive forever. The
     * tech debt is the honest part: every platform you add is another set of
     * certification requirements that never goes away.
     */
    id: "gaming-port",
    tab: "product",
    label: "Port to another platform",
    signal: "New players. Same game. More builds.",
    detail:
      "Another storefront, another certification process, another build to patch every time you fix anything.",
    costS: 3,
    apply: (s) =>
      spend(
        s,
        "gaming-port",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "rev_pct", amount: 14, durationQ: 6 },
            { stat: "tdebt", amount: 3 },
            { stat: "energy", amount: -5 },
            { stat: "gm_pt", amount: -1 },
          ],
          setFlags: ["ported"],
        },
        "The port ships. New players, the same game, and one more build you can never stop maintaining.",
      ),
  },
  {
    /**
     * The cheap insurance nobody buys, and it is built to look useless: it moves
     * almost nothing you can see. What it actually does is shrink the variance
     * band inside the leak, so a playtested title cannot surprise you as badly.
     * Only offered while something is still unshipped, because that is the whole
     * point of testing.
     */
    id: "gaming-playtest",
    tab: "product",
    label: "Run a playtest",
    signal: "Find out now instead of after.",
    detail:
      "Strangers play the unfinished thing in front of you. Everything they get stuck on, you already knew and had decided not to believe.",
    costS: 0.5,
    available: (s) => inDevelopment(s).length > 0,
    apply: (s) => {
      for (const item of inDevelopment(s)) item.meta.tested = true;
      spend(
        s,
        "gaming-playtest",
        {
          effects: [
            { stat: "cash_S", amount: -0.5 },
            { stat: "energy", amount: -3 },
            { stat: "tdebt", amount: -1 },
          ],
        },
        "You watch strangers play it. Nothing improves this week. The worst surprises are now behind you.",
      );
    },
  },
  {
    /**
     * Closing a live service is not the same as retiring a menu item, and the
     * cost is not financial. The brand hit scales with how much of the company
     * that title was carrying — sunset a rounding error and nobody notices;
     * sunset the thing people organised their evenings around and they will
     * write about it for a week.
     *
     * No burn effect here: `retireItem` already gives back the standing cost the
     * launch charged, and claiming a second reduction on the way out would be
     * inventing a saving the books never took.
     */
    id: "gaming-sunset",
    tab: "product",
    label: "Sunset a live title",
    signal: "Players will post about this.",
    detail:
      "You turn off the servers on the title that stopped paying for itself. The people still playing did not get a vote.",
    available: (s) => weakestLiveService(s) !== null,
    apply: (s) => {
      const item = weakestLiveService(s);
      if (!item) return;
      const loved = item.history.at(-1)?.share ?? 0;
      retireItem(s, item.id);
      spend(
        s,
        "gaming-sunset",
        {
          effects: [
            { stat: "brand", amount: -(3 + Math.round(loved * 0.25)) },
            { stat: "csat", amount: -(2 + Math.round(loved * 0.12)) },
            { stat: "morale", amount: -3 },
          ],
        },
        `You announce the last season of ${item.name}. The team that built it reads the replies too.`,
      );
    },
  },
];

/**
 * The title an expansion should attach to: the one earning the most, because
 * that is where the existing audience is. Falls back to nothing when there is no
 * closed year to rank on, so the activity is absent rather than arbitrary.
 */
function bestTitle(state: RunState): LineItem | null {
  const ranked = liveItems(ensurePortfolio(state))
    .filter((i) => i.history.length > 0)
    .sort((a, b) => (b.history.at(-1)?.revenue ?? 0) - (a.history.at(-1)?.revenue ?? 0));
  return ranked[0] ?? null;
}

/**
 * The live service earning least — the one a studio actually shuts down. Only
 * titles that have shipped are eligible: cancelling something nobody has played
 * yet is a different decision with a different cost, and it is not this one.
 */
function weakestLiveService(state: RunState): LineItem | null {
  const ranked = liveService(state)
    .filter((i) => i.state === "live" || i.state === "declining")
    .sort((a, b) => (a.history.at(-1)?.revenue ?? 0) - (b.history.at(-1)?.revenue ?? 0));
  return ranked[0] ?? null;
}

export default SPEC;
