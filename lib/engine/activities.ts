import type { RunState } from "./types";
import { applyOutcome } from "./effects";
import { refreshBooks } from "./sim";
import { makeLine } from "./log";
import { S_UNIT } from "./constants";
import { hashString, runRng } from "./rng";
import { assetById, buyAsset } from "./holdings";
// Value import, and industries/*.ts imports `spend` and the `Activity` TYPE back
// from here. ESM handles the cycle because the only runtime edge is one way:
// this module is fully evaluated before any ACTIVITIES array is read.
// Explicit /index: webpack resolves a directory import, the headless ts-loader
// used by the balance harnesses does not, and the engine has to run under both.
import { activitiesForIndustry } from "./industries/index";
import type { ActivityTab } from "@/components/ActivityBar";

/**
 * Player-initiated activities. None of these advance time — that is the whole
 * point of the separation. They spend cash, energy and attention instead.
 */

export interface Activity {
  id: string;
  tab: ActivityTab;
  label: string;
  /** The visible cost/benefit. Hidden consequences stay hidden. */
  signal: string;
  detail: string;
  costS?: number;
  minStage?: number;
  /** Once per fiscal year. */
  yearly?: boolean;
  /**
   * Availability gate beyond `minStage`, for the things that can only happen
   * once in a company's life. Checked in `activitiesFor` so an unavailable
   * activity is absent rather than present-and-disabled — a greyed-out IPO
   * button would advertise a mechanic the player cannot reach and cannot be
   * told why.
   */
  available?(state: RunState): boolean;
  apply(state: RunState): void;
}

/**
 * Apply, refresh the books, log one line. Never advances time.
 *
 * Exported because every industry lens in lib/engine/industries/ needs it, and
 * while it was module-private all eleven of them grew their own identical copy —
 * which meant a fix here would have reached exactly one of twelve call sites.
 */
export function spend(
  state: RunState,
  id: string,
  effects: Parameters<typeof applyOutcome>[1],
  narration: string,
) {
  const rng = runRng(state.seed, state.year, state.month, hashString(id));
  const res = applyOutcome(state, effects, id, rng);
  refreshBooks(state);
  state.log.push(makeLine(state, "decision", narration, res.deltas));
}

