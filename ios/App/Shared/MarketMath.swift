import Foundation

/**
 RobinGhood's tape, on this side of the bridge.

 ── Why this exists at all, given that it is a second implementation ─────────

 It is a second implementation, and that is normally the thing to refuse. It is
 here because the alternative is worse and because the maths is exceptional in
 one specific way: `lib/engine/market.ts` prices every ticker as a PURE
 FUNCTION of (symbol, minute-since-epoch). Nothing is stored, nothing is
 random at read time, and any two processes that agree on the clock agree on
 the price.

 That property is the whole reason a Live Activity showing a position can be
 alive rather than a photograph. A widget process gets a few seconds of CPU
 every fifteen minutes or so and never gets to ask the app anything; without
 this file the lock screen would show whatever the price was the last time the
 player opened the game, which for an overnight position is a number with the
 wrong sign on it.

 ── What keeps the two from drifting ─────────────────────────────────────────

 Three things, in increasing order of how much they are worth:

 1. **No constants live here.** `base`, `drift` and `vol` ride in the snapshot
    from `TICKERS` in market.ts. Adding a ticker, or retuning one, changes
    nothing in this file and needs no new build of it.
 2. **The app's own answer is the anchor.** Every snapshot carries `value` and
    `unrealised` as the engine computed them at `minute`. `repriced(at:)` below
    returns those verbatim for the published minute and extrapolates only for
    minutes AFTER it — so a disagreement can never be older than the last time
    the player had the app open.
 3. **A fixture, checked in DEBUG.** `scripts/market-fixture.mjs` runs the real
    TypeScript over a spread of symbols and minutes and writes the answers into
    `MarketFixture.swift`. `verifyAgainstFixture()` replays them here. A port
    that stops agreeing fails on the first debug launch instead of on a
    stranger's lock screen.

 ── The port itself ──────────────────────────────────────────────────────────

 Everything integer is `UInt32` arithmetic with wrapping operators, which is
 exactly what JavaScript's `Math.imul`, `|0` and `>>>` add up to: both sides
 are manipulating a 32-bit pattern and only the spelling differs. Everything
 else is `Double`, which is the same IEEE-754 binary64 in both languages.

 `pow` is the one call whose last bit is not guaranteed identical across
 implementations, which is why the fixture check below compares with a relative
 tolerance rather than for equality. A price is rendered to the cent; a
 disagreement in the fifteenth significant figure is not a drift, and treating
 it as one would make the check cry wolf until somebody deleted it.
 */
enum MarketMath {

    // ── The seeded RNG, ported from lib/engine/rng.ts ────────────────────────

    /// FNV-1a over UTF-16 code units — `hashString` in rng.ts, exactly.
    static func hash(_ string: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for unit in string.utf16 {
            h ^= UInt32(unit)
            h = h &* 16_777_619
        }
        return h
    }

    /**
     mulberry32, ported from rng.ts.

     Returns one draw rather than a generator: every call site in market.ts
     seeds a fresh generator and takes exactly one number from it, and a
     stateful closure here would be a mutable thing to get wrong for no gain.
     */
    static func draw(seed: UInt32) -> Double {
        let a = seed &+ 0x6D2B_79F5
        var t = (a ^ (a >> 15)) &* (a | 1)
        t = (t &+ ((t ^ (t >> 7)) &* (t | 61))) ^ t
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }

    // ── The tape ─────────────────────────────────────────────────────────────

    /// Minutes since epoch. The clock both sides price against.
    static func minute(at date: Date = Date()) -> Int {
        Int(floor(date.timeIntervalSince1970 / 60))
    }

    /**
     `priceAt` from market.ts: a slow trend, an intraday session wave, a seeded
     daily gap and seeded minute noise, layered so the tape looks alive at
     every zoom.
     */
    static func price(symbol: String, base: Double, drift: Double, vol: Double, minute: Int)
        -> Double
    {
        let dayIndex = Int(floor(Double(minute) / 1440))
        let minuteOfDay = Double(minute - dayIndex * 1440)

        // Long trend: drift applied per day.
        let trend = pow(1 + drift / 365, Double(dayIndex % 3650))

        // Session shape — a slow intraday wave, unique per ticker.
        let phase = Double(hash(symbol) % 1000)
        let ofDay = minuteOfDay / 1440
        let session =
            1 + (vol / 100)
            * (sin(ofDay * .pi * 2 + phase) * 0.6 + sin(ofDay * .pi * 6 + phase) * 0.25)

        // Day-to-day gap: a seeded jump each day.
        let gap = 1 + (draw(seed: hash("\(symbol):\(dayIndex)")) - 0.5) * (vol / 45)

        // Minute noise, seeded so the tape is stable on reload.
        let noise = 1 + (draw(seed: hash("\(symbol):\(minute)")) - 0.5) * (vol / 260)

        return max(0.01, base * trend * session * gap * noise)
    }

