/**
 * Assets — things the company buys to run itself, and things the founder buys
 * because they can. Both appreciate (or don't) and both can be sold, which
 * makes them a real long-term investment rather than a shop.
 */

import type { RunState } from "./types";
import { S_UNIT } from "./constants";
import { mulberry32, hashString } from "./rng";

export type AssetKind = "company" | "personal";

export interface AssetDef {
  id: string;
  name: string;
  kind: AssetKind;
  category: "Property" | "Equipment" | "Vehicle" | "Collectible" | "Art";
  /** Purchase price in S units at the current stage. */
  priceS: number;
  /** Annual appreciation, as a fraction. Negative = it depreciates. */
  appreciation: number;
  /** Monthly burn delta in S while owned (upkeep, or rent saved). */
  upkeepS: number;
  minStage: number;
  blurb: string;
  /** Company assets can move the books directly. */
  effect?: { stat: "qual" | "brand" | "gm_pt" | "morale"; amount: number };
  pro?: boolean;
}

export const ASSET_CATALOG: AssetDef[] = [
  // ── Company ──────────────────────────────────────────────────────────────
  {
    id: "office-small",
    name: "The first real office",
    kind: "company",
    category: "Property",
    priceS: 8,
    appreciation: 0.05,
    upkeepS: -0.4,
    minStage: 2,
    blurb: "Own the room instead of renting it. Illiquid, but the rent stops being someone else's income.",
    effect: { stat: "morale", amount: 5 },
  },
  {
    id: "warehouse",
    name: "Warehouse unit",
    kind: "company",
    category: "Property",
    priceS: 14,
    appreciation: 0.04,
    upkeepS: -0.2,
    minStage: 3,
    blurb: "Stock stops living in your hallway. Logistics gets cheaper the day you sign.",
    effect: { stat: "gm_pt", amount: 3 },
  },
  {
    id: "equipment",
    name: "Production equipment",
    kind: "company",
    category: "Equipment",
    priceS: 3,
    appreciation: -0.12,
    upkeepS: 0.05,
    minStage: 1,
    blurb: "Better tools, better output. It loses value the moment you unbox it — that is what equipment does.",
    effect: { stat: "qual", amount: 5 },
  },
  {
    /**
     * The "invest in real estate" activity buys this one.
     *
     * It is a commercial unit you lease out rather than occupy, which is why it
     * is the only asset here with a negative upkeep that is not rent you stopped
     * paying — it is rent somebody pays you. Modelled as a burn reduction
     * because that is what net rental income does to a monthly P&L, and it means
     * the existing yearly revaluation and sell path work on it unchanged.
     *
     * Deliberately the slowest-paying thing on the board: it takes about five
     * years of rent to earn back the cash, and the cash is gone the whole time.
     * That is the actual tradeoff real estate presents to a company that still
     * has a runway to worry about.
     */
    id: "rental-unit",
    name: "A commercial unit you lease out",
    kind: "company",
    category: "Property",
    priceS: 20,
    appreciation: 0.06,
    upkeepS: -0.34,
    minStage: 3,
    blurb:
      "Not for you to sit in — for somebody else to rent. It pays monthly, appreciates quietly, and locks up cash you might need in a hurry.",
  },
  {
    id: "flagship",
    name: "Flagship store",
    kind: "company",
    category: "Property",
    priceS: 26,
    appreciation: 0.06,
    upkeepS: 0.4,
    minStage: 3,
    blurb: "A room customers can stand inside. Expensive theatre that happens to sell things.",
    effect: { stat: "brand", amount: 9 },
  },
  {
    id: "van",
    name: "Delivery van",
    kind: "company",
    category: "Vehicle",
    priceS: 2.5,
    appreciation: -0.15,
    upkeepS: 0.08,
    minStage: 1,
    blurb: "You stop paying couriers to be late for you.",
    effect: { stat: "gm_pt", amount: 2 },
  },
  {
    /**
     * Stage 1 must offer property, or the Assets tab teaches a first-time
     * player that real estate is not in the game — everything property-shaped
     * used to start at Stage 2. Priced so a garage company with ~25S cash can
     * actually reach it, and appreciating well under the free ladder's best
     * (the watch, 0.09): early access, not early advantage.
     */
    id: "market-lockup",
    name: "Market stall lockup",
    kind: "company",
    category: "Property",
    priceS: 4,
    appreciation: 0.03,
    upkeepS: -0.06,
    minStage: 1,
    blurb:
      "A pitch at the Saturday market and the lockup behind it. The smallest property you can own is still property.",
  },

  // ── Personal ─────────────────────────────────────────────────────────────
  {
    /**
     * The Stage-1 personal pair. An empty PERSONAL tab at Stage 1 reads as
     * "not in the game", same failure as company property above. Both are
     * deliberately modest — the parking space yields ~5%/yr on its price and
     * the watch climbs at under half of "The watch" (0.09) — so the Stage-2
     * unlocks still feel like unlocks. Early access, not early advantage.
     */
    id: "parking-space",
    name: "A deeded parking space",
    kind: "personal",
    category: "Property",
    priceS: 5,
    appreciation: 0.05,
    upkeepS: -0.02,
    minStage: 1,
    blurb:
      "Painted lines and a padlock, rented to a commuter by the month. Nobody brags about it. It pays anyway.",
  },
  {
    id: "watch-secondhand",
    name: "A second-hand watch",
    kind: "personal",
    category: "Collectible",
    priceS: 1.5,
    appreciation: 0.04,
    upkeepS: 0,
    minStage: 1,
    blurb: "Somebody else paid retail. You wear the years where it quietly climbs.",
  },
  {
    id: "apartment",
    name: "A place of your own",
    kind: "personal",
    category: "Property",
    priceS: 18,
    appreciation: 0.07,
    upkeepS: 0.15,
    minStage: 2,
    blurb: "You stop working from the kitchen table. Property has outlived most founders' companies.",
  },
  {
    id: "watch",
    name: "The watch",
    kind: "personal",
    category: "Collectible",
    priceS: 4,
    appreciation: 0.09,
    upkeepS: 0,
    minStage: 2,
    blurb: "Steel, boring, appreciating. The kind that gets quietly more valuable while you ignore it.",
  },
  {
    id: "classic-car",
    name: "Classic car",
    kind: "personal",
    category: "Vehicle",
    priceS: 12,
    appreciation: 0.08,
    upkeepS: 0.12,
    minStage: 3,
    blurb: "Appreciates if you garage it, bleeds if you drive it. You will drive it.",
  },
  {
    id: "supercar",
    name: "Something very fast",
    kind: "personal",
    category: "Vehicle",
    priceS: 30,
    appreciation: -0.11,
    upkeepS: 0.3,
    minStage: 4,
    blurb: "Depreciating, loud, and honestly the most fun line item on this page.",
  },
  {
    id: "art",
    name: "A painting people recognise",
    kind: "personal",
    category: "Art",
    priceS: 22,
    appreciation: 0.11,
    upkeepS: 0.05,
    minStage: 4,
    blurb: "The best-performing asset on this list, and the one you understand least.",
    // Deliberately NOT Pro. It has the best appreciation in the catalogue, and a
    // purchasable subscription must never gate the best-compounding asset —
    // holdings are sold back into cash, cash is survival, survival is the
    // leaderboard. The island stays Pro because it appreciates WORSE than the
    // free watch: Pro flavour, not Pro advantage. Brand Law 4.
  },
  {
    id: "island",
    name: "A very small island",
    kind: "personal",
    category: "Property",
    priceS: 90,
    appreciation: 0.05,
    upkeepS: 0.9,
    minStage: 5,
    blurb: "At this point the company is a machine for buying this.",
    pro: true,
  },
];

