import Foundation

/**
 The app's display rules, for the one case that cannot use them.

 ── Read this before adding a caller ─────────────────────────────────────────

 **Almost nothing out here is allowed to format a number.** Every figure in
 `OutsideSnapshot` arrives with the exact string `lib/engine/format.ts`
 produced, and drawing that string is the rule — see the note at the top of
 lib/outside/snapshot.ts for why a second implementation of a *display rule*
 across a process boundary is a bug waiting for the first time either side
 changes.

 This file exists for the single exception: RobinGhood is priced from the real
 clock, the extension re-prices it for minutes the app never saw
 (`MarketMath`), and a number that did not exist when the app published cannot
 arrive with a string attached. There is no way to have live prices and no
 formatter here; the choice is which of the two to give up.

 So the rule becomes a narrower one: this is a PORT, not a reimplementation. It
 follows `fmtMoney`, `fmtDelta` and `fmtPct` line for line, including the
 U+2212 minus sign and the 10K threshold below which money is written out in
 full — and `scripts/market-fixture.mjs` checks it against the real thing on
 every debug launch, the same way the price maths is checked. If a rule here
 stops matching format.ts, the app says so before anyone ships it.
 */
enum NvFormat {

    /// `fmtMoney` — money compresses: 12.4K / 3.1M / 1.2B (GDD §5).
    static func money(_ n: Double) -> String {
        // U+2212 MINUS SIGN, not a hyphen. The app uses it everywhere a
        // figure is negative and the two are visibly different in a
        // monospaced face.
        let sign = n < 0 ? "\u{2212}" : ""
        let abs = Swift.abs(n)
        if abs >= 1_000_000_000 { return "\(sign)$\(trim(abs / 1_000_000_000))B" }
        if abs >= 1_000_000 { return "\(sign)$\(trim(abs / 1_000_000))M" }
        if abs >= 10_000 { return "\(sign)$\(trim(abs / 1_000))K" }
        return "\(sign)$\(grouped(abs))"
    }

    /// `fmtDelta` — a signed money change: "+$3.2K", "−$2,000".
    static func delta(_ n: Double) -> String {
        // `money` renders its own minus for a negative, so the sign is applied
        // to the absolute value exactly once.
        "\(n < 0 ? "\u{2212}" : "+")\(money(Swift.abs(n)))"
    }

    /// `fmtPct` — one decimal at most, and only when there is one.
    static func percent(_ n: Double, signed: Bool = false) -> String {
        let rounded = (n * 10).rounded() / 10
        let body = "\(shortest(Swift.abs(rounded)))%"
        guard signed else { return body }
        return rounded < 0 ? "\u{2212}\(body)" : "+\(body)"
    }

    // ── The two rules the above are made of ─────────────────────────────────

    /**
     `trim` from format.ts: whole numbers above 100, one decimal below it, and
     never a trailing ".0".

     `(x * 10).rounded() / 10` rather than `String(format: "%.1f")` on the raw
     value, and the difference is not pedantry. `printf` rounds an exact tie to
     even — 3.25 becomes "3.2" — and JavaScript's `toFixed` rounds it away from
     zero, to "3.3". `Double.rounded()` is away-from-zero by default, so
     rounding first and formatting second is what makes the two agree.
     */
    private static func trim(_ x: Double) -> String {
        // `%.0f` rather than `String(Int(…))`: converting a Double that
        // overflows Int traps, and this is fed by a valuation that the engine
        // is perfectly capable of running away with.
        if x >= 100 { return String(format: "%.0f", x.rounded()) }
        var s = String(format: "%.1f", (x * 10).rounded() / 10)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }

    /// `Math.round(abs).toLocaleString("en-US")` — grouped thousands.
    private static func grouped(_ x: Double) -> String {
        grouping.string(from: NSNumber(value: Int(x.rounded()))) ?? String(Int(x.rounded()))
    }

    /**
     JavaScript's number-to-string, for the values `fmtPct` can produce.

     `${x}` in JS prints the shortest decimal that round-trips, which for a
     value already rounded to one decimal place means "17" or "17.5" and never
     "17.0". Anything else here would put a decimal on every whole percentage.
     */
    private static func shortest(_ x: Double) -> String {
        x == x.rounded() ? String(format: "%.0f", x) : String(format: "%.1f", x)
    }

    /// Built once. A `NumberFormatter` per call is expensive, and a widget
    /// draws several figures in a process that gets a few milliseconds.
    private static let grouping: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        formatter.groupingSize = 3
        formatter.usesGroupingSeparator = true
        // Pinned rather than inherited: `toLocaleString("en-US")` is en-US on
        // every device, and a phone set to de_DE would otherwise print
        // "9.500" for a figure the app writes as "9,500".
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.maximumFractionDigits = 0
        return formatter
    }()
}

// ── The drift guard ─────────────────────────────────────────────────────────

#if DEBUG
    extension NvFormat {

        /**
         Replays the format samples in `MarketFixture` and reports every
         disagreement. Called alongside `MarketMath.verifyAgainstFixture()`.

         Exact string comparison, unlike the price check: a display rule has no
         tolerance. "12.4K" and "12.5K" are different answers and one of them
         is wrong.
         */
        @discardableResult
        static func verifyAgainstFixture() -> [String] {
            var problems: [String] = []
            for sample in MarketFixture.formats {
                let mine: String
                switch sample.rule {
                case "money": mine = money(sample.input)
                case "delta": mine = delta(sample.input)
                case "percent": mine = percent(sample.input, signed: true)
                default: continue
                }
                if mine != sample.output {
                    problems.append(
                        "\(sample.rule)(\(sample.input)): swift \"\(mine)\" vs engine \"\(sample.output)\""
                    )
                }
            }
            if !problems.isEmpty {
                print(
                    """
                    [novus] NvFormat has drifted from lib/engine/format.ts \
                    — \(problems.count) of \(MarketFixture.formats.count) samples disagree:
                    \(problems.prefix(5).joined(separator: "\n"))
                    """)
            }
            return problems
        }
    }
#endif