    static func price(_ position: OutsidePosition, minute: Int) -> Double {
        price(
            symbol: position.symbol, base: position.base, drift: position.drift,
            vol: position.vol, minute: minute)
    }
}

// ── What a position is worth right now ──────────────────────────────────────

extension OutsidePosition {
    func marketValue(at minute: Int) -> Double { MarketMath.price(self, minute: minute) * shares }
    /// Deliberately not `unrealised(at:)`: the struct already has a stored
    /// `unrealised`, and a method sharing its name is one autocomplete slip
    /// away from reading the publish-time figure where the repriced one was
    /// meant.
    func gain(at minute: Int) -> Double { marketValue(at: minute) - avgCost * shares }
}

extension OutsideMarket {
    /**
     The book, re-priced for a minute the app never saw.

     Returns the published figures untouched when asked for the published
     minute — or for one before it, which happens whenever a widget refreshes
     from a timeline entry that was scheduled before the last publish landed.
     Recomputing the past would replace the engine's own answer with this
     file's opinion of it, which is precisely the trade this file is not
     allowed to make.
     */
    func repriced(at minute: Int) -> (value: Double, unrealised: Double, minute: Int) {
        guard minute > self.minute else { return (value, unrealised, self.minute) }
        // `held` rather than `value`: a local named for a stored property is a
        // shadow the compiler is entitled to reject and a reader is entitled
        // to misread.
        let held = positions.reduce(0) { $0 + $1.marketValue(at: minute) }
        return (held, held - cost, minute)
    }

    /// Change against the same book 1440 minutes ago — the day line RobinGhood draws.
    func dayChange(at minute: Int) -> Double {
        let now = positions.reduce(0) { $0 + $1.marketValue(at: minute) }
        let then = positions.reduce(0) { $0 + $1.marketValue(at: minute - 1440) }
        return then > 0 ? (now - then) / then * 100 : 0
    }

    /// The one the player has the most riding on. Snapshots arrive sorted; this
    /// does not assume it, because a sort order is not a contract.
    var largest: OutsidePosition? { positions.max { $0.value < $1.value } }
}

// ── The drift guard ─────────────────────────────────────────────────────────

#if DEBUG
    extension MarketMath {

        /**
         Replays `scripts/market-fixture.mjs` and reports every disagreement.

         Called once from the widget bundle's initialiser, so a broken port
         announces itself on the first debug launch rather than on a lock
         screen. Costs nothing in a Release build, where the whole thing is
         compiled out.

         The tolerance is relative and generous by the standards of a bit-exact
         port and tight by the standards of a rendered price: 1e-9 of the value
         is eleven orders of magnitude below a cent on the most expensive
         ticker in the table. Anything that fails this is a real difference in
         the maths, not a rounding artefact of `pow`.
         */
        @discardableResult
        static func verifyAgainstFixture() -> [String] {
            var problems: [String] = []
            for sample in MarketFixture.samples {
                let mine = price(
                    symbol: sample.symbol, base: sample.base, drift: sample.drift,
                    vol: sample.vol, minute: sample.minute)
                let theirs = sample.price
                let tolerance = max(abs(theirs) * 1e-9, 1e-12)
                if abs(mine - theirs) > tolerance {
                    problems.append(
                        "\(sample.symbol)@\(sample.minute): swift \(mine) vs engine \(theirs)")
                }
            }
            if !problems.isEmpty {
                print(
                    """
                    [novus] MarketMath has drifted from lib/engine/market.ts \
                    — \(problems.count) of \(MarketFixture.samples.count) samples disagree:
                    \(problems.prefix(5).joined(separator: "\n"))
                    Regenerate the fixture with `npm run market:fixture` and diff the two.
                    """)
            }
            return problems
        }
    }
#endif
