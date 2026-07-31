import type { IndustrySpec, LineItem } from "../portfolio";
import type { RunState } from "../types";
import type { Activity } from "../activities";
import { spend } from "../activities";
import type { Rng } from "../rng";
import { S_UNIT } from "../constants";
import {
  clampPrice,
  earningItems,
  elasticityBand,
  ensurePortfolio,
  launchItem,
  liveItems,
  portfolioCap,
  priceRatio,
} from "../portfolio";
import { deriveRunwayMonths } from "../sim";
import { hashString, runRng } from "../rng";
import { assetById, buyAsset } from "../holdings";

/**
 * 02 · E-COMMERCE / RETAIL — the working-capital lens.
 *
 * Modelled on food.ts, which is the reference. Everything shared lives in
 * portfolio.ts; the only genuinely bespoke thing here is the leak below.
 *
 * ── Signature mechanic · INVENTORY & THE STOCKOUT/OVERSTOCK VICE ────────────
 *
 * FOOD loses money because demand is unpredictable and prep goes in the bin.
 * That is a per-item, one-sided, same-week problem. This is a different animal
 * and must stay one: here the money left your account MONTHS before the
 * customer showed up, and it is sitting in a box on a shelf. The loss is not
 * caused by unpredictability — it is caused by a COMMITMENT made before the
 * information arrived, and it hurts in both directions for different reasons:
 *
 *   Ordered too little → you sell out mid-season. The orders you could not
 *   fill are gone, and they are worst exactly when demand is best, which is
 *   why underpricing is lethal here rather than merely careless.
 *
 *   Ordered too much → the cash is frozen. It does not appear in `cash`, it
 *   does not appear in burn, and the only way out is a markdown. Apparel goes
 *   stale, a kettle does not; that asymmetry is the whole buying discipline.
 *
 * Two things make it structurally unlike spoilage. First, every SKU draws on
 * ONE pool of working capital, so a wide catalog starves each listing of depth
 * and the ordering error grows with the catalog rather than staying per-item.
 * Second, a short runway causes its own stockouts — you skip the reorder you
 * cannot fund, lose the orders, and shorten the runway again. That is the loop
 * that kills companies with a profitable P&L, and it is the reason this lens
 * exists.
 *
 * Riding on top is the signature failure, THE RETURNS SPIRAL: a return costs
 * you twice, once for the refund and once for a unit that comes back
 * unsellable, so the term is scaled by the cost share of a unit and grows with
 * the stage. The better you sell, the faster a bad return rate takes you down.
 *
 * Teaches: working capital, the cash-conversion cycle, and why profitable
 * companies go bankrupt.
 *
 * `reorder` buys cover and freezes cash. `liquidate` unfreezes it at a
 * humiliating rate. `bundle` moves dead stock at the cost of the live SKU it
 * rides on. None of them tell you which side of the vice you are on — the
 * year-end report does, after the fact.
 */

const ECOM_TAGS = ["apparel", "hardgood", "consumable", "giftable", "bundle", "clearance"];

/**
 * The cost share of a unit, mirroring portfolio.ts's `unitCost` basis
 * (`baselinePrice * 0.42 * costMult`). Used to price the second half of a
 * return: the refund is the revenue, the unsellable unit is the cost.
 *
 * Only part of what comes back is a write-off — a sealed box goes back on the
 * shelf, a worn garment does not — so the second bite is a share of the cost
 * rather than all of it. Overstating this would make returns, not buying, the
 * dominant lesson of the lens.
 */
const COGS_SHARE = 0.42;
const RETURN_WRITE_OFF = 0.55;

/**
 * Months of stock a launch buys, by tier. A small first order is thin cover; a
 * volume commitment is a third of a year of it. The middle rung sits close to
 * what an average SKU at an average brand actually needs — being roughly right
 * has to be reachable, or the lens is a tax rather than a decision.
 */
const TIER_COVER = [2, 2.5, 4];

/**
 * Months of cover on hand. `meta.coverMonths` is written by the reorder,
 * liquidate and bundle activities; SKUs launched before that key existed fall
 * back to what their investment tier implicitly bought, per the appendix.
 */
function coverMonths(item: LineItem): number {
  const raw = Number(item.meta.coverMonths);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(18, raw);
  return TIER_COVER[item.investTier] ?? TIER_COVER[1];
}

/**
 * Cash sunk into that stock, in S units. This is the number liquidation pays a
 * fraction of, so it has to exist for every SKU: an item with no key spent its
 * launch tier on its first order, because that is what the tier was.
 */
