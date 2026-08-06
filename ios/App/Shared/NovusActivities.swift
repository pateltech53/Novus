#if canImport(ActivityKit)
    import ActivityKit
#endif
import Foundation

/**
 The two things Novus is allowed to put on a lock screen.

 An `ActivityAttributes` type is a contract between two processes that are
 built together and then run apart: the app requests and updates the activity,
 the widget extension draws it, and an activity started by yesterday's binary
 is still running under today's. So the split between the static half and the
 moving half is not a style choice.

 · **Attributes** are fixed for the life of the activity. Only `runId` is here,
   and it is here for one reason: it is how the app tells "the activity on
   screen is for the company that is open" from "the activity on screen is for
   the company the player just switched away from". Ending and restarting on
   every publish would work and would flash the lock screen every month.

 · **ContentState** is everything that moves, which in this game is everything
   else — including the company's name, because a founder can rename the
   company from Settings and an attribute cannot be updated.

 ── The size budget ──────────────────────────────────────────────────────────

 ActivityKit caps the encoded attributes plus state at 4 KB. Carrying the whole
 `OutsideCompany` — twelve months of two ledger series included — encodes to
 roughly a quarter of that, which buys something worth having: the lock screen
 card and the home screen widget are drawn by the same views from the same
 struct, so they cannot disagree about what a company looks like.
 */

#if canImport(ActivityKit)

    /// The fiscal year, in progress. One per open company.
    @available(iOS 16.1, *)
    struct FiscalYearAttributes: ActivityAttributes {
        /// The company this activity belongs to. Never changes; that is the point.
        let runId: String

        struct ContentState: Codable, Hashable {
            /// The whole company, so every surface draws it from one shape.
            let company: OutsideCompany
        }
    }

    /// RobinGhood, priced on the player's real clock rather than the fiscal one.
    @available(iOS 16.1, *)
    struct MarketAttributes: ActivityAttributes {
        /// Which company's brokerage account this is. Positions live on the run.
        let runId: String

        struct ContentState: Codable, Hashable {
            let market: OutsideMarket
            /// The company's name, for the one line of context the card has room for.
            let companyName: String
        }
    }

#endif

// ── How long a figure stays believable ──────────────────────────────────────

/**
 The two stale dates, which are a design decision rather than a constant.

 iOS dims a Live Activity once its `staleDate` passes, and the right answer is
 different for the two of them because they age at completely different rates:

 · **The fiscal year does not move on its own.** Time in this game advances
   only when the player taps (Brand Law 1), so a score from four hours ago is
   not stale — it is exactly right, and dimming it would say the app had lost
   track of a company that has not changed. Eight hours is a compromise
   with the one thing that IS a clock: the player's own sense of whether they
   have played today.

 · **RobinGhood moves every minute**, and the extension re-prices it locally
   from `MarketMath`. What actually goes stale there is not the price but the
   POSITION — a share count the player changed in the app. Two hours is short
   enough that a sold-out holding stops claiming to exist for long.
 */
enum OutsideStaleness {
    static let fiscalYear: TimeInterval = 8 * 60 * 60
    static let market: TimeInterval = 2 * 60 * 60
}
