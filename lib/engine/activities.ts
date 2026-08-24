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

/**
 * ONE BRANCH OF A TWO-LEVEL ACTIVITY — the *which*, after the verb.
 *
 * ── Why the second question is the whole point ──────────────────────────────
 *
 * BitLife does not offer "commit crime". It offers **Commit crime**, and then
 * asks which: pickpocket, burglary, murder. It does not offer "get a job"; it
 * offers a list. The second question is where all of the character is, it costs
 * almost nothing to build — one verb, four outcomes — and it changes what the
 * player is deciding: not *whether*, but *how far*.
 *
 * Novus had no two-level activity anywhere. "Talk to the press" is a shrug;
 * "talk to the press — the trade weekly, or the national business desk?" is a
 * decision with a spine, because one of those two can end you. See
 * docs/PROGRESSION.md §2.2 and §4.2.
 *
 * ── The rules a branch inherits ─────────────────────────────────────────────
 *
 * Everything true of an `Activity` is true of a branch. `signal` is qualitative
 * and never an effect preview (Addendum A §7.1, enforced by
 * scripts/validate-activities.mjs, which reads these the same way it reads the
 * parents'). `costS` is the one number allowed before committing. `apply` runs
 * through `spend`, so it goes through the same seeded RNG the events do and
 * lands on the tape.
 *
 * A branch may be stage-gated or conditional on its own: "sue them" is not a
 * thing a company in a garage can afford to do, and hiding that branch while
 * showing the letter is more honest than a row that refuses the press.
 */
export interface ActivityOption {
  /** Stable, and written onto the tape. Renaming one invalidates old runs. */
  id: string;
  label: string;
  /** Qualitative. What the choice IS, never what it does to the books. */
  signal: string;
  costS?: number;
  minStage?: number;
  available?(state: RunState): boolean;
  apply(state: RunState): void;
}

export interface Activity {
  id: string;
  tab: ActivityTab;
  label: string;
  /** The visible cost/benefit. Hidden consequences stay hidden. */
  signal: string;
  detail: string;
  costS?: number;
  minStage?: number;
  /**
   * The branches, when this is a two-level activity. Present means the row
   * opens a chooser instead of firing, and `apply` is not called at all —
   * `applyActivity` takes the branch instead.
   */
  options?: ActivityOption[];
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
  /**
   * Optional only because a two-level activity has no single outcome to run —
   * its branches do. Every activity has exactly one of `apply` or `options`,
   * which `scripts/playbook-test.mjs` asserts, because an activity with
   * neither is a row that silently does nothing when pressed.
   */
  apply?(state: RunState): void;
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

