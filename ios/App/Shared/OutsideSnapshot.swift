import Foundation

/**
 The company as the phone sees it when the app is shut.

 The mirror of `lib/outside/snapshot.ts`, and the ONLY thing the widget
 extension knows about the game. There is no engine over here, no save file it
 can read and no way to ask a follow-up question: whatever the app last
 published is the whole truth until it publishes again.

 ── Why every figure carries its own text ────────────────────────────────────

 `fmtMoney` is the app's answer to "what does $12,400 look like" — 12.4K, with
 a U+2212 for the minus and a trim rule for the decimal. Re-deriving that here
 would be a second implementation of a display rule on the far side of a
 bridge, and the two would disagree the first time either changed.

 So `OutsideFigure` arrives as a pair: the quantity, which is what a gauge or
 a meter needs, and the exact string the app itself would print, which is what
 gets drawn. **Nothing in this extension formats a number that has a
 `text` beside it.**

 ── Why every field is either non-optional or explicitly optional ────────────

 A widget that fails to decode shows its placeholder forever and reports
 nothing. `OutsideStore` treats a decode failure as "no snapshot" rather than
 crashing, but the cheaper fix is upstream: the TypeScript builder writes every
 key on every publish, including nulls, so the shapes below are exact rather
 than defensive.
 */

/// Wire format version. A snapshot from a newer app is refused rather than
/// half-read — see `OutsideStore.decode`.
let outsideWireVersion = 1

/// How the app colours a change. Already resolved for the direction that is
/// GOOD, so nothing here has to know that rising burn is bad news.
enum OutsideTone: String, Codable {
    case up, down, flat
}

struct OutsideFigure: Codable, Hashable {
    /// The quantity, for a gauge or a bar.
    let value: Double
    /// Exactly what the app would print. Draw this; never re-derive it.
    let text: String
    /// Month over month. Null — not "+$0" — when there is no history to compare.
    let deltaText: String?
    let deltaTone: OutsideTone?
}

/**
 One of the five stats the game actually steers by.

 Not a dashboard somebody assembled: `weakestCategory()` in
 lib/engine/events.ts — the function that decides which kind of event to aim at
 a player next — reads exactly these five. A widget showing them is showing the
 numbers the engine is looking at when it picks what happens to you next month.
 */
struct OutsideScore: Codable, Hashable {
    /// "BRAND". The app's own label, as `StatRings` prints it.
    let label: String
    /// 0–100, already rounded.
    let value: Int
    /// SF Symbol.
    let symbol: String
    /// The event category this stat is attacked through — MKT, PRD, PPL, CUS, LIF.
    let category: String
}

extension OutsideScore {
    /// 0…1, for a meter.
    var fill: Double { Double(max(0, min(100, value))) / 100 }
}

struct OutsideCompany: Codable, Hashable {
    let slot: Int
    let runId: String
    let name: String
    let founder: String
    let industry: String
    let industryName: String
    /// SF Symbol, chosen in TypeScript for the same reason `NativeTab.symbol` is.
    let symbol: String
    let stage: Int
    let stageName: String
    let year: Int
    /// 1…12.
    let month: Int
    /// Month 12. Not "nearly done" — a different state, drawn in prestige gold
    /// everywhere, because the fiscal year does not close without a scored
    /// camera performance.
    let atGate: Bool
    let alive: Bool
    let endedBy: String?
    /// "MAY → JUN", or "DEC → FY4" at the gate. The app's own capsule.
    let badge: String
    let badgeLabel: String

    let cash: OutsideFigure
    let burn: OutsideFigure
    let valuation: OutsideFigure

    /// Brand, Quality, Morale, CSAT, Energy — in that order, always all five.
    /// The order is fixed so a surface with room for three gets `StatRings`'
    /// own trio: the three levers a founder actually steers.
    let scores: [OutsideScore]
    /// Index into `scores` of the lowest — the one events are about to be
    /// aimed at.
    let weakestIndex: Int
    /// That lowest score is under 45, which is the line `weakestCategory()`
    /// draws in lib/engine/events.ts. Above it the game is not aiming at you.
    let underPressure: Bool

    let employees: Int
    let equityPct: Int
    let peakValuationText: String
}

extension OutsideCompany {
    /**
     The stat the game is about to aim at.

     Bounds-checked rather than subscripted straight, because `weakestIndex`
     arrives over a wire: a snapshot from a build that shipped six scores would
     otherwise crash a widget rather than draw five of them.
     */
    var weakest: OutsideScore? {
        scores.indices.contains(weakestIndex) ? scores[weakestIndex] : scores.first
    }