export const ACTIVITIES: Activity[] = [
  // ── Company ───────────────────────────────────────────────────────────
  {
    id: "rnd",
    tab: "company",
    label: "Fund R&D",
    signal: "Costs real money. Nobody claps.",
    detail: "A quarter of real engineering time. Quality compounds; nobody claps for it.",
    costS: 2,
    apply: (s) =>
      spend(
        s,
        "rnd",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "qual", amount: 5 },
            { stat: "tdebt", amount: -1 },
          ],
        },
        "You put money into the product instead of the megaphone.",
      ),
  },
  {
    id: "refactor",
    tab: "company",
    label: "Pay down tech debt",
    signal: "Nothing visibly improves. Everything does.",
    detail: "Remove the duct tape before it removes itself.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "refactor",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "energy", amount: -5 },
            { stat: "tdebt", amount: -2 },
            { stat: "qual", amount: 2 },
          ],
        },
        "You spend the week removing duct tape. Nothing visibly improves. Everything does.",
      ),
  },
  {
    /**
     * The largest single financial event in the game, and the only activity that
     * permanently changes what kind of company you are running.
     *
     * On the numbers: no event in the library moves cash by more than 12S, and
     * dilution across the library tops out at 30%. An IPO should sit at the top
     * of both scales without leaving them — 18S for a quarter of the company,
     * plus a burn increase that never goes away, because audit, filings and
     * investor relations are a permanent staff cost, not a one-off fee.
     *
     * The burn is the real design of this. Going public is not a reward; it is a
     * large amount of cash in exchange for a quarter of your ownership and a
     * higher floor under your monthly costs forever.
     */
    id: "ipo",
    tab: "company",
    label: "Go public",
    signal: "The money is real. So is the audience, forever.",
    detail:
      "You ring the bell and hand a quarter of the company to strangers. The reporting requirements never stop.",
    minStage: 5,
    available: (s) => !s.flags.public_company,
    apply: (s) =>
      spend(
        s,
        "ipo",
        {
          effects: [
            { stat: "cash_S", amount: 18 },
            { stat: "dilution_pct", amount: 25 },
            { stat: "burn_S_mo", amount: 0.5 },
            { stat: "brand", amount: 12 },
            { stat: "val_pct", amount: 15 },
            { stat: "invsent", amount: 2 },
            { stat: "risk", amount: 2 },
          ],
          setFlags: ["public_company"],
        },
        "You ring the bell. The money is real, the ownership is gone, and every quarter now has an audience.",
      ),
  },
  {
    /**
     * The activities tab's door into The Room. It does not place the call — the
     * two-minute clock, the pitch and the answer all live in the phone, because
     * a cold call is something you do on a phone.
     *
     * Kept here anyway because the activities tab is where a player goes looking
     * for "what can I do about money today", and a raise mechanic that only
     * exists behind an app icon is a raise mechanic most players never find.
     *
     * Pro-gated for ACCESS only. The bar, the cheque and the odds are identical
     * for a Pro and a free player who both reach the same person (Brand Law 4).
     */
    id: "cold-call",
    tab: "company",
    label: "Cold call an investor",
    signal: "Three a day, two minutes each. They have not heard of you.",
    detail:
      "A directory of investors, buyers and operators who do not know your name. You pitch out loud and they decide on the spot.",
    available: (s) => !!s.pro && (s.coldCallsUsed ?? 0) < 3,
    apply: (s) =>
      spend(
        s,
        "cold-call",
        { setFlags: ["open_the_room"] },
        "You pull up the directory and start looking for somebody who might pick up.",
      ),
  },
  {
    id: "rename",
    tab: "company",
    label: "Rename the company",
    signal: "The leaderboard remembers the old name.",
    detail: "The leaderboard will remember what you used to be called.",
    yearly: true,
    apply: (s) =>
      spend(s, "rename", { effects: [{ stat: "brand", amount: -1 }] }, "New name. Same books."),
  },

  // ── Team ──────────────────────────────────────────────────────────────
  {
    id: "hire",
    tab: "team",
    label: "Hire someone",
    signal: "More hands. Payroll is monthly, forever.",
    detail: "More hands, more payroll, more opinions.",
    apply: (s) =>
      spend(
        s,
        "hire",
        {
          effects: [
            { stat: "emp", amount: 1 },
            { stat: "qual", amount: 3 },
          ],
        },
        "You hire. Payroll is a promise you make every month.",
      ),
  },
  {
    id: "fire",
    tab: "team",
    label: "Let someone go",
    signal: "Cheaper. The room will remember.",
    detail: "You deliver this yourself. It costs you either way.",
    apply: (s) =>
      spend(
        s,
        "fire",
        {
          effects: [
            { stat: "emp", amount: -1 },
            { stat: "morale", amount: -6 },
            { stat: "energy", amount: -4 },
          ],
        },
        "You do it yourself, in person. It is the least you can do and the most you can offer.",
      ),
  },
  {
    id: "raise-pay",
    tab: "team",
    label: "Raise pay across the board",
    signal: "Expensive. They notice you did it unasked.",
    detail: "The cheapest retention tool nobody uses until it's late.",
    apply: (s) =>
      spend(
        s,
        "raise-pay",
        {
          effects: [
            { stat: "burn_S_mo", amount: 0.4 },
            { stat: "morale", amount: 9 },
            { stat: "teamloy", amount: 1 },
          ],
          setFlags: ["treated_team_well"],
        },
        "You pay people more before they ask. They notice which order that happened in.",
      ),
  },
  {
    id: "rest",
    tab: "team",
    label: "Take a real weekend",
    signal: "The company survives without you.",
    detail: "Your own battery. At zero, you make bad calls.",
    apply: (s) =>
      spend(
        s,
        "rest",
        { effects: [{ stat: "energy", amount: 14 }] },
        "You take two days off. The company survives without you, which stings and helps.",
      ),
  },

  // ── Assets ────────────────────────────────────────────────────────────
  {
    id: "buy-office",
    tab: "assets",
    label: "Buy the office",
    signal: "Rent stops. So does your liquidity.",
    detail: "Own the room instead of renting it. Illiquid, but yours.",
    costS: 8,
    minStage: 2,
    apply: (s) =>
      spend(
        s,
        "buy-office",
        {
          effects: [
            { stat: "cash_S", amount: -8 },
            { stat: "burn_S_mo", amount: -0.4 },
            { stat: "val_pct", amount: 3 },
          ],
          setFlags: ["own_building"],
        },
        "You buy the building. Rent stops being someone else's income.",
      ),
  },
  {
    id: "equipment",
    tab: "assets",
    label: "Upgrade equipment",
    signal: "The team stops apologising for the old kit.",
    detail: "Better tools, better output, worse bank balance.",
    costS: 3,
    apply: (s) =>
      spend(
        s,
        "equipment",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "qual", amount: 4 },
            { stat: "gm_pt", amount: 1 },
          ],
        },
        "New equipment. The team stops apologizing for the old equipment.",
      ),
  },

  {
    /**
     * Real estate goes through `buyAsset` rather than a flat stat bump, so it
     * behaves like the investment it claims to be: it sits in `holdings`, gets
     * revalued every year by tickHoldings, counts toward net worth, and can be
     * sold when the runway gets short. A `val_pct` nudge would have been three
     * lines and a lie.
     */
    id: "real-estate",
    tab: "assets",
    label: "Invest in real estate",
    signal: "Pays every month. You cannot spend a building.",
    detail:
      "A commercial unit you lease to someone else. It pays every month, gains value most years, and you cannot spend a building.",
    costS: 20,
    minStage: 3,
    apply: (s) => {
      const def = assetById("rental-unit");
      if (!def || !buyAsset(s, def)) return;
      // buyAsset already moved the cash, the upkeep and the holding. Only the
      // books refresh and the log line are left.
      refreshBooks(s);
      s.log.push(
        makeLine(
          s,
          "decision",
          "You buy a unit and lease it out. The rent arrives whether or not you had a good month.",
        ),
      );
    },
  },

  // ── Market ────────────────────────────────────────────────────────────
  {
    /**
     * The counterpart to the social push: four times the money for roughly three
     * times the brand, because reach gets more expensive the more of it you buy.
     * The CAC increase is the honest part — a campaign this size buys people who
     * were not looking for you, and they cost more than the ones who were.
     */
    id: "ad-campaign",
    tab: "market",
    label: "Run a real ad campaign",
    signal: "Real reach, rented by the quarter.",
    detail:
      "Proper media buying — placements, a production budget, a schedule. It works while it runs and stops working when it stops.",
    costS: 4,
    minStage: 2,
    apply: (s) =>
      spend(
        s,
        "ad-campaign",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "brand", amount: 11 },
            { stat: "rev_pct", amount: 12, durationQ: 3 },
            { stat: "cac_pt", amount: 3 },
            { stat: "ctr_pt", amount: 4 },
          ],
        },
        "You buy real reach for a full quarter. People who have never looked for you see you anyway.",
      ),
  },
  {
    id: "marketing-social",
    tab: "market",
    label: "Run a social push",
    signal: "Cheap reach. Rents by the week.",
    detail: "Cheap reach, shallow loyalty.",
    costS: 1,
    apply: (s) =>
      spend(
        s,
        "marketing-social",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "brand", amount: 4 },
            { stat: "ctr_pt", amount: 3 },
          ],
        },
        "You buy attention. It rents by the week.",
      ),
  },
  {
    id: "marketing-street",
    tab: "market",
    label: "Go door to door",
    signal: "Free except for you.",
    detail: "You, a bag of product, every business on the street. Free except for you.",
    apply: (s) =>
      spend(
        s,
        "marketing-street",
        {
          effects: [
            { stat: "energy", amount: -12 },
            { stat: "rev_pct", amount: 6, durationQ: 2 },
            { stat: "respect", amount: 1 },
          ],
          setFlags: ["street_cred"],
        },
        "You knock on doors for a week. Three people remember your name. That is the whole trick.",
      ),
  },
  {
    id: "price-up",
    tab: "market",
    label: "Raise prices 10%",
    signal: "Fastest lever on the board. Easy to over-pull.",
    detail: "The fastest lever on the board, and the easiest to over-pull.",
    apply: (s) =>
      spend(
        s,
        "price-up",
        {
          effects: [
            { stat: "gm_pt", amount: 3 },
            { stat: "churn_pt", amount: 2 },
          ],
        },
        "You raise prices. Some customers leave. The ones who stay are worth more.",
      ),
  },

  // ── Closet ────────────────────────────────────────────────────────────
  {
    id: "closet-fit",
    tab: "closet",
    label: "Change your fit",
    signal: "Cosmetic. Always.",
    detail: "Cosmetics never touch score, survival, or the leaderboard. Ever.",
    apply: (s) =>
      spend(s, "closet-fit", {}, "New fit. The books do not care, and neither does the shark."),
  },
];