  // ═══════════════════════════════════════════════════════════════════════
  // THE PLAYBOOK
  //
  // Everything below this line was added to answer one complaint: after the
  // first fiscal year the game was "boring and repetitive to keep clicking
  // options". It was, and the reason was measurable — seventeen shared verbs,
  // every one of them a single tap with a single outcome, and an identical list
  // in December to the one in January and in year five to the one in year one.
  //
  // The full diagnosis, the model it is built against and the four rules it has
  // to keep are in docs/PROGRESSION.md. The short version:
  //
  //   · BREADTH. A menu you have exhausted is a control panel. Roughly fifty
  //     shared verbs instead of seventeen, so a player who opens a tab in year
  //     three still finds rows they have never pressed.
  //
  //   · THE SECOND QUESTION. The rows carrying `options` do not fire when
  //     pressed — they ask WHICH, and the branch is the decision. See the note
  //     on `ActivityOption`.
  //
  //   · ESCALATION. About a third of these open at stage 2, 3 or 4, so growth
  //     ADDS doors. Before this the four stage-gated activities had all opened
  //     by stage 5 and a late company had strictly less to do than an early one.
  //
  //   · ONCE A YEAR MEANS ONCE A YEAR. `yearly` is read now (`isSpentThisYear`),
  //     so the December list is genuinely shorter than the January one and
  //     spending a lever is a decision about WHEN.
  //
  // House rules, unchanged and non-negotiable: `signal` is qualitative and
  // never an effect preview (scripts/validate-activities.mjs reads the branches
  // too), `costS` is the only number allowed before committing, the log line is
  // a sentence, and none of it advances time.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Company · the founder's public life ───────────────────────────────
  {
    /**
     * The first two-level activity in the game, and the template for the rest.
     *
     * One verb, four rooms, and the range between them is the point: the local
     * paper is free and harmless, the national desk is expensive and will ask
     * about the thing you hoped nobody knew. A player choosing between those is
     * making a real decision about how much attention they can survive.
     */
    id: "press",
    tab: "company",
    label: "Talk to the press",
    signal: "Somebody else writes the first draft of you.",
    detail:
      "An interview. You do not get to approve it, and the bigger the room the less of it you control.",
    yearly: true,
    options: [
      {
        id: "local",
        label: "The local paper",
        signal: "A small room, and they will spell it right.",
        apply: (s) =>
          spend(
            s,
            "press:local",
            {
              effects: [
                { stat: "brand", amount: 3 },
                { stat: "respect", amount: 1 },
              ],
            },
            "The local paper runs four hundred words and a photograph of you outside the door.",
          ),
      },
      {
        id: "trade",
        label: "The trade weekly",
        signal: "The people who buy from you actually read it.",
        costS: 1,
        apply: (s) =>
          spend(
            s,
            "press:trade",
            {
              effects: [
                { stat: "cash_S", amount: -1 },
                { stat: "brand", amount: 5 },
                { stat: "ctr_pt", amount: 2 },
                { stat: "invsent", amount: 1 },
              ],
            },
            "The trade weekly runs it. Nobody outside your industry notices, which is exactly who you needed.",
          ),
      },
      {
        id: "podcast",
        label: "A founder podcast",
        signal: "Two hours, no editor, and all of it on tape.",
        apply: (s) =>
          spend(
            s,
            "press:podcast",
            {
              effects: [
                { stat: "brand", amount: 6 },
                { stat: "energy", amount: -6 },
                { stat: "risk", amount: 1 },
              ],
            },
            "Two hours, unedited. You said one thing you will think about at three in the morning.",
          ),
      },
      {
        id: "national",
        label: "The national business desk",
        signal: "They will ask about the thing you hoped nobody knew.",
        costS: 2,
        minStage: 3,
        apply: (s) =>
          spend(
            s,
            "press:national",
            {
              effects: [
                { stat: "cash_S", amount: -2 },
                { stat: "brand", amount: 12 },
                { stat: "invsent", amount: 2 },
                { stat: "val_pct", amount: 4 },
                { stat: "risk", amount: 3 },
              ],
            },
            "It runs on a Sunday. Your inbox has never looked like this, and neither has your risk register.",
          ),
      },
    ],
  },
  {
    id: "write-book",
    tab: "company",
    label: "Write the book",
    signal: "A year of evenings. It outlives the company either way.",
    detail:
      "Founders write books. Which book you write says more about you than the company does.",
    yearly: true,
    minStage: 3,
    options: [
      {
        id: "memoir",
        label: "The memoir",
        signal: "Your version, while you still like it.",
        costS: 1,
        apply: (s) =>
          spend(
            s,
            "write-book:memoir",
            {
              effects: [
                { stat: "cash_S", amount: -1 },
                { stat: "brand", amount: 8 },
                { stat: "respect", amount: 2 },
                { stat: "energy", amount: -14 },
              ],
            },
            "You write the version where the hard part was inevitable. It sells, and you know which chapter is fiction.",
          ),
      },
      {
        id: "playbook",
        label: "The operator's playbook",
        signal: "Everything you learned, handed to your competitors.",
        costS: 1,
        apply: (s) =>
          spend(
            s,
            "write-book:playbook",
            {
              effects: [
                { stat: "cash_S", amount: -1 },
                { stat: "brand", amount: 6 },
                { stat: "respect", amount: 4 },
                { stat: "invsent", amount: 2 },
                { stat: "share_pt", amount: -1 },
                { stat: "energy", amount: -12 },
              ],
            },
            "You write down how you did it. Two competitors read it properly, and one of them was always going to.",
          ),
      },
      {
        id: "postmortem",
        label: "An honest post-mortem",
        signal: "You write down what went wrong, with names.",
        apply: (s) =>
          spend(
            s,
            "write-book:postmortem",
            {
              effects: [
                { stat: "brand", amount: 4 },
                { stat: "respect", amount: 6 },
                { stat: "morale", amount: -4 },
                { stat: "energy", amount: -10 },
              ],
            },
            "You publish the mistakes with the dates on them. The people in it read it first, which is the least you owed them.",
          ),
      },
    ],
  },
  {
    id: "keynote",
    tab: "company",
    label: "Speak somewhere",
    signal: "A room of people who did not have to come.",
    detail: "Standing up in front of an audience is free reach and paid-for risk.",
    yearly: true,
    options: [
      {
        id: "meetup",
        label: "A local meetup",
        signal: "Thirty chairs, twenty of them full.",
        apply: (s) =>
          spend(
            s,
            "keynote:meetup",
            {
              effects: [
                { stat: "brand", amount: 2 },
                { stat: "respect", amount: 1 },
                { stat: "energy", amount: -3 },
              ],
            },
            "Twenty people in a room above a pub. Two of them email you afterwards, and one of them matters.",
          ),
      },
      {
        id: "conference",
        label: "An industry conference",
        signal: "A badge, a slot, and a hotel you paid for.",
        costS: 2,
        minStage: 2,
        apply: (s) =>
          spend(
            s,
            "keynote:conference",
            {
              effects: [
                { stat: "cash_S", amount: -2 },
                { stat: "brand", amount: 7 },
                { stat: "invsent", amount: 1 },
                { stat: "energy", amount: -6 },
              ],
            },
            "Your slot is at nine on the second morning. It goes well, and the hallway afterwards goes better.",
          ),
      },
      {
        id: "mainstage",
        label: "The mainstage",
        signal: "A very large room and a clip that never dies.",
        costS: 4,
        minStage: 4,
        apply: (s) =>
          spend(
            s,
            "keynote:mainstage",
            {
              effects: [
                { stat: "cash_S", amount: -4 },
                { stat: "brand", amount: 15 },
                { stat: "respect", amount: 3 },
                { stat: "risk", amount: 2 },
                { stat: "energy", amount: -12 },
              ],
            },
            "You walk out under the lights and it lands. The clip will follow you for years, in both directions.",
          ),
      },
    ],
  },
  {
    /**
     * The business translation of BitLife's crime menu, and the reason that
     * translation works: the verb is legal, the range is enormous, and the
     * furthest branch can genuinely end you. Nobody gets to choose it before
     * somebody has bothered to copy them, which is what the brand floor is for.
     */
    id: "copycat",
    tab: "company",
    label: "Deal with the copycat",
    signal: "Somebody shipped your product with a different logo.",
    detail:
      "Being copied is a compliment with a price tag. What you do about it is a decision about who you are.",
    yearly: true,
    available: (s) => s.stats.brand >= 30,
    options: [
      {
        id: "ignore",
        label: "Let it go and out-build them",
        signal: "The answer that never makes the news.",
        apply: (s) =>
          spend(
            s,
            "copycat:ignore",
            {
              effects: [
                { stat: "qual", amount: 3 },
                { stat: "respect", amount: 1 },
                { stat: "energy", amount: -2 },
              ],
            },
            "You put the week into the product instead of the lawyer. They ship your last version; you ship your next one.",
          ),
      },
      {
        id: "letter",
        label: "Send a cease and desist",
        signal: "A lawyer's letter, and a week of not sleeping.",
        costS: 1,
        apply: (s) =>
          spend(
            s,
            "copycat:letter",
            {
              effects: [
                { stat: "cash_S", amount: -1 },
                { stat: "brand", amount: 1 },
                { stat: "risk", amount: 1 },
                { stat: "energy", amount: -5 },
              ],
            },
            "The letter goes out. They change three words and carry on, which is what letters mostly buy.",
          ),
      },
      {
        id: "sue",
        label: "Sue them",
        signal: "Years of it, and the outcome is not the point.",
        costS: 6,
        minStage: 3,
        apply: (s) =>
          spend(
            s,
            "copycat:sue",
            {
              effects: [
                { stat: "cash_S", amount: -6 },
                { stat: "brand", amount: 4 },
                { stat: "risk", amount: 4 },
                { stat: "invsent", amount: -1 },
                { stat: "energy", amount: -14 },
              ],
            },
            "You file. It will take years, it will cost more than this, and every investor call now opens with it.",
          ),
      },
      {
        id: "brief",
        label: "Brief a journalist about them",
        signal: "Nobody's hands are clean when this prints.",
        minStage: 2,
        apply: (s) =>
          spend(
            s,
            "copycat:brief",
            {
              effects: [
                { stat: "brand", amount: 6 },
                { stat: "respect", amount: -3 },
                { stat: "risk", amount: 5 },
              ],
              special: ["karma:-1"],
            },
            "The piece runs and it hurts them. Two people who like you work out where it came from.",
          ),
      },
    ],
  },
  {
    id: "advisory-board",
    tab: "company",
    label: "Form an advisory board",
    signal: "Four people who have already made your mistakes.",
    detail:
      "Not a board of directors — no control, no seats. Experience on a retainer and a small slice of the company.",
    minStage: 2,
    available: (s) => !s.flags.has_advisors,
    apply: (s) =>
      spend(
        s,
        "advisory-board",
        {
          effects: [
            { stat: "dilution_pct", amount: 2 },
            { stat: "invsent", amount: 2 },
            { stat: "respect", amount: 2 },
            { stat: "risk", amount: -2 },
          ],
          setFlags: ["has_advisors"],
        },
        "Four people who have already made your mistakes agree to take your calls. It costs a sliver of the company.",
      ),
  },
  {
    id: "patent",
    tab: "company",
    label: "File a patent",
    signal: "Slow, expensive, and it is a fence rather than a wall.",
    detail:
      "Eighteen months and a specialist lawyer. What you get is the right to make somebody stop.",
    costS: 3,
    minStage: 2,
    available: (s) => !s.flags.holds_patent,
    apply: (s) =>
      spend(
        s,
        "patent",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "val_pct", amount: 6 },
            { stat: "invsent", amount: 1 },
          ],
          setFlags: ["holds_patent"],
          special: ["moat:2yr"],
        },
        "The filing goes in. It will be granted long after it mattered, and it is on the balance sheet from today.",
      ),
  },
  {
    id: "audit",
    tab: "company",
    label: "Commission an audit",
    signal: "You pay somebody to find what you have been avoiding.",
    detail:
      "An outside firm goes through the books, the contracts and the compliance. Nobody enjoys it.",
    costS: 2,
    minStage: 2,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "audit",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "risk", amount: -5 },
            { stat: "invsent", amount: 1 },
            { stat: "energy", amount: -6 },
          ],
        },
        "They find three things. Two are paperwork and one of them would have been a very bad month.",
      ),
  },
  {
    id: "trade-body",
    tab: "company",
    label: "Join the trade body",
    signal: "A subscription, a lanyard, and a room full of rivals.",
    detail:
      "The industry association. Dull, political, and the only place your competitors have to be polite to you.",
    costS: 1,
    minStage: 2,
    available: (s) => !s.flags.trade_member,
    apply: (s) =>
      spend(
        s,
        "trade-body",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "suploy", amount: 1 },
            { stat: "respect", amount: 2 },
            { stat: "risk", amount: -1 },
          ],
          setFlags: ["trade_member"],
        },
        "You join. The meetings are dull and the third one is where you meet the supplier who saves your year.",
      ),
  },
  {
    id: "restructure",
    tab: "company",
    label: "Restructure the company",
    signal: "New reporting lines. Everybody hates it for a quarter.",
    detail:
      "Redraw who reports to whom. It is the cheapest thing on this tab and the one most likely to cost you somebody.",
    minStage: 4,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "restructure",
        {
          effects: [
            { stat: "burn_S_mo", amount: -0.5 },
            { stat: "morale", amount: -8 },
            { stat: "tdebt", amount: -1 },
            { stat: "energy", amount: -8 },
          ],
        },
        "New lines on the chart. Two people who were quietly holding it together find out they now report to each other.",
      ),
  },
  {
    id: "succession",
    tab: "company",
    label: "Hire a chief operating officer",
    signal: "Somebody else runs the day. You find out who you are.",
    detail:
      "A real operator above the team and below you. Expensive, permanent, and the only way you ever get a weekend back.",
    costS: 4,
    minStage: 4,
    available: (s) => !s.flags.has_coo,
    apply: (s) =>
      spend(
        s,
        "succession",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "burn_S_mo", amount: 0.8 },
            { stat: "energy", amount: 18 },
            { stat: "qual", amount: 4 },
            { stat: "morale", amount: 4 },
          ],
          setFlags: ["has_coo"],
        },
        "They start on the first. Within a month the things you were dropping are not being dropped, and you feel oddly redundant.",
      ),
  },

  // ── Team · everything that happens to people ──────────────────────────
  {
    id: "offsite",
    tab: "team",
    label: "Take the team offsite",
    signal: "Two days somewhere else. Nothing ships that week.",
    detail:
      "A minibus, a room with a whiteboard, and one evening where somebody finally says the thing.",
    costS: 2,
    yearly: true,
    available: (s) => s.stats.employees >= 3,
    apply: (s) =>
      spend(
        s,
        "offsite",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "morale", amount: 12 },
            { stat: "teamloy", amount: 1 },
            { stat: "energy", amount: -4 },
          ],
          setFlags: ["treated_team_well"],
        },
        "Two days out of the office. Nothing ships, and on the second evening somebody finally says the thing.",
      ),
  },
  {
    id: "training",
    tab: "team",
    label: "Send the team to training",
    signal: "They come back better. Some come back employable elsewhere.",
    detail: "Real courses with real certificates. It is the cheapest quality you can buy.",
    costS: 2,
    minStage: 2,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "training",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "qual", amount: 6 },
            { stat: "morale", amount: 4 },
            { stat: "tdebt", amount: -1 },
          ],
        },
        "Three of them come back with certificates and one comes back with a recruiter's number. Both of those are the same investment.",
      ),
  },
  {
    id: "equity-grants",
    tab: "team",
    label: "Grant the team equity",
    signal: "You give away part of it. They stop calling it your company.",
    detail:
      "An option pool. It costs ownership rather than cash, which is the one currency a young company has spare.",
    minStage: 2,
    available: (s) => !s.flags.option_pool && s.stats.employees >= 2,
    apply: (s) =>
      spend(
        s,
        "equity-grants",
        {
          effects: [
            { stat: "dilution_pct", amount: 8 },
            { stat: "morale", amount: 14 },
            { stat: "teamloy", amount: 2 },
            { stat: "invsent", amount: 1 },
          ],
          setFlags: ["option_pool", "treated_team_well"],
        },
        "Everybody gets a slice. The word they use in the kitchen changes from yours to ours, and it stays changed.",
      ),
  },
  {
    /**
     * Two-level, and the branches are three genuinely different theories of
     * where a senior person comes from — a rival, a much bigger company, or the
     * desk outside your office. Each costs a different thing, and one of them
     * costs no money at all.
     */
    id: "poach",
    tab: "team",
    label: "Bring in a senior hire",
    signal: "One person, and it changes how the whole team works.",
    detail:
      "The most consequential hire a company makes is its first properly senior one. Where they come from decides what you get.",
    minStage: 2,
    yearly: true,
    options: [
      {
        id: "rival",
        label: "Poach one from a rival",
        signal: "They know your market. They also know your rival's lawyers.",
        costS: 3,
        apply: (s) =>
          spend(
            s,
            "poach:rival",
            {
              effects: [
                { stat: "cash_S", amount: -3 },
                { stat: "emp", amount: 1 },
                { stat: "qual", amount: 6 },
                { stat: "share_pt", amount: 1 },
                { stat: "risk", amount: 3 },
              ],
            },
            "They start in a month and bring the market in their head. Their old employer's lawyer writes to you in six weeks.",
          ),
      },
      {
        id: "bigco",
        label: "Hire one out of a big company",
        signal: "Process, polish, and a salary from a different world.",
        costS: 4,
        apply: (s) =>
          spend(
            s,
            "poach:bigco",
            {
              effects: [
                { stat: "cash_S", amount: -4 },
                { stat: "burn_S_mo", amount: 0.5 },
                { stat: "emp", amount: 1 },
                { stat: "qual", amount: 5 },
                { stat: "tdebt", amount: -2 },
                { stat: "morale", amount: -3 },
              ],
            },
            "They arrive with process, and process is exactly what you needed and exactly what everybody resents in month one.",
          ),
      },
      {
        id: "promote",
        label: "Promote from inside",
        signal: "Costs nothing today. Somebody else wanted that job.",
        apply: (s) =>
          spend(
            s,
            "poach:promote",
            {
              effects: [
                { stat: "morale", amount: 6 },
                { stat: "teamloy", amount: 1 },
                { stat: "qual", amount: 2 },
                { stat: "burn_S_mo", amount: 0.15 },
              ],
              setFlags: ["treated_team_well"],
            },
            "You promote from inside. The person you chose is delighted, and the person you did not starts reading job adverts.",
          ),
      },
    ],
  },
  {
    id: "mentor",
    tab: "team",
    label: "Mentor the newest hire",
    signal: "Your afternoons, for a quarter. Nothing else changes.",
    detail: "You sit with the newest person once a week. It is the slowest lever on this tab.",
    available: (s) => s.stats.employees >= 2,
    apply: (s) =>
      spend(
        s,
        "mentor",
        {
          effects: [
            { stat: "energy", amount: -8 },
            { stat: "morale", amount: 5 },
            { stat: "qual", amount: 3 },
            { stat: "teamloy", amount: 1 },
          ],
        },
        "An hour a week with the newest person. In three months they are doing work you would have had to do yourself.",
      ),
  },
  {
    /**
     * The other end of the range from `fire`, which lets one person go. This
     * closes a whole function, and the branches are which one — a decision with
     * a completely different shape depending on what the company sells.
     */
    id: "cut-function",
    tab: "team",
    label: "Close a whole function",
    signal: "Not one person. A department, and the work it was doing.",
    detail:
      "The thing a company does when the runway is short and honesty is cheaper than hope. Pick what stops.",
    minStage: 3,
    yearly: true,
    available: (s) => s.stats.employees >= 5,
    options: [
      {
        id: "marketing",
        label: "Marketing",
        signal: "The pipeline is already full. It will not stay that way.",
        apply: (s) =>
          spend(
            s,
            "cut-function:marketing",
            {
              effects: [
                { stat: "emp", amount: -2 },
                { stat: "burn_S_mo", amount: -0.6 },
                { stat: "brand", amount: -8 },
                { stat: "ctr_pt", amount: -4 },
                { stat: "morale", amount: -10 },
              ],
            },
            "Marketing goes. The pipeline holds for a quarter on work already done, and then it does not.",
          ),
      },
      {
        id: "support",
        label: "Customer support",
        signal: "Cheapest to cut. The people who paid you notice first.",
        apply: (s) =>
          spend(
            s,
            "cut-function:support",
            {
              effects: [
                { stat: "emp", amount: -2 },
                { stat: "burn_S_mo", amount: -0.5 },
                { stat: "csat", amount: -12 },
                { stat: "churn_pt", amount: 4 },
                { stat: "morale", amount: -8 },
              ],
            },
            "Support goes to a shared inbox. The people who already paid you find out within a week.",
          ),
      },
      {
        id: "rnd",
        label: "Research and development",
        signal: "Costs nothing this year. Costs everything in three.",
        apply: (s) =>
          spend(
            s,
            "cut-function:rnd",
            {
              effects: [
                { stat: "emp", amount: -2 },
                { stat: "burn_S_mo", amount: -0.7 },
                { stat: "qual", amount: -6 },
                { stat: "tdebt", amount: 2 },
                { stat: "morale", amount: -12 },
              ],
            },
            "You stop building the next one. Nothing breaks this year, which is precisely how this mistake gets made.",
          ),
      },
    ],
  },
  {
    id: "healthcare",
    tab: "team",
    label: "Put the team on proper cover",
    signal: "Permanent cost. Nobody leaves over it, ever.",
    detail:
      "Real health cover, properly paid for. It never shows up in a growth chart and it shows up in every exit interview.",
    minStage: 3,
    available: (s) => !s.flags.team_covered && s.stats.employees >= 4,
    apply: (s) =>
      spend(
        s,
        "healthcare",
        {
          effects: [
            { stat: "burn_S_mo", amount: 0.6 },
            { stat: "morale", amount: 10 },
            { stat: "teamloy", amount: 2 },
          ],
          setFlags: ["team_covered", "treated_team_well"],
        },
        "The cover starts in January. Somebody uses it in March and never says so, and never leaves either.",
      ),
  },

  // ── Product · the half the industry lens does not own ─────────────────
  {
    /**
     * The product tab had NO shared activities at all — the twelve industry
     * lenses owned the whole of it, so a player who ran a restaurant and then a
     * software company learned nothing transferable about product. These three
     * are the transferable part.
     */
    id: "customer-calls",
    tab: "product",
    label: "Sit in on customer calls",
    signal: "A week of listening. Most of it is uncomfortable.",
    detail:
      "You take the support queue yourself for a week. It is the cheapest research that exists and nobody does it twice happily.",
    apply: (s) =>
      spend(
        s,
        "customer-calls",
        {
          effects: [
            { stat: "energy", amount: -9 },
            { stat: "qual", amount: 5 },
            { stat: "csat", amount: 4 },
            { stat: "cwp_pt", amount: 2 },
          ],
        },
        "You take the queue yourself for a week. Four people describe the same problem and you had been calling it something else.",
      ),
  },
  {
    id: "kill-feature",
    tab: "product",
    label: "Kill your worst feature",
    signal: "Some people loved it. Fewer than you think.",
    detail:
      "Remove something you shipped. The maintenance stops, the support tickets stop, and a handful of customers are furious.",
    minStage: 2,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "kill-feature",
        {
          effects: [
            { stat: "tdebt", amount: -2 },
            { stat: "qual", amount: 4 },
            { stat: "burn_S_mo", amount: -0.2 },
            { stat: "churn_pt", amount: 1 },
          ],
        },
        "You take it out. Eleven people write in angrily and the other nine thousand never notice it was there.",
      ),
  },
  {
    id: "ship-smaller",
    tab: "product",
    label: "Ship a smaller version on purpose",
    signal: "Half of what you promised, a quarter early.",
    detail:
      "Cut the release down to the part that works and put it in front of people now. Discipline, not cowardice.",
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "ship-smaller",
        {
          effects: [
            { stat: "rev_pct", amount: 5, durationQ: 2 },
            { stat: "tdebt", amount: -1 },
            { stat: "csat", amount: 3 },
            { stat: "brand", amount: -1 },
          ],
        },
        "You cut it to the part that works and ship it early. The demo is shorter and the feedback is real.",
      ),
  },

  // ── Market · reach, price and the name over the door ──────────────────
  {
    id: "sponsor",
    tab: "market",
    label: "Sponsor something",
    signal: "Your name on somebody else's thing, for a season.",
    detail:
      "Sponsorship buys association rather than attention. What you associate with is the whole decision.",
    yearly: true,
    options: [
      {
        id: "local-team",
        label: "The local team",
        signal: "Shirts, a banner, and every parent in the town.",
        costS: 1,
        apply: (s) =>
          spend(
            s,
            "sponsor:local-team",
            {
              effects: [
                { stat: "cash_S", amount: -1 },
                { stat: "brand", amount: 4 },
                { stat: "respect", amount: 2 },
                { stat: "csat", amount: 2 },
              ],
              setFlags: ["street_cred"],
            },
            "Your name goes on the shirts. It reaches four hundred people and every one of them lives near you.",
          ),
      },
      {
        id: "podcast",
        label: "A podcast your buyers listen to",
        signal: "Read out by somebody they already trust.",
        costS: 2,
        minStage: 2,
        apply: (s) =>
          spend(
            s,
            "sponsor:podcast",
            {
              effects: [
                { stat: "cash_S", amount: -2 },
                { stat: "brand", amount: 6 },
                { stat: "ctr_pt", amount: 5 },
                { stat: "cac_pt", amount: -2 },
              ],
            },
            "A host your buyers already trust reads your name out for thirty seconds a week. It works better than the number suggests.",
          ),
      },
      {
        id: "stadium",
        label: "Put your name on a building",
        signal: "Enormous, permanent, and impossible to measure.",
        costS: 10,
        minStage: 4,
        apply: (s) =>
          spend(
            s,
            "sponsor:stadium",
            {
              effects: [
                { stat: "cash_S", amount: -10 },
                { stat: "brand", amount: 20 },
                { stat: "val_pct", amount: 5 },
                { stat: "invsent", amount: -1 },
                { stat: "cac_pt", amount: 2 },
              ],
            },
            "Your name goes on a building. Everybody has heard of you now, and your board asks what it returned.",
          ),
      },
    ],
  },
  {
    /**
     * The pricing tab could previously only go UP — `price-up` and nothing
     * facing the other way — which taught that price is a ratchet. It is not,
     * and the third branch here is the one most founders should take and least
     * want to.
     */
    id: "pricing-test",
    tab: "market",
    label: "Run a pricing experiment",
    signal: "You find out what you are actually worth.",
    detail:
      "A real test on real customers for a quarter. The answer is usually not the one you were hoping for.",
    yearly: true,
    minStage: 2,
    options: [
      {
        id: "cut",
        label: "Cut prices and chase volume",
        signal: "More of them, each worth less. Hard to undo.",
        apply: (s) =>
          spend(
            s,
            "pricing-test:cut",
            {
              effects: [
                { stat: "gm_pt", amount: -4 },
                { stat: "rev_pct", amount: 9, durationQ: 4 },
                { stat: "share_pt", amount: 2 },
                { stat: "churn_pt", amount: -2 },
                { stat: "cwp_pt", amount: -3 },
              ],
            },
            "You cut. Volume comes, margin goes, and putting the price back up will be somebody's problem in two years.",
          ),
      },
      {
        id: "hold",
        label: "Hold the price and add value",
        signal: "The slow answer. It compounds and nobody notices.",
        costS: 2,
        apply: (s) =>
          spend(
            s,
            "pricing-test:hold",
            {
              effects: [
                { stat: "cash_S", amount: -2 },
                { stat: "qual", amount: 5 },
                { stat: "cwp_pt", amount: 4 },
                { stat: "csat", amount: 5 },
                { stat: "churn_pt", amount: -2 },
              ],
            },
            "You leave the price alone and make the thing better. Nothing happens for two quarters and then churn quietly falls.",
          ),
      },
      {
        id: "premium",
        label: "Take it upmarket",
        signal: "Fewer customers. You will find out how few.",
        minStage: 3,
        apply: (s) =>
          spend(
            s,
            "pricing-test:premium",
            {
              effects: [
                { stat: "gm_pt", amount: 7 },
                { stat: "churn_pt", amount: 5 },
                { stat: "share_pt", amount: -2 },
                { stat: "brand", amount: 4 },
                { stat: "cwp_pt", amount: 3 },
              ],
            },
            "You move upmarket. A third of the list leaves and the two thirds that stay are worth more than all of them were.",
          ),
      },
    ],
  },
  {
    id: "partner",
    tab: "market",
    label: "Sign a distribution partner",
    signal: "Their reach, their terms, and a slice of every sale.",
    detail:
      "Somebody else sells your product to people you cannot reach. They take a margin and they own the customer.",
    costS: 2,
    minStage: 3,
    available: (s) => !s.flags.has_distributor,
    apply: (s) =>
      spend(
        s,
        "partner",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "rev_pct", amount: 16, durationQ: 6 },
            { stat: "gm_pt", amount: -5 },
            { stat: "share_pt", amount: 3 },
            { stat: "suploy", amount: 1 },
          ],
          setFlags: ["has_distributor"],
        },
        "They start shipping in the spring. Your revenue line bends upward and your margin line bends the other way.",
      ),
  },
  {
    id: "loyalty",
    tab: "market",
    label: "Launch a loyalty programme",
    signal: "Cheaper than finding new ones. Slower than it sounds.",
    detail:
      "Reward the people who already buy. It is the least glamorous growth there is and the most durable.",
    costS: 2,
    minStage: 2,
    available: (s) => !s.flags.loyalty_live,
    apply: (s) =>
      spend(
        s,
        "loyalty",
        {
          effects: [
            { stat: "cash_S", amount: -2 },
            { stat: "churn_pt", amount: -4 },
            { stat: "csat", amount: 6 },
            { stat: "gm_pt", amount: -2 },
            { stat: "cac_pt", amount: -3 },
          ],
          setFlags: ["loyalty_live"],
        },
        "You start rewarding the people who were already coming back. The effect is invisible for two quarters and then it is the whole business.",
      ),
  },
  {
    id: "rebrand",
    tab: "market",
    label: "Rebrand",
    signal: "New everything. The old customers hate it first.",
    detail:
      "A whole new identity — name kept, everything else replaced. Expensive, and half of them will tell you they preferred the old one.",
    costS: 4,
    minStage: 3,
    yearly: true,
    apply: (s) =>
      spend(
        s,
        "rebrand",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "brand", amount: 10 },
            { stat: "cwp_pt", amount: 3 },
            { stat: "csat", amount: -4 },
            { stat: "ctr_pt", amount: 3 },
          ],
        },
        "The new identity goes live on a Monday. Half the replies say they preferred the old one and the click-through says otherwise.",
      ),
  },
  {
    id: "price-down",
    tab: "market",
    label: "Cut prices 10%",
    signal: "The other direction, and the harder one to reverse.",
    detail:
      "The tab could only ever raise prices, which taught that price is a ratchet. It is not.",
    apply: (s) =>
      spend(
        s,
        "price-down",
        {
          effects: [
            { stat: "gm_pt", amount: -3 },
            { stat: "churn_pt", amount: -2 },
            { stat: "rev_pct", amount: 5, durationQ: 3 },
          ],
        },
        "You drop the price. More of them buy, each one is worth less, and nobody ever thanks you for it.",
      ),
  },

  // ── Assets · what the company owns and what it gives away ─────────────
  {
    /**
     * `insurance_halves_damage` has existed in the effect vocabulary since the
     * engine was written and could only ever be reached through an authored
     * event. This is the first way a player can decide to be insured, which is
     * the only interesting version of insurance.
     */
    id: "insure",
    tab: "assets",
    label: "Insure the business",
    signal: "You pay every month for something you hope wastes your money.",
    detail:
      "Proper cover on the premises, the product and the liability. It halves the damage of the worst thing that can happen.",
    costS: 1,
    minStage: 2,
    available: (s) => !s.flags.insured,
    apply: (s) =>
      spend(
        s,
        "insure",
        {
          effects: [
            { stat: "cash_S", amount: -1 },
            { stat: "burn_S_mo", amount: 0.25 },
            { stat: "risk", amount: -3 },
          ],
          special: ["insurance_halves_damage"],
        },
        "The policy starts on the first. You will resent the premium every month until the one month you do not.",
      ),
  },
  {
    id: "warehouse",
    tab: "assets",
    label: "Lease a warehouse",
    signal: "Room to hold stock. Rent whether it is full or empty.",
    detail:
      "Space of your own to hold what you sell. It smooths supply and it is a fixed cost forever.",
    costS: 3,
    minStage: 3,
    available: (s) => !s.flags.has_warehouse,
    apply: (s) =>
      spend(
        s,
        "warehouse",
        {
          effects: [
            { stat: "cash_S", amount: -3 },
            { stat: "burn_S_mo", amount: 0.4 },
            { stat: "gm_pt", amount: 3 },
            { stat: "suploy", amount: 1 },
            { stat: "csat", amount: 3 },
          ],
          setFlags: ["has_warehouse"],
        },
        "You take the lease. Orders start going out the same day they come in, and the rent arrives whether they do or not.",
      ),
  },
  {
    id: "sell-office",
    tab: "assets",
    label: "Sell the building",
    signal: "Cash today, rent forever. Sometimes that is the trade.",
    detail:
      "You own the room. Selling it turns an illiquid asset into runway and a landlord into your problem again.",
    minStage: 2,
    available: (s) => !!s.flags.own_building,
    apply: (s) =>
      spend(
        s,
        "sell-office",
        {
          effects: [
            { stat: "cash_S", amount: 7 },
            { stat: "burn_S_mo", amount: 0.4 },
            { stat: "val_pct", amount: -3 },
          ],
          clearFlags: ["own_building"],
        },
        "You sell the building and lease it back. There is money in the account again, and rent is somebody else's income once more.",
      ),
  },
  {
    /**
     * Two-level, and the branches are the three things a company actually has
     * to give: money, what it makes, and the founder's own time. The last one
     * costs no cash and the most energy, which is the honest shape of it.
     */
    id: "give-back",
    tab: "assets",
    label: "Give something away",
    signal: "It comes back, eventually, in a form you cannot bank.",
    detail:
      "Companies give to the places they operate in. What you give says which kind of company you are.",
    yearly: true,
    minStage: 2,
    options: [
      {
        id: "cash",
        label: "Write a cheque",
        signal: "The simplest one, and the one people believe least.",
        costS: 2,
        apply: (s) =>
          spend(
            s,
            "give-back:cash",
            {
              effects: [
                { stat: "cash_S", amount: -2 },
                { stat: "brand", amount: 4 },
                { stat: "respect", amount: 1 },
              ],
              special: ["karma:1"],
            },
            "The cheque goes out. It is announced, it is appreciated, and a few people say it was cheaper than caring.",
          ),
      },
      {
        id: "product",
        label: "Give away what you make",
        signal: "Costs margin, not cash. They use it in front of others.",
        apply: (s) =>
          spend(
            s,
            "give-back:product",
            {
              effects: [
                { stat: "gm_pt", amount: -2 },
                { stat: "brand", amount: 6 },
                { stat: "csat", amount: 3 },
                { stat: "ctr_pt", amount: 2 },
              ],
              special: ["karma:1"],
            },
            "You give away what you make. It costs margin rather than cash, and every one of them is used somewhere visible.",
          ),
      },
      {
        id: "time",
        label: "Give your own time",
        signal: "The one that costs you personally. It shows.",
        apply: (s) =>
          spend(
            s,
            "give-back:time",
            {
              effects: [
                { stat: "energy", amount: -12 },
                { stat: "respect", amount: 4 },
                { stat: "brand", amount: 3 },
                { stat: "morale", amount: 4 },
              ],
              setFlags: ["street_cred"],
              special: ["karma:1"],
            },
            "You turn up yourself, every week, for a term. It is the only version of this nobody questions.",
          ),
      },
    ],
  },
  {
    id: "emergency-fund",
    tab: "assets",
    label: "Ring-fence a reserve",
    signal: "Money you promise not to spend. Then you keep the promise.",
    detail:
      "A separate account with a quarter of your costs in it, and a rule about touching it. Dull, and it is the difference between a bad month and Chapter 7.",
    costS: 4,
    minStage: 2,
    available: (s) => !s.flags.has_reserve,
    apply: (s) =>
      spend(
        s,
        "emergency-fund",
        {
          effects: [
            { stat: "cash_S", amount: -4 },
            { stat: "risk", amount: -4 },
            { stat: "invsent", amount: 1 },
          ],
          setFlags: ["has_reserve"],
          special: ["insurance_halves_damage"],
        },
        "You move it into a separate account and tell yourself it is not there. Twice a year you will be very glad it is.",
      ),
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
  /*
   * A chooser with nothing in it is a door onto a wall. Two-level rows carry
   * branches that open at different stages — the letter now, the lawsuit at
   * stage 3 — so a row whose every branch is still gated is absent rather than
   * pressable-and-empty.
   */
  if (activity.options && !activity.options.some((o) => isOptionOfferable(o, state)))
    return false;
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
  /*
   * A two-level row is affordable when ANY of its branches is. Judging the
   * parent by its own (absent) price would call every chooser free; judging it
   * by the dearest branch would grey out "talk to the press" because the
   * national desk is out of reach, and hide the local paper behind it.
   */
  if (activity.options?.length) {
    return activity.options
      .filter((o) => isOptionOfferable(o, state))
      .some((o) => canAffordOption(o, state));
  }
  if (!activity.costS) return true;
  return state.stats.cash >= activity.costS * S_UNIT[state.stage];
}

