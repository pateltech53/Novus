import type { RunState } from "./types";
import { applyOutcome } from "./effects";
import { refreshBooks } from "./sim";
import { makeLine } from "./log";
import { S_UNIT, sellsToBusinesses } from "./constants";
import { hashString, runRng } from "./rng";
import { assetById, buyAsset } from "./holdings";
// Value import, and industries/*.ts imports `spend` and the `Activity` TYPE back
// from here. ESM handles the cycle because the only runtime edge is one way:
// this module is fully evaluated before any ACTIVITIES array is read.
// Explicit /index: webpack resolves a directory import, the headless ts-loader
// used by the balance harnesses does not, and the engine has to run under both.
import { activitiesForIndustry } from "./industries/index";
import type { ActivityTab } from "@/components/ActivityBar";
// Type-only, like the ActivityTab import above it: the engine names which
// paywall a locked row leads with, and never imports the paywall itself.
import type { GateId } from "@/lib/upgrade";

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
  /**
   * Pro gates ACCESS to this, and nothing else about it (Brand Law 4).
   *
   * The deliberate opposite of `available`. An unavailable activity is absent
   * because there is nothing useful to say about a mechanic the player cannot
   * reach — no stage, no second IPO. A LOCKED one is the reverse case: the
   * player could do it today and the only thing between them and it is the
   * subscription, which is precisely the thing a screen can explain. So it is
   * listed, it is pressable, and the press opens the paywall.
   *
   * That is also the honest version of what free had before. Cold calling was
   * hidden outright, so a free player never learned The Room existed — the
   * pricing page sold "the phone" to somebody who had never seen a phone.
   *
   * Refused in `runActivity` and again in the replay verifier, never only in
   * the UI: a row is a route to `apply`, not the definition of who may run it.
   */
  pro?: boolean;
  /** Which paywall the locked press opens. Defaults to the generic sheet. */
  gate?: GateId;
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
  recordActivityUse(state, id);
  state.log.push(makeLine(state, "decision", narration, res.deltas));
}

/**
 * Note that this activity has been run, and in which fiscal year.
 *
 * Exported because `spend` is not quite universal: `real-estate` goes through
 * `buyAsset` and never calls it, and a ledger that lived only inside `spend`
 * would silently miss any activity that does its own bookkeeping — which is
 * exactly the class of bug the note above `spend` already warns about.
 *
 * Cheap enough to record for every activity rather than only the `yearly`
 * ones: the map is a dozen small integers, and recording only some of them
 * would mean a flag added later found no history behind it.
 */
export function recordActivityUse(state: RunState, id: string): void {
  (state.activityUses ??= {})[id] = state.year;
}

/**
 * THE ROOM'S DAILY RATION — three calls a real day, two minutes each.
 *
 * Defined here rather than beside the caller directory in lib/ai/callers.ts,
 * which is where it used to live. The cold-call ACTIVITY needs the number, and
 * an engine that imported lib/ai to get it would be an engine that no longer
 * runs headlessly. So the engine kept a second copy — `coldCallsUsed < 3`,
 * with no day comparison — and the two drifted: the activity row stayed hidden
 * the morning after three calls while the phone was already offering three
 * fresh ones. callers.ts re-exports these four, so nothing that reads them
 * from there had to change.
 *
 * Both limits are the mechanic and not friction. A cold call is the one place
 * in Novus where you choose your listener, and the lesson is that access is
 * scarce and attention is short.
 */
export const MAX_CALLS_PER_DAY = 3;

/** Seconds. Two minutes, and the clock is on screen the whole time. */
export const CALL_SECONDS = 120;

/**
 * UTC, and not the player's local date — the one ration in the app that is.
 *
 * Every other daily allowance rolls over at the player's own midnight, which
 * is the right answer for something only their device counts. This one is
 * different because it is also counted somewhere else: a cold call goes on the
 * leaderboard tape, and `lib/leaderboard/bounds.ts` buckets those entries by
 * UTC date to reject a tape claiming more than three in a day. A ledger the
 * verifier has to agree with has to be on the verifier's clock.
 */
const callDayISO = (d = new Date()) => d.toISOString().slice(0, 10);

/** Calls left today, rolling over on the real UTC date. */
export function callsRemaining(state: RunState, now = new Date()): number {
  const iso = callDayISO(now);
  if (state.coldCallDayISO !== iso) return MAX_CALLS_PER_DAY;
  return Math.max(0, MAX_CALLS_PER_DAY - (state.coldCallsUsed ?? 0));
}

/** Consumes one call. Call this when the line connects, not when it resolves —
 *  hanging up early still used the person's time. */