    /// `StatRings`' trio — Brand, Quality, Morale. The three a founder steers.
    var headlineScores: [OutsideScore] { Array(scores.prefix(3)) }

    /// Twelve ticks, one per fiscal month, `month` of them filled.
    var monthsElapsed: Int { max(0, min(12, month)) }
}

/// One held ticker, with everything needed to price it here. See MarketMath.swift.
struct OutsidePosition: Codable, Hashable {
    let symbol: String
    let name: String
    let shares: Double
    let avgCost: Double
    /// The ticker's own constants, so this side never carries a second copy.
    let base: Double
    let drift: Double
    let vol: Double
    /// The engine's own answer at publish time. The anchor, not the source.
    let value: Double
    let unrealised: Double
}

struct OutsideMarket: Codable, Hashable {
    let positions: [OutsidePosition]
    let brokerageCash: Double
    let value: Double
    let cost: Double
    let unrealised: Double
    /// Minutes since epoch — the clock both sides price against.
    let minute: Int
}

struct OutsideIsland: Codable, Hashable {
    let slot: Int
    let name: String
    let industry: String
    let symbol: String
    let year: Int
    let alive: Bool
    let endedBy: String?
    let valuation: Double
    let valuationText: String
    let peak: Double
    let peakText: String
}

struct OutsideSnapshot: Codable, Hashable {
    let v: Int
    /// Null when no company is open — the widgets draw their empty state.
    let company: OutsideCompany?
    /// Null when the player holds nothing. No positions, no activity.
    let market: OutsideMarket?
    let islands: [OutsideIsland]
    /// The player's switch, for Live Activities and nothing else.
    let liveActivities: Bool
    /// Device clock, epoch ms. For "as of", never for conflict resolution.
    let at: Double
}

extension OutsideSnapshot {
    var publishedAt: Date { Date(timeIntervalSince1970: at / 1000) }

    /**
     Something worth putting on a lock screen.

     A company that has gone under is still worth a widget — the headstone is
     the point of Still Standing — but it is not worth an activity, because an
     activity is for something in progress and a Chapter 7 is not.
     */
    var hasLiveCompany: Bool { company?.alive == true }
}

// ── The one placeholder ─────────────────────────────────────────────────────

/**
 What a widget draws in the gallery, and in the seconds before a real snapshot
 has been read off disk.

 Deliberately a real, plausible company rather than zeroes: a preview full of
 `$0` and `0` tells someone browsing the widget gallery that the widget is
 broken. The numbers are the game's own opening position — Cash 25S, Burn 2S/mo
 at stage 1 (GDD §4 T1), which is where every run in this game actually starts.
 */
extension OutsideSnapshot {
    static let placeholder = OutsideSnapshot(
        v: outsideWireVersion,
        company: OutsideCompany(
            slot: 0,
            runId: "preview",
            name: "Brewzo",
            founder: "You",
            industry: "FOOD",
            industryName: "Food & Beverage",
            symbol: "fork.knife",
            stage: 2,
            stageName: "Startup",
            year: 3,
            month: 7,
            atGate: false,
            alive: true,
            endedBy: nil,
            badge: "JUL → AUG",
            badgeLabel: "Brewzo. Fiscal year 3.",
            cash: OutsideFigure(value: 412_000, text: "$412K", deltaText: "−$18K", deltaTone: .down),
            burn: OutsideFigure(value: 58_000, text: "$58K", deltaText: "+$4K", deltaTone: .down),
            valuation: OutsideFigure(value: 4_100_000, text: "$4.1M", deltaText: "+$260K", deltaTone: .up),
            scores: [
                OutsideScore(label: "BRAND", value: 61, symbol: "megaphone", category: "MKT"),
                OutsideScore(label: "QUALITY", value: 74, symbol: "checkmark.seal", category: "PRD"),
                OutsideScore(label: "MORALE", value: 52, symbol: "person.2", category: "PPL"),
                OutsideScore(label: "CSAT", value: 68, symbol: "heart", category: "CUS"),
                OutsideScore(label: "ENERGY", value: 47, symbol: "bolt", category: "LIF"),
            ],
            // Energy, at 47 — the lowest of the five and just above the line,
            // which is the ordinary state of a company that is doing fine.
            weakestIndex: 4,
            underPressure: false,
            employees: 6,
            equityPct: 78,
            peakValuationText: "$4.4M"
        ),
        market: nil,
        islands: [],
        liveActivities: true,
        at: 0
    )
}