export interface Holding {
  id: string;
  defId: string;
  /** Dollars paid, at the stage of purchase. */
  paid: number;
  /** Current dollar value; ticks yearly. */
  value: number;
  purchasedYear: number;
}

export const assetById = (id: string) => ASSET_CATALOG.find((a) => a.id === id);

export function availableAssets(state: RunState, kind: AssetKind): AssetDef[] {
  return ASSET_CATALOG.filter((a) => a.kind === kind && state.stage >= a.minStage);
}

export function buyAsset(state: RunState, def: AssetDef): boolean {
  const S = S_UNIT[state.stage];
  const price = def.priceS * S;
  if (state.stats.cash < price) return false;

  state.stats.cash -= price;
  state.burnDeltaS += def.upkeepS;
  state.holdings.push({
    id: `hold-${state.holdings.length}-${def.id}`,
    defId: def.id,
    paid: price,
    value: price,
    purchasedYear: state.year,
  });

  if (def.effect) {
    const s = state.stats;
    if (def.effect.stat === "qual") s.qual = clamp(s.qual + def.effect.amount);
    if (def.effect.stat === "brand") s.brand = clamp(s.brand + def.effect.amount);
    if (def.effect.stat === "morale") s.morale = clamp(s.morale + def.effect.amount);
    if (def.effect.stat === "gm_pt")
      s.grossMarginPt = Math.min(95, s.grossMarginPt + def.effect.amount);
  }
  return true;
}

export function sellAsset(state: RunState, holdingId: string): number {
  const idx = state.holdings.findIndex((h) => h.id === holdingId);
  if (idx < 0) return 0;
  const [gone] = state.holdings.splice(idx, 1);
  const def = assetById(gone.defId);
  state.stats.cash += gone.value;
  if (def) {
    state.burnDeltaS -= def.upkeepS;
    if (def.effect) {
      const s = state.stats;
      if (def.effect.stat === "qual") s.qual = clamp(s.qual - def.effect.amount);
      if (def.effect.stat === "brand") s.brand = clamp(s.brand - def.effect.amount);
      if (def.effect.stat === "morale") s.morale = clamp(s.morale - def.effect.amount);
      if (def.effect.stat === "gm_pt")
        s.grossMarginPt = Math.max(2, s.grossMarginPt - def.effect.amount);
    }
  }
  return gone.value;
}

/** Yearly revaluation, with a little seeded market noise on top of the trend. */
export function tickHoldings(state: RunState) {
  for (const h of state.holdings) {
    const def = assetById(h.defId);
    if (!def) continue;
    const rng = mulberry32(hashString(`${h.id}:${state.year}`));
    const noise = 1 + (rng() - 0.5) * 0.06;
    h.value = Math.max(0, h.value * (1 + def.appreciation) * noise);
  }
}

export function holdingsValue(state: RunState, kind?: AssetKind): number {
  return state.holdings
    .filter((h) => !kind || assetById(h.defId)?.kind === kind)
    .reduce((sum, h) => sum + h.value, 0);
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));