export function consumeCall(state: RunState, now = new Date()) {
  const iso = callDayISO(now);
  if (state.coldCallDayISO !== iso) {
    state.coldCallDayISO = iso;
    state.coldCallsUsed = 0;
  }
  state.coldCallsUsed = (state.coldCallsUsed ?? 0) + 1;
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
     *
     * ── Shown to everyone, opened by Pro ──────────────────────────────────
     *
     * `available` used to carry `!!s.pro`, which put the Pro test in the field
     * that decides whether an activity EXISTS — so a free player's company tab
     * simply had no cold call on it. Two things were wrong with that. The
     * player could not find out The Room was there, which made the pricing
     * page's promise about "the phone" a promise about something they had
     * never seen; and a player who pressed it was telling us something, and a
     * row that is not rendered cannot be pressed. The lock moved to `pro`,
     * which lists the row and sends the press to the paywall instead.
     *
     * The day comparison replaces a bare `coldCallsUsed < 3`, which never
     * looked at `coldCallDayISO` and so kept the row hidden the morning after
     * three calls — while `callsRemaining()` in lib/ai/callers.ts, which does
     * roll over, was already handing the player three fresh ones.
     */
    id: "cold-call",
    tab: "company",
    label: "Work the phones",
    signal: "Three a day, two minutes each. They have not heard of you.",
    detail:
      "The trade index for your industry — who buys what you sell, and their direct line. Find a number, dial it, and pitch out loud. They decide on the spot.",
    pro: true,
    gate: "the_room",
    /*
     * Two gates, and the ORDER of them is the point.
     *
     * `available` is the industry question and it is asked first, because it is
     * a fact about the BUSINESS: a fast-food owner has nobody to ring, so the
     * row is absent rather than locked. `pro` above is a fact about the
     * ACCOUNT, and it shows the row and refuses the press. Getting these the
     * wrong way round would put a subscription pitch in front of somebody for a
     * phone they should never want to pick up, which is the worst version of
     * both.
     */
    available: (s) => sellsToBusinesses(s.industry) && callsRemaining(s) > 0,
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
      // books refresh, the ledger and the log line are left. The ledger is
      // written by hand here precisely because this activity does not go
      // through `spend` — see `recordActivityUse`.
      refreshBooks(s);
      recordActivityUse(s, "real-estate");
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
    (a) => a.tab === tab && isOfferable(a, state),
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

/**
 * Offered, but not to this account — the state a row is in when the only thing
 * missing is the subscription.
 *
 * Separate from `isAvailable` on purpose, and the two answer different
 * questions: `isAvailable` decides whether to draw the row at all, `isLocked`
 * decides whether pressing it runs the activity or opens the paywall. A locked
 * row is still drawn, still pressable, and never greyed out.
 *
 * Reads `state.pro` — the run's own tier — rather than the entitlement store,
 * to stay in step with the two gates downstream of it: ColdCall's `ProGate`
 * and the leaderboard verifier, which replays historical tapes and has no
 * localStorage to read.
 */
export function isLocked(activity: Activity, state: RunState): boolean {
  return !!activity.pro && !state.pro;
}

/**
 * Already done this fiscal year, for the activities that are once a year.
 *
 * ── The flag that did nothing ──────────────────────────────────────────────
 *
 * `Activity.yearly` has been declared and documented as "Once per fiscal year"
 * since the interface was written, is set on seven activities across the
 * industry lenses, and was read by NOTHING — not `isAvailable`, not the
 * dispatcher, not the verifier. So a player could fire the same once-a-year
 * lever every month of the year, and — the reported symptom — the company tab
 * offered an identical list in year 2 to the one it offered in year 1, because
 * nothing about the list had ever depended on the year at all.
 *
 * ── Why this is not folded into `isAvailable` ──────────────────────────────
 *
 * `isAvailable` is the leaderboard verifier's admissibility test
 * (lib/leaderboard/replay.ts). Tightening it would retroactively invalidate
 * every tape already submitted in which a yearly activity fired twice — runs
 * that were legal when they were played, refused now for following the rules
 * as they were then enforced. A verifier that accepts a little more than the
 * client will produce is the safe direction of that asymmetry; the reverse
 * deletes people's boards.
 *
 * So the gate lives here, and `activitiesFor` and `runActivity` — everything a
 * player can actually reach — ask this one instead.
 */
export function isSpentThisYear(activity: Activity, state: RunState): boolean {
  return !!activity.yearly && state.activityUses?.[activity.id] === state.year;
}

/**
 * Offerable to THIS player, right now: available, and not already spent this
 * fiscal year. What every screen and the dispatcher ask.
 *
 * `isLocked` is deliberately not part of it — a Pro-locked activity is still
 * offered, it just refuses the press (see the `pro` field).
 */
export function isOfferable(activity: Activity, state: RunState): boolean {
  return isAvailable(activity, state) && !isSpentThisYear(activity, state);
}

export function canAfford(activity: Activity, state: RunState): boolean {
  if (!activity.costS) return true;
  return state.stats.cash >= activity.costS * S_UNIT[state.stage];
}
