import ActivityKit
import SwiftUI
import WidgetKit

/**
 RobinGhood — the brokerage book, on the Lock Screen.

 ── Why this one can exist at all ────────────────────────────────────────────

 Every other number in Novus moves only when the player taps. The market does
 not: `lib/engine/market.ts` prices each ticker as a pure function of (symbol,
 minute-since-epoch), so the tape keeps running while the app is shut and while
 the fiscal year stands perfectly still. That asymmetry is the whole reason
 there is a second activity rather than one more row on the first — a founder
 who put company money into FinnCoin has one thing that can genuinely change
 overnight, and it is this.

 ── What "live" honestly means here ──────────────────────────────────────────

 A Live Activity is not a running process. The system renders these views as
 snapshots — when the activity starts, when the app updates it, and when the
 Dynamic Island is expanded — and there is no timer in this file that could
 fire between those moments.

 So the numbers are re-derived at RENDER time rather than carried from publish
 time: `MarketMath` re-prices the book for the current minute every time the
 system draws, which means an expanded Dynamic Island shows the price now
 rather than the price when the app was last open. Between renders the card
 holds still and says when it was published, and `staleDate` lets iOS dim it
 once that is old enough to stop being a claim.

 The surface that genuinely ticks on its own is `MarketWidget` next door, which
 can schedule a timeline of future entries. Both are drawn by the same views
 below, from the same maths, so they cannot disagree.
 */
@available(iOS 16.2, *)
struct MarketActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MarketAttributes.self) { context in
            MarketCard(book: MarketBook(context.state.market), companyName: context.state.companyName)
                .padding(13)
                .activitySystemActionForegroundColor(Nv.action)
        } dynamicIsland: { context in
            let book = MarketBook(context.state.market)

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("ROBINGHOOD")
                            .font(NvType.label(12, weight: .black))
                            .tracking(0.5)
                            .foregroundStyle(Nv.primary)
                        Text(context.state.companyName.uppercased())
                            .font(NvType.label(9, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(Nv.tertiary)
                            .lineLimit(1)
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        // The trailing region is about ninety points wide and
                        // a book worth $1.2M is eight glyphs of monospace.
                        // Both of these shrink rather than wrap.
                        Text(book.valueText)
                            .font(NvType.figure(16, weight: .bold))
                            .foregroundStyle(Nv.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Text(book.unrealisedText)
                            .font(NvType.figure(11, weight: .bold))
                            .foregroundStyle(book.tint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 5) {
                        ForEach(book.rows.prefix(3), id: \.symbol) { row in
                            PositionRow(row: row)
                        }
                    }
                    .padding(.top, 2)
                }
            } compactLeading: {
                Image(systemName: book.arrow)
                    .foregroundStyle(book.tint)
            } compactTrailing: {
                Text(book.dayText)
                    .font(NvType.figure(13, weight: .bold))
                    .foregroundStyle(book.tint)
            } minimal: {
                Image(systemName: book.arrow)
                    .foregroundStyle(book.tint)
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://market"))
            .keylineTint(book.tint)
        }
    }
}

// ── The book, re-priced ─────────────────────────────────────────────────────

/**
 One re-pricing, done once, for every view that needs a piece of it.

 Built at render time from the current minute. Doing it here rather than in
 each view is what stops the compact and expanded presentations of the same
 activity from being computed a minute apart and disagreeing about the sign.
 */
struct MarketBook {
    let rows: [Row]
    let valueText: String
    let unrealisedText: String
    let dayText: String
    let up: Bool
    let minute: Int
    let published: Int

    struct Row {
        let symbol: String
        let name: String
        let shares: Double
        let valueText: String
        let changeText: String
        let up: Bool
    }

    init(_ market: OutsideMarket) {
        let now = MarketMath.minute()
        let (value, unrealised, minute) = market.repriced(at: now)

        self.minute = minute
        self.published = market.minute
        self.valueText = NvFormat.money(value)
        self.unrealisedText = NvFormat.delta(unrealised)
        self.up = unrealised >= 0
        self.dayText = NvFormat.percent(market.dayChange(at: minute), signed: true)

        self.rows = market.positions.map { position in
            let held = position.marketValue(at: minute)
            let gain = held - position.avgCost * position.shares
            let basis = position.avgCost * position.shares
            return Row(
                symbol: position.symbol,
                name: position.name,
                shares: position.shares,
                valueText: NvFormat.money(held),
                changeText: NvFormat.percent(basis > 0 ? gain / basis * 100 : 0, signed: true),
                up: gain >= 0)
        }
    }

    /// Solvency green for upside, alert red for damage. `--solvency` is
    /// financial upside ONLY and never a call to action, which is exactly what
    /// this is.
    var tint: Color { up ? Nv.solvency : Nv.alert }
    var arrow: String { up ? "arrow.up.right" : "arrow.down.right" }

    /// True when this was drawn from a book the app published a while ago. The
    /// PRICES are current either way — the share counts are what age.
    var isStale: Bool { minute - published > 180 }
}

// ── The Lock Screen card ────────────────────────────────────────────────────

@available(iOS 16.2, *)
struct MarketCard: View {
    let book: MarketBook
    let companyName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Nv.action)

                Text("ROBINGHOOD")
                    .font(NvType.label(11, weight: .black))
                    .tracking(0.7)
                    .foregroundStyle(Nv.primary)

                Spacer(minLength: 6)

                Text(companyName.uppercased())
                    .font(NvType.label(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(1)
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(book.valueText)
                    .font(NvType.figure(26, weight: .bold))
                    .foregroundStyle(Nv.primary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)

                VStack(alignment: .leading, spacing: 0) {
                    Text(book.unrealisedText)
                        .font(NvType.figure(12, weight: .bold))
                        .foregroundStyle(book.tint)
                    Text("\(book.dayText) TODAY")
                        .font(NvType.label(8, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(Nv.tertiary)
                }

                Spacer(minLength: 0)
            }

            VStack(spacing: 4) {
                ForEach(book.rows.prefix(3), id: \.symbol) { row in
                    PositionRow(row: row)
                }
            }
        }
    }
}

// ── One holding ─────────────────────────────────────────────────────────────

struct PositionRow: View {
    let row: MarketBook.Row

    var body: some View {
        HStack(spacing: 6) {
            Text(row.symbol)
                .font(NvType.figure(11, weight: .black))
                .foregroundStyle(Nv.primary)
                .frame(width: 42, alignment: .leading)

            Text(shares)
                .font(NvType.label(10, weight: .semibold))
                .foregroundStyle(Nv.tertiary)
                .lineLimit(1)

            Spacer(minLength: 4)

            Text(row.valueText)
                .font(NvType.figure(11, weight: .bold))
                .foregroundStyle(Nv.secondary)
                // The one text on this row with no fixed width. Without a
                // limit a long figure wraps, and a wrapped row in a region
                // measured in points is a row that gets clipped.
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(row.changeText)
                .font(NvType.figure(11, weight: .bold))
                .foregroundStyle(row.up ? Nv.solvency : Nv.alert)
                .frame(width: 52, alignment: .trailing)
        }
    }

    /// Whole shares read as whole shares. The engine allows fractions and a
    /// row that says "4.0 sh" is a row that looks like a bug.
    private var shares: String {
        row.shares == row.shares.rounded()
            ? "\(Int(row.shares)) sh"
            : String(format: "%.2f sh", row.shares)
    }
}