// ── Two-level activities ─────────────────────────────────────────────────────

/** A branch the player could take right now — stage and condition, not cash. */
export function isOptionOfferable(option: ActivityOption, state: RunState): boolean {
  if (option.minStage && state.stage < option.minStage) return false;
  if (option.available && !option.available(state)) return false;
  return true;
}

export function canAffordOption(option: ActivityOption, state: RunState): boolean {
  if (!option.costS) return true;
  return state.stats.cash >= option.costS * S_UNIT[state.stage];
}

/** The branches worth drawing. Never empty for an offerable two-level row —
 *  `isAvailable` refuses the parent when every branch is out of reach. */
export const optionsFor = (activity: Activity, state: RunState): ActivityOption[] =>
  (activity.options ?? []).filter((o) => isOptionOfferable(o, state));

/**
 * RUN IT — one door for both shapes of activity.
 *
 * Central rather than duplicated because there are exactly two callers and they
 * are the two that must never disagree: `runActivity` in GameProvider, which is
 * what a player's tap reaches, and the replay verifier in
 * lib/leaderboard/replay.ts, which re-runs the same tap months later to decide
 * whether a leaderboard row is real. A branch resolved one way in the app and
 * another in the verifier is a run that plays fine and then vanishes off the
 * board with no explanation anybody could give.
 *
 * Returns false rather than throwing when the branch does not exist or is not
 * reachable — a tape naming a renamed option, a stale sheet held open across a
 * promotion. The caller decides whether that is a skip or a no-op.
 */
export function applyActivity(
  activity: Activity,
  state: RunState,
  optionId?: string,
): boolean {
  if (activity.options?.length) {
    const option = activity.options.find((o) => o.id === optionId);
    if (!option || !isOptionOfferable(option, state)) return false;
    option.apply(state);
    /*
     * The PARENT goes in the ledger, and it has to be written here.
     *
     * `spend` records whatever id it was handed, and a branch hands it its own
     * ("press:national") so that the seeded RNG differs per branch. That is
     * right for the RNG and wrong for the ledger: `isSpentThisYear` asks for
     * `activity.id`, so without this line a `yearly` chooser is never spent —
     * a player could talk to the local paper, the trade weekly, the podcast
     * and the national desk in the same fiscal year, which is the exact bug
     * `yearly` was read for in the first place.
     */
    recordActivityUse(state, activity.id);
    return true;
  }
  if (!activity.apply) return false;
  activity.apply(state);
  return true;
}
