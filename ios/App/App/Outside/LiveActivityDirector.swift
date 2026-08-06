import Foundation

#if canImport(ActivityKit)
    import ActivityKit
#endif

/**
 What is on the lock screen, and why.

 The web layer never says "start" or "end". It publishes the whole of what
 should be true and this file works out the difference — the same contract
 `GlassChromeController` has with `setChrome`, and for the same reason: a
 start/update/end protocol across a bridge is a second source of truth about
 what is on screen, and the two of them disagree the first time a message is
 dropped, replayed or reordered.

 ── The rules it applies ─────────────────────────────────────────────────────

 · An activity exists only for a company that is **open and alive**. A Chapter 7
   is not something in progress, and leaving a dead company glowing on the lock
   screen is the app failing to notice that the game ended.
 · An activity is **keyed by `runId`**. Switching islands ends the old one and
   starts a new one; a rename, a month, a bankruptcy scare all update the one
   that is already there. Restarting on every publish would work and would
   flash the lock screen twelve times a fiscal year.
 · **The player's switch wins**, and so does the system's. `liveActivities` in
   the snapshot is the Settings row; `areActivitiesEnabled` is iOS Settings ▸
   Face ID & Passcode. Either being off means every activity comes down now.

 Everything here is best-effort by construction. There is no state in which a
 failed request, a refused update or a missing framework costs the player
 anything at all — the game is in the app, and this is a window onto it.
 */
enum LiveActivityDirector {

    /// True when ActivityKit exists on this OS and the player has not turned
    /// Live Activities off system-wide.
    static var authorized: Bool {
        #if canImport(ActivityKit)
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
        #endif
        return false
    }

    /// What is live after the most recent `apply`. Reported straight back
    /// across the bridge, so the web layer can say so in a log line rather
    /// than infer it.
    struct Live {
        var fiscalYear = false
        var market = false
    }

    /**
     Make the lock screen match the snapshot.

     Synchronous in what it decides and asynchronous in what it does: requests
     are immediate, updates and endings are `async` in ActivityKit and are
     driven from detached tasks. The return value describes the intent, which
     is what the caller can honestly report — an update that fails leaves the
     previous content up, which is still an activity, so the answer stays true.
     */
    @discardableResult
    static func apply(_ snapshot: OutsideSnapshot) -> Live {
        #if canImport(ActivityKit)
            guard #available(iOS 16.2, *), authorized else { return Live() }

            let wanted = snapshot.liveActivities && snapshot.hasLiveCompany
            guard wanted, let company = snapshot.company else {
                endAll()
                return Live()
            }

            var live = Live()
            live.fiscalYear = applyFiscalYear(company: company)
            live.market = applyMarket(snapshot: snapshot, company: company)
            return live
        #else
            return Live()
        #endif
    }

    /// Take everything down. The Settings switch, and burying a company.
    static func endAll() {
        #if canImport(ActivityKit)
            guard #available(iOS 16.2, *) else { return }
            for activity in Activity<FiscalYearAttributes>.activities {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }
            }
            for activity in Activity<MarketAttributes>.activities {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }
            }
        #endif
    }

    // ── The fiscal year ─────────────────────────────────────────────────────

    #if canImport(ActivityKit)
        @available(iOS 16.2, *)
        private static func applyFiscalYear(company: OutsideCompany) -> Bool {
            let state = FiscalYearAttributes.ContentState(company: company)
            let content = ActivityContent(
                state: state, staleDate: Date().addingTimeInterval(OutsideStaleness.fiscalYear))

            let running = Activity<FiscalYearAttributes>.activities
            if let mine = running.first(where: { $0.attributes.runId == company.runId }) {
                // Everything else on screen belongs to a company that is no
                // longer open. Ending them here rather than in `endAll` keeps
                // the switch-islands case to one pass.
                for other in running where other.id != mine.id {
                    Task { await other.end(nil, dismissalPolicy: .immediate) }
                }
                Task { await mine.update(content) }
                return true
            }

            for other in running {
                Task { await other.end(nil, dismissalPolicy: .immediate) }
            }
            do {
                _ = try Activity.request(
                    attributes: FiscalYearAttributes(runId: company.runId),
                    content: content,
                    pushType: nil)
                return true
            } catch {
                /*
                 The documented refusals are all legitimate and none of them is
                 the app's to fix: the player has too many activities up
                 already, the system is under pressure, or authorisation
                 changed between the check above and this line. Reporting false
                 is the honest answer and the web layer logs it.
                 */
                return false
            }
        }

        // ── RobinGhood ──────────────────────────────────────────────────────

        @available(iOS 16.2, *)
        private static func applyMarket(snapshot: OutsideSnapshot, company: OutsideCompany) -> Bool
        {
            let running = Activity<MarketAttributes>.activities

            // No positions is the common case, and it is a reason to have no
            // activity rather than an activity showing zero.
            guard let market = snapshot.market, !market.positions.isEmpty else {
                for activity in running {
                    Task { await activity.end(nil, dismissalPolicy: .immediate) }
                }
                return false
            }

            let state = MarketAttributes.ContentState(market: market, companyName: company.name)
            let content = ActivityContent(
                state: state, staleDate: Date().addingTimeInterval(OutsideStaleness.market))

            if let mine = running.first(where: { $0.attributes.runId == company.runId }) {
                for other in running where other.id != mine.id {
                    Task { await other.end(nil, dismissalPolicy: .immediate) }
                }
                Task { await mine.update(content) }
                return true
            }

            for other in running {
                Task { await other.end(nil, dismissalPolicy: .immediate) }
            }
            do {
                _ = try Activity.request(
                    attributes: MarketAttributes(runId: company.runId),
                    content: content,
                    pushType: nil)
                return true
            } catch {
                return false
            }
        }
    #endif
}