/**
 * Everything offerable on a tab right now — the industry-agnostic activities plus
 * the ones that exist only because of the business the player chose.
 *
 * Industry activities come FIRST. On the product tab in particular they are the
 * whole content of the screen, and burying "Add a menu item" under three generic
 * company actions would read as the generic list it used to be.
 */
export function activitiesFor(tab: ActivityTab, state: RunState): Activity[] {
  return [...activitiesForIndustry(state), ...ACTIVITIES].filter(
    (a) => a.tab === tab && isAvailable(a, state),
  );
}

/** Any activity by id, from either registry. Used by the dispatcher. */
export function activityById(id: string, state: RunState): Activity | undefined {
  return (
    activitiesForIndustry(state).find((a) => a.id === id) ??
    ACTIVITIES.find((a) => a.id === id)
  );
}

/**
 * Stage and one-off gates, in one place so the sheet and the dispatcher cannot
 * disagree about whether something is offerable.
 */
export function isAvailable(activity: Activity, state: RunState): boolean {
  if (activity.minStage && state.stage < activity.minStage) return false;
  if (activity.available && !activity.available(state)) return false;
  return true;
}

export function canAfford(activity: Activity, state: RunState): boolean {
  if (!activity.costS) return true;
  return state.stats.cash >= activity.costS * S_UNIT[state.stage];
}