function stockS(item: LineItem, spec: IndustrySpec): number {
  const raw = Number(item.meta.stockS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return spec.investTiers[item.investTier]?.costS ?? spec.investTiers[1].costS;
}

function inventoryVice(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number {
  const catalog = liveItems(ensurePortfolio(state)).length;
  const band = elasticityBand(priceRatio(item, state, spec));

  // ── What the year is about to ask of this SKU ──────────────────────────
  // The player never sees this. It is the same pull the yearly tick uses, in
  // months-of-demand rather than units, because months are what a buyer
  // actually orders against.
  let pull = 0.8 + 0.5 * (state.stats.brand / 100) + 0.3 * (state.stats.ctrPt / 100);
  // Priced under what people think it is worth, it walks off the shelf. In FOOD
  // that only makes demand erratic; here it empties the warehouse.
  if (band === "underpriced") pull += 0.45;
  else if (band === "sweet") pull += 0.15;
  // A Q4 push is an amplifier, not a gift: it multiplies whatever ordering
  // mistake you already made. Year-scoped so last year's push is not still
  // inflating this year's demand.
  if (state.flags[`q4_push_y${state.year}`]) pull += 0.35;

  // Calibrated so a proper opening run is roughly right for a fairly-priced SKU
  // at a modest brand. Being roughly right is the best case; the player is never
  // told they hit it.
  const needed = 2.3 * pull;
  const onHand = coverMonths(item);

  // ── The loop that kills profitable companies ───────────────────────────
  // Short on cash, you skip the reorder you were supposed to place mid-season,
  // so the cover you are actually trading on is less than the cover you bought.
  // Skipping it costs you orders, losing orders shortens the runway, and nothing
  // about it shows up as a loss anywhere the player can see until half the
  // catalog page says out of stock.
  const runway = deriveRunwayMonths(state);
  const unfunded =
    Number.isFinite(runway) && runway < 8 ? ((8 - Math.max(0, runway)) / 8) * 1.5 : 0;
  const effective = onHand - unfunded;

  // Supplier loyalty is lead time in disguise. A supplier who likes you lets
  // you chase a hit mid-season and cancel the back half of a dud, which shrinks
  // the error on BOTH sides. One who does not makes every order final.
  const rigid = 1 - 0.06 * state.stats.suploy;

  // One position, one sign. You are either short of the season or long of it —
  // and running out of cash is the same disease as being long, so it eats the
  // excess before it starts costing you orders.
  const short = Math.max(0, needed - effective) * rigid;
  const excess = Math.max(0, effective - needed) * rigid;

  // Fraction of the selling season spent out of stock ≈ fraction of gross lost.
  // Not all of it: some customers wait, and a backorder is not a dead order.
  const stockout = Math.min(0.22, (short / needed) * 0.85);

  // ── The other side: what the markdown costs to unfreeze ────────────────
  // Excess cover only hurts as much as the discount needed to move it, and that
  // depends entirely on what the thing is.
  let markdown = 0.3;
  if (item.tags.includes("apparel")) markdown += 0.12; // sizes and seasons go stale
  if (item.tags.includes("consumable")) markdown += 0.06; // dated stock has a clock
  if (item.tags.includes("clearance")) markdown += 0.08; // already the discount bin
  if (item.tags.includes("hardgood")) markdown -= 0.1; // a kettle keeps
  if (item.state === "declining") markdown += 0.1; // nobody wants last year's
  // Own the shelf and you can hold stock into the next season instead of
  // dumping it into this one. That is what the warehouse is actually for.
  if (state.flags.own_warehouse) markdown -= 0.1;
  const overstock = Math.min(0.18, (excess / needed) * Math.max(0.08, markdown));

  // Gift demand is compressed into a few weeks. It does not make you order
  // wrong; it makes being wrong cost more, because there is no February in
  // which to recover. Deliberately an amplifier on an existing error rather
  // than a level: a tag that raises the leak on a well-bought SKU would just be
  // a fine for picking it.
  const concentration = item.tags.includes("giftable") ? 1.35 : 1;

  // ── One cash pool, many listings ───────────────────────────────────────
  // The working-capital point, stated mechanically: every extra live SKU is
  // another claim on the same money, so you cannot fund the right depth
  // everywhere and the ordering error scales with the catalog.
  const ordering =
    (stockout + overstock) * concentration * (1 + 0.06 * Math.max(0, catalog - 3));

  // ── The returns spiral ─────────────────────────────────────────────────
  // Apparel is the outlier and it is not close: people buy two sizes on purpose.
  // It is the one tag whose returns are structural rather than earned, which is
  // what the listing, the carrier and the warehouse are there to claw back.
  let returns = item.tags.includes("apparel") ? 0.11 : 0.04;
  if (item.tags.includes("hardgood")) returns += 0.015; // freight damage
  const ratio = priceRatio(item, state, spec);
  // The real driver: the gap between what you charged and what it turned out to
  // be worth in the customer's hands. They do not argue, they ship it back.
  if (ratio > 1) returns += Math.min(0.12, (ratio - 1) * 0.16);
  returns += 0.04 * (1 - state.stats.qual / 100);
  returns -= 0.04 * (state.stats.csat / 100);
  if (state.flags.listing_improved) returns -= 0.03; // accurate copy, fewer surprises
  if (state.flags.ship_fast) returns -= 0.02; // it arrived before they cooled on it
  if (state.flags.own_warehouse) returns -= 0.01; // your own pick and pack
  returns = Math.max(0.01, returns);
  // Twice: the refund gives back the revenue, and most of the unit comes back in
  // no state to sell again. Then it compounds with volume, which is why a
  // scaling company with a return problem dies faster the better it sells.
  const returnsLoss =
    returns * (1 + COGS_SHARE * RETURN_WRITE_OFF) * (1 + 0.1 * (state.stage - 1));

  // Freight, a damaged pallet, a carrier that missed a week.
  const variance = (rng() - 0.5) * 0.04;

  // Which side of the vice this was, so the year-end report can name it instead
  // of reporting a bare percentage. Same pattern as `meta.lastCulprit` in
  // portfolio.ts: written as the year closes, never read before it does.
  item.meta.leakSide = stockout >= overstock ? "stockout" : "overstock";

  return Math.max(0, ordering + returnsLoss + variance);
}

export const SPEC: IndustrySpec = {
  code: "ECOM",
  noun: "SKU",
  nounPlural: "SKUs",
  demandUnit: "orders",
  reportLabel: "THE CATALOG",
  priceMin: 5,
  priceMax: 300,
  priceStep: 1,
  // A far wider band than FOOD's, on a higher anchor. $32 is a plausible median
  // order for a small store and it sets the unit cost basis the shared engine
  // derives from it, which is what makes the bottom of the band a genuine trap:
  // there is no profitable five-dollar SKU in a business built to ship
  // thirty-dollar ones.
  baselinePrice: 32,
  // Orders, not covers. Fewer transactions than a restaurant, each worth more.
  baseUnits: 2000,
  // Deliberately well below FOOD's 62. Goods retail runs thin, and the shared
  // unit cost basis plus a typical leak lands a well-bought SKU only a little
  // above this — a "hit" verdict here has to be earned in the buying, not the
  // pricing.
  baselineGmPt: 44,
  tags: ECOM_TAGS,
  namePlaceholder: "Everyday Canvas Tote",
  leakLabel: "Inventory",
  // Higher than FOOD's ceiling. Spoilage is a bad week; a buying mistake is a
  // year of frozen cash plus a return rate you cannot outrun.
  leakMax: 0.34,
  investTiers: [
    // The tier IS the opening order. Small orders get no volume break, which is
    // why the cheap option costs more per unit than the expensive one.
    { label: "Small first order", costS: 0.5, costMult: 1.22, valueMult: 0.84 },
    { label: "Order a proper run", costS: 1.5, costMult: 1.0, valueMult: 1.0 },
    { label: "Commit to volume", costS: 3, costMult: 0.84, valueMult: 1.18 },
  ],
  launchChoice: {
    metaKey: "coverMonths",
    label: "How deep is the opening order?",
    options: [
      { value: 1.6, label: "Thin cover" },
      { value: 2.5, label: "A normal opening order" },
      { value: 4.5, label: "Buy the season" },
    ],
    defaultIndex: 1,
  },
  signatureLeak: (item, state, rng, spec) => inventoryVice(item, state, rng, spec),
};

// ── Activities ──────────────────────────────────────────────────────────────

/**
 * Spread a purchase order across the live catalog. `skuMonths` is the total
 * cover bought, divided by however many listings you are carrying — the same
 * pool, split more ways. Six SKUs get a third of the depth two SKUs would.
 */
function spreadOrder(state: RunState, skuMonths: number, cashS: number): number {
  const live = liveItems(ensurePortfolio(state));
  if (live.length === 0) return 0;
  const months = skuMonths / live.length;
  const cash = cashS / live.length;
  for (const it of live) {
    it.meta.coverMonths = Math.min(18, coverMonths(it) + months);
    it.meta.stockS = stockS(it, SPEC) + cash;
  }
  return live.length;
}

/**
 * Stock that is not moving: past its peak, or sitting on months of depth after
 * having had a full year to sell. The closed-year test is what stops this from
 * meaning "everything you just ordered" — a jobber sale is for aged stock, and a
 * SKU that has not had a season yet has not failed at anything.
 *
 * Deliberately a flat threshold rather than a comparison against the season's
 * real need. Need is a forecast and the player does not get one; boxes on a
 * shelf are something a founder can walk out and count.
 */
const isSlow = (item: LineItem): boolean =>
  item.state === "declining" || (item.history.length > 0 && coverMonths(item) >= 4);

export const ACTIVITIES: Activity[] = [
  // ── Product ───────────────────────────────────────────────────────────
  {
    /**
     * The launch flow proper (§6) belongs to the product sheet: the name, the
     * price and the tier are the player's three taps, and `launchItem` moves the
     * cash when they commit. This activity only opens the door, so it carries no
     * `costS` — charging here and again at commit would bill the same order
     * twice.
     */
    id: "ecom-list-sku",
    tab: "product",
    label: "List a new SKU",
    signal: "Name it, price it, order stock.",
    detail:
      "A listing, a price you pick with no forecast in front of you, and an order quantity you pay for before anyone has bought one.",
    available: (s) => liveItems(ensurePortfolio(s)).length < portfolioCap(s),
    apply: (s) =>
      spend(
        s,
        "ecom-list-sku",
        { setFlags: ["launch_sheet_open"] },
        "You start a new listing. Nothing is committed until you name it and set a price.",
      ),
  },
  {
    /**
     * The core working-capital decision, split into two rungs because an
     * activity takes no input and the quantity is the entire point. The player
     * picks depth with no demand forecast shown, which is exactly the real
     * buying decision: you commit cash in month one against a season you cannot
     * see.
     *
     * Priced off the same basis as the tiers — a proper opening run buys about
     * two SKU-months per S — so a reorder cannot be cheaper stock than a launch
     * was. The deep rung gets a small volume break, and the volume break is the
     * bait.
     */
    id: "ecom-reorder-lean",
    tab: "product",
    label: "Reorder lean",
    signal: "Cash now, orders later. Guess how many.",
    detail:
      "A small purchase order across the catalog. Less cash on the shelf, less cover if the season runs hot.",
    costS: 1,
    apply: (s) => {
      const n = spreadOrder(s, 2, 1);
      if (n === 0) return;
      spend(
        s,
        "ecom-reorder-lean",
        { effects: [{ stat: "cash_S", amount: -1 }], setFlags: ["reordered"] },
        "You place a small order. The money is gone today; the orders it serves have not arrived yet.",
      );
    },
  },
  {
    id: "ecom-reorder-deep",
    tab: "product",
    label: "Reorder deep",
    signal: "A deeper shelf. The cash goes in the box with it.",
    detail:
      "A full purchase order. Better per-unit terms, and a large part of your cash stops being cash until someone buys it back.",
    costS: 3,
    apply: (s) => {
      const n = spreadOrder(s, 7, 3);
      if (n === 0) return;
      spend(
        s,
        "ecom-reorder-deep",
        { effects: [{ stat: "cash_S", amount: -3 }], setFlags: ["reordered"] },
        "You buy the volume break. The shelf is full and the bank balance is not.",
      );
    },
  },
  {
    /**
     * The correct move that always feels like failure. Recovering thirty-odd
     * cents on the dollar is a loss you have to book out loud, which is why real
     * founders sit on dead stock for a year first — and why the activity exists.
     */
    id: "ecom-liquidate",
    tab: "product",
    label: "Liquidate slow stock",
    signal: "Cash back. Pennies on the dollar.",
    detail:
      "A jobber takes the dead stock off your hands at a price you will not enjoy. The shelf clears and the cash comes home.",
    available: (s) => liveItems(ensurePortfolio(s)).some(isSlow),
    apply: (s) => {
      const slow = liveItems(ensurePortfolio(s)).filter(isSlow);
      if (slow.length === 0) return;
      const rng = runRng(s.seed, s.year, s.month, hashString("ecom-liquidate"));
      // 30–40% of what you paid. The rest is the price of having been wrong.
      const rate = 0.3 + rng() * 0.1;
      let recovered = 0;
      for (const it of slow) {
        const sunk = stockS(it, SPEC);
        recovered += sunk * rate;
        // The stock leaves. What is left is the trickle you keep listed.
        it.meta.stockS = sunk * 0.15;
        it.meta.coverMonths = Math.min(coverMonths(it), 0.5);
      }
      spend(
        s,
        "ecom-liquidate",
        {
          effects: [
            { stat: "cash_S", amount: recovered },
            { stat: "gm_pt", amount: -3 },
            { stat: "brand", amount: -2 },
          ],
          setFlags: ["stock_liquidated"],
        },
        "You sell the dead stock to a jobber. The cash is real and so is what it says about the buy.",
      );
    },
  },
  {
    /**
     * Bundling is the only way to move dead stock at something like full price,
     * and it works by spending the good SKU's pricing power to do it. The
     * derived listing carries the slow parent's tags on purpose: the shared
     * cannibalization in portfolio.ts then reads them as the same shelf and
     * takes the slow parent's remaining orders, which is the intent — you are
     * replacing it, not adding to it.
     *
     * Which two get bundled is the best-seller and the worst, because that is
     * what the move is for. When the product sheet can take a selection, the
     * pair should be the player's.
     *
     * On the price: NOT a discount off the sum of the two. The shared
     * `perceivedValue` is anchored to one item at the industry's baseline, so any
     * two-item price reads as greedy to the elasticity model and the bundle
     * launches dead. It is priced at what the good one costs on its own, which is
     * both what makes it move and what real retail actually does when it needs a
     * shelf cleared — the dead one rides along, and giving it away is the cost.
     */
    id: "ecom-bundle",
    tab: "product",
    label: "Bundle two SKUs",
    signal: "Moves the slow one. Cheapens the fast one.",
    detail:
      "One box, two products, one price far under the sum. The slow one finally ships and the fast one stops being worth what it was.",
    costS: 1.5,
    available: (s) => {
      const p = ensurePortfolio(s);
      if (earningItems(p).length < 2 || liveItems(p).length >= portfolioCap(s)) return false;
      // The listing is charged at launch, so do not offer a move that will fail
      // silently on cash.
      return s.stats.cash >= SPEC.investTiers[1].costS * S_UNIT[s.stage];
    },
    apply: (s) => {
      const p = ensurePortfolio(s);
      const ranked = earningItems(p)
        .map((i) => ({ i, u: i.history.at(-1)?.units ?? 0 }))
        .sort((a, b) => b.u - a.u);
      const fast = ranked[0]?.i;
      const slow = ranked[ranked.length - 1]?.i;
      if (!fast || !slow || fast.id === slow.id) return;

      const price = clampPrice(fast.price, SPEC);
      // The stock does not multiply — it moves, and only as much of it as one
      // listing can plausibly ship. A SKU buried under nine months of cover does
      // not get rescued by a box: the remainder stays where it is, and what is
      // left behind is a liquidation decision the player now has to make.
      const moved = Math.min(coverMonths(slow), 3);
      const kept = Math.max(0, coverMonths(slow) - moved);
      const sunk = stockS(slow, SPEC);
      const movedShare = coverMonths(slow) > 0 ? moved / coverMonths(slow) : 1;
      const created = launchItem(s, SPEC, {
        name: `${fast.name} + ${slow.name}`,
        price,
        // No new stock is bought here — what you pay for is packaging,
        // photography and a listing. The middle tier because that is what a
        // bundle presents as regardless of what is inside it.
        investTier: 1,
        tags: slow.tags.slice(0, 2),
        meta: {
          coverMonths: moved,
          stockS: sunk * movedShare,
          bundledFrom: `${fast.id}+${slow.id}`,
        },
      });
      if (!created) return;
      slow.meta.coverMonths = kept;
      slow.meta.stockS = sunk * (1 - movedShare);

      spend(
        s,
        "ecom-bundle",
        {
          effects: [
            // What "cheapens the fast one" actually means: you have told the
            // market what the good product is worth, and it is less. The margin
            // goes with it — two units are leaving for one unit's money.
            { stat: "cwp_pt", amount: -3 },
            { stat: "gm_pt", amount: -2 },
          ],
          setFlags: ["bundled"],
        },
        `You put ${slow.name} in the box with ${fast.name} and charge what the good one cost alone.`,
      );
    },
  },
  {
    /**
     * The cheapest real win in the industry and the one nobody does. Accurate
     * measurements and honest photography raise conversion and cut the returns
     * term, because most returns are not faults — they are surprises.
     */
    id: "ecom-listing",
    tab: "product",
    label: "Improve the listing",
    signal: "Same product. Better sentence.",
    detail:
      "Real photographs, real measurements, the question everyone emails you answered above the fold. The product does not change.",
    costS: 0.5,
    apply: (s) =>
      spend(
        s,
        "ecom-listing",
        {
          effects: [
            { stat: "cash_S", amount: -0.5 },
            { stat: "ctr_pt", amount: 4 },
            { stat: "csat", amount: 3 },
            { stat: "cwp_pt", amount: 2 },
          ],
          setFlags: ["listing_improved"],
        },
        "You rewrite the listing and reshoot the photos. Same product, fewer surprises.",
      ),
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    /**
     * Sets `ship_fast`, which the authored event library already weights off
     * (E-PRD-002 doubles). The trade is the honest one: two days instead of
     * seven is a carrier bill you pay on every parcel forever.
     */
    id: "ecom-fast-ship",
    tab: "market",
    label: "Switch to faster shipping",
    signal: "Customers notice. So does your margin.",
    detail:
      "Two days instead of seven. Every parcel costs more from the day you sign, whether or not the customer would have waited.",
    apply: (s) =>
      spend(
        s,
        "ecom-fast-ship",
        {
          effects: [
            { stat: "csat", amount: 6 },
            { stat: "gm_pt", amount: -3 },
            { stat: "churn_pt", amount: -2 },
          ],
          setFlags: ["ship_fast"],
        },
        "You move to the faster carrier. Delivery stops being the thing people complain about.",
      ),
  },
  {
    /**
     * Q4 is the year in this industry, which makes the push an amplifier rather
     * than a gain: it multiplies whatever buying decision you already made. Full
     * shelf, and it is the best quarter you will ever have. Thin shelf, and you
     * have paid to send traffic to a sold-out page.
     *
     * The year-scoped flag is what the leak reads; the plain one persists for
     * event weighting.
     */
    id: "ecom-q4-push",
    tab: "market",
    label: "Run a Q4 push",
    signal: "The whole year, in one quarter.",
    detail:
      "Every channel, one quarter, the calendar doing half the work. It finds whatever you got wrong in the buy and makes it larger.",
    costS: 2,
    yearly: true,
    available: (s) => s.month >= 10,
    apply: (s) =>
      spend(
        s,
        "ecom-q4-push",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "rev_pct", amount: 22, durationQ: 1 },
            { stat: "ctr_pt", amount: 5 },
            // Q4 ad auctions are the most expensive of the year. You are bidding
            // against everyone else who noticed December.
            { stat: "cac_pt", amount: -3 },
            { stat: "brand", amount: 3 },
          ],
          setFlags: ["q4_push", `q4_push_y${s.year}`],
        },
        "You put the whole year's marketing into one quarter. Whatever you ordered, you find out now.",
      ),
  },

  // ── Assets ────────────────────────────────────────────────────────────
  {
    /**
     * Goes through `buyAsset` rather than a stat bump, same reasoning as the
     * real-estate activity: it sits in `holdings`, gets revalued, counts toward
     * net worth and can be sold when the runway gets short. `buyAsset` already
     * books the unit cost saving and the rent it replaces; the extra burn here
     * is the part the catalog entry does not carry — racking, staff, insurance.
     *
     * The real prize is in the leak: owning the shelf lets you hold stock into
     * next season instead of dumping it into this one, which is the only defence
     * against the overstock half of the vice.
     */
    id: "ecom-warehouse",
    tab: "assets",
    label: "Build the warehouse",
    signal: "Own the shelf.",
    detail:
      "Stock stops living in your hallway. Fulfilment gets cheaper per parcel and more expensive per month, and it holds three more listings.",
    costS: 14,
    minStage: 3,
    available: (s) => !s.flags.own_warehouse,
    apply: (s) => {
      const def = assetById("warehouse");
      if (!def || !buyAsset(s, def)) return;
      s.portfolioCapBonus = (s.portfolioCapBonus ?? 0) + 3;
      spend(
        s,
        "ecom-warehouse",
        {
          effects: [{ stat: "burn_S_mo", amount: 0.45 }],
          setFlags: ["own_warehouse"],
        },
        "You sign for the unit. The pallets have somewhere to go and the rent arrives every month regardless.",
      );
    },
  },
];

export default SPEC;
